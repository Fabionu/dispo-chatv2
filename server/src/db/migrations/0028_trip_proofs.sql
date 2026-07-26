-- Immutable audit trail for the transport documents a driver must submit
-- before leaving a loading stop or completing an unloading stop.

create table trip_proofs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  trip_id text not null,
  stop_id text not null,
  uploaded_by uuid not null references users(id) on delete restrict,
  kind text not null check (kind in ('loading', 'unloading')),
  original_name text not null,
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'application/pdf')
  ),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 26214400),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index trip_proofs_trip_kind_created_idx
  on trip_proofs (trip_id, kind, created_at desc);

create index trip_proofs_group_id_idx on trip_proofs (group_id);
create index trip_proofs_uploaded_by_idx on trip_proofs (uploaded_by);
