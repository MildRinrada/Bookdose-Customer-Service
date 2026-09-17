'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/Icon';
import { api, ApiError } from '@/lib/api/client';
import {
  applyExpiry,
  expiryOf,
  onSessionExpired,
  serverNow,
  setActiveSession,
  subscribeExpiry,
  type ExpiryTimes,
  type SessionExpiry,
  type SessionKind,
} from '@/lib/session-expiry';
import type { Boot, CustomerAccount } from '@/lib/types';

/* Session limits inside a signed-in frame (StaffShell for the organization and the platform console, CustomerShell).
   docs/SECURITY-DESIGN.md §2 and §4:
   - Activity: a real keydown / pointerdown in the page, or the window getting focus, posts the activity endpoint at
     most once a minute (a trailing post covers activity inside that minute). Nothing else posts it: polling, the
     realtime socket and timers never do, and a hidden tab never does. A successful change (non-GET) already counts
     on the server, so it also counts here (lib/session-expiry.ts) and the minute starts from it.
   - Two minutes before the idle limit (checked with the server first, so another tab's activity is seen) a dialog
     asks "คุณยังใช้งานอยู่ไหม" with a countdown: ใช้งานต่อ posts activity, ออกจากระบบ signs out. When the absolute
     limit comes first, the dialog says so instead (activity cannot extend it).
   - When a limit passes (checked with the server once more), or any answer says 401 {reason}, the session query is
     asked again; the layout then goes to sign-in with the reason and the address to come back to. */

const MINUTE = 60 * 1000;
const WARN_MS = 2 * MINUTE;
/** setTimeout cannot wait longer than ~24.8 days; long waits are cut into hours. */
const LONGEST_WAIT = 60 * MINUTE;

export const STAFF_SESSION_PATH = '/api/session';
export const STAFF_ACTIVITY_PATH = '/api/session/activity';
export const CUSTOMER_ACTIVITY_PATH = '/api/customer/activity';

const sessionKeyOf = (kind: SessionKind) => (kind === 'staff' ? '/api/bootstrap' : '/api/customer/account');

function endOf(expiry: SessionExpiry): number | null {
  const ends = [expiry.idleAt, expiry.absoluteAt].filter((at): at is number => at !== null);
  return ends.length ? Math.min(...ends) : null;
}

const countdown = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

type Props = {
  kind: SessionKind;
  /** The limits the frame's session query already carries (bootstrap / customer account), if any. */
  times?: ExpiryTimes | null;
  onLogout: () => Promise<unknown>;
};

