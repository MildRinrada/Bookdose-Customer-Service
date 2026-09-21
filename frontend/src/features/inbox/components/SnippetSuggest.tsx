'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RichEditor } from '@/features/rich/RichEditor';

/* Prepared replies while the reply is being written: typing "/" and the first letters brings up what matches, ↑ ↓
   choose and Enter or Tab puts the text in. Typing the whole shortcut and then a space still works without ever
   looking at the menu, the way it did before, and Alt+1 … Alt+9 still reach the member's own first nine.

   Both lists are searched: the team's (ตั้งค่าองค์กร → คำตอบสำเร็จรูปของทีม) and the member's own (ตั้งค่าบัญชี →
   คำตอบด่วน). Either one only writes into the draft — a Macro is what sends.

   The menu is fixed to the screen beside the caret and placed through the CSSOM (the policy allows no style
   attributes - backend/middleware/security.py). Markup: styles/pages/inbox.css (snippet-menu). */

export type Prepared = { id?: string; shortcut: string; text: string; team?: boolean };

const SHOWN = 6;
/** "/" and what has been typed after it, at the start of a word. */
const WORD = /(?:^|\s)\/([^\s/]*)$/;

type Spot = { node: Text; start: number; end: number; word: string };

function typedAt(area: HTMLElement): Spot | null {
  const selection = getSelection();
  const node = selection?.anchorNode;
  if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !area.contains(node)) return null;
  const before = (node.textContent ?? '').slice(0, selection.anchorOffset);
  const typed = WORD.exec(before);
  if (!typed) return null;
  return {
    node: node as Text,
    start: selection.anchorOffset - typed[1].length - 1,
    end: selection.anchorOffset,
    word: typed[1].toLowerCase(),
  };
}

export function useSnippets(editor: RichEditor, mine: Prepared[], team: Prepared[]) {
  const [word, setWord] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const card = useRef<HTMLDivElement>(null);

  // The team's first: they are the organization's own words, and a member's own shortcut of the same name wins
  // below by being searched after (the find takes the first match).
  const all = [...mine, ...team.map((snippet) => ({ ...snippet, team: true }))];
  const found = word === null ? [] : all.filter((snippet) => snippet.shortcut.startsWith(word)).slice(0, SHOWN);
  const chosen = Math.min(active, Math.max(0, found.length - 1));

  // What the key handler reads, kept current without rebuilding the handler on every keystroke.
  const liveRef = useRef({ all, mine, found, chosen, word });
  useEffect(() => {
    liveRef.current = { all, mine, found, chosen, word };
  });

  const close = useCallback(() => {
    setWord(null);
    setActive(0);
  }, []);

  /** Replace the "/คีย์ลัด" being typed with the reply itself. */
  const put = useCallback(
    (snippet: Prepared) => {
      const area = editor.element();
      const selection = getSelection();
      if (!area || !selection) return;
      const spot = typedAt(area);
      if (spot) {
        const range = document.createRange();
        range.setStart(spot.node, spot.start);
        range.setEnd(spot.node, spot.end);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand('insertText', false, snippet.text);
      editor.sync();
      close();
    },
    [editor, close],
  );

  useEffect(() => {
    const area = editor.element();
    if (!area) return;

    /* After anything that may have changed what is typed or where the cursor is. The choice only goes back to the
       first row when the word itself changed: this also runs on the key-up of ↑ and ↓, and resetting there would
       drag the highlight back to the top the instant it was moved. */
    const read = () => {
      const spot = typedAt(area);
      const next = spot ? spot.word : null;
      if (next !== liveRef.current.word) setActive(0);
      setWord(next);
    };

    const onKey = (event: KeyboardEvent) => {
      const live = liveRef.current;
      // Alt+1 … Alt+9: the member's own first nine, wherever the cursor is.
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (event.altKey && !event.ctrlKey && !event.metaKey && digit) {
        const snippet = live.mine[Number(digit[1]) - 1];
        if (!snippet) return;
        event.preventDefault();
        document.execCommand('insertText', false, snippet.text);
        editor.sync();
        close();
        return;
      }
      // While the menu is up it takes the keys that mean "choose".
      if (live.found.length) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const by = event.key === 'ArrowDown' ? 1 : live.found.length - 1;
          setActive((index) => (Math.min(index, live.found.length - 1) + by) % live.found.length);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          put(live.found[live.chosen] ?? live.found[0]);
          return;
        }
      }
      // The older way, still there for anyone who knows the shortcut by heart: type it whole, then a space.
      if ((event.key !== ' ' && event.key !== 'Tab') || event.altKey || event.ctrlKey || event.metaKey) return;
      const spot = typedAt(area);
      const snippet = spot && spot.word && live.all.find((item) => item.shortcut === spot.word);
      if (!snippet) return;
      event.preventDefault();
      put(snippet);
    };

    area.addEventListener('keydown', onKey);
    area.addEventListener('keyup', read);
    area.addEventListener('input', read);
    area.addEventListener('mouseup', read);
    area.addEventListener('blur', close);
    return () => {
      area.removeEventListener('keydown', onKey);
      area.removeEventListener('keyup', read);
      area.removeEventListener('input', read);
      area.removeEventListener('mouseup', read);
      area.removeEventListener('blur', close);
    };
  }, [editor, put, close]);

  // Beside the caret: above it where there is room, below it otherwise.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !found.length) return;
    const place = () => {
      const selection = getSelection();
      if (!selection?.rangeCount) return;
      const at = selection.getRangeAt(0).getBoundingClientRect();
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const above = at.top - height - 8 >= 12;
      el.style.setProperty('top', `${Math.round(above ? at.top - height - 8 : Math.min(at.bottom + 8, window.innerHeight - height - 12))}px`);
      el.style.setProperty('left', `${Math.round(Math.max(12, Math.min(at.left, window.innerWidth - width - 12)))}px`);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [found.length, word]);

  const menu = found.length ? (
    <div
      ref={card}
      className="snippet-menu"
      role="listbox"
      aria-label="คำตอบสำเร็จรูปที่ตรงกับที่พิมพ์"
      // Keeps the writing box focused, so choosing with the mouse puts the text where the cursor was.
      onMouseDown={(event) => event.preventDefault()}
    >
      {found.map((snippet, index) => (
        <button
          key={`${snippet.team ? 'team' : 'mine'}:${snippet.id ?? snippet.shortcut}`}
          type="button"
          role="option"
          aria-selected={index === chosen}
          className={`snippet-option${index === chosen ? ' active' : ''}`}
          onClick={() => put(snippet)}
        >
          <span className="snippet-option-head">
            <code>/{snippet.shortcut}</code>
            <span className="tiny muted">{snippet.team ? 'ของทีม' : 'ของฉัน'}</span>
          </span>
          <span className="muted snippet-option-text">{snippet.text}</span>
        </button>
      ))}
      <p className="tiny muted snippet-menu-foot">↑ ↓ เลือก · Enter หรือ Tab แทรก · Esc ปิด</p>
    </div>
  ) : null;

  return { menu };
}
