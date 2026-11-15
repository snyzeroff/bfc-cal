-- The built-in restriction is "no conference in the 21 days before exams",
-- derived from verified academic calendars (it replaces the earlier key-date rule).
UPDATE "restriction_rules"
SET "name" = 'Exams — 21 days before',
    "type" = 'academic_kind',
    "severity" = 'hard',
    "applies_to" = '["conference"]'::jsonb,
    "params" = '{"kinds":["exam"],"daysBefore":21}'::jsonb,
    "message" = '',
    "updated_at" = now()
WHERE "builtin" = true AND "type" = 'victoriales';
