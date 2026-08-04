-- Separate "where the truck last WAS" from "when we last HEARD from it".
--
-- WHY: a parked truck keeps pinging, and those pings are correctly filtered out
-- as stationary — but that left `last_recorded_at` frozen at the last STORED
-- point, so the time since the last fix kept growing while the phone was in fact
-- reporting normally. Once it passed the gap threshold the ingest declared a
-- signal gap and opened a new segment, for a truck that had simply been standing
-- at a loading dock with perfect reception. A dispatcher then saw "periods
-- without signal" that never happened.
--
-- `last_seen_at` records every TRUSTED fix, including the stationary ones that
-- are deliberately not stored. The gap test reads it, while distance still
-- measures from `last_lat`/`last_lng`/`last_recorded_at` — the last point we
-- actually banked — so the two clocks stop interfering with each other.
--
-- Additive: one nullable column, backfilled from the value it replaces so
-- existing tracks behave exactly as before.
--
-- ROLLBACK:
--   alter table trip_tracks drop column if exists last_seen_at;
--   delete from _migrations where id = '0032_trip_tracks_last_seen.sql';

alter table trip_tracks add column if not exists last_seen_at timestamptz;

update trip_tracks
   set last_seen_at = last_recorded_at
 where last_seen_at is null;
