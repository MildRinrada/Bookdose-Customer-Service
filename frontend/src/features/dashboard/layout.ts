/* หน้าภาพรวมของฉัน: a board the member lays out, the way widgets are laid out on a phone's home screen.

   A support overview has to hold everything somebody might need, and nobody needs all of it. An agent works from the
   chats waiting and what is about to break its SLA; an owner works from the team's load and the figures. One fixed
   page can only be a compromise between the two, and the compromise is what makes it feel crowded. So the page keeps
   the shape it ships with and the arrangement becomes the member's.

   The page is a grid: COLUMNS columns wide and as many rows as the cards reach. Every card holds a rectangle of it -
   where it starts and how many columns and rows it covers - and nothing moves on its own. A card dragged away leaves
   the hole it came from, and a card can be made narrower without the one beside it sliding over to fill the gap. That
   space is the point: arranging is choosing what sits next to what, and a board that closes every gap the moment it
   appears will not let anybody choose. Two cards may not cover the same square, which is the one rule a board needs.

   What it starts as is the page as it was, card for card: the checklist, the figures and วันนี้ของฉัน across the
   top, the cases and the chart with the shift board under them, the side column beside all three, and the two owner
   sections at the foot. Somebody who never opens จัดหน้า should not be able to tell this was built.

   Below the narrow breakpoint the grid is one column and the cards come down it in the order they are laid out, top
   to bottom and left to right: a phone has no room for a board, and a fifth of a phone is not a card.

   The list of cards lives here, not on the server. The server keeps the rectangles and nothing else, so a card added,
   renamed or dropped in a release needs no migration: this file decides what a name means, a name it no longer knows
   is skipped, and a card released after somebody laid out their page takes the first free space at the foot of it.

   Three layers answer "what does this member see": their own board, then the organization's (set by an owner from
   their own page), then the rectangles below. คืนค่าเริ่มต้น drops the first layer, never the other two. */

/** How many columns the board is divided into, and how tall one row is in pixels (styles: dashboard-widgets.css). */
export const COLUMNS = 12;
export const ROW_PX = 40;
export const GAP_PX = 22;
/** A card narrower or shorter than this holds nothing anybody can read. */
export const MIN_W = 3;
export const MIN_H = 3;
export const MAX_ROWS = 400;

/** Where a card sits: its top-left square, and how many columns and rows it covers. */
export type Box = { x: number; y: number; w: number; h: number };

/** base 'page': the member chose the screen's own arrangement over the organization's default. */
export type DashboardLayout = { hidden: string[]; box: Partial<Record<string, Box>>; base?: 'page' };

export const PAGE_LAYOUT: DashboardLayout = { hidden: [], box: {}, base: 'page' };

export const EMPTY_LAYOUT: DashboardLayout = { hidden: [], box: {} };

export type CardDef = { id: string; title: string; note: string; box: Box };

/* The page as it ships, in squares. A row is 40px with a 22px gap, so h rows come out at 62h-22 pixels; the heights
   are guesses that the page corrects by measuring (growToFit), so what matters here is the order and the columns.

   Two columns under the figures. The left, two thirds wide, is the work: the cases, then the week's chart, then the
   two team boards side by side. The right third is what needs somebody now, most urgent first: cases about to break
   their SLA, the ones forecast to, the chats waiting, and what was addressed to this member; the quick replies, which
   nobody needs to see to act, come last. Cards that take no rows (nothing to show) drop out and the rest close up. */
