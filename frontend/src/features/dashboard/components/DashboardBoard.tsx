'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { PREFS_PATH, savePreferences, usePreferences } from '@/features/staff-account/prefs';
import { api } from '@/lib/api/client';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import {
  cardTitle,
  edgeNames,
  EDGES,
  EMPTY_LAYOUT,
  fitBox,
  hideCard,
  isEmptyLayout,
  layoutInUse,
  materialise,
  growToFit,
  placeCards,
  placeWithPush,
  pullEdge,
  readLayout,
  rowsFor,
  rowsNeeded,
  squareAt,
  stepEdge,
  type Box,
  type DashboardLayout,
  type Edge,
  type PlacedCard,
} from '../layout';

/* จัดหน้า: the overview as a board the member lays out (../layout.ts has the why, the grid and the list of cards).

   Untouched, this draws the overview exactly as it always was. Pressing จัดหน้า shows the squares underneath and
   gives each card a bar to carry it by and eight edges to pull. A card goes where it is put and stays there: the
   space left behind is not closed up, and the card beside a narrowed one does not slide over to fill the gap,
   because choosing what sits next to what is the whole of arranging a page.

   Put a card where another one already is and the one that was there moves down, whole (../layout.ts placeWithPush).
   A drop is never refused and never makes anything smaller: a card's size is something its owner chose.

   Everything a mouse can do here a keyboard can do too: ← → ↑ ↓ on a card's handle carry it a square at a time, and
   on any of its edges pull that edge a square. A page that can only be arranged by dragging is a page some people
   cannot arrange at all.

   Each change is saved against the member's own account, so it follows them to another machine and nobody else's
   page moves. Saving waits a moment after the last change: carrying a card across the board is one save, not fifty.
   Markup: pages/dashboard-widgets (widget-board). */

const SAVE_AFTER_MS = 700;
/** How close to the top or bottom of the window a carried card has to be before the page starts to follow it. */
const EDGE_PX = 110;
const EDGE_SPEED = 22;
/** How many times a card may be measured before its height is left alone for good. */
const MEASURE_PASSES = 5;

/** The switch the page heading holds; the board below reads the same one. */
export const ARRANGING = 'dashboard:arranging';

export function useArranging() {
  return useUiState(ARRANGING, false);
}

/** Write a measured number onto an element, which the page's own rules allow and a style attribute would not. */
const setVar = (el: HTMLElement | null, name: string, value: string) => el?.style.setProperty(name, value);

/** What is being carried or pulled, and where it would land. */
type Live = { id: string; box: Box } | null;
type Hold = { id: string; edge: Edge | null; grab: { x: number; y: number }; from: Box };

