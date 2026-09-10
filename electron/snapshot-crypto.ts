import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "sage-enc-v1:";
let key: Buffer | null = null;
let fingerprint = "";

export function configureSnapshotEncryptionKey(base64Key: string) {
  const decoded = Buffer.from(String(base64Key ?? ""), "base64");
  if (decoded.length !== 32) throw new Error("Snapshot encryption key must be 32 bytes.");
  key = decoded;
  fingerprint = createHash("sha256").update(decoded).digest("hex").slice(0, 24);
}

export function snapshotEncryptionFingerprint() {
  if (!key) throw new Error("Snapshot encryption is not initialised.");
  return fingerprint;
}

function requireKey() {
  if (!key) throw new Error("Snapshot encryption is not initialised.");
  return key;
}

export function isEncryptedSnapshotPayload(value: string) {
  return String(value ?? "").startsWith(PREFIX);
}

export function encryptSnapshotPayload(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = {
    v: 1,
    keyFingerprint: snapshotEncryptionFingerprint(),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return PREFIX + Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

export function decryptSnapshotPayload<T>(value: string): T {
  if (!isEncryptedSnapshotPayload(value)) return JSON.parse(value) as T;
  const encoded = value.slice(PREFIX.length);
  const envelope = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    v?: number;
    keyFingerprint?: string;
    iv?: string;
    tag?: string;
    ciphertext?: string;
  };
  if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.ciphertext) throw new Error("Unsupported encrypted snapshot format.");
  if (envelope.keyFingerprint && envelope.keyFingerprint !== snapshotEncryptionFingerprint()) throw new Error("Snapshot was encrypted with a different local key.");
  const decipher = createDecipheriv("aes-256-gcm", requireKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
