// Pure path helpers for the cloud backup mirror. Kept free of any imports
// (no Supabase client) so the logic can be unit-tested in isolation.

// The key a Storage object maps to inside the mirror: "<bucket>/<path…>" with
// the leading `<user_id>/` stripped. Both listCloudMirror (which reads the
// mirror back) and the backup upload loop must agree on this exact shape, or
// every file would look "new" every run.
export function mirrorKeyFor(bucketId: string, storagePath: string, userId: string): string {
  const rel = storagePath.startsWith(`${userId}/`) ? storagePath.slice(userId.length + 1) : storagePath;
  return `${bucketId}/${rel}`;
}
