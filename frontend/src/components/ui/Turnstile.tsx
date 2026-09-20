'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/* Cloudflare Turnstile on a form anyone on the internet can send (the guest start form). The widget proves the
   visitor is a person without asking them to read anything, and hands the form a token; the server verifies that
   token once (backend/extensions/turnstile.py). Nothing is drawn while the platform has no Turnstile keys: the
   server then sends an empty site key and the form leaves this out.

   The script is fetched from Cloudflare by this app's own script, which the Content-Security-Policy trusts
   ('strict-dynamic'), and its frame is allowed by frame-src (src/proxy.ts). It is loaded once per page, however many
   widgets ask for it.

   A token is good for one send: after a refused send the form calls handleRef.current.reset() for a fresh one. */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const ON_LOAD = '__bookdoseTurnstileReady';
export const CAPTCHA_FIELD = 'captcha_token';
const UNREACHABLE = 'โหลดตัวตรวจสอบของ Cloudflare ไม่ได้ กรุณาปิดตัวบล็อกโฆษณาหรือลองเครือข่ายอื่น';

type Options = Record<string, unknown>;
type TurnstileApi = {
  render: (element: HTMLElement, options: Options) => string | undefined;
  reset: (widget?: string) => void;
  remove: (widget?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    [ON_LOAD]?: () => void;
  }
}

export type TurnstileHandle = { reset: () => void };

let loading: Promise<TurnstileApi> | null = null;

/** The Turnstile script, fetched once per page. */
function load(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      window[ON_LOAD] = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error(UNREACHABLE));
      };
      script.src = `${SCRIPT_SRC}&onload=${ON_LOAD}`;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error(UNREACHABLE));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

export function TurnstileField({
  siteKey,
  action,
  handleRef,
  name = CAPTCHA_FIELD,
}: {
  siteKey: string;
  action?: string;
  /** Set by this field: reset() asks Cloudflare for a fresh token (after a refused send). */
  handleRef?: RefObject<TurnstileHandle | null>;
  name?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let gone = false;
    if (handleRef) handleRef.current = { reset: () => window.turnstile?.reset(widget.current ?? undefined) };
    load()
      .then((turnstile) => {
        if (gone || !box.current || widget.current) return;
        widget.current =
          turnstile.render(box.current, {
            sitekey: siteKey,
            action,
            language: 'th',
            // The widget is asked again on its own before the token grows stale in a long form.
            'refresh-expired': 'auto',
            callback: (value: string) => {
              setToken(value);
              setProblem('');
            },
            'expired-callback': () => setToken(''),
            'timeout-callback': () => setToken(''),
            'error-callback': () => {
              // Cloudflare shows what went wrong in the widget itself; the form only loses its token.
              setToken('');
            },
          }) ?? null;
      })
      .catch((reason: unknown) => {
        if (!gone) setProblem(reason instanceof Error ? reason.message : UNREACHABLE);
      });
    return () => {
      gone = true;
      const current = widget.current;
      widget.current = null;
      if (handleRef) handleRef.current = null;
      if (current) window.turnstile?.remove(current);
    };
  }, [siteKey, action, handleRef]);

  return (
    <div className="field captcha-field">
      <div ref={box} className="captcha-box" />
      <input type="hidden" name={name} value={token} readOnly />
      {problem && (
        <span className="field-error" role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}

/** What the form should say when the visitor sends before Cloudflare has answered. */
export const CAPTCHA_WAIT = 'กำลังตรวจว่าคุณไม่ใช่บอท กรุณารอสักครู่แล้วกดส่งอีกครั้ง';
