# Feedback forms and certificates — implementation plan

Prepared October 28, 2026 for the next program on October 29, 2026.

## 1. Separate program forms — implemented in this change

The existing program remains form 1, including its questions, responses, repeat-submission preference, certificate settings and uploaded template. The original participant URL continues to load it. New programs receive their own integer ID, participant URL (`?form=2`, etc.), questions, response settings and certificate configuration. Admins select a program or create one from Program forms. New programs start with two general feedback questions and a default certificate; they do not inherit another program’s participants or uploaded certificate.

Creation runs in one database transaction. Questions, submissions, response counts, CSV exports, and certificate updates are scoped to the selected form. Email uniqueness applies within each form, allowing a returning participant to attend multiple programs. Database validation rejects answers from other programs and prevents a form save from modifying questions belonging to another form. Participant access to responses remains blocked by RLS.

Save questions and certificate settings before switching programs. The interface confirms before discarding unsaved work. Demo changes remain temporary.

### Rollout before tomorrow’s program

1. Back up the live Supabase database, including responses and certificate settings. Record the existing response count and download its CSV.
2. For a database already using the repeat-submission feature, run `migrations/20261028_multiple_forms.sql` in Supabase SQL Editor. For an older database, run `migrations/20261025_allow_duplicate_responses.sql` first. New installations use `supabase-schema.sql`. Do not rerun the older repeat-submission migration after upgrading to multiple forms.
3. Deploy the updated frontend after the migration succeeds. The migration preserves the original URL and defaults existing submissions to form 1. Refresh older admin tabs after deployment.
4. Sign in at `?admin=1`. Verify form 1’s title, questions, certificate, response count and CSV against the backup.
5. Create the October 29 program. Customize and save its questions, certificate wording, actual authorized signatory, and template if applicable. Preview using a long participant name and download a sample certificate.
6. Use Send to copy this program’s link. Confirm it includes the new `form` ID. Submit a test response with an email already used for the original program: it must work once in the new program. Confirm a second submission is blocked when repeat submissions are disabled.
7. Verify only the new response appears in the new program’s responses and CSV, and the original program is unchanged. Publish the correct link to participants.

If migration fails, its transaction rolls back. Keep the previous frontend until the failure is resolved. If frontend deployment fails after migration and no new programs exist yet, the previous frontend can still use form 1. Once other programs exist, keep the new frontend or fix forward: older versions load all questions without a program filter. Avoid restoring a backup over responses received after rollout without first preserving those new rows.

## 2. Program lifecycle and safer editing — next priority

Add draft/open/closed status, event date, opening/closing times with a visible time zone, and an optional response limit. Enforce availability in database submission validation, display a useful closed-form message, and let admins archive programs without deleting responses. Add a duplicate-program action that copies configuration and generates new question IDs but never copies responses. Add dirty-state tracking and a save/discard/cancel workflow, including navigation and tab closure.

Acceptance: closed or draft programs reject direct API submissions; opening a new program does not reopen the old one; archiving retains exports; cancellation preserves unsaved work.

## 3. Preserve response meaning as forms evolve

Replace answer keys based on question titles with immutable question IDs. Store a question/version snapshot and certificate configuration reference with each submission. Offer publishing revisions so edits after responses arrive do not change historical interpretation or old certificate wording. Migrate existing answers without overwriting their original text.

Acceptance: renaming, reordering or removing a question leaves old reports understandable, and certificate reissues use the intended program/version.

## 4. Certificate reliability and recovery

Move uploaded templates from base64 settings into Supabase Storage with explicit access policies and per-program paths. Load templates on demand. Add Unicode font support, long-name fitting, explicit event dates and accessible PDF previews. Introduce server-issued certificate IDs and a verification endpoint that discloses only approved fields. Add email-verified recovery so participants can retrieve lost certificates safely.

Acceptance: names with accents and long names render correctly; original templates remain available; recovery requires ownership verification; verification never exposes participant email or answers.

## 5. Submission protection and privacy

Add a server/Edge Function submission endpoint that verifies a CAPTCHA token and enforces rate limits. Define a council-approved privacy notice, contact address and retention policy. Add retention/export workflows and an audit log of admin changes. Review admin permissions if different organizers should access different programs; current admin accounts can manage all programs.

Acceptance: bypassing browser validation cannot evade challenge/rate limits; non-admin users cannot read responses; retention actions require a concrete preview and preserve required records.

## 6. Reports and participant experience

Add per-program rating summaries and question charts, server-side search and pagination, export filters, and explicit CSV filenames containing the program ID and title. Improve keyboard navigation, labels, mobile layouts, loading states and error recovery. For large events, use background CSV export jobs and show completion status. Consider QR codes for each program’s share link and opt-in participant progress recovery with a clear shared-device privacy warning.

Acceptance: dashboard totals agree with exported rows, program filters never mix records, charts handle revised questions, and participant completion works with keyboard-only navigation and narrow screens.

## Verification and operational limits

Automated tests cover database authorization, legacy response preservation, repeat-email rules per program, scoped validation/saving, schema reruns, and browser creation/switching/sharing/submission flows. Existing certificate PDF and template tests remain part of the suite. Run `npm test` and a configured production build before deployment.

Live Supabase migration, hosting deployment, real email recovery and verification services are not performed by this repository change. Complete the live checks above before distributing the October 29 link. Priorities 2–6 are planned work, not features included in this change.
