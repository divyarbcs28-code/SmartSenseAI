-- SmartSense Rest Mode — core schema
-- Pipeline: ESP32 + BioAmp (EEG/EOG, 100 Hz, 30s epochs) -> 32-feature
-- extraction (20 EEG + 12 EOG) -> XGBoost N2 classifier -> temporal
-- sleep-state engine -> Smart Alarm.
--
-- Design goals (per spec): store meaningful application state,
-- predictions, session history, alarm events and model/version info —
-- never raw per-sample EEG/EOG rows (an 8h session at 100 Hz would be
-- ~2.88M samples/channel, ~5.76M for two channels). Raw signal, if kept
-- at all, lives in file/blob storage; the DB only holds a reference.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- 1. USERS
-- Extends Supabase Auth 1:1. If you're not using Supabase Auth, drop the
-- "references auth.users" and generate ids with gen_random_uuid() instead.
-- ---------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. DEVICES
-- ---------------------------------------------------------------------
create table public.devices (
  device_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  device_name text,
  firmware_version text,
  sampling_rate_hz integer not null default 100,
  eeg_channel_config jsonb, -- e.g. {"channels": ["Fp1","Fp2"], "gain": 24}
  eog_channel_config jsonb, -- e.g. {"channels": ["LOC","ROC"]}
  connection_status text not null default 'disconnected'
    check (connection_status in ('connected', 'disconnected', 'pairing')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_devices_user_id on public.devices (user_id);

-- ---------------------------------------------------------------------
-- 3. MODEL_VERSIONS
-- Referenced by sleep_epochs so every prediction is traceable to the
-- exact model + feature-extractor build that produced it.
-- ---------------------------------------------------------------------
create table public.model_versions (
  model_version_id uuid primary key default gen_random_uuid(),
  model_name text not null,
  version text not null,
  algorithm text not null default 'XGBoost',
  feature_extractor_version text not null,
  training_dataset text,
  validation_metrics jsonb, -- {"accuracy":0.93,"f1":0.91,"auc":0.95,...}
  model_path text,          -- storage path/reference to the serialized model
  notes text,
  created_at timestamptz not null default now(),
  unique (model_name, version)
);

-- ---------------------------------------------------------------------
-- 4. SLEEP_SESSIONS
-- One row = one full sleep session/night.
-- ---------------------------------------------------------------------
create table public.sleep_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  device_id uuid not null references public.devices (device_id) on delete restrict,
  start_time timestamptz not null default now(),
  end_time timestamptz,
  target_wake_time timestamptz,
  smart_wake_window_start timestamptz,
  smart_wake_window_end timestamptz,
  session_status text not null default 'active'
    check (session_status in ('active', 'completed', 'aborted')),
  n2_threshold real not null default 0.6 check (n2_threshold between 0 and 1),
  required_consecutive_n2_epochs integer not null default 3,
  -- Optional: if raw EEG/EOG is retained for research/debugging, it lives
  -- as a file/blob (e.g. a Supabase Storage object or S3 key) and this
  -- column just points to it — never store raw samples as DB rows.
  raw_recording_ref text,
  created_at timestamptz not null default now()
);
create index idx_sessions_user_start on public.sleep_sessions (user_id, start_time desc);
create index idx_sessions_device_id on public.sleep_sessions (device_id);

-- ---------------------------------------------------------------------
-- 5. SLEEP_EPOCHS
-- One row = one 30s epoch. An 8h session is ~960 rows — this table is
-- the write-heavy one, so epoch_id is a bigint identity (cheaper to
-- index and naturally ordered) rather than a uuid.
-- ---------------------------------------------------------------------
create table public.sleep_epochs (
  epoch_id bigint generated always as identity primary key,
  session_id uuid not null references public.sleep_sessions (session_id) on delete cascade,
  epoch_number integer not null, -- 1, 2, 3... within the session
  epoch_start_time timestamptz not null,
  epoch_end_time timestamptz not null,

  -- The 32 extracted features (20 EEG + 12 EOG). Kept as jsonb rather
  -- than 32 named columns while the prototype's feature set is still
  -- evolving — no migration needed to add/drop a feature. Switch to
  -- named real columns later if you want simpler SQL aggregation once
  -- the feature list is frozen.
  -- e.g. {"eeg_delta_power": 12.4, "eeg_theta_power": 8.1, ...,
  --       "eog_rem_rate": 0.03, "eog_blink_count": 2, ...}
  features jsonb not null,

  n2_probability real not null check (n2_probability between 0 and 1),
  binary_prediction boolean not null, -- true = N2, false = W/N1/N3/R
  prediction_label text not null check (prediction_label in ('N2', 'NOT_N2')),
  smoothed_n2_probability real check (smoothed_n2_probability between 0 and 1),
  recent_n2_count smallint, -- N2 count within the trailing smoothing window
  current_smoothed_sleep_state text not null
    check (current_smoothed_sleep_state in ('WAKE', 'NON_N2', 'N2')),
  state_changed boolean not null default false,
  event_type text, -- e.g. 'state_change', 'wake_window_open'

  eeg_signal_quality real check (eeg_signal_quality between 0 and 1),
  eog_signal_quality real check (eog_signal_quality between 0 and 1),
  eeg_missing_fraction real check (eeg_missing_fraction between 0 and 1),
  eog_missing_fraction real check (eog_missing_fraction between 0 and 1),

  model_version_id uuid references public.model_versions (model_version_id),

  -- DREAMT / offline-validation only. The real wearable never populates
  -- these — it has no ground truth at inference time.
  ground_truth_label text,
  ground_truth_binary boolean,
  is_correct boolean generated always as (
    case when ground_truth_binary is null then null
         else (binary_prediction = ground_truth_binary) end
  ) stored,

  created_at timestamptz not null default now(),
  unique (session_id, epoch_number)
);
create index idx_epochs_session_id on public.sleep_epochs (session_id);
create index idx_epochs_session_epoch on public.sleep_epochs (session_id, epoch_number);
create index idx_epochs_model_version on public.sleep_epochs (model_version_id);

-- ---------------------------------------------------------------------
-- 6. ALARM_EVENTS
-- ---------------------------------------------------------------------
create table public.alarm_events (
  alarm_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sleep_sessions (session_id) on delete cascade,
  trigger_time timestamptz not null default now(),
  target_wake_time timestamptz,
  alarm_type text not null check (alarm_type in ('SMART_ALARM', 'HARD_ALARM')),
  triggering_epoch_id bigint references public.sleep_epochs (epoch_id),
  n2_probability_at_trigger real check (n2_probability_at_trigger between 0 and 1),
  consecutive_n2_epochs integer,
  status text not null default 'TRIGGERED'
    check (status in ('TRIGGERED', 'ACKNOWLEDGED', 'SNOOZED', 'DISMISSED')),
  created_at timestamptz not null default now()
);
create index idx_alarms_session_id on public.alarm_events (session_id);

-- ---------------------------------------------------------------------
-- Row Level Security — each driver only ever sees their own data.
-- model_versions is shared reference data: readable by any signed-in user.
-- ---------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.devices enable row level security;
alter table public.sleep_sessions enable row level security;
alter table public.sleep_epochs enable row level security;
alter table public.alarm_events enable row level security;
alter table public.model_versions enable row level security;

create policy "Users read/update their own profile"
  on public.users for all
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "Users manage their own devices"
  on public.devices for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage their own sessions"
  on public.sleep_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users access epochs of their own sessions"
  on public.sleep_epochs for all
  using (exists (
    select 1 from public.sleep_sessions s
    where s.session_id = sleep_epochs.session_id and s.user_id = auth.uid()
  ));

create policy "Users access alarms of their own sessions"
  on public.alarm_events for all
  using (exists (
    select 1 from public.sleep_sessions s
    where s.session_id = alarm_events.session_id and s.user_id = auth.uid()
  ));

create policy "Authenticated users can read model versions"
  on public.model_versions for select
  using (auth.role() = 'authenticated');
