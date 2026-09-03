import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const FLOWUS_CREDENTIAL_COOKIE = "ai_phone_flowus_credential_v1";
export const FLOWUS_CREDENTIAL_MAX_AGE = 60 * 60 * 24 * 180;

function secretKey(): Buffer | null {
  const secret = (
    process.env.FLOWUS_CREDENTIAL_SECRET ||
    process.env.WEREAD_CREDENTIAL_SECRET ||
    process.env.ACCOUNT_GATE_SECRET ||
    process.env.SITE_ACCESS_PASSWORD ||
    process.env.NEXTAUTH_SECRET ||
    ""
  ).trim();
  return secret ? createHash("sha256").update(`flowus:${secret}`).digest() : null;
}

export function sealFlowusCredential(token: string, accountId: string): string | null {
  const key = secretKey();
  if (!key || !token.trim() || !accountId) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(accountId));
  const ciphertext = Buffer.concat([cipher.update(token.trim(), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function openFlowusCredential(value: string, accountId: string): string | null {
  const key = secretKey();
  if (!key || !value || !accountId) return null;
  const [version, ivRaw, ciphertextRaw, tagRaw, ...rest] = value.split(".");
  if (version !== "v1" || !ivRaw || !ciphertextRaw || !tagRaw || rest.length) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAAD(Buffer.from(accountId));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
