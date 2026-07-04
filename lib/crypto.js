const crypto = require('crypto');

// Messages are encrypted at rest with AES-256-GCM before hitting the database.
// The key comes from an environment variable (never hardcoded, never stored
// alongside the ciphertext). If it's missing, generate one and set it in
// Render's Environment tab as MESSAGE_ENCRYPTION_KEY — losing this key means
// existing messages become permanently unreadable, so treat it like a password.
//
// To generate one locally: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const KEY_HEX = process.env.MESSAGE_ENCRYPTION_KEY;

if (!KEY_HEX) {
  console.error(
    'Missing MESSAGE_ENCRYPTION_KEY environment variable. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
    'and set it in Render (or your local .env).'
  );
}

const KEY = KEY_HEX ? Buffer.from(KEY_HEX, 'hex') : null;

function encrypt(plaintext) {
  if (!KEY) throw new Error('Encryption key not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    bodyEncrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64')
  };
}

function decrypt(bodyEncrypted, ivB64, authTagB64) {
  if (!KEY) throw new Error('Encryption key not configured.');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(bodyEncrypted, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
