const crypto = require("crypto");

// IMPORTANT: This key MUST be stored securely in your .env file
// and should NEVER be hardcoded in your code.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // Must be 32 bytes (256 bits) for AES-256
console.log(ENCRYPTION_KEY);
const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Encrypts a plain text string.
 * @param {string} text - The text to encrypt.
 * @returns {string} The encrypted text, formatted as iv:encryptedData:authTag.
 */
function encrypt(text) {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not set in environment variables.");
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv
  );
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return (
    iv.toString("hex") +
    ":" +
    encrypted.toString("hex") +
    ":" +
    authTag.toString("hex")
  );
}

/**
 * Decrypts an encrypted string.
 * @param {string} text - The encrypted text (iv:encryptedData:authTag).
 * @returns {string} The original plain text.
 */
function decrypt(text) {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not set in environment variables.");
  }
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift(), "hex");
  const encryptedText = Buffer.from(textParts.shift(), "hex");
  const authTag = Buffer.from(textParts.shift(), "hex");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv
  );
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedText),
    decipher.final(),
  ]);
  return decrypted.toString();
}

module.exports = { encrypt, decrypt };
