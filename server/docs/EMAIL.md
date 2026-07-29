# Transactional email

Dispo-chat uses Resend for:

- account email confirmation;
- confirmation-email resend;
- addressed company invitations.

## Resend setup

1. Add a sending subdomain in Resend (for example `updates.example.com`).
2. Publish the SPF and DKIM records shown by Resend and wait for the domain to
   become verified. DMARC is also recommended.
3. Configure these server/Railway variables:

   ```dotenv
   RESEND_API_KEY=re_...
   EMAIL_FROM=Dispo-chat <notifications@updates.example.com>
   EMAIL_REPLY_TO=support@example.com
   PUBLIC_ORIGIN=https://your-public-app.example.com
   ```

4. Run the database migrations and redeploy:

   ```bash
   npm run migrate
   npm run build
   ```

`RESEND_API_KEY` is a server secret. It must never be prefixed with `VITE_`,
committed, logged, or included in the Android build.

## Security model

Verification links contain 256-bit random, single-use tokens. Only a SHA-256
hash is stored in Postgres; links expire after 24 hours and a resend invalidates
older live links. Existing accounts are backfilled as verified during migration
so deployment does not lock them out.

