import { beforeAll, describe, expect, test } from 'bun:test';

beforeAll(() => {
  Bun.env.APP_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
});

describe('secret encryption', () => {
  test('round trips secrets without storing plaintext', async () => {
    const { decryptSecret, encryptSecret } = await import('./crypto');
    const encrypted = encryptSecret('kite-secret');

    expect(encrypted.encryptedValue).not.toContain('kite-secret');
    expect(decryptSecret(encrypted)).toBe('kite-secret');
  });

  test('rejects auth tag tampering', async () => {
    const { decryptSecret, encryptSecret } = await import('./crypto');
    const encrypted = encryptSecret('llm-secret');

    expect(() => decryptSecret({ ...encrypted, authTag: Buffer.alloc(16).toString('base64') })).toThrow();
  });
});
