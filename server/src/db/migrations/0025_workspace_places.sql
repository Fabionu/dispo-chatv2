-- Shared operational places (parking, depots, fuel stations, customers, etc.)
-- saved by members of a workspace and reused from the route planner.

create table workspace_places (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text not null check (
    category in ('parking', 'depot', 'fuel', 'customer', 'service', 'customs', 'other')
  ),
  address text check (address is null or char_length(address) <= 240),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every list query is scoped to one workspace and sorted/grouped by category +
-- name. Keeping the equality column first lets Postgres use one compact index.
create index workspace_places_workspace_category_name_idx
  on workspace_places (workspace_id, category, name);

-- PostgreSQL does not automatically index the referencing side of a foreign key.
create index workspace_places_created_by_idx on workspace_places (created_by);