export function SessionGuard({ kind, times, onLogout }: Props) {
  const client = useQueryClient();
  const sessionKey = sessionKeyOf(kind);
  const expiry = useSyncExternalStore(subscribeExpiry, () => expiryOf(kind), () => expiryOf(kind));
  const end = endOf(expiry);
  const absoluteFirst = expiry.absoluteAt !== null && (expiry.idleAt === null || expiry.absoluteAt <= expiry.idleAt);

  // --- The frame is on screen: changes count as its activity; limits from the session query ---
  useEffect(() => {
    setActiveSession(kind);
    return () => setActiveSession(null);
  }, [kind]);

  const idleText = times?.idle_expires_at;
  const absoluteText = times?.absolute_expires_at;
  useEffect(() => {
    applyExpiry(kind, { idle_expires_at: idleText, absolute_expires_at: absoluteText });
  }, [kind, idleText, absoluteText]);

  // Ask the session again, and so the layout (signed out → sign-in with the reason).
  const leave = useCallback(() => void client.invalidateQueries({ queryKey: [sessionKey] }), [client, sessionKey]);
  useEffect(() => onSessionExpired(leave), [leave]);

  /** The server's current limits, without counting as activity (a GET). */
  const check = useCallback(
    async (fallback = true) => {
      if (kind === 'customer') {
        await client.refetchQueries({ queryKey: [sessionKey], exact: true });
        const account = client.getQueryData<CustomerAccount>([sessionKey]);
        if (account?.signed_in) applyExpiry('customer', account);
        return;
      }
      try {
        applyExpiry('staff', await api<ExpiryTimes>(STAFF_SESSION_PATH));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) leave();
        else if (fallback) {
          await client.refetchQueries({ queryKey: [sessionKey], exact: true });
          applyExpiry('staff', client.getQueryData<Boot>([sessionKey]));
        }
      }
    },
    [client, kind, sessionKey, leave],
  );

  // Staff: bootstrap may not carry the limits; GET /api/session does.
  useEffect(() => {
    const known = expiryOf(kind);
    if (known.idleAt === null && known.absoluteAt === null) void check(false).catch(() => {});
  }, [kind, check]);

  // --- Activity ---
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  const setOpen = useCallback((value: boolean) => {
    openRef.current = value;
    setOpenState(value);
  }, []);

  const inFlight = useRef(false);
  const lastPost = useRef(0);
  const postActivity = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastPost.current = Date.now();
    try {
      applyExpiry(kind, await api<ExpiryTimes>(kind === 'staff' ? STAFF_ACTIVITY_PATH : CUSTOMER_ACTIVITY_PATH, {}), true);
    } catch (error) {
      // Signed out meanwhile: the 401's reason (if any) already went to onSessionExpired.
      if (error instanceof ApiError && error.status === 401) leave();
    } finally {
      inFlight.current = false;
    }
  }, [kind, leave]);

  useEffect(() => {
    let trailing: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    const since = () => Date.now() - Math.max(lastPost.current, expiryOf(kind).countedAt);
    const onActivity = (event: Event) => {
      // Only the person: not script-made events, not a hidden tab, not an element's focus (only the window's), and
      // not while the dialog asks (its buttons decide).
      if (!event.isTrusted || document.visibilityState !== 'visible' || openRef.current) return;
      if (event.type === 'focus' && event.target !== window) return;
      if (since() >= MINUTE) {
        pending = false;
        void postActivity();
        return;
      }
      pending = true;
      trailing ??= setTimeout(() => {
        trailing = undefined;
        if (pending && document.visibilityState === 'visible' && !openRef.current) {
          pending = false;
          void postActivity();
        }
      }, MINUTE - since());
    };
    const options: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener('keydown', onActivity, options);
    window.addEventListener('pointerdown', onActivity, options);
    window.addEventListener('focus', onActivity, { passive: true });
    return () => {
      clearTimeout(trailing);
      window.removeEventListener('keydown', onActivity, options);
      window.removeEventListener('pointerdown', onActivity, options);
      window.removeEventListener('focus', onActivity);
    };
  }, [kind, postActivity]);

  // --- Warning and expiry ---
  const [left, setLeft] = useState(Infinity);
  const warnedFor = useRef<number | null>(null);
  const endCheckedFor = useRef<number | null>(null);
  const dismissedFor = useRef<number | null>(null);

  useEffect(() => {
    if (end === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (cancelled) return;
      const remaining = end - serverNow();
      setLeft(remaining);
      if (remaining > WARN_MS) {
        setOpen(false);
        timer = setTimeout(tick, Math.min(remaining - WARN_MS, LONGEST_WAIT));
        return;
      }
      if (remaining > 0) {
        // Another tab (or a change) may have kept the session going: ask before interrupting.
        if (warnedFor.current !== end) {
          warnedFor.current = end;
          void check()
            .catch(() => {})
            .then(() => {
              const next = endOf(expiryOf(kind));
              warnedFor.current = next;
              if (!cancelled) tick();
            });
          return;
        }
        if (dismissedFor.current !== end) setOpen(true);
        timer = setTimeout(tick, Math.min(1000, remaining));
        return;
      }
      setOpen(false);
      if (endCheckedFor.current !== end) {
        endCheckedFor.current = end;
        void check()
          .catch(() => {})
          .then(() => {
            if (!cancelled) tick();
          });
        return;
      }
      leave();
    };
    timer = setTimeout(tick, 0);
    // Timers of a hidden tab are slowed down: coming back looks at the clock at once.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      clearTimeout(timer);
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [end, kind, check, leave, setOpen]);

  const keepGoing = () => {
    if (absoluteFirst) {
      dismissedFor.current = end;
      setOpen(false);
      return;
    }
    setOpen(false);
    void postActivity();
  };

  return (
    <IdleDialog
      open={open && end !== null}
      absolute={absoluteFirst}
      left={left}
      onContinue={keepGoing}
      onLogout={() => {
        setOpen(false);
        void onLogout().catch(leave);
      }}
    />
  );
}

function IdleDialog({
  open,
  absolute,
  left,
  onContinue,
  onLogout,
}: {
  open: boolean;
  absolute: boolean;
  left: number;
  onContinue: () => void;
  onLogout: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const textId = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  const time = countdown(left);
  return (
    <dialog
      ref={ref}
      className="idle-dialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(event) => {
        // Escape: the person is here.
        event.preventDefault();
        onContinue();
      }}
    >
      {open && (
        <>
          <div className="modal-header">
            <h2 id={titleId}>{absolute ? 'ใกล้ครบเวลาการเข้าสู่ระบบ' : 'คุณยังใช้งานอยู่ไหม'}</h2>
            <Icon name="clock" />
          </div>
          <div className="modal-body">
            <p id={textId} className="idle-dialog-text">
              {absolute
                ? 'เพื่อความปลอดภัย การเข้าสู่ระบบครั้งนี้จะสิ้นสุดในอีก'
                : 'ไม่มีการใช้งานมาระยะหนึ่ง เพื่อความปลอดภัยระบบจะออกจากระบบให้อัตโนมัติในอีก'}{' '}
              <strong className="idle-countdown mono" role="timer" aria-live="off">
                {time}
              </strong>{' '}
              นาที{absolute ? ' กรุณาบันทึกงานที่ทำค้างไว้ แล้วเข้าสู่ระบบใหม่' : ''}
            </p>
            <div className="form-actions">
              <button type="button" className="btn" onClick={onLogout}>
                <Icon name="logout" />
                ออกจากระบบ
              </button>
              <button type="button" className="btn primary" autoFocus onClick={onContinue}>
                {absolute ? 'รับทราบ' : 'ใช้งานต่อ'}
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
