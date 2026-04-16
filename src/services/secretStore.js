const crypto = require('crypto');
const logger = require('./logger');

const ALGO = 'aes-256-gcm';
const KEY_ENV = process.env.APP_SECRET_KEY || process.env.PROCESSIQ_SECRET_KEY || null;

if (!KEY_ENV) {
  logger && logger.warn && logger.warn('No APP_SECRET_KEY/PROCESSIQ_SECRET_KEY configured; encrypted secrets unavailable');
}

function getKey() {
  if (!KEY_ENV) return null;
  // expect base64 or raw; normalize to 32 bytes
  let key = KEY_ENV;
  if (key.length === 44 && key.endsWith('=')) {
    // probably base64
    try {
      const buf = Buffer.from(key, 'base64');
      if (buf.length === 32) return buf;
    } catch (e) {
      // fallthrough
    }
  }
  // pad/trim
  const buf = Buffer.alloc(32);
  Buffer.from(String(key)).copy(buf);
  return buf;
}

function encrypt(plainText) {
  const key = getKey();
  if (!key) return plainText; // fallback: no-op so system remains functional

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(cipherText) {
  const key = getKey();
  if (!key) return cipherText; // fallback
  if (!cipherText) return null;
  try {
    const data = Buffer.from(String(cipherText), 'base64');
    const iv = data.slice(0, 12);
    const tag = data.slice(12, 28);
    const encrypted = data.slice(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    logger && logger.error && logger.error('Failed to decrypt secret', { err: err && err.message });
    return null;
  }
}

module.exports = {
  encrypt,
  decrypt,
};
