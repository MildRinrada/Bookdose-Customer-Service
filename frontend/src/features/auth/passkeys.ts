'use client';

import { useSyncExternalStore } from 'react';

/* Passkeys in the browser (WebAuthn). The server speaks base64url everywhere - a challenge, a credential id, the
   answer of the authenticator - so this file turns that into the ArrayBuffers navigator.credentials wants and back
   again. Nothing here decides anything: the server checks the origin, the challenge, the rpId, the flags and the
   signature (backend/modules/customer_security/webauthn.py). */

export type PasskeyCreateOptions = {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  authenticatorSelection: { residentKey: 'required'; requireResidentKey: boolean; userVerification: 'required' };
  attestation: 'none';
  timeout: number;
  excludeCredentials: Array<{ type: 'public-key'; id: string }>;
};

export type PasskeyRequestOptions = {
  challenge: string;
  rpId: string;
  userVerification: 'required';
  allowCredentials: Array<{ type: 'public-key'; id: string }>;
  timeout: number;
};

/** What POST .../passkeys and /api/customer/passkey/login are sent. */
export type PasskeyAnswer = {
  id: string;
  rawId: string;
  type: string;
  response: Record<string, string | string[]>;
};

/** The browser can make and use passkeys (the buttons are hidden everywhere else). Read it with the hook, so the
    server renders the same "no" every time and the browser's answer arrives only after hydration. */
export const passkeysAvailable = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

const never = () => () => {};
export const usePasskeysAvailable = () => useSyncExternalStore(never, passkeysAvailable, () => false);

const NO_PASSKEY = 'ยังไม่ได้ยืนยันด้วย Passkey กรุณาลองใหม่ หรือเข้าสู่ระบบด้วยรหัสผ่าน';

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(text + '='.repeat((4 - (text.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64Url(raw: ArrayBuffer): string {
  const bytes = new Uint8Array(raw);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ids = (list: Array<{ type: 'public-key'; id: string }>) => list.map((item) => ({ type: item.type, id: fromBase64Url(item.id) }));

/** A message the customer can act on; a cancelled prompt is not an error worth shouting about. */
function failed(error: unknown): Error {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError'))
    return new Error('ยกเลิกการยืนยันด้วย Passkey แล้ว');
  if (error instanceof DOMException && error.name === 'InvalidStateError')
    return new Error('อุปกรณ์นี้มี Passkey ของบัญชีนี้อยู่แล้ว');
  return new Error(error instanceof Error && error.message ? error.message : NO_PASSKEY);
}

/** navigator.credentials.create(): make a passkey on this device for the signed-in account. */
export async function createPasskey(options: PasskeyCreateOptions): Promise<PasskeyAnswer> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        rp: options.rp,
        user: { ...options.user, id: fromBase64Url(options.user.id) },
        pubKeyCredParams: options.pubKeyCredParams,
        authenticatorSelection: options.authenticatorSelection,
        attestation: options.attestation,
        timeout: options.timeout,
        excludeCredentials: ids(options.excludeCredentials),
      },
    });
  } catch (error) {
    throw failed(error);
  }
  const made = credential as PublicKeyCredential | null;
  if (!made) throw new Error(NO_PASSKEY);
  const answer = made.response as AuthenticatorAttestationResponse;
  return {
    id: made.id,
    rawId: toBase64Url(made.rawId),
    type: made.type,
    response: {
      clientDataJSON: toBase64Url(answer.clientDataJSON),
      attestationObject: toBase64Url(answer.attestationObject),
      transports: typeof answer.getTransports === 'function' ? answer.getTransports() : [],
    },
  };
}

/** navigator.credentials.get(): sign in with a passkey already on this device (no account named). */
export async function requestPasskey(options: PasskeyRequestOptions): Promise<PasskeyAnswer> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        rpId: options.rpId,
        userVerification: options.userVerification,
        allowCredentials: ids(options.allowCredentials),
        timeout: options.timeout,
      },
    });
  } catch (error) {
    throw failed(error);
  }
  const used = credential as PublicKeyCredential | null;
  if (!used) throw new Error(NO_PASSKEY);
  const answer = used.response as AuthenticatorAssertionResponse;
  return {
    id: used.id,
    rawId: toBase64Url(used.rawId),
    type: used.type,
    response: {
      clientDataJSON: toBase64Url(answer.clientDataJSON),
      authenticatorData: toBase64Url(answer.authenticatorData),
      signature: toBase64Url(answer.signature),
      ...(answer.userHandle ? { userHandle: toBase64Url(answer.userHandle) } : {}),
    },
  };
}
