export async function encryptQrPayload(plaintext: string): Promise<string> {
  const res = await fetch('/api/qr/encrypt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: plaintext }),
  });
  if (!res.ok) throw new Error('QR encryption failed');
  const data = await res.json();
  return data.encrypted as string;
}

export async function decryptQrPayload(encrypted: string): Promise<string> {
  const res = await fetch('/api/qr/decrypt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted }),
  });
  if (!res.ok) throw new Error('QR decryption failed');
  const data = await res.json();
  return data.payload as string;
}

// Encrypted payloads start with v{digit}. — e.g. "v1.abc123..."
export function isEncryptedQr(value: string): boolean {
  return /^v\d+\./.test(value);
}
