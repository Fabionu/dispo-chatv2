-- Company / workspace operational profile fields.
--
-- Extends `workspaces` with the registration + dispatch details a transport
-- company needs. Editable only by admins (enforced in the API). All columns are
-- nullable, so existing workspaces remain valid without a backfill.
--
--   logo_path           storage object key for the company logo (NULL → keep
--                       the default Box icon).
--   legal_name          registered legal entity name (vs the display name).
--   vat_id              VAT / tax identification number.
--   country, city       operational location.
--   operational_address full operational address.
--   dispatch_email      dispatch contact email.
--   dispatch_phone      dispatch contact phone.
--   website             company website URL.

alter table workspaces
  add column logo_path text,
  add column legal_name text,
  add column vat_id text,
  add column country text,
  add column city text,
  add column operational_address text,
  add column dispatch_email text,
  add column dispatch_phone text,
  add column website text;
