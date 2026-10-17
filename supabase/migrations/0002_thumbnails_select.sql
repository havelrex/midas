-- Storage's remove() needs SELECT as well as DELETE on storage.objects.
-- Public URLs don't need this; it only lets users list/remove their own thumbnails.
create policy "thumbnails_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
