-- Widen kindle storage MIME allow-list + allow video chat messages

UPDATE storage.buckets
SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v',
    'video/mpeg'
  ]
WHERE id = 'crew-kindle';

ALTER TABLE crew_messages DROP CONSTRAINT IF EXISTS crew_messages_message_type_check;
ALTER TABLE crew_messages
  ADD CONSTRAINT crew_messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'video', 'gif', 'poll'));
