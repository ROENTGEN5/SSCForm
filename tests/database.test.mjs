import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('schema, participant privacy, admin authorization, validation and atomic save', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.jwt() to anon, authenticated;`);
    const schema = await readFile('supabase-schema.sql', 'utf8');
    await db.exec(schema);
    await db.exec("update public.certificate_settings set name_font_size=45;");
    await db.exec(schema);
    assert.equal((await db.query('select name_font_size from certificate_settings')).rows[0].name_font_size, 45);
    await db.exec('set role anon');
    const questions = (await db.query('select * from survey_questions order by sort_order')).rows;
    const answers = Object.fromEntries(questions.map(q => [q.question_text, q.question_type === 'rating' ? '5' : q.question_type === 'choice' ? q.options[0] : 'Thank you']));
    await db.query('insert into survey_responses(full_name,email,answers) values ($1,$2,$3)', ['Student Name', 'STUDENT@example.com', JSON.stringify(answers)]);
    await assert.rejects(db.query('select * from survey_responses'), /permission denied/);
    await assert.rejects(db.query("update form_settings set form_title='Hacked'"), /permission denied/);
    await assert.rejects(db.query('insert into survey_responses(full_name,email,answers) values ($1,$2,$3)', ['Other Student', 'student@example.com', JSON.stringify(answers)]), error => error.code === '23505');
    await assert.rejects(db.query("insert into survey_responses(full_name,email,answers) values ('Student','bad@example.com','{}')"), /required questions/);
    await db.exec('reset role; set role authenticated');
    assert.equal((await db.query('select * from survey_responses')).rows.length, 0);
    const rows = questions.map((q, index) => ({ ...q, sort_order: index + 1 }));
    await assert.rejects(db.query('select save_survey($1,$2,$3)', ['Blocked', '', JSON.stringify(rows)]), /Administrator access required/);
    await db.query("select set_config('request.jwt.claims', $1, false)", ['{"app_metadata":{"role":"admin"}}']);
    assert.equal((await db.query('select * from survey_responses')).rows.length, 1);
    await db.query('select save_survey($1,$2,$3)', ['Updated event', 'Council event', JSON.stringify(rows)]);
    assert.equal((await db.query('select form_title from form_settings')).rows[0].form_title, 'Updated event');
    rows[1].question_type = 'invalid';
    await assert.rejects(db.query('select save_survey($1,$2,$3)', ['Must rollback', '', JSON.stringify(rows)]));
    assert.equal((await db.query('select form_title from form_settings')).rows[0].form_title, 'Updated event');
    assert.equal((await db.query('select * from survey_questions')).rows.length, 4);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from response_email_registry'), /permission denied/);
    await assert.rejects(db.query("update form_settings set allow_duplicate_responses=true"), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claims', '{}', false)");
    assert.equal((await db.query('update form_settings set allow_duplicate_responses=true returning id')).rows.length, 0);
    await db.query("select set_config('request.jwt.claims', $1, false)", ['{"app_metadata":{"role":"admin"}}']);
    await db.exec('update form_settings set allow_duplicate_responses=true');
    await db.exec('reset role; set role anon');
    await db.query('insert into survey_responses(full_name,email,answers) values ($1,$2,$3)', ['Repeat Student', ' STUDENT@example.com ', JSON.stringify(answers)]);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as total from survey_responses')).rows[0].total, 2);
    await db.exec('update form_settings set allow_duplicate_responses=false; set role anon');
    await assert.rejects(db.query('insert into survey_responses(full_name,email,answers) values ($1,$2,$3)', ['Repeat Student', 'student@example.com', JSON.stringify(answers)]), error => error.code === '23505');
    // A rejected response must not consume an email's first valid submission.
    await assert.rejects(db.query("insert into survey_responses(full_name,email,answers) values ('Test','retry@example.com','{}')"), /required questions/);
    await db.query('insert into survey_responses(full_name,email,answers) values ($1,$2,$3)', ['Retry Student', 'retry@example.com', JSON.stringify(answers)]);
    await db.exec('reset role');
    // Upgrades and schema reruns preserve existing duplicate rows and settings.
    await db.exec(await readFile('migrations/20261025_allow_duplicate_responses.sql', 'utf8'));
    await db.exec(schema);
    assert.equal((await db.query('select count(*)::int as total from survey_responses')).rows[0].total, 3);
    await db.exec('set role anon');
    await assert.rejects(db.query('insert into survey_responses(full_name,email,answers) values ($1,$2,$3)', ['Repeat Student', 'STUDENT@example.com', JSON.stringify(answers)]), error => error.code === '23505');
  } finally { await db.close(); }
});

test('migration upgrades an existing database without losing responses or duplicate protection', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.jwt() to anon, authenticated;`);
    const schema = await readFile('supabase-schema.sql', 'utf8');
    await db.exec(schema.split('-- Run once in Supabase SQL Editor')[0]);
    const questions = (await db.query('select * from survey_questions')).rows;
    const answers = JSON.stringify(Object.fromEntries(questions.map(q => [q.question_text,
      q.question_type === 'rating' ? '5' : q.question_type === 'choice' ? q.options[0] : 'Thanks'])));
    await db.query('insert into survey_responses(full_name,email,answers) values ($1,$2,$3)', ['Existing Student', 'existing@example.com', answers]);
    await db.exec(await readFile('migrations/20261025_allow_duplicate_responses.sql', 'utf8'));
    assert.equal((await db.query('select count(*)::int as total from survey_responses')).rows[0].total, 1);
    await db.exec('set role anon');
    await assert.rejects(db.query('insert into survey_responses(full_name,email,answers) values ($1,$2,$3)', ['Existing Student', 'EXISTING@example.com', answers]), error => error.code === '23505');
    await db.exec('reset role; update form_settings set allow_duplicate_responses=true');
    await db.exec(schema);
    assert.equal((await db.query('select allow_duplicate_responses from form_settings')).rows[0].allow_duplicate_responses, true);
    await db.exec('set role anon');
    await db.query('insert into survey_responses(full_name,email,answers) values ($1,$2,$3)', ['Existing Student', 'existing@example.com', answers]);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as total from survey_responses')).rows[0].total, 2);
  } finally { await db.close(); }
});
