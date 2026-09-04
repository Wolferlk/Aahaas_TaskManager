import 'server-only';
import crypto from 'node:crypto';

/**
 * AES-256-GCM for third-party credentials at rest (GitHub tokens).
 *
 * The key is derived from TM_SESSION_SECRET, so rotating that secret
 * invalidates stored tokens — users simply reconnect. Tokens are never logged
 * and never returned through an API; only the last four characters are shown.
 */

function key(): Buffer {
  const secret = process.env.TM_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('TM_SESSION_SECRET must be set to at least 32 characters.');
  }
  return crypto.createHash('sha256').update(`tm-token-encryption:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Stored credential is malformed.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}