export function DashboardBoard({ content }: { content: Record<string, ReactNode> }) {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const prefs = usePreferences();
  /* Whether this organization has the feature at all (platform console → ฟีเจอร์รายองค์กร). Switched off, the page
     is the arrangement it ships with for everybody: no จัดหน้า, and nobody's saved board is read. What they arranged
     is still saved and comes back if it is switched on again - a switch is not a reason to throw somebody's page
     away. */
  const allowed = work.features?.dashboard_layout !== false;
  const [arranging] = useArranging();
  const editing = arranging && allowed;
  const [live, setLive] = useState<Live>(null);
  const board = useRef<HTMLDivElement>(null);

  const organization = allowed ? readLayout(work.settings?.dashboard_layout) : EMPTY_LAYOUT;
  // Seeded once, from the first answer of the preferences: after that this screen is the one holding the board.
  const saved = prefs.data ? readLayout(prefs.data.preferences.dashboard) : null;
  const [mine, setMine] = useState<DashboardLayout>(EMPTY_LAYOUT);
  const [seeded, setSeeded] = useState(false);
  if (saved && !seeded) {
    setSeeded(true);
    setMine(saved);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useCallback(
    (layout: DashboardLayout) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void savePreferences({ dashboard: layout })
          .then(() => refresh(PREFS_PATH))
          .catch((error: Error) => toast(error.message, true));
      }, SAVE_AFTER_MS);
    },
    [refresh, toast],
  );

  const current = allowed ? layoutInUse(mine, organization) : EMPTY_LAYOUT;
  /* A card the member has never sized is as tall as what it holds: the rectangles this file ships with are a guess,
     and a guess one row short cuts the last line off a card nobody asked to be shortened. The measuring is done on
     the page itself, once its contents have drawn, and what it pushes into moves down. */
  const [needs, setNeeds] = useState<Record<string, number>>({});
  /* A card is measured a few times at most, and only ever grows. Measuring without a limit is how a page ends up
     asking itself for one more row, for ever; measuring once is not enough either, because a card's contents arrive
     after the page does - a web font, a list that loads, a chart that draws. A handful of passes catches those and
     then stops for good. */
  const measured = useRef<Map<string, number>>(new Map());
  // The effect below runs after every render on purpose: a card's contents change with the data, not with anything
  // listable, and a card is measured only the first time it is seen.
  const cards = growToFit(placeCards(current, (id) => id in content), needs, (id) => Boolean(current.box[id]));
  const shown = cards.filter((card) => !card.hidden);
  useEffect(() => {
    // After the browser has drawn, so what is measured is a card at the height its contents asked for.
    const frame = requestAnimationFrame(() => {
      const node = board.current;
      if (!node) return;
      const found: Record<string, number> = {};
      for (const el of node.querySelectorAll<HTMLElement>('.widget')) {
        const id = el.dataset.card ?? '';
        const body = el.querySelector<HTMLElement>('.widget-body');
        const bar = el.querySelector<HTMLElement>('.widget-bar');
        const passes = measured.current.get(id) ?? 0;
        if (!id || !body || current.box[id] || passes >= MEASURE_PASSES) continue;
        const rows = rowsFor(body.scrollHeight + (bar?.offsetHeight ?? 0));
        if (rows <= (needs[id] ?? 0)) continue;
        measured.current.set(id, passes + 1);
        found[id] = rows;
      }
      if (Object.keys(found).length) setNeeds((before) => ({ ...before, ...found }));
    });
    return () => cancelAnimationFrame(frame);
  });
  const put = (layout: DashboardLayout) => {
    setMine(layout);
    save(layout);
  };
  // Whatever is already on those squares moves down; nothing is refused and nothing is made smaller.
  const place = (id: string, box: Box) => put(placeWithPush(current, cards, id, fitBox(box)));
  /** What new members of this organization start from (owners only). */
  const publish = (dashboard: DashboardLayout, said: string) =>
    api('/api/settings/dashboard', { dashboard })
      .then(async () => {
        toast(said);
        await refresh('/api/workspace');
      })
      .catch((error: Error) => toast(error.message, true));

  /* The page follows a card held near the top or bottom of the window. Without it the only squares anybody can
     reach are the ones already on the screen, and on a board four screens tall that is most of it. */
  const pointer = useRef({ x: 0, y: 0 });
  const dragging = useRef<Hold | null>(null);
  const following = useRef(0);
  const stopFollowing = () => {
    if (following.current) cancelAnimationFrame(following.current);
    following.current = 0;
  };
  useEffect(
    () => () => {
      if (following.current) cancelAnimationFrame(following.current);
    },
    [],
  );

  /** Where the card being carried or pulled would land, from the pointer and the square it was picked up by. */
  const aim = () => {
    const held = dragging.current;
    const node = board.current;
    if (!held || !node) return;
    const rect = node.getBoundingClientRect();
    const square = squareAt(rect, pointer.current.x, pointer.current.y);
    const box = held.edge
      ? pullEdge(held.from, held.edge, square)
      : fitBox({ ...held.from, x: square.x - held.grab.x, y: square.y - held.grab.y });
    setLive({ id: held.id, box });
  };

  const follow = () => {
    if (following.current) return;
    const step = () => {
      const { y } = pointer.current;
      const by = y < EDGE_PX ? -EDGE_SPEED : y > window.innerHeight - EDGE_PX ? EDGE_SPEED : 0;
      if (by) {
        window.scrollBy(0, by);
        aim();
      }
      following.current = requestAnimationFrame(step);
    };
    following.current = requestAnimationFrame(step);
  };

  const controls: Controls = {
    editing,
    content,
    live,
    onGrab: (id, edge, e) => {
      const node = board.current;
      const card = shown.find((c) => c.id === id);
      if (!node || !card) return;
      const square = squareAt(node.getBoundingClientRect(), e.clientX, e.clientY);
      dragging.current = { id, edge, from: card.box, grab: { x: square.x - card.box.x, y: square.y - card.box.y } };
      pointer.current = { x: e.clientX, y: e.clientY };
      aim();
      follow();
    },
    onMoveTo: (x, y) => {
      if (!dragging.current) return;
      pointer.current = { x, y };
      aim();
    },
    onLetGo: () => {
      const held = dragging.current;
      dragging.current = null;
      stopFollowing();
      const landing = live;
      setLive(null);
      if (held && landing) place(held.id, landing.box);
    },
    onNudge: (id, dx, dy) => {
      const card = shown.find((c) => c.id === id);
      if (card) place(id, { ...card.box, x: card.box.x + dx, y: card.box.y + dy });
    },
    onStretch: (id, edge, dx, dy) => {
      const card = shown.find((c) => c.id === id);
      if (card) place(id, stepEdge(card.box, edge, dx, dy));
    },
    onHide: (id) => put(hideCard(current, cards, id, true)),
  };

  return (
    <>
      {editing && (
        <div className="arrange-bar">
          <span className="grow">
            <strong>กำลังจัดหน้า</strong>{' '}
            <span className="tiny muted">จับแถบหัวการ์ดเพื่อย้าย · จับมุมขวาล่างเพื่อย่อ-ขยาย · เว้นช่องว่างได้ตามใจ · หน้านี้เป็นของคุณคนเดียว</span>
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              put(EMPTY_LAYOUT);
              toast(isEmptyLayout(organization) ? 'คืนค่าเริ่มต้นของหน้าแล้ว' : 'คืนค่าเริ่มต้นขององค์กรแล้ว');
            }}
          >
            <Icon name="restore" />
            คืนค่าเริ่มต้น
          </button>
          {work.role === 'admin' && !work.read_only && (
            <button
              type="button"
              className="btn sm"
              title="คนที่จัดหน้าของตัวเองไว้แล้วจะไม่ถูกเปลี่ยน"
              onClick={() => void publish(materialise(current, cards), 'ตั้งเป็นค่าเริ่มต้นขององค์กรแล้ว · คนที่จัดหน้าเองไว้แล้วจะไม่ถูกเปลี่ยน')}
            >
              <Icon name="users" />
              ตั้งเป็นค่าเริ่มต้นขององค์กร
            </button>
          )}
          {/* Only while there is one to clear: an organization back on the screen's own arrangement needs no button
              offering to put it there again. */}
          {work.role === 'admin' && !work.read_only && !isEmptyLayout(organization) && (
            <button
              type="button"
              className="btn sm"
              title="ทุกคนที่ยังไม่ได้จัดหน้าเองจะกลับไปใช้หน้าตามค่าเริ่มต้นของระบบ"
              onClick={() => void publish(EMPTY_LAYOUT, 'ล้างค่าเริ่มต้นขององค์กรแล้ว')}
            >
              <Icon name="restore" />
              ล้างค่าเริ่มต้นขององค์กร
            </button>
          )}
        </div>
      )}

      <div
        ref={(el) => {
          board.current = el;
          setVar(el, '--rows', String(rowsNeeded(cards)));
        }}
        className={`widget-board${editing ? ' arranging' : ''}`}
      >
        {shown.map((card) => (
          <Widget key={card.id} card={card} controls={controls} />
        ))}
        {live && (
          <div
            ref={(el) => {
              setVar(el, '--x', String(live.box.x));
              setVar(el, '--y', String(live.box.y));
              setVar(el, '--w', String(live.box.w));
              setVar(el, '--h', String(live.box.h));
            }}
            className="board-ghost"
            aria-hidden="true"
          />
        )}
      </div>

      {editing && <PutAway cards={cards.filter((card) => card.hidden).map((card) => card.id)} onShow={(id) => put(hideCard(current, cards, id, false))} />}
    </>
  );
}

