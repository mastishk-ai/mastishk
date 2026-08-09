import { writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';

// Spec section 17.1 — all file writes under .mastishk/ MUST be atomic:
// write to a temporary file in the same directory, then rename.
// A reader must never observe a half-written node.
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = join(
    dirname(filePath),
    `.${basename(filePath)}.tmp-${randomBytes(6).toString('hex')}`
  );
  await writeFile(tmpPath, content, 'utf-8');
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}
