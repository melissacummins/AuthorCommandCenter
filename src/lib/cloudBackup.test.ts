// Pure-logic test for the incremental mirror key. Run via:
//   npx tsx src/lib/cloudBackup.test.ts
//
// The whole point of the incremental mirror is that the key derived from a
// Supabase Storage path matches the key listCloudMirror reads back from the
// cloud. If these ever drift, every file re-uploads every run — so pin it.

import { mirrorKeyFor } from './backupPaths';

const USER = '11111111-2222-3333-4444-555555555555';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

// A top-level file: <user>/cover.png  →  book-covers/cover.png
assert(
  mirrorKeyFor('book-covers', `${USER}/cover.png`, USER) === 'book-covers/cover.png',
  'strips the user prefix and prepends the bucket',
);

// A nested file: <user>/proj-1/ch1.mp3  →  audiobook-audio/proj-1/ch1.mp3
assert(
  mirrorKeyFor('audiobook-audio', `${USER}/proj-1/ch1.mp3`, USER) === 'audiobook-audio/proj-1/ch1.mp3',
  'preserves nested folders under the bucket',
);

// Defensive: a path that somehow lacks the user prefix is kept as-is under the
// bucket (never throws, never mangles).
assert(
  mirrorKeyFor('media-outputs', 'loose.webm', USER) === 'media-outputs/loose.webm',
  'tolerates a path without the user prefix',
);

// The key a re-run computes for the SAME object must equal what the mirror
// stored, so an unchanged file is recognised and skipped.
const storagePath = `${USER}/series/banner.jpg`;
const keyOnBackup = mirrorKeyFor('book-covers', storagePath, USER);
const keyReadFromMirror = 'book-covers/series/banner.jpg'; // listCloudMirror shape
assert(keyOnBackup === keyReadFromMirror, 'round-trips to the same mirror key');

console.log('\nAll cloudBackup tests passed.');