type Controls = {
  editing: boolean;
  content: Record<string, ReactNode>;
  live: Live;
  /** edge null: the card is being carried rather than pulled. */
  onGrab: (id: string, edge: Edge | null, e: ReactPointerEvent<HTMLElement>) => void;
  onMoveTo: (x: number, y: number) => void;
  onLetGo: () => void;
  onNudge: (id: string, dx: number, dy: number) => void;
  onStretch: (id: string, edge: Edge, dx: number, dy: number) => void;
  onHide: (id: string) => void;
};

/** The arrow keys on a handle: carried a square at a time, or stretched a square at a time. */
const arrow = (key: string): [number, number] | null =>
  key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowRight' ? [1, 0] : key === 'ArrowUp' ? [0, -1] : key === 'ArrowDown' ? [0, 1] : null;

function Widget({ card, controls: c }: { card: PlacedCard; controls: Controls }) {
  /* Carrying a card and pulling its corner are two holds, so they are two places to hold: the bar at the top carries
     it, the corner sizes it. When the whole card carried it, every attempt to catch a corner that missed by a few
     pixels picked the card up instead.

     Pointer events rather than the browser's own drag, because HTML5 drag-and-drop does not exist on a touch screen,
     and a card people can only move with a mouse is a card half the team cannot move. */
  const hold = (edge: Edge | null) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      // A press on a control does what that control does - unless the control is the handle itself, which is a
      // button so that a keyboard can reach it.
      const control = (e.target as HTMLElement).closest('button,select,input,a,label');
      if (e.button !== 0 || (control && !control.hasAttribute('data-handle'))) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      c.onGrab(card.id, edge, e);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => c.onMoveTo(e.clientX, e.clientY),
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      c.onLetGo();
    },
    onPointerCancel: () => c.onLetGo(),
  });

  const carried = c.live?.id === card.id;
  return (
    <div
      ref={(el) => {
        setVar(el, '--x', String(card.box.x));
        setVar(el, '--y', String(card.box.y));
        setVar(el, '--w', String(card.box.w));
        setVar(el, '--h', String(card.box.h));
      }}
      className={`widget${card.sized ? ' sized' : ''}${carried ? ' carried' : ''}`}
      data-card={card.id}
    >
      {c.editing && (
        <div className="widget-bar" {...hold(null)}>
          <button
            type="button"
            className="widget-grip"
            data-handle=""
            aria-label={`ย้าย ${card.title} · ใช้ปุ่มลูกศรเลื่อนทีละช่อง`}
            title="ลากเพื่อย้าย · ปุ่มลูกศรเลื่อนทีละช่อง"
            onKeyDown={(e) => {
              const step = arrow(e.key);
              if (!step) return;
              e.preventDefault();
              c.onNudge(card.id, step[0], step[1]);
            }}
          >
            <Icon name="grip" />
          </button>
          <strong className="grow truncate">{card.title}</strong>
          <span className="widget-size tiny muted">
            {card.box.w}×{card.box.h}
          </span>
          <button type="button" className="btn sm" aria-label={`ซ่อน ${card.title}`} title="ซ่อนการ์ดนี้" onClick={() => c.onHide(card.id)}>
            <Icon name="eyeOff" />
            ซ่อน
          </button>
        </div>
      )}
      {c.editing &&
        EDGES.map((edge) => (
          <button
            key={edge}
            type="button"
            className={`widget-edge at-${edge}`}
            data-handle=""
            aria-label={`${edgeNames[edge]}ของ ${card.title} · ตอนนี้ ${card.box.w} คูณ ${card.box.h} ช่อง · ใช้ปุ่มลูกศรปรับทีละช่อง`}
            title={`ลาก${edgeNames[edge]}เพื่อย่อ-ขยาย · ปุ่มลูกศรปรับทีละช่อง`}
            {...hold(edge)}
            onKeyDown={(e) => {
              const step = arrow(e.key);
              if (!step) return;
              e.preventDefault();
              c.onStretch(card.id, edge, step[0], step[1]);
            }}
          >
            <span className="sr-only">ลากเพื่อย่อ-ขยาย</span>
          </button>
        ))}
      <div className="widget-body">{c.content[card.id]}</div>
    </div>
  );
}

/** The cards this member put away, so putting one back is one click and never a hunt through settings. */
function PutAway({ cards, onShow }: { cards: string[]; onShow: (id: string) => void }) {
  return (
    <section className="card put-away">
      <h2>การ์ดที่ซ่อนไว้</h2>
      {cards.length ? (
        <div className="put-away-list">
          {cards.map((id) => (
            <button key={id} type="button" className="btn sm" onClick={() => onShow(id)}>
              <Icon name="plus" />
              {cardTitle(id)}
            </button>
          ))}
        </div>
      ) : (
        <p className="tiny muted">ยังไม่ได้ซ่อนการ์ดไหน · กดปุ่ม ซ่อน บนการ์ดที่ไม่ได้ใช้ แล้วการ์ดนั้นจะมารออยู่ตรงนี้</p>
      )}
    </section>
  );
}
