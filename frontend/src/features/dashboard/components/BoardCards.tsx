'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useToast } from '@/components/ui/Toast';
import { clockTime, shortAgo } from '@/lib/format';
import { useApi } from '@/lib/query';
import { addNote, BOARD_PATH, removeNote, setTodoDone, type Board, type Todo } from '../board';

/* The overview's board: ส่งต่อกะ (handover notes for whoever works next, the whole organization reads them) and
   สิ่งที่ต้องทำของฉัน (the member's own short to-dos, with an optional time today). A case number written as BD-1234
   opens that case in the case list. Markup: pages/dashboard-widgets (board-card). */

/** The text with every "BD-1234" as a link to that case. */
function withCaseLinks(text: string): ReactNode[] {
  return text.split(/(BD-\d{1,7})/g).map((part, i) =>
    /^BD-\d+$/.test(part) ? (
      <Link key={i} className="board-case" href={`/tickets?q=${part}`}>
        {part}
      </Link>
    ) : (
      part
    ),
  );
}

function useBoard(interval: number | false) {
  return useApi<Board>(BOARD_PATH, { refetchInterval: interval });
}

/** Keeps the board the server answered, so both cards show it at once. */
function useBoardWrite() {
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (write: () => Promise<Board>) => {
    setBusy(true);
    try {
      client.setQueryData([BOARD_PATH], await write());
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function HandoverCard({ interval, readOnly }: { interval: number | false; readOnly: boolean }) {
  const board = useBoard(interval).data;
  const { busy, run } = useBoardWrite();
  const [text, setText] = useState('');
  const notes = board?.handover ?? [];

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() && (await run(() => addNote('handover', text)))) setText('');
  };

  return (
    <section className="card board-card handover-card" aria-labelledby="handover-title">
      <div className="card-header">
        <div>
          <h2 id="handover-title"><Icon name="users" className="card-title-icon" />ส่งต่อกะ</h2>
          <p>ทุกคนในองค์กรเห็น · เก็บ {board?.handover_days ?? 3} วัน</p>
        </div>
      </div>
      <div className="card-body">
        {!readOnly && (
          <form className="board-form" onSubmit={(e) => void submit(e)}>
            <textarea
              aria-label="ข้อความส่งต่อกะ"
              rows={2}
              maxLength={500}
              value={text}
              placeholder="เช่น กะเช้าเคลียร์แชท Facebook แล้ว เหลือ BD-1002 ฝากกะบ่ายต่อ"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
              }}
            />
            <button className="btn primary sm" type="submit" disabled={busy || !text.trim()}>
              <Icon name="send" />
              ฝากส่งต่อ
            </button>
          </form>
        )}
        {notes.length ? (
          <ul className="handover-list">
            {notes.map((n) => (
              <li key={n.id} className={n.mine ? 'mine' : ''}>
                <UserAvatar id={n.user_id} name={n.author_name} index={n.mine ? 0 : 3} />
                <div className="handover-body">
                  <div className="handover-meta">
                    <strong>{n.mine ? 'คุณ' : n.author_name}</strong>
                    <time dateTime={n.created_at} title={clockTime(n.created_at)}>
                      {shortAgo(n.created_at)}
                    </time>
                  </div>
                  <p>{withCaseLinks(n.body)}</p>
                </div>
                {n.removable && !readOnly && (
                  <button type="button" className="icon-btn board-remove" aria-label="ลบโน้ตนี้" disabled={busy} onClick={() => void run(() => removeNote(n.id))}>
                    <Icon name="close" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="board-empty">
            <Icon name="users" />
            <strong>ยังไม่มีเรื่องฝากส่งต่อ</strong>
            <span>งานที่ค้าง เคสที่ต้องตามต่อ หรือเรื่องที่กะถัดไปควรรู้</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** "15:00" today, as the ISO time the server keeps. */
function todayAt(time: string) {
  const [h, m] = time.split(':').map(Number);
  const at = new Date();
  at.setHours(h, m, 0, 0);
  return at.toISOString();
}

function dueTone(todo: Todo, now: number) {
  if (!todo.due_at || todo.done_at) return '';
  const left = new Date(todo.due_at).getTime() - now;
  return left < 0 ? 'late' : left < 30 * 60e3 ? 'soon' : '';
}

export function TodoCard({ interval, now }: { interval: number | false; now: number }) {
  const board = useBoard(interval).data;
  const { busy, run } = useBoardWrite();
  const [text, setText] = useState('');
  const [time, setTime] = useState('');
  const todos = board?.todos ?? [];
  const open = todos.filter((t) => !t.done_at).length;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() && (await run(() => addNote('todo', text, time ? todayAt(time) : null)))) {
      setText('');
      setTime('');
    }
  };

  return (
    <section className="card board-card my-todo-card" aria-labelledby="todo-title">
      <div className="card-header">
        <div>
          <h2 id="todo-title"><Icon name="checkCircle" className="card-title-icon" />สิ่งที่ต้องทำของฉัน</h2>
          <p>{open ? `เหลือ ${open} งาน · เห็นเฉพาะคุณ` : 'เห็นเฉพาะคุณ'}</p>
        </div>
      </div>
      <div className="card-body">
        <form className="todo-form" onSubmit={(e) => void submit(e)}>
          <input aria-label="งานที่ต้องทำ" maxLength={500} value={text} placeholder="เช่น โทรตามลูกค้า BD-1002" onChange={(e) => setText(e.target.value)} />
          <input aria-label="เวลา (วันนี้ ไม่บังคับ)" title="เวลา (วันนี้ ไม่บังคับ)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <button className="btn primary sm" type="submit" disabled={busy || !text.trim()} aria-label="เพิ่มงาน">
            <Icon name="plus" />
          </button>
        </form>
        {todos.length ? (
          <ul className="my-todo-list">
            {todos.map((t) => (
              <li key={t.id} className={`${t.done_at ? 'done' : ''} ${dueTone(t, now)}`}>
                <label>
                  <input type="checkbox" checked={Boolean(t.done_at)} disabled={busy} onChange={(e) => void run(() => setTodoDone(t.id, e.target.checked))} />
                  <span>{withCaseLinks(t.body)}</span>
                </label>
                {t.due_at && (
                  <time className="todo-time" dateTime={t.due_at}>
                    <Icon name="clock" />
                    {clockTime(t.due_at)}
                  </time>
                )}
                <button type="button" className="icon-btn board-remove" aria-label="ลบงานนี้" disabled={busy} onClick={() => void run(() => removeNote(t.id))}>
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="board-empty">
            <Icon name="checkCircle" />
            <strong>ยังไม่มีงานที่จดไว้</strong>
            <span>ใส่เวลาได้ ระบบจะเตือนด้วยสีเมื่อใกล้ถึงเวลา</span>
          </div>
        )}
      </div>
    </section>
  );
}
