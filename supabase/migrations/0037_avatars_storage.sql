-- Migration 0037: public avatars storage bucket + per-user RLS policies
-- Path convention: {profile_id}.jpg  (profile.id, not auth.uid())
-- current_profile_id() SECURITY DEFINER helper from migration 0007

-- Create public avatars bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Public read (anon + authenticated can view avatars)
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- Authenticated user can upload their own avatar
DROP POLICY IF EXISTS "avatars_self_insert" ON storage.objects;
CREATE POLICY "avatars_self_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND name = current_profile_id()::text || '.jpg'
  );

-- Authenticated user can overwrite their own avatar
DROP POLICY IF EXISTS "avatars_self_update" ON storage.objects;
CREATE POLICY "avatars_self_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name = current_profile_id()::text || '.jpg'
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND name = current_profile_id()::text || '.jpg'
  );

-- Authenticated user can delete their own avatar
DROP POLICY IF EXISTS "avatars_self_delete" ON storage.objects;
CREATE POLICY "avatars_self_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name = current_profile_id()::text || '.jpg'
  );