export const CARDS: CardDef[] = [
  { id: 'setup', title: 'เช็กลิสต์เริ่มต้นใช้งาน', note: 'ขั้นตอนตั้งค่าองค์กรที่ยังไม่ครบ', box: { x: 0, y: 0, w: 12, h: 5 } },
  { id: 'stats', title: 'ตัวเลขสรุป', note: 'เคสที่ดูแล · ของฉัน · ปิดวันนี้ · เกิน SLA', box: { x: 0, y: 5, w: 12, h: 4 } },
  { id: 'today', title: 'วันนี้ของฉัน', note: 'ตอบวันนี้ ปิดวันนี้ เวลาตอบ และ CSAT ของคุณ', box: { x: 0, y: 9, w: 12, h: 3 } },
  { id: 'tickets', title: 'เคสล่าสุด', note: 'ตาราง 6 เคสล่าสุด พร้อมตัวกรองด่วน', box: { x: 0, y: 12, w: 8, h: 15 } },
  { id: 'chart', title: 'เคสเข้าใหม่', note: 'กราฟ 7 วันย้อนหลัง', box: { x: 0, y: 27, w: 8, h: 6 } },
  { id: 'handover', title: 'ส่งต่อกะ', note: 'บันทึกส่งต่อระหว่างกะของทีม', box: { x: 0, y: 33, w: 4, h: 7 } },
  { id: 'todo', title: 'สิ่งที่ต้องทำ', note: 'รายการงานส่วนตัวของคุณ', box: { x: 4, y: 33, w: 4, h: 7 } },
  { id: 'sla', title: 'SLA Watch', note: 'เคสที่ต้องดำเนินการทันที พร้อมนาฬิกานับเวลา', box: { x: 8, y: 12, w: 4, h: 9 } },
  { id: 'forecast', title: 'คาดว่าจะเกิน SLA', note: 'เคสที่ยังไม่เกิน แต่ตามคิวและความเร็วทีมตอนนี้จะไม่ทัน', box: { x: 8, y: 21, w: 4, h: 6 } },
  { id: 'waiting', title: 'แชทรอตอบ', note: 'บทสนทนาที่ลูกค้าพิมพ์ล่าสุด เรียงตามเวลาที่รอ', box: { x: 8, y: 27, w: 4, h: 7 } },
  { id: 'me', title: 'ถึงคุณ', note: 'ถูกกล่าวถึง · เตือนติดตามผล · เคสที่ยกระดับ', box: { x: 8, y: 34, w: 4, h: 7 } },
  { id: 'replies', title: 'คำตอบด่วน', note: 'คำตอบสำเร็จรูปที่ใช้บ่อย', box: { x: 8, y: 41, w: 4, h: 4 } },
  { id: 'insights', title: 'AI และคลังความรู้', note: 'เห็นเฉพาะเจ้าขององค์กร', box: { x: 0, y: 47, w: 12, h: 13 } },
  { id: 'manager', title: 'มุมมองผู้ดูแล', note: 'ภาระงานของทีม ช่องทาง และสถิติรวม', box: { x: 0, y: 60, w: 12, h: 16 } },
];

/* What the page ships without. A page that shows everything shows nothing: the cards below are useful to the member
   who wants them and noise to everyone else, so they wait under เพิ่มการ์ด (right-click) rather than on the page.
   Only the page as it ships is trimmed this way; a board somebody laid out lists what they hid themselves. */
export const DEFAULT_HIDDEN = ['today', 'forecast', 'replies', 'handover', 'todo'];

/** Which cards a layout keeps off the page: its own list, or the trimmed page while nothing is laid out. */
export const hiddenIn = (layout: DashboardLayout) => (isEmptyLayout(layout) ? DEFAULT_HIDDEN : layout.hidden);

const BY_ID = new Map(CARDS.map((card) => [card.id, card]));

export const cardTitle = (id: string) => BY_ID.get(id)?.title ?? id;

