-- Structured address on a saved place.
--
-- A place stored its address as ONE free-text line (whatever HERE's reverse
-- geocode returned, or whatever was typed over it). A vehicle stop keeps street
-- / country / postal code / city apart, so picking a saved place while adding a
-- stop could only fill the street box — with the whole line in it — and left the
-- other three empty. Splitting that line back apart in the client would mean
-- guessing which comma is which, and a wrong guess writes a wrong address into
-- an operational record silently.
--
-- So the place stores what the stop stores. `address` STAYS: it is the one-line
-- label the map and the Places list show, every existing row has one, and
-- nothing built from these columns is required to be complete.
--
-- Lengths mirror the stop's own fields (see VehicleStop in lib/vehicleOps.ts):
-- country is the 2–3 character code the stop form accepts, not a country name.
alter table workspace_places
  add column street text check (street is null or char_length(street) <= 160),
  add column country text check (country is null or char_length(country) <= 3),
  add column postal_code text check (postal_code is null or char_length(postal_code) <= 16),
  add column city text check (city is null or char_length(city) <= 120);
