-- Durable GPS history for vehicle trips.
--
-- WHY: `groups.meta.driverLocations` answers "where is the truck now" and
-- `groups.meta.driverTrails` held a breadcrumb path — but the trail is keyed by
-- room and reset the moment a new trip starts, so a completed trip's path was
-- lost as soon as the vehicle got its next job. This adds the durable half:
-- every VALIDATED fix of every trip, kept after the trip completes and after the
-- room moves on. The meta blobs stay exactly as they are (live position + the
-- in-flight trail the map already seeds from) — nothing here rewrites them.
--
-- Additive only: two new tables and their indexes. No existing table, column or
-- row is touched, so applying this cannot break a running deployment.
--
-- ROLLBACK (this project's runner has no down-step; run manually if ever needed):
--   drop table if exists trip_track_points;
--   drop table if exists trip_tracks;
--   delete from _migrations where id = '0031_trip_tracks.sql';

-- ── Per (trip, driver) rollup ────────────────────────────────────────────────
-- The running totals, maintained incrementally on ingest so "kilometres driven"
-- is a single-row read instead of a scan over every point. It also holds the
-- last ACCEPTED fix, which is what the validator compares each new ping against
-- — that comparison is what makes ingest idempotent (a replayed ping is not
-- newer than `last_recorded_at`, so it banks no second copy of the same metres).
create table if not exists trip_tracks (
  trip_id            text not null,
  driver_id          uuid not null references users(id) on delete cascade,
  group_id           uuid not null references groups(id) on delete cascade,
  distance_m         double precision not null default 0 check (distance_m >= 0),
  point_count        integer not null default 0 check (point_count >= 0),
  last_lat           double precision,
  last_lng           double precision,
  last_recorded_at   timestamptz,
  first_recorded_at  timestamptz,
  -- Monotonic counter, bumped when a signal gap means the next point must NOT be
  -- joined to the previous one by a straight line.
  segment            integer not null default 0 check (segment >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (trip_id, driver_id)
);

create index if not exists trip_tracks_group_idx on trip_tracks (group_id, trip_id);
create index if not exists trip_tracks_driver_idx on trip_tracks (driver_id, updated_at desc);

-- ── The history itself ───────────────────────────────────────────────────────
create table if not exists trip_track_points (
  id           bigserial primary key,
  trip_id      text not null,
  driver_id    uuid not null references users(id) on delete cascade,
  group_id     uuid not null references groups(id) on delete cascade,
  lat          double precision not null check (lat >= -90 and lat <= 90),
  lng          double precision not null check (lng >= -180 and lng <= 180),
  recorded_at  timestamptz not null,
  accuracy_m   real,
  heading_deg  real,
  speed_mps    real,
  -- Validated ground distance from the previous accepted point. Zero for the
  -- first point of a track and for the first point after a gap, so summing this
  -- column can never double-count and never invents distance across a hole.
  distance_m   double precision not null default 0 check (distance_m >= 0),
  -- Points sharing a segment may be joined into one drawn line; a change of
  -- segment means "no data in between — do not draw across it".
  segment      integer not null default 0 check (segment >= 0),
  created_at   timestamptz not null default now()
);

-- The idempotency key: one row per (trip, driver, capture instant). A retry or a
-- reconnect that replays the same ping hits this index and is discarded instead
-- of banking the same metres twice.
create unique index if not exists trip_track_points_fix_idx
  on trip_track_points (trip_id, driver_id, recorded_at);

-- Reads: the whole path of a trip in capture order, and one driver's recent
-- history. Both are the access patterns the history endpoints use.
create index if not exists trip_track_points_trip_time_idx
  on trip_track_points (trip_id, recorded_at);
create index if not exists trip_track_points_driver_time_idx
  on trip_track_points (driver_id, recorded_at desc);
create index if not exists trip_track_points_group_idx
  on trip_track_points (group_id, recorded_at desc);