const whole = (value: unknown, low: number, high: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : null;

/** A rectangle that fits on the board, or null. */
export function readBox(value: unknown): Box | null {
  if (!value || typeof value !== 'object') return null;
  const found = value as Partial<Box>;
  const w = whole(found.w, MIN_W, COLUMNS);
  const h = whole(found.h, MIN_H, MAX_ROWS);
  const y = whole(found.y, 0, MAX_ROWS);
  if (w === null || h === null || y === null) return null;
  const x = whole(found.x, 0, COLUMNS - w);
  return x === null ? null : { x, y, w, h };
}

/** A layout as it arrives from the server or from settings: anything unexpected reads as "nothing laid out yet". */
export function readLayout(value: unknown): DashboardLayout {
  const raw = typeof value === 'string' ? safeParse(value) : value;
  if (!raw || typeof raw !== 'object') return EMPTY_LAYOUT;
  const found = raw as Partial<DashboardLayout>;
  const box: Partial<Record<string, Box>> = {};
  if (found.box && typeof found.box === 'object')
    for (const [id, value] of Object.entries(found.box)) {
      const read = readBox(value);
      if (read) box[id] = read;
    }
  const layout: DashboardLayout = { hidden: Array.isArray(found.hidden) ? found.hidden.filter((id): id is string => typeof id === 'string') : [], box };
  if (found.base === 'page') layout.base = 'page';
  return layout;
}

function safeParse(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const isEmptyLayout = (layout: DashboardLayout) => !layout.hidden.length && !Object.keys(layout.box).length;

/** The member's board over the organization's: a member who has laid out nothing follows the organization, unless
    they chose the page as it ships (base 'page'), which sits between the two. */
export const layoutInUse = (mine: DashboardLayout, organization: DashboardLayout) =>
  !isEmptyLayout(mine) ? mine : mine.base === 'page' ? EMPTY_LAYOUT : organization;

/** sized: the member put this card on these squares themselves, so it is held to them. */
/** empty: the card drew nothing when measured, so it holds no squares until it does. */
export type PlacedCard = { id: string; title: string; box: Box; hidden: boolean; sized: boolean; empty?: boolean };

/** On the board and taking room: not put away, and not empty. */
export const occupies = (card: PlacedCard) => !card.hidden && !card.empty;

/** Do two rectangles cover any of the same squares? */
export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The first row at which `box` would sit clear of everything in `taken`. */
function firstFreeRow(box: Box, taken: Box[]): number {
  for (let y = box.y; y < MAX_ROWS; y += 1) {
    const at = { ...box, y };
    if (!taken.some((other) => overlaps(at, other))) return y;
  }
  return box.y;
}

/** What the screen draws: the cards this member can see, each on its own square of the board, top-left first.
    A card with no rectangle of its own - one released since this board was laid out - takes the first space at the
    foot that nothing else covers, rather than landing on top of something. */
export function placeCards(layout: DashboardLayout, available: (id: string) => boolean): PlacedCard[] {
  const found: PlacedCard[] = [];
  const taken: Box[] = [];
  const cards = CARDS.filter((card) => available(card.id));
  const off = hiddenIn(layout);
  for (const card of cards.filter((card) => layout.box[card.id])) {
    const box = layout.box[card.id] as Box;
    found.push({ id: card.id, title: card.title, box, hidden: off.includes(card.id), sized: true });
    if (!off.includes(card.id)) taken.push(box);
  }
  for (const card of cards.filter((card) => !layout.box[card.id])) {
    const hidden = off.includes(card.id);
    // Only when the member has laid the board out themselves: otherwise this is the page as it ships.
    const box = isEmptyLayout(layout) ? card.box : { ...card.box, y: firstFreeRow({ ...card.box, y: bottomOf(taken) }, taken) };
    found.push({ id: card.id, title: card.title, box, hidden, sized: false });
    if (!hidden) taken.push(box);
  }
  return found.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

const bottomOf = (taken: Box[]) => taken.reduce((low, box) => Math.max(low, box.y + box.h), 0);

/** A rough ceiling on how many times a push may pass through the board, so a cycle cannot run away. */
const PUSH_ROUNDS = 200;

/** Taller than this and it is not a card any more; a ceiling here is what a runaway measurement runs into. */
export const MAX_GROW = 30;

/** How many rows a card needs to hold `pixels` of content. */
export const rowsFor = (pixels: number) =>
  Math.min(MAX_GROW, Math.max(MIN_H, Math.ceil((pixels + GAP_PX) / (ROW_PX + GAP_PX))));

/* A card nobody has resized is as tall as what it holds.

   The rectangles above are what the page ships as, and a guess at a height is a guess: a checklist with one more
   step in it, a name that wraps, a screen a little narrower, and the card is a row short and the last line of it is
   cut off. So the ones the member has never touched are measured on the page itself and given the rows they need,
   and whatever that pushes into moves down, the same way a drop does. A card the member has sized keeps its size -
   it was chosen, and a choice is not corrected by measuring. */
export function growToFit(cards: PlacedCard[], needs: Record<string, number>, fixed: (id: string) => boolean): PlacedCard[] {
  /* An untouched card takes exactly the rows its contents ask for once they have been measured - not more: the
     rectangles this file ships with are guesses, and a guess a row too tall leaves a band of nothing at the foot of
     a card, which reads as a mistake. Until it is measured, the guess stands.

     A card measured at nothing - its contents drew nothing, for want of data or of the right role - holds no squares
     at all rather than a guessed rectangle of blank page. It is still drawn, out of the flow, so the next measurement
     sees it the moment it has something to show. */
  const wanted = cards.map((card) => {
    const rows = needs[card.id];
    const empty = rows === 0;
    const box = fixed(card.id) || empty ? card.box : { ...card.box, h: Math.max(MIN_H, rows ?? card.box.h) };
    return { ...card, box, empty };
  });
  const placed: PlacedCard[] = [];
  for (const card of wanted) {
    if (!occupies(card)) {
      placed.push(card);
      continue;
    }
    let box = card.box;
    if (!fixed(card.id)) {
      /* And it sits directly under whatever is above it in its columns, the way the page flowed before it was a
         board: a card nobody placed has no reason to float below a gap that a shorter card above it left behind. A
         card the member placed stays on its squares - that gap is theirs. */
      const under = placed
        .filter((other) => occupies(other) && other.box.x < box.x + box.w && box.x < other.box.x + other.box.w && other.box.y < box.y + box.h)
        .reduce((low, other) => Math.max(low, other.box.y + other.box.h), 0);
      box = { ...box, y: Math.min(box.y, Math.max(0, under)) };
    }
    for (let round = 0; round < PUSH_ROUNDS; round += 1) {
      const over = placed.find((other) => occupies(other) && overlaps(box, other.box));
      if (!over) break;
      box = { ...box, y: over.box.y + over.box.h };
    }
    placed.push({ ...card, box });
  }
  return placed.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

/* A card that went away leaves no hole.

   A card that is no longer on the page - the setup checklist closed for good or finished, a card this member's role
   does not get - still has its rectangle written down on a board somebody laid out, and the cards under it would sit
   below an empty band. The cards under it, in its columns and everything under those in theirs, come up by as many
   of its rows as they can without landing on a card beside them. A gap the member left between two cards that are
   both still there is theirs and stays. */
export function closeGaps(cards: PlacedCard[], vacated: Box[]): PlacedCard[] {
  let placed = cards.map((card) => ({ ...card }));
  for (const gap of [...vacated].sort((a, b) => b.y - a.y)) {
    const on = placed.filter(occupies);
    // What hangs under the gap: the cards starting at or below its top in its columns, then whatever is under those.
    const moving = new Set<string>();
    let reach = on.filter((c) => c.box.y >= gap.y && c.box.x < gap.x + gap.w && gap.x < c.box.x + c.box.w);
    while (reach.length) {
      for (const c of reach) moving.add(c.id);
      reach = on.filter(
        (c) => !moving.has(c.id) && on.some((m) => moving.has(m.id) && c.box.y >= m.box.y + m.box.h && c.box.x < m.box.x + m.box.w && m.box.x < c.box.x + c.box.w),
      );
    }
    if (!moving.size) continue;
    const staying = on.filter((c) => !moving.has(c.id));
    const top = Math.min(...on.filter((c) => moving.has(c.id)).map((c) => c.box.y));
    let lift = Math.min(gap.h, top);
    for (; lift > 0; lift -= 1) {
      const clear = on.every((c) => !moving.has(c.id) || !staying.some((s) => overlaps({ ...c.box, y: c.box.y - lift }, s.box)));
      if (clear) break;
    }
    if (lift > 0) placed = placed.map((c) => (moving.has(c.id) ? { ...c, box: { ...c.box, y: c.box.y - lift } } : c));
  }
  return placed.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

/** How many rows the board needs, so it keeps its shape while a card is being carried across it. */
export const rowsNeeded = (cards: PlacedCard[]) => Math.max(8, bottomOf(cards.filter(occupies).map((c) => c.box)) + 2);

/** `box` clipped to the board, and to nothing smaller than a card. */
export function fitBox(box: Box): Box {
  const w = Math.min(COLUMNS, Math.max(MIN_W, Math.round(box.w)));
  const h = Math.min(MAX_ROWS, Math.max(MIN_H, Math.round(box.h)));
  return { w, h, x: Math.min(COLUMNS - w, Math.max(0, Math.round(box.x))), y: Math.min(MAX_ROWS, Math.max(0, Math.round(box.y))) };
}

/** The board with every card's rectangle written down, so that from now on moving one never shifts another. */
export function materialise(layout: DashboardLayout, cards: PlacedCard[]): DashboardLayout {
  const box: Partial<Record<string, Box>> = { ...layout.box };
  for (const card of cards) box[card.id] = box[card.id] ?? card.box;
  // Written down with what the trimmed page kept off, so un-hiding one card does not bring back the rest.
  return { ...layout, hidden: [...hiddenIn(layout)], box };
}

/* Putting a card where another one already is.

   The one that was there moves down, whole, to just below the card that arrived - it is never made smaller to fit
   around it, because a card's size is something its owner chose and a drop somewhere else is no reason to take it
   back. What the card that moved lands on moves down in turn, and so on, so a drop at the top of a full board pushes
   a whole column of cards down rather than covering them.

   Only downwards. A push that could go either way has to guess which, and a guess that moves a card the reader was
   not looking at is worse than a longer page. */
export function placeWithPush(layout: DashboardLayout, cards: PlacedCard[], id: string, box: Box): DashboardLayout {
  return placeManyWithPush(layout, cards, { [id]: box });
}

/** Several cards put down at once, as one: whatever they land on moves down, and none of them is pushed by the
    others, because they were carried together and arrive together. */
export function placeManyWithPush(layout: DashboardLayout, cards: PlacedCard[], moves: Record<string, Box>): DashboardLayout {
  const found = materialise(layout, cards);
  const boxes: Record<string, Box> = {};
  for (const card of cards) if (occupies(card)) boxes[card.id] = (found.box[card.id] as Box) ?? card.box;
  for (const [id, box] of Object.entries(moves)) boxes[id] = fitBox(box);
  const queue = Object.keys(moves);
  for (let round = 0; queue.length && round < PUSH_ROUNDS; round += 1) {
    const moved = queue.shift() as string;
    const above = boxes[moved];
    if (!above) continue;
    for (const [other, sitting] of Object.entries(boxes)) {
      if (other === moved || other in moves || !overlaps(above, sitting)) continue;
      boxes[other] = fitBox({ ...sitting, y: above.y + above.h });
      queue.push(other);
    }
  }
  return { ...found, box: { ...found.box, ...boxes } };
}

export function hideCard(layout: DashboardLayout, cards: PlacedCard[], id: string, hidden: boolean): DashboardLayout {
  const found = materialise(layout, cards);
  return { ...found, hidden: hidden ? [...new Set([...found.hidden, id])] : found.hidden.filter((c) => c !== id) };
}

/* Pulling a card's edges. A card has eight of them - four sides and four corners - because which one is nearest is
   not something the person arranging the page should have to work around. `edge` names the sides being pulled:
   'n', 's', 'e', 'w' and the corners between them, as on a map. */
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export const edgeNames: Record<Edge, string> = {
  n: 'ขอบบน',
  s: 'ขอบล่าง',
  e: 'ขอบขวา',
  w: 'ขอบซ้าย',
  ne: 'มุมขวาบน',
  nw: 'มุมซ้ายบน',
  se: 'มุมขวาล่าง',
  sw: 'มุมซ้ายล่าง',
};

/** The rectangle after an edge has been pulled to a square. The opposite side stays where it is. */
export function pullEdge(from: Box, edge: Edge, square: { x: number; y: number }): Box {
  let { x, y, w, h } = from;
  if (edge.includes('e')) w = square.x - x + 1;
  if (edge.includes('w')) {
    const right = x + w;
    x = Math.max(0, Math.min(square.x, right - MIN_W));
    w = right - x;
  }
  if (edge.includes('s')) h = square.y - y + 1;
  if (edge.includes('n')) {
    const bottom = y + h;
    y = Math.max(0, Math.min(square.y, bottom - MIN_H));
    h = bottom - y;
  }
  return fitBox({ x, y, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) });
}

/** The same by the square, for the arrow keys: the side being held moves, the opposite one stays. */
export function stepEdge(from: Box, edge: Edge, dx: number, dy: number): Box {
  let { x, y, w, h } = from;
  if (edge.includes('e')) w += dx;
  if (edge.includes('w')) {
    x += dx;
    w -= dx;
  }
  if (edge.includes('s')) h += dy;
  if (edge.includes('n')) {
    y += dy;
    h -= dy;
  }
  return fitBox({ x: Math.max(0, x), y: Math.max(0, y), w, h });
}

/** The square a point on the screen falls on, given where the board is and how wide a column came out. */
export function squareAt(board: DOMRect, x: number, y: number): { x: number; y: number } {
  const column = (board.width + GAP_PX) / COLUMNS;
  return { x: Math.floor((x - board.left) / column), y: Math.floor((y - board.top) / (ROW_PX + GAP_PX)) };
}
