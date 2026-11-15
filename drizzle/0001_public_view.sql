-- The ONLY relation public (unauthenticated) code paths read from.
-- It exposes published events and nothing private: no internal notes, no
-- tentative dates, no speaker contact details, no organisers.
CREATE OR REPLACE VIEW "public_events" AS
SELECT
  e.id,
  e.title,
  e.description,
  e.start_at,
  e.end_at,
  e.all_day,
  e.location,
  e.online_url,
  e.registration_url,
  e.status,
  e.sequence,
  e.color,
  e.audience,
  e.published_at,
  e.cancelled_at,
  e.created_at,
  e.updated_at,
  c.name  AS category_name,
  c.kind  AS category_kind,
  c.color AS category_color,
  c.icon  AS category_icon,
  s.name         AS speaker_name,
  s.organization AS speaker_organization,
  s.position     AS speaker_position,
  s.bio          AS speaker_bio
FROM events e
JOIN categories c ON c.id = e.category_id
LEFT JOIN speakers s ON s.id = e.speaker_id
WHERE e.is_public = true
  AND e.archived_at IS NULL
  AND e.start_at IS NOT NULL
  AND e.end_at IS NOT NULL
  AND e.status IN ('published', 'postponed', 'cancelled', 'completed');
