'use client';

import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import type { Article } from '../types';

/* ปักหมุดของฉัน: the member's own shelf of articles they reach for most, above the list and seen only by them. Drag
   a card to arrange it (or, focused, Alt + ← / →); the cross takes it off the shelf. Markup: pages/knowledge
   (pin-shelf). */

export function PinnedShelf({
  pins,
  onOpen,
  onArrange,
  onUnpin,
}: {
  pins: Article[];
  onOpen: (article: Article) => void;
  onArrange: (ids: string[]) => void;
  onUnpin: (article: Article) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ids = pins.map((a) => a.id);

  const move = (id: string, to: number) => {
    const rest = ids.filter((i) => i !== id);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
    if (rest.join() !== ids.join()) onArrange(rest);
  };

  const drop = (event: DragEvent, target: string) => {
    event.preventDefault();
    const id = dragged ?? event.dataTransfer.getData('text/plain');
    setDragged(null);
    setOver(null);
    if (!id || id === target) return;
    move(id, ids.indexOf(target));
  };

  const keys = (event: KeyboardEvent, id: string) => {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const at = ids.indexOf(id);
    move(id, event.key === 'ArrowLeft' ? at - 1 : at + 1);
    // Keep the focus on the card that moved.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.pin-card[data-id="${id}"] .pin-open`)?.focus());
  };

  return (
    <section className="pin-shelf" aria-labelledby="pin-shelf-title">
      <div className="pin-shelf-head">
        <h2 id="pin-shelf-title">
          <Icon name="pin" />
          ปักหมุดของฉัน
        </h2>
        <span className="muted small">{pins.length > 1 ? 'ลากเพื่อจัดลำดับ · เห็นเฉพาะคุณ' : 'เห็นเฉพาะคุณ'}</span>
      </div>
      <ol className="pin-list">
        {pins.map((a, index) => (
          <li
            key={a.id}
            className={`pin-card${dragged === a.id ? ' dragging' : ''}${over === a.id && dragged !== a.id ? ' over' : ''}`}
            data-id={a.id}
            draggable
            onDragStart={(event) => {
              setDragged(a.id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', a.id);
            }}
            onDragEnd={() => {
              setDragged(null);
              setOver(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (over !== a.id) setOver(a.id);
            }}
            onDrop={(event) => drop(event, a.id)}
          >
            <span className="pin-grip" aria-hidden="true">
              <Icon name="grip" />
            </span>
            <button
              type="button"
              className="pin-open"
              aria-label={`อ่าน ${a.title} (ลำดับ ${index + 1} จาก ${pins.length} · Alt + ลูกศรซ้ายขวาเพื่อย้าย)`}
              onClick={() => onOpen(a)}
              onKeyDown={(event) => keys(event, a.id)}
            >
              <span className="pin-title">{a.title}</span>
              <span className="pin-meta">
                {a.category}
                {a.uses ? ` · ใช้ ${a.uses} ครั้ง` : ''}
              </span>
            </button>
            <button type="button" className="icon-btn pin-remove" aria-label={`เลิกปักหมุด ${a.title}`} title="เลิกปักหมุด" onClick={() => onUnpin(a)}>
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
