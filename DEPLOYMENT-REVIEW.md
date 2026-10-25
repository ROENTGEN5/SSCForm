# Deployment review — October 25, 2026

## Verdict

Suitable for a private deployment preview after Supabase setup. Do not treat this as public-launch approval: three issues were reproduced, production credentials are absent from this workspace, and the actual hosted database and Vercel deployment have not been tested.

Application source was not modified during this review.

## Checks performed

- `npm test`: **4 passed, 0 failed** after installing Playwright Chromium and permitting local browser traffic outside the sandbox.
- The suite checks production configuration guards; a production build with synthetic credentials and mocked Supabase requests; database error handling; mobile layout and logo loading; required fields; successful demo submission; duplicate-email blocking; a one-page default PDF download; admin question saving; database privileges, RLS, normalization, and transactional rollback.
- `npm audit --json`: **0 known vulnerabilities** reported for the installed dependency tree on the review date.
- `npm run build` without credentials: **fails**, as designed, with `Set SUPABASE_URL to your HTTPS Supabase project URL.` Configure both environment variables before deploying.
- Additional browser probes exercised checkbox clearing, response CSV export, custom PDF upload/save, and a custom PDF download with a Unicode name.
- Additional PostgreSQL probe checked whether an invalid checkbox option is rejected.
- Reviewed the mobile certificate screenshot. These checks used Chromium; Safari/iOS and Firefox were not tested.

The initial browser failures were missing Chromium and sandbox network restrictions, not app failures. The complete existing suite subsequently passed.

## Reproduced issues

### 1. Clearing the form retains hidden checkbox selections

**Location:** `js/app.js:471` and `js/app.js:716`.

Steps: change a question to checkboxes; select the first option; choose Clear form and confirm; select the second option; submit; export CSV. The CSV contains both `Keynote & Opening Plenary, Technical Deep Dives`, even though only the second option is visibly selected after clearing.

The clear handler empties the global answers and removes selection styling but does not clear each checkbox group's closed-over Set. This can silently save answers that differ from the screen. Reset the checkbox state or rebuild the participant questions on clear, then add a regression test.

### 2. The database accepts invalid checkbox answers

**Location:** `supabase-schema.sql:182`–`188`.

The validation trigger verifies rating values and single-choice membership but has no checkbox membership check. A direct insert as `anon` with `NONEXISTENT OPTION` for a required checkbox question succeeded in the local PostgreSQL test.

Validate each checkbox selection in the database. The current comma-joined string format is ambiguous when labels contain commas; a structured array format would need coordinated frontend and database changes. This issue affects response integrity; it does not demonstrate unauthorized access to other participants' responses.

### 3. Custom PDF certificates fail for unsupported name characters

**Location:** `js/app.js:823`–`829`.

Steps: upload a valid blank landscape PDF template; save it; submit as `Jose Łukasz`; download the certificate. The app shows `Could not generate PDF: WinAnsi cannot encode "Ł" (0x0141)`.

The response is already saved, and submitting again with the same email is blocked. The custom PDF branch needs an embedded font covering supported student names and a recovery process for failed downloads. The built-in certificate path uses a different renderer; this result applies to custom PDF templates.

## Other launch requirements and limitations

- Public submissions have no verified CAPTCHA or rate limiting. RLS prevents response reads but does not stop automated inserts.
- Email ownership and attendance are not verified. Someone can submit another person's email first; certificates are generated in the browser and are not independently authenticated.
- Replace the starter signatory and event wording. Add a real council contact and a retention period to the privacy notice in `index.html:136`.
- One survey is supported; email uniqueness applies across that survey's lifetime. Plan separate forms/events before reusing the database.
- Local PostgreSQL tests approximate Supabase auth claims and permissions. A live Supabase smoke test remains required.
- A successful mock production build confirms compilation, not the validity of real credentials or remote configuration.

## Deployment steps: Supabase + Vercel

1. Fix the reproduced issues before public launch. A private preview can be used for integration testing first.
2. Create a Supabase project at https://supabase.com/dashboard. In SQL Editor, run the entire `supabase-schema.sql`. Back up an existing database before applying schema changes.
3. Disable new public user signups in Supabase Authentication settings. Keep email/password sign-in available for administrators. Create and confirm an admin user under Authentication → Users.
4. In SQL Editor, grant that exact user the role:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
     || '{"role":"admin"}'::jsonb
   where email = 'your-admin-email@example.com';
   ```

   Sign out and sign back in after changing this role. Do not put the role in user-editable user metadata.
5. Copy the Supabase project URL and publishable key. Use a public `sb_publishable_...` key (or supported legacy `anon` key). Never put a secret/service-role key in this browser app.
6. Optionally test the real integration locally: copy `.env.example` to `.env`, replace both placeholders, run `npm ci`, then `node scripts/build.mjs --serve`, and open http://127.0.0.1:3000. `npm run dev` always starts the temporary demo, so do not use it to verify database persistence.
7. Push the source and `package-lock.json` to a GitHub repository. `.gitignore` already excludes `.env`, `node_modules`, and `dist`. Keep credentials out of Git.
8. Import the repository at https://vercel.com/new. Use the app's repository folder as Root Directory and these settings:

   | Setting | Value |
   | --- | --- |
   | Framework preset | Other |
   | Node.js | 24.x, matching the tested local major version |
   | Install command | `npm ci` |
   | Build command | `npm run build` |
   | Output directory | `dist` |

   `vercel.json` already supplies the build/output configuration and security headers.
9. Add Vercel environment variables for Production, and Preview if you use it:

   ```text
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_actual_key
   ```

   Use a separate Supabase project for previews when preview data should not reach production. These values are bundled at build time, so changing them requires redeployment.
10. Deploy. Set Supabase Authentication → URL Configuration → Site URL to the final HTTPS site URL. Add narrowly scoped redirect URLs if you later implement recovery or email-link authentication.
11. Open `https://YOUR-DOMAIN/?admin=1`. Sign in and set the actual event questions, certificate text, issuer, signatory, and template. Save, reload, and verify the changes persist. The Send button supplies the participant URL.
12. Before sharing publicly, complete the live checks below.

## Live acceptance checks

- Submit a uniquely identified test response, reload, and verify it remains in the admin response list and downloaded CSV.
- Download and inspect the actual certificate PDF using typical, long, accented, and other expected student names; test the chosen template on a phone.
- Try the same email again and confirm it cannot submit or receive a certificate for a different name.
- Test a wrong password, a signed-out session, and an authenticated user without the admin role. Confirm that response reads and settings changes are denied through the API, not just hidden in the UI.
- Disconnect the network during loading/submission; confirm no success message or certificate appears for a failed insert.
- Confirm there is no demo banner, no unexpected console/CSP errors, and no missing assets at the deployed URL.
- Confirm privacy details, signatory authorization, spam controls, and the council's certificate recovery process before distribution.

## References

- Vercel build settings: https://vercel.com/docs/builds/configure-a-build
- Vercel environment variables: https://vercel.com/docs/environment-variables
- Supabase API keys: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase data security: https://supabase.com/docs/guides/database/secure-data

Additional probe script and raw output are saved locally in the ignored `test-results` folder. Re-run with `PLAYWRIGHT_BROWSERS_PATH` pointing to `node_modules/.cache/ms-playwright`, then `node test-results/deployment-probes.mjs`.
