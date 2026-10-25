-- Run once in Supabase SQL Editor before deploying the repeat-submission setting.
-- Existing responses are preserved. Repeat submissions are blocked by default.
BEGIN;
LOCK TABLE public.survey_responses IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.form_settings
  ADD COLUMN IF NOT EXISTS allow_duplicate_responses boolean NOT NULL DEFAULT false;

-- A private email registry gives concurrent submissions a unique lock even
-- while survey_responses itself permits multiple rows for the same email.
CREATE TABLE IF NOT EXISTS public.response_email_registry (email text PRIMARY KEY);
ALTER TABLE public.response_email_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.response_email_registry FROM PUBLIC, anon, authenticated;
INSERT INTO public.response_email_registry(email)
  SELECT DISTINCT lower(btrim(email)) FROM public.survey_responses
  ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_response_email_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE allow_repeats boolean; registered text;
BEGIN
  NEW.email := lower(btrim(NEW.email));
  SELECT allow_duplicate_responses INTO allow_repeats
    FROM public.form_settings WHERE id = 1 FOR SHARE;
  INSERT INTO public.response_email_registry(email) VALUES (NEW.email)
    ON CONFLICT DO NOTHING RETURNING email INTO registered;
  IF registered IS NULL AND NOT coalesce(allow_repeats, false) THEN
    RAISE EXCEPTION 'This email has already responded.' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_response_email_policy() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_response_email_policy ON public.survey_responses;
CREATE TRIGGER enforce_response_email_policy BEFORE INSERT ON public.survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_response_email_policy();
ALTER TABLE public.survey_responses DROP CONSTRAINT IF EXISTS uq_survey_responses_email;
COMMIT;
