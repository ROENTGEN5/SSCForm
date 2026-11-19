-- Enable admin response deletion after the multi-program upgrade.
BEGIN;

DROP POLICY IF EXISTS "Admins can delete responses" ON public.survey_responses;
CREATE POLICY "Admins can delete responses"
    ON public.survey_responses FOR DELETE TO authenticated
    USING ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

GRANT DELETE ON public.survey_responses TO authenticated;

COMMIT;
