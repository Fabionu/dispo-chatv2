-- Durable cache for the HERE HGV restriction tiles.
--
-- Every tile HERE serves is a billed Advanced Raster Tile transaction, and the
-- only cache in front of it was per-process memory — emptied by every deploy or
-- restart, so each one re-bought the same tiles. Restriction signs change on a
-- map-release scale, so a stored tile stays good for weeks.
--
-- `png` is empty (zero bytes) for a tile HERE answered 404 for: "nothing here"
-- is an answer worth keeping too. `fetched_at` drives expiry and the purge.
create table here_tile_cache (
  cache_key text primary key,
  png bytea not null,
  fetched_at timestamptz not null default now()
);

create index here_tile_cache_fetched_at_idx on here_tile_cache (fetched_at);
