-- Preview-sized variants for image attachments. Chat bubbles render the small
-- preview (preview_path); the full original (storage_path) is reserved for the
-- lightbox modal and downloads. Non-image attachments and images uploaded
-- before this migration leave preview_path NULL and fall back to the original.
--
-- width/height are the original image's intrinsic dimensions (after EXIF
-- rotation), used by the client to reserve the bubble's box and avoid layout
-- shift while the preview decodes.

alter table attachments
  add column preview_path text,
  add column width        integer check (width  is null or width  > 0),
  add column height       integer check (height is null or height > 0);
