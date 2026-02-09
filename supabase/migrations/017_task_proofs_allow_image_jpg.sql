-- Ensure task proof bucket accepts image/jpg as well.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpg',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm'
]::text[]
WHERE id = 'task-proofs';
