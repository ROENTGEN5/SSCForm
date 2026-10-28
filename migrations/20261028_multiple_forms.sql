-- Multi-program upgrade. Apply after 20261025_allow_duplicate_responses.sql.
-- Existing rows remain assigned to form 1; the original participant URL stays valid.
BEGIN;
LOCK TABLE public.form_settings, public.certificate_settings, public.survey_questions,
  public.survey_responses, public.response_email_registry IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.form_settings DROP CONSTRAINT IF EXISTS form_settings_id_check;
ALTER TABLE public.certificate_settings DROP CONSTRAINT IF EXISTS certificate_settings_id_check;
CREATE SEQUENCE IF NOT EXISTS public.form_id_seq START 2;
SELECT setval('public.form_id_seq', greatest((SELECT max(id) FROM public.form_settings), 1), true);
ALTER TABLE public.form_settings ALTER COLUMN id SET DEFAULT nextval('public.form_id_seq');
ALTER TABLE public.certificate_settings ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.certificate_settings DROP CONSTRAINT IF EXISTS certificate_settings_form_fk;
ALTER TABLE public.certificate_settings ADD CONSTRAINT certificate_settings_form_fk FOREIGN KEY (id) REFERENCES public.form_settings(id);
ALTER TABLE public.survey_questions ADD COLUMN IF NOT EXISTS form_id integer NOT NULL DEFAULT 1 REFERENCES public.form_settings(id);
ALTER TABLE public.survey_responses ADD COLUMN IF NOT EXISTS form_id integer NOT NULL DEFAULT 1 REFERENCES public.form_settings(id);
ALTER TABLE public.response_email_registry ADD COLUMN IF NOT EXISTS form_id integer NOT NULL DEFAULT 1 REFERENCES public.form_settings(id);
ALTER TABLE public.response_email_registry DROP CONSTRAINT IF EXISTS response_email_registry_pkey;
ALTER TABLE public.response_email_registry ADD PRIMARY KEY (form_id, email);
CREATE INDEX IF NOT EXISTS idx_questions_form ON public.survey_questions(form_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_responses_form ON public.survey_responses(form_id, created_at DESC, id);
GRANT INSERT (form_id) ON public.survey_responses TO anon, authenticated;
DROP FUNCTION IF EXISTS public.save_survey(text, text, jsonb);
CREATE OR REPLACE FUNCTION public.validate_survey_response()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE q record; answer text;
BEGIN
  NEW.full_name := btrim(NEW.full_name);
  NEW.email := lower(btrim(NEW.email));
  IF char_length(NEW.full_name) NOT BETWEEN 1 AND 150
    OR char_length(NEW.email) > 254
    OR NEW.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR jsonb_typeof(NEW.answers) IS DISTINCT FROM 'object'
    OR octet_length(NEW.answers::text) > 100000 THEN
    RAISE EXCEPTION 'Invalid name, email or answers.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.answers) AS k(key)
    WHERE NOT EXISTS (SELECT 1 FROM public.survey_questions s WHERE s.form_id = NEW.form_id AND s.question_text = k.key)) THEN
    RAISE EXCEPTION 'The form has changed. Reload and try again.' USING ERRCODE = '22023';
  END IF;
  FOR q IN SELECT * FROM public.survey_questions WHERE form_id = NEW.form_id LOOP
    answer := NEW.answers ->> q.question_text;
    IF q.is_required AND coalesce(btrim(answer), '') = '' THEN
      RAISE EXCEPTION 'Please answer all required questions.' USING ERRCODE = '22023';
    END IF;
    IF answer IS NOT NULL THEN
      IF jsonb_typeof(NEW.answers -> q.question_text) <> 'string' OR char_length(answer) > 5000 THEN
        RAISE EXCEPTION 'Answers must be text of at most 5000 characters.' USING ERRCODE = '22023';
      END IF;
      IF q.question_type = 'rating' AND answer NOT IN ('1','2','3','4','5') THEN
        RAISE EXCEPTION 'Invalid rating.' USING ERRCODE = '22023';
      END IF;
      IF q.question_type = 'choice' AND NOT q.options @> jsonb_build_array(answer) THEN
        RAISE EXCEPTION 'Invalid choice. Reload the form.' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.enforce_response_email_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE allow_repeats boolean; registered text;
