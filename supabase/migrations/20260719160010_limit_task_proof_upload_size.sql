update storage.buckets
set
  file_size_limit = 31457280,
  allowed_mime_types = array[
    'image/jpg',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]::text[]
where id = 'task-proofs';
