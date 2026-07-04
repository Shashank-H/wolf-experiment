import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

export type EncryptedSecret = {
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

function getKey(): Buffer {
  return Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
}

export function encryptSecret(plainText: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion: 1,
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(secret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.encryptedValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskSecret(value?: string | null): string | null {
  if (!value) return null;
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}
