# PUP Unisan SSC Feedback & Certificates

Mobile-friendly feedback form, admin question builder, response CSV export, and downloadable certificates. Built with browser JavaScript and Supabase; deployed as a static site on Vercel. Your supplied SSC logo appears in the navigation, participant header, favicon, and built-in certificate.

## 1. Create the Supabase database

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor → New query**, paste all of `supabase-schema.sql`, and run it. It creates tables, starter questions, validation, admin policies, and the atomic form-save function. You can rerun it without resetting certificate settings. If upgrading an existing database, back it up first.
3. Under **Authentication → Providers → Email**, disable public signups. Participants submit without accounts.
4. Under **Authentication → Users**, create your admin account with a strong password and confirmed email.
5. Run this SQL, replacing the email with that exact admin account:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
     || '{"role":"admin"}'::jsonb
   where email = 'your-admin-email@example.com';
   ```

   Sign out and sign back in after granting or changing roles. Only accounts with `app_metadata.role = admin` can edit the form or read participant responses. Never use user-editable `user_metadata` for this role.

6. From the project's **Connect dialog or Settings → API Keys**, copy the project URL and **publishable key** (`sb_publishable_...`). A legacy `anon` key also works. Never supply `service_role`, `sb_secret_...`, a database password, or a connection string to this app.

## 2. Preview locally

Install Node.js 22 or later, then:

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:3000. This command is an explicitly labeled, temporary demo. Restart after edits. Demo submissions and admin changes disappear on reload.

To use your actual database locally, copy `.env.example` to `.env`, fill in both values, then run:

```powershell
node scripts/build.mjs --serve
```

Production builds fail when credentials are missing or a secret key is supplied. Browser configuration cannot override the deployed project's connection. Public Supabase keys are intentionally visible in browser assets; database RLS protects the data.

## 3. Deploy to Vercel

1. Put this folder in a GitHub repository; commit the source and `package-lock.json`. Keep `.env` out of Git.
2. Import that repository into https://vercel.com/new.
3. Use **Framework Preset: Other**, repository root as Root Directory, **Build Command: `npm run build`**, and **Output Directory: `dist`**. `vercel.json` already declares these settings and security headers.
4. Add these environment variables for **Production** and, if needed, **Preview**:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | `https://your-project.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | your project's publishable key |

5. Deploy. Environment changes require a new deployment. Use a separate Supabase project for previews if you want to avoid preview submissions touching production.
6. In Supabase **Authentication → URL Configuration**, set Site URL to your final HTTPS Vercel/custom domain. Add only your intended redirect URLs if you later enable recovery or email sign-in flows.
7. Open `https://your-domain/?admin=1`, sign in, and configure the questions, event wording, certificate, and **actual authorized signatory**. The starter signatory is a placeholder. Use **Send** to copy the participant link.

No Supabase or Vercel account is connected to this workspace; deployment and live database configuration require the account steps above.

## Before sharing with students

- Submit a test response; confirm it appears in the admin portal, CSV exports correctly, and the PDF downloads with the logo and expected layout.
- With repeat submissions disabled (the default), try the same email again; it must not create another response or issue a certificate for a different name.
- Signed-out participants and signed-in accounts without the admin role must be unable to read responses or edit settings through the API.
- Review the privacy notice with your council, adding a real contact channel and retention period before collecting student information. Never ask for passwords or unnecessary sensitive data.
- Set the correct certificate issuer and signatory. Certificates are generated in the browser; they are not cryptographically signed or independently verifiable.

## Verification

### Allowing repeat submissions

For an existing Supabase project, run `migrations/20261025_allow_duplicate_responses.sql` in **SQL Editor** before deploying this update. It preserves all responses. New projects can use the full `supabase-schema.sql`, which includes this change.

In the admin **Form Builder → Response settings**, check **Allow multiple responses from the same email address**, then click **Save Response Settings**. This is off by default. When enabled, each submission is stored separately and can generate a certificate. Turn it off to block further submissions from any email already used; existing responses remain. The database enforces the setting, including for direct API requests and concurrent submissions. Email addresses are compared without case or surrounding spaces; this does not verify email ownership.

```powershell
npx playwright install chromium
npm test
npm audit
npm run build
```

Tests exercise database policies, input validation, transaction rollback, build configuration, and browser flows. A live Supabase/Vercel smoke test is still required after account setup.

## Current limits and useful next additions

- Multiple program forms have separate questions, responses, certificates and share links. Each email can respond once per program unless repeat submissions are enabled for that program.
- Public submission has no CAPTCHA or rate limit. Add a verified Turnstile challenge with a server/Edge Function before distributing the link widely. Browser-only checks cannot prevent automated submissions.
- Certificate downloads happen after a successful submission. Lost certificates need council assistance; secure self-service recovery should verify ownership by email.
- Custom PNG/JPEG/PDF/SVG templates are limited to 20 MB per upload and stored in settings as base64. SVG templates are converted on the admin's device into vector PDFs, then use the existing PDF certificate workflow; no database change is required for SVG support. Use a static, self-contained SVG with outlined text for custom fonts. Scripts, animation, HTML, filters, and external resources are rejected; for complex effects, upload the original PDF instead. Embedded photos retain their source resolution. The converted PDF must also fit within 20 MB. Larger saved templates increase participant page downloads; Supabase Storage is a better next step when large templates are used regularly.
- Custom PDF text uses standard PDF fonts, which may not support every character. Embed a Unicode font if needed; test actual student names and long names before launch.
- PDF templates (including converted SVGs) show their first page in the admin and participant previews. Preview rendering is separate from the original vector PDF used for downloads. The build includes the PDF.js compatibility library and matching local worker, fonts, CMaps, and decoding assets; deploy the complete `dist` folder and its configured security headers.
- The admin loads responses in batches for complete exports. For large events, add server-side search, analytics, and export jobs.

Official references: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vercel build settings](https://vercel.com/docs/builds/configure-a-build), [Vercel environment variables](https://vercel.com/docs/environment-variables).


## Multiple program forms

For an existing project with the repeat-submission migration installed, run `migrations/20261028_multiple_forms.sql` before deploying this frontend. Older projects must run `migrations/20261025_allow_duplicate_responses.sql` first. Do not apply the older migration again after the multi-form upgrade. Back up the live database first. New installations can use the complete `supabase-schema.sql`.

Open `?admin=1`, then use **Program forms → New program title → Create separate form**. The new program starts with fresh questions and a default certificate. Save its questions and certificate settings, and use **Send** to copy its separate `?form=ID` participant link. Responses and CSV exports apply to the selected program. Save changes before switching programs.

The existing program remains form 1, with its responses and certificate template preserved. Old participant links without a `form` parameter still load form 1. The same email can submit to different programs. All council admins can manage all programs. Demo programs and changes disappear on reload.

See [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) for the October 29 rollout checklist and prioritized improvements.


### Share a program by QR code

In the admin portal, select the correct program and click **Send**. The dialog generates a QR code for that program’s participant link. Choose **Download QR code (PNG)** to save a 1200-pixel image for posters or slides. Codes use a white background and include a clear border for scanning; keep that border when placing the image. Generation runs locally in the browser.

Generate the final code from your deployed website. A QR code created on localhost points to a local preview that other participants’ phones cannot access. No database migration is needed for the QR feature.
