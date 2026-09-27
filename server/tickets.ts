import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type ImageTicket = {
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
  sourceId: string;
};

export function createTicketCodec(secret: string) {
  const key = createHash('sha256').update(secret).digest();
  return {
    seal(value: ImageTicket) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    },
    open(token: string): ImageTicket {
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.length < 29 || bytes.length > 16 * 1024) throw new Error('image_expired');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      let value: ImageTicket;
      try {
        value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
      } catch {
        throw new Error('image_expired');
      }
      if (!value || typeof value.url !== 'string' || !value.headers || typeof value.headers !== 'object' ||
          !/^\d{1,19}$/.test(value.sourceId) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt < Date.now())
        throw new Error('image_expired');
      return value;
    }
  };
}
