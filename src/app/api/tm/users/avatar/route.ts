import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { audit, badRequest, requireUser, toErrorResponse } from '@/lib/api';

const MAX_BYTES = 4 * 1024 * 1024;

// Only formats we can verify by magic number are accepted.
const SIGNATURES: Array<{ ext: string; mime: string; test: (b: Buffer) => boolean }> = [
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.subarray(0, 6).toString('ascii').startsWith('GIF8') },
];

const uploadDir = () => path.join(process.cwd(), 'public', 'uploads', 'avatars');

/**
 * Profile photo upload.
 *
 * The file is validated by magic number rather than the client-supplied MIME
 * type, written under public/uploads (gitignored) with a generated name, and
 * the previous photo is removed so the directory does not grow unbounded.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw badRequest('Choose an image to upload.');
    if (file.size === 0) throw badRequest('That file is empty.');
    if (file.size > MAX_BYTES) throw badRequest('Images must be 4MB or smaller.');

    const buffer = Buffer.from(await file.arrayBuffer());
    const match = SIGNATURES.find((s) => s.test(buffer));
    if (!match) throw badRequest('Upload a PNG, JPG, WEBP or GIF image.');

    await fs.mkdir(uploadDir(), { recursive: true });

    const name = `${user.uuid}-${crypto.randomBytes(6).toString('hex')}.${match.ext}`;
    await fs.writeFile(path.join(uploadDir(), name), buffer);

    const previous = await queryOne<{ avatar_url: string | null }>('SELECT avatar_url FROM tm_users WHERE id = ?', [
      user.id,
    ]);

    const url = `/uploads/avatars/${name}`;
    await execute('UPDATE tm_users SET avatar_url = ? WHERE id = ?', [url, user.id]);

    // Best-effort cleanup of the file this one replaces.
    const old = previous?.avatar_url;
    if (old?.startsWith('/uploads/avatars/')) {
      const oldName = path.basename(old);
      await fs.unlink(path.join(uploadDir(), oldName)).catch(() => {});
    }

    await audit(user.id, 'AVATAR_UPDATED', 'USER', user.id, old, url);
    return NextResponse.json({ ok: true, avatar_url: url });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Removes the current photo and falls back to initials. */
export async function DELETE() {
  try {
    const user = await requireUser();
    const previous = await queryOne<{ avatar_url: string | null }>('SELECT avatar_url FROM tm_users WHERE id = ?', [
      user.id,
    ]);

    await execute('UPDATE tm_users SET avatar_url = NULL WHERE id = ?', [user.id]);

    const old = previous?.avatar_url;
    if (old?.startsWith('/uploads/avatars/')) {
      await fs.unlink(path.join(uploadDir(), path.basename(old))).catch(() => {});
    }

    await audit(user.id, 'AVATAR_REMOVED', 'USER', user.id, old, null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