BEGIN
  NEW.email := lower(btrim(NEW.email));
  SELECT allow_duplicate_responses INTO allow_repeats
    FROM public.form_settings WHERE id = NEW.form_id FOR SHARE;
  INSERT INTO public.response_email_registry(form_id, email) VALUES (NEW.form_id, NEW.email)
    ON CONFLICT DO NOTHING RETURNING email INTO registered;
  IF registered IS NULL AND NOT coalesce(allow_repeats, false) THEN
    RAISE EXCEPTION 'This email has already responded.' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_response_email_policy() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.save_survey(p_title text, p_description text, p_questions jsonb, p_form_id integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q jsonb;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(p_title)) NOT BETWEEN 1 AND 300 OR char_length(p_description) > 10000
    OR jsonb_typeof(p_questions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid form settings.';
  END IF;
  IF jsonb_array_length(p_questions) > 100 THEN RAISE EXCEPTION 'Use at most 100 questions.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_questions) x GROUP BY x->>'question_text' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Each question must have a unique title.';
  END IF;
  -- Lock the selected form to serialize concurrent saves.
  PERFORM id FROM public.form_settings WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found.'; END IF;
  UPDATE public.form_settings SET form_title = btrim(p_title), form_description = p_description, updated_at = now() WHERE id = p_form_id;
  FOR q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    IF char_length(btrim(q->>'question_text')) NOT BETWEEN 1 AND 1000
      OR jsonb_typeof(q->'options') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid question or options.';
    END IF;
    IF jsonb_array_length(q->'options') > 100 THEN RAISE EXCEPTION 'Use at most 100 options.'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(q->'options') opt
      WHERE jsonb_typeof(opt) <> 'string' OR char_length(opt #>> '{}') NOT BETWEEN 1 AND 500) THEN
      RAISE EXCEPTION 'Options must contain text of 1 to 500 characters.';
    END IF;
    INSERT INTO public.survey_questions (id, form_id, question_text, question_type, options, is_required, sort_order)
    VALUES ((q->>'id')::uuid, p_form_id, q->>'question_text', q->>'question_type', q->'options', (q->>'is_required')::boolean, (q->>'sort_order')::integer)
    ON CONFLICT (id) DO UPDATE SET question_text = excluded.question_text, question_type = excluded.question_type,
      options = excluded.options, is_required = excluded.is_required, sort_order = excluded.sort_order WHERE public.survey_questions.form_id = p_form_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Question belongs to another form.'; END IF;
  END LOOP;
  DELETE FROM public.survey_questions WHERE form_id = p_form_id AND id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_questions) x);
END;
$$;
REVOKE ALL ON FUNCTION public.save_survey(text, text, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_survey(text, text, jsonb, integer) TO authenticated;

-- Creation is atomic; new programs start with fresh questions and a default certificate.
CREATE OR REPLACE FUNCTION public.create_survey(p_title text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_id integer;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'Enter a program title of 1 to 300 characters.';
  END IF;
  INSERT INTO public.form_settings(form_title, form_description)
    VALUES (btrim(p_title), 'Please share your feedback about this program.') RETURNING id INTO new_id;
  INSERT INTO public.certificate_settings(id) VALUES (new_id);
  INSERT INTO public.survey_questions(form_id, question_text, question_type, is_required, sort_order)
    VALUES (new_id, 'How would you rate the overall program?', 'rating', true, 1),
      (new_id, 'What can we improve for future programs?', 'paragraph', false, 2);
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_survey(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_survey(text) TO authenticated;
COMMIT;
