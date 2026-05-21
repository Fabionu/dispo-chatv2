-- Session strategy decision: STATELESS JWT ONLY.
--
-- The `sessions` table was created in 0001 but never used — auth is entirely
-- JWT-in-an-httpOnly-cookie (see server/src/auth.ts: issueSession signs a
-- token, readSession verifies it, no DB row is involved). Keeping an empty,
-- unreferenced table is misleading dead code, so we drop it and make the
-- stateless choice explicit.
--
-- Tradeoff accepted: a signed-out cookie is cleared client-side, but the JWT
-- itself stays cryptographically valid until its 7-day expiry. There is no
-- server-side revocation. This is the standard stateless tradeoff and is
-- fine at this stage. If device management / instant revocation is needed
-- later, reintroduce a sessions (or token denylist) table in its own
-- migration — built for that purpose, not left lying around unused.

drop table if exists sessions;
