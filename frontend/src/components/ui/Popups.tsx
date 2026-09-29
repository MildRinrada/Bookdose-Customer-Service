'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';

/* Pop-ups at the bottom right while the person is on the page: a new message, (staff) their own work, or (platform
   admin) the server or its security needing them now (features/platform/usePlatformAlerts). Whoever
   notices calls showPopup(); <Popups /> in the staff and customer frames shows up to three cards, the newest last,
   in the celebration card's dress (the dark card at the bottom). A card opens what it is about when clicked, closes
   with ✕, and goes by itself after a few seconds unless the pointer rests on it. Styles: pages/celebrations.css. */

/** label: the small line above the title. kind: a message (chat icon) or work (bell; bolt when urgent). icon: another
    icon than the kind's (the platform admin's security alerts wear the shield). open: what a click does instead of
    going to href (the visitor's chat page switches chats in place). */
export type Popup = {
  key: string;
  label: string;
  title: string;
  body: string;
  href: string;
  kind: 'message' | 'work';
  urgent?: boolean;
  icon?: IconName;
  open?: () => void;
};

const EVENT = 'bookdose:popup';
const SHOW_MS = 4000;
const MAX = 3;

export function showPopup(item: Popup) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<Popup>(EVENT, { detail: item }));
}

export function Popups() {
  const router = useRouter();
  const [items, setItems] = useState<Popup[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const item = (event as CustomEvent<Popup>).detail;
      setItems((list) => [...list.filter((p) => p.key !== item.key), item].slice(-MAX));
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const close = (key: string) => setItems((list) => list.filter((p) => p.key !== key));
  if (!items.length) return null;
  return (
    <div className="popups" role="status" aria-live="polite">
      {items.map((p) => (
        <PopupCard
          key={p.key}
          popup={p}
          onClose={() => close(p.key)}
          onOpen={() => {
            close(p.key);
            if (p.open) p.open();
            else router.push(p.href);
          }}
        />
      ))}
    </div>
  );
}

function PopupCard({ popup, onClose, onOpen }: { popup: Popup; onClose: () => void; onOpen: () => void }) {
  const [resting, setResting] = useState(false);
  // The latest close, so a card arriving (a new list) does not restart the others' time.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (resting) return;
    const timer = setTimeout(() => closeRef.current(), SHOW_MS);
    return () => clearTimeout(timer);
  }, [resting]);

  const tone = popup.kind === 'message' ? 'message' : popup.urgent ? 'urgent' : 'work';
  return (
    // data-tone, not a class: "message" is the chat bubble's class.
    <div className="popup-card" data-tone={tone} onMouseEnter={() => setResting(true)} onMouseLeave={() => setResting(false)}>
      <button type="button" className="popup-open" onClick={onOpen}>
        <span className="celebration-icon popup-icon" aria-hidden="true">
          <Icon name={popup.icon ?? (tone === 'message' ? 'chat' : tone === 'urgent' ? 'bolt' : 'bell')} />
        </span>
        <span className="celebration-text">
          <small>{popup.label}</small>
          <strong>{popup.title}</strong>
          {popup.body && <span className="popup-body">{popup.body}</span>}
        </span>
      </button>
      <button type="button" className="icon-btn" aria-label="ปิด" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
