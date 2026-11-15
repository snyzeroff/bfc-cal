-- "Retake Sport" sessions were classified as exams and wrongly closed the 21 days before them.
UPDATE "academic_entries" SET "kind" = 'sport', "updated_at" = now() WHERE "kind" = 'exam' AND "label" ~* '^retake\s+(sport|eps)';--> statement-breakpoint
UPDATE "import_candidates" SET "kind" = 'sport' WHERE "kind" = 'exam' AND "label" ~* '^retake\s+(sport|eps)';
