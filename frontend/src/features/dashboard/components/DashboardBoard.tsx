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
  COLUMNS,
  fitBox,
  GAP_PX,
  MIN_H,
  MIN_W,
  ROW_PX,
  hideCard,
  isEmptyLayout,
  layoutInUse,
  materialise,
  PAGE_LAYOUT,
  growToFit,
  placeCards,
  placeManyWithPush,
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

/** A rectangle in pixels on the board. */
type Rect = { x: number; y: number; w: number; h: number };
/** What is being carried or pulled: where each piece of it would land (boxes, in squares), and where each piece is
    right now under the pointer (free, in pixels). The card is drawn at `free` and the landing at `boxes`, so the
    hand sees the card move as smoothly as the pointer does, and where it will settle. */
type Live = { boxes: Record<string, Box>; free: Record<string, Rect> } | null;
/** group: the cards carried together (one of them, or a selection), each with the square it started from and the
    pixels it was drawn at; start: the pointer, in page pixels, when it took hold. */
type Hold = {
  id: string;
  edge: Edge | null;
  grab: { x: number; y: number };
  from: Box;
  group: Record<string, Box>;
  rects: Record<string, Rect>;
  start: { x: number; y: number };
};
/** A box being drawn over the board to select what it covers, in board pixels. */
type Marquee = { x0: number; y0: number; x1: number; y1: number };

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
  const [arranging, setArranging] = useArranging();
  const editing = arranging && allowed;
  const [live, setLive] = useState<Live>(null);
  const board = useRef<HTMLDivElement>(null);
  /* The right-click menu: where it opened and which card, if any, it opened on. Everything the board can be told to
     do is in it, so nothing about the board has to be found in a bar or at the foot of the page. */
  const [menu, setMenu] = useState<{ x: number; y: number; card: string | null } | null>(null);
  /* Several cards at once. Shift+click on a card's bar adds it to the selection; a box drawn over empty board takes
     everything it touches. Carrying any selected card carries them all, keeping their places relative to each
     other, the way a set of nodes moves together. */
  const [selected, setSelected] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const drawing = useRef<Marquee | null>(null);
  /* A press on the face of a selected card carries the whole selection: once several cards are chosen, having to
     find the small bar of one of them to move them is the hunt the selection was meant to end. */
  const carryingFromBoard = useRef(false);

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
  /* A card is measured a few times at most. Measuring without a limit is how a page ends up
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
        // The card itself, not the box around it: the bar at its top while arranging and the room made for that bar
        // are part of the page's furniture, not of the card, and a height measured with them in it was a row too
        // tall and then stuck that way.
        const card = el.querySelector<HTMLElement>('.widget-body > *');
        const passes = measured.current.get(id) ?? 0;
        if (!id || passes >= MEASURE_PASSES) continue;
        // Nothing drawn: no squares. A card the member sized is otherwise left at its size, but an empty frame is
        // not a size anybody chose, so emptiness is measured for every card and height only for the untouched.
        const height = card?.offsetHeight ?? 0;
        const rows = height === 0 ? 0 : current.box[id] ? (needs[id] ?? -1) : rowsFor(height);
        if (rows === -1 || rows === needs[id]) continue;
        measured.current.set(id, passes + 1);
        found[id] = rows;
      }
      if (Object.keys(found).length) setNeeds((before) => ({ ...before, ...found }));
    });
    return () => cancelAnimationFrame(frame);
  });
  /* Arranging is a draft. Every move and stretch changes the page on the screen and nothing else, until บันทึก
     writes the board to the member's account or ยกเลิก puts back the board they opened with. A change made from the
     right-click menu while reading (hiding a card, a reset) is one deliberate click and is saved at once. */
  const before = useRef<DashboardLayout | null>(null);
  const put = (layout: DashboardLayout) => {
    setMine(layout);
    if (!editing) save(layout);
  };
  const commit = () => {
    if (before.current) save(mine);
    before.current = null;
    setArranging(false);
  };
  const discard = () => {
    if (before.current) {
      measured.current.clear();
      setNeeds({});
      setMine(before.current);
    }
    before.current = null;
    setArranging(false);
  };
  useEffect(() => {
    if (!editing) {
      // Deferred: the selection is drawn state, and clearing it is not something this effect should do mid-render.
      const frame = requestAnimationFrame(() => setSelected([]));
      // Left arranging by the heading's own button rather than by บันทึก or ยกเลิก: that is a save.
      if (before.current) {
        before.current = null;
        save(mine);
      }
      return () => cancelAnimationFrame(frame);
    }
    before.current = mine;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected([]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);
  /* Starting over. The heights measured so far were measured for the widths the cards had, and a card narrowed to a
     third of the page is twice as tall as it is at full width: kept, they made the page after a reset the wrong
     shape. So a reset forgets them and measures the page again as if it had just been opened. */
  const resetTo = (layout: DashboardLayout) => {
    measured.current.clear();
    setNeeds({});
    put(layout);
  };
  /** Which of the three layers the board is drawn from right now. */
  const layer = !isEmptyLayout(mine)
    ? 'หน้าที่คุณจัดเอง'
    : mine.base === 'page' || isEmptyLayout(organization)
      ? 'หน้าเดิมของระบบ'
      : 'ค่าเริ่มต้นขององค์กร';
  // Whatever is already on those squares moves down; nothing is refused and nothing is made smaller.
  const place = (id: string, box: Box) => put(placeWithPush(current, cards, id, fitBox(box)));
  const placeMany = (moves: Record<string, Box>) => put(placeManyWithPush(current, cards, moves));
  /** The cards that move with `id`: the selection when it is one of them, otherwise just itself. */
  const groupOf = (id: string): Record<string, Box> => {
    const ids = selected.includes(id) ? selected : [id];
    const group: Record<string, Box> = {};
    for (const c of shown) if (ids.includes(c.id)) group[c.id] = c.box;
    return group;
  };
  /** Everything in the group carried by the same distance, and the distance clipped so none of it leaves the board. */
  const carried = (group: Record<string, Box>, dx: number, dy: number): Record<string, Box> => {
    const boxes = Object.values(group);
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const top = Math.min(...boxes.map((b) => b.y));
    const okX = Math.max(-left, Math.min(dx, COLUMNS - right));
    const okY = Math.max(-top, dy);
    const out: Record<string, Box> = {};
    for (const [id, b] of Object.entries(group)) out[id] = fitBox({ ...b, x: b.x + okX, y: b.y + okY });
    return out;
  };
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

  /** Where the card being carried or pulled would land, and where it is right now, from the pointer. */
  const aim = () => {
    const held = dragging.current;
    const node = board.current;
    if (!held || !node) return;
    const rect = node.getBoundingClientRect();
    const square = squareAt(rect, pointer.current.x, pointer.current.y);
    // Page pixels, so the page scrolling under a held card does not read as the card moving.
    const dx = pointer.current.x + window.scrollX - held.start.x;
    const dy = pointer.current.y + window.scrollY - held.start.y;
    const column = (rect.width + GAP_PX) / COLUMNS;
    const minW = MIN_W * column - GAP_PX;
    const minH = MIN_H * (ROW_PX + GAP_PX) - GAP_PX;
    if (held.edge) {
      const r = held.rects[held.id];
      let { x, y, w, h } = r;
      if (held.edge.includes('e')) w = Math.max(minW, r.w + dx);
      if (held.edge.includes('w')) {
        const right = r.x + r.w;
        x = Math.max(0, Math.min(r.x + dx, right - minW));
        w = right - x;
      }
      if (held.edge.includes('s')) h = Math.max(minH, r.h + dy);
      if (held.edge.includes('n')) {
        const bottom = r.y + r.h;
        y = Math.max(0, Math.min(r.y + dy, bottom - minH));
        h = bottom - y;
      }
      setLive({ boxes: { [held.id]: pullEdge(held.from, held.edge, square) }, free: { [held.id]: { x, y, w, h } } });
      return;
    }
    const free: Record<string, Rect> = {};
    for (const [id, r] of Object.entries(held.rects)) free[id] = { ...r, x: r.x + dx, y: Math.max(0, r.y + dy) };
    setLive({ boxes: carried(held.group, square.x - held.grab.x - held.from.x, square.y - held.grab.y - held.from.y), free });
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
    selected,
    onGrab: (id, edge, e) => {
      const node = board.current;
      const card = shown.find((c) => c.id === id);
      if (!node || !card) return;
      // Shift or Ctrl on a card's bar: in or out of the selection, and nothing is carried.
      if (!edge && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        setSelected((before) => (before.includes(id) ? before.filter((c) => c !== id) : [...before, id]));
        return;
      }
      if (!edge && !selected.includes(id)) setSelected([id]);
      const rect = node.getBoundingClientRect();
      const square = squareAt(rect, e.clientX, e.clientY);
      const group = edge ? { [id]: card.box } : groupOf(id);
      // Where each carried card is drawn now, in board pixels: the pixels it will follow the pointer from.
      const rects: Record<string, Rect> = {};
      for (const el of node.querySelectorAll<HTMLElement>('.widget')) {
        const cid = el.dataset.card ?? '';
        if (!(cid in group)) continue;
        const r = el.getBoundingClientRect();
        rects[cid] = { x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height };
      }
      dragging.current = {
        id,
        edge,
        from: card.box,
        grab: { x: square.x - card.box.x, y: square.y - card.box.y },
        group,
        rects,
        start: { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY },
      };
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
      if (held && landing) placeMany(landing.boxes);
    },
    onNudge: (id, dx, dy) => {
      if (shown.find((c) => c.id === id)) placeMany(carried(groupOf(id), dx, dy));
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
            <span className="tiny muted">
              จับแถบหัวการ์ดเพื่อย้าย · จับขอบหรือมุมเพื่อย่อ-ขยาย · <b>Shift+คลิก</b>หรือ<b>ลากกรอบ</b>เพื่อเลือกหลายการ์ด แล้วจับตรงไหนของการ์ดที่เลือกก็ย้ายได้ทั้งชุด ·{' '}
              <b>คลิกขวา</b>เพื่อเพิ่มการ์ด ซ่อน หรือคืนค่า{selected.length > 1 ? ` · เลือกอยู่ ${selected.length} การ์ด` : ''}
            </span>
            <br />
            <span className="tiny arrange-layer">ตอนนี้แสดง: {layer} · ยังไม่บันทึกจนกว่าจะกด บันทึก</span>
          </span>
          <button type="button" className="btn sm" onClick={discard}>
            <Icon name="close" />
            ยกเลิก
          </button>
          <button type="button" className="btn sm primary" onClick={commit}>
            <Icon name="check" />
            บันทึก
          </button>
        </div>
      )}

      <div
        ref={(el) => {
          board.current = el;
          setVar(el, '--rows', String(rowsNeeded(cards)));
        }}
        className={`widget-board${editing ? ' arranging' : ''}`}
        onContextMenu={(e) => {
          if (!allowed) return;
          e.preventDefault();
          const card = (e.target as HTMLElement).closest<HTMLElement>('.widget')?.dataset.card ?? null;
          setMenu({ x: e.clientX, y: e.clientY, card });
        }}
        onPointerDown={(e) => {
          // Anywhere that is not a handle: the board between the cards, or the dimmed face of a card (its bar and
          // edges are for carrying and pulling). On a full board the gaps are thin, and a box that could only start
          // in a gap would be a box nobody could draw.
          if (!editing || e.button !== 0 || (e.target as HTMLElement).closest('.widget-bar,.widget-edge,button,a,input,select')) return;
          const under = (e.target as HTMLElement).closest<HTMLElement>('.widget')?.dataset.card;
          if (under && selected.includes(under)) {
            e.preventDefault();
            carryingFromBoard.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            controls.onGrab(under, null, e);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const at = { x0: e.clientX - rect.left, y0: e.clientY - rect.top, x1: e.clientX - rect.left, y1: e.clientY - rect.top };
          drawing.current = at;
          setMarquee(at);
          if (!e.shiftKey) setSelected([]);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (carryingFromBoard.current) {
            controls.onMoveTo(e.clientX, e.clientY);
            return;
          }
          if (!drawing.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const at = { ...drawing.current, x1: e.clientX - rect.left, y1: e.clientY - rect.top };
          drawing.current = at;
          setMarquee(at);
        }}
        onPointerUp={(e) => {
          if (carryingFromBoard.current) {
            carryingFromBoard.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            controls.onLetGo();
            return;
          }
          const at = drawing.current;
          drawing.current = null;
          setMarquee(null);
          if (!at) return;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          const rect = e.currentTarget.getBoundingClientRect();
          const left = Math.min(at.x0, at.x1);
          const right = Math.max(at.x0, at.x1);
          const top = Math.min(at.y0, at.y1);
          const bottom = Math.max(at.y0, at.y1);
          if (right - left < 4 && bottom - top < 4) return;
          const hit: string[] = [];
          for (const el of e.currentTarget.querySelectorAll<HTMLElement>('.widget')) {
            const r = el.getBoundingClientRect();
            const x = r.left - rect.left;
            const y = r.top - rect.top;
            if (x < right && left < x + r.width && y < bottom && top < y + r.height && el.dataset.card) hit.push(el.dataset.card);
          }
          setSelected((before) => (e.shiftKey ? [...new Set([...before, ...hit])] : hit));
        }}
      >
        {shown.map((card) => (
          <Widget key={card.id} card={card} controls={controls} />
        ))}
        {live &&
          Object.entries(live.boxes).map(([id, box]) => (
            <div
              key={id}
              ref={(el) => {
                setVar(el, '--x', String(box.x));
                setVar(el, '--y', String(box.y));
                setVar(el, '--w', String(box.w));
                setVar(el, '--h', String(box.h));
              }}
              className="board-ghost"
              aria-hidden="true"
            />
          ))}
        {marquee && (
          <div
            ref={(el) => {
              setVar(el, '--left', `${Math.min(marquee.x0, marquee.x1)}px`);
              setVar(el, '--top', `${Math.min(marquee.y0, marquee.y1)}px`);
              setVar(el, '--width', `${Math.abs(marquee.x1 - marquee.x0)}px`);
              setVar(el, '--height', `${Math.abs(marquee.y1 - marquee.y0)}px`);
            }}
            className="board-marquee"
            aria-hidden="true"
          />
        )}
      </div>

      {menu && (
        <BoardMenu
          at={menu}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.card && !cards.find((c) => c.id === menu.card)?.hidden
              ? [{ label: `ซ่อน ${cardTitle(menu.card)}`, icon: 'eyeOff', run: () => put(hideCard(current, cards, menu.card as string, true)) }]
              : []),
            {
              label: 'เพิ่มการ์ด',
              icon: 'plus',
              children: cards.filter((c) => c.hidden).map((c) => ({ label: c.title, icon: 'plus', run: () => put(hideCard(current, cards, c.id, false)) })),
              empty: 'ทุกการ์ดอยู่บนหน้าแล้ว',
            },
            { label: editing ? 'บันทึกและเสร็จสิ้น' : 'จัดหน้า', icon: editing ? 'check' : 'grip', run: () => (editing ? commit() : setArranging(true)) },
            {
              label: 'คืนหน้าเดิมของระบบ',
              icon: 'restore',
              run: () => {
                resetTo(PAGE_LAYOUT);
                toast('คืนหน้าเดิมของระบบแล้ว');
              },
            },
            ...(!isEmptyLayout(organization)
              ? [
                  {
                    label: 'ใช้ค่าเริ่มต้นขององค์กร',
                    icon: 'users',
                    run: () => {
                      resetTo(EMPTY_LAYOUT);
                      toast('ใช้ค่าเริ่มต้นขององค์กรแล้ว');
                    },
                  },
                ]
              : []),
            ...(work.role === 'admin' && !work.read_only
              ? [
                  {
                    label: 'ตั้งหน้านี้เป็นค่าเริ่มต้นขององค์กร',
                    icon: 'users',
                    run: () => void publish(materialise(current, cards), 'ตั้งเป็นค่าเริ่มต้นขององค์กรแล้ว · คนที่จัดหน้าเองไว้แล้วจะไม่ถูกเปลี่ยน'),
                  },
                  ...(!isEmptyLayout(organization)
                    ? [{ label: 'ล้างค่าเริ่มต้นขององค์กร', icon: 'restore', run: () => void publish(EMPTY_LAYOUT, 'ล้างค่าเริ่มต้นขององค์กรแล้ว') }]
                    : []),
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}

type MenuItem = { label: string; icon: string; run?: () => void; children?: MenuItem[]; empty?: string };

/** The board's right-click menu, at the pointer and kept on the screen. It closes on a choice, a click elsewhere,
    Escape, or the page scrolling away from under it. */
function BoardMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);
  const choose = (item: MenuItem) => {
    item.run?.();
    onClose();
  };
  return (
    <div
      ref={(el) => {
        box.current = el;
        if (!el) return;
        // Opened near the right or bottom edge it moves in rather than off the screen.
        const w = el.offsetWidth || 280;
        const h = el.offsetHeight || 320;
        setVar(el, '--x', `${Math.max(8, Math.min(at.x, window.innerWidth - w - 8))}px`);
        setVar(el, '--y', `${Math.max(8, Math.min(at.y, window.innerHeight - h - 8))}px`);
      }}
      className="board-menu"
      role="menu"
      aria-label="จัดการหน้าภาพรวม"
    >
      {items.map((item) =>
        item.children ? (
          <div key={item.label} className="board-menu-group" role="group" aria-label={item.label}>
            <span className="board-menu-title">
              <Icon name={item.icon} />
              {item.label}
            </span>
            {item.children.length ? (
              item.children.map((child) => (
                <button key={child.label} type="button" role="menuitem" className="board-menu-item is-child" onClick={() => choose(child)}>
                  <Icon name={child.icon} />
                  {child.label}
                </button>
              ))
            ) : (
              <span className="board-menu-empty tiny muted">{item.empty}</span>
            )}
          </div>
        ) : (
          <button key={item.label} type="button" role="menuitem" className="board-menu-item" onClick={() => choose(item)}>
            <Icon name={item.icon} />
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

type Controls = {
  editing: boolean;
  content: Record<string, ReactNode>;
  live: Live;
  selected: string[];
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

  const carried = Boolean(c.live && card.id in c.live.boxes);
  const free = c.live?.free[card.id];
  const chosen = c.selected.includes(card.id);
  return (
    <div
      ref={(el) => {
        setVar(el, '--x', String(card.box.x));
        setVar(el, '--y', String(card.box.y));
        setVar(el, '--w', String(card.box.w));
        setVar(el, '--h', String(card.box.h));
        if (free) {
          setVar(el, '--fx', `${Math.round(free.x)}px`);
          setVar(el, '--fy', `${Math.round(free.y)}px`);
          setVar(el, '--fw', `${Math.round(free.w)}px`);
          setVar(el, '--fh', `${Math.round(free.h)}px`);
        }
      }}
      className={`widget${card.sized ? ' sized' : ''}${card.empty ? ' empty' : ''}${carried ? ' carried' : ''}${free ? ' free' : ''}${chosen ? ' selected' : ''}`}
      data-card={card.id}
    >
      {c.editing && !card.empty && (
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
        !card.empty &&
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
