'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { macroSteps } from '@/features/automation/labels';
import { fieldText, useCaseFields } from '@/features/tickets/fields';
import { useCaseTags } from '@/features/tickets/tags';
import { date } from '@/lib/format';
import { priorityLabels, statusLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useMemberName, useTeamName } from '@/lib/session';
import { runAssistantActions } from '../api';
import type { AssistantAction, AssistantResult } from '../types';

/* What the assistant proposes to do, under its answer (AiAssistant.tsx): one row per case with what will change, in
   the app's own words built from what the server checked (never the AI's description of it), so the list is exactly
   what ทำเลย does. Every row is picked at first, except a merge of customer records that match by name alone; a
   message to a customer or a note can be rewritten before it goes. After the press each row says whether it was done,
   and why not. Markup: pages/ai-assistant.css (assistant-actions). */

const REFRESH = ['/api/tickets', '/api/conversations', '/api/automation', '/api/workspace', '/api/contacts'];
const MATCHED: Record<string, string> = { email: 'อีเมล', phone: 'เบอร์โทร', name: 'ชื่อ' };

/** A merge of records that share an email or a phone number; a shared name alone may be two people. */
const surelyOne = (a: AssistantAction) => a.type !== 'merge_customers' || Boolean(a.matched_by?.some((m) => m === 'email' || m === 'phone'));

/** "อีเมลและเบอร์โทรตรงกัน", "อีเมล เบอร์โทร และชื่อตรงกัน", or why to look twice before merging. */
function matchedText(a: AssistantAction): { text: string; warn: boolean } {
  const parts = (a.matched_by ?? []).map((m) => MATCHED[m] ?? m);
  if (!surelyOne(a)) return { text: parts.length ? 'ตรงกันแค่ชื่อ อาจเป็นคนละคน ตรวจก่อนเลือก' : 'ข้อมูลติดต่อไม่ตรงกัน ตรวจให้แน่ใจว่าเป็นคนเดียวกัน', warn: true };
  const last = parts[parts.length - 1];
  return { text: `${parts.length > 2 ? `${parts.slice(0, -1).join(' ')} และ${last}` : parts.join('และ')}ตรงกัน`, warn: false };
}

/** The records of a merge: the one kept first, each with how to tell it apart and its cases. */
function MergePeople({ a }: { a: AssistantAction }) {
  const { text, warn } = matchedText(a);
  return (
    <>
      <ul className="assistant-action-people">
        {(a.customers ?? []).map((c, i) => (
          <li key={c.id}>
            <strong>{c.name}</strong>
            {(c.email || c.phone) && <span>{c.email || c.phone}</span>}
            <span>{c.cases} เคส</span>
            {i === 0 && <span className="assistant-action-keep">เก็บไว้</span>}
          </li>
        ))}
      </ul>
      <span className={`assistant-action-match${warn ? ' warn' : ''}`}>{text}</span>
    </>
  );
}

function useActionLines() {
  const memberName = useMemberName();
  const teamName = useTeamName();
  const tags = useCaseTags();
  const caseFields = useCaseFields();
  const tagNames = (ids: string[] = []) => ids.map((id) => `“${tags.find((t) => t.id === id)?.name ?? 'ป้ายที่ถูกลบ'}”`).join(' ');
  return (a: AssistantAction): string[] => {
    switch (a.type) {
      case 'update_case': {
        const c = a.changes ?? {};
        return [
          c.status ? `เปลี่ยนสถานะเป็น “${statusLabels[c.status] ?? c.status}”` : '',
          c.priority ? `ความเร่งด่วน “${priorityLabels[c.priority] ?? c.priority}”` : '',
          c.team_id ? `ย้ายไป ${teamName(c.team_id)}` : '',
          c.assignee_id ? `มอบหมายให้ ${memberName(c.assignee_id)}` : c.assignee_id === null ? 'เอาผู้รับผิดชอบออก' : '',
        ].filter(Boolean);
      }
      case 'tag_case':
        return [a.add_tags?.length ? `ติดป้าย ${tagNames(a.add_tags)}` : '', a.remove_tags?.length ? `เอาป้าย ${tagNames(a.remove_tags)} ออก` : ''].filter(Boolean);
      case 'snooze_case':
        return [`พักเคสถึง ${date(a.until, true)}`, a.text ? `เหตุผล: ${a.text}` : ''].filter(Boolean);
      case 'wake_case':
        return ['นำเคสที่พักไว้กลับเข้าคิวตอนนี้'];
      case 'note':
        return ['เขียนบันทึกภายใน ลูกค้าไม่เห็น'];
      case 'reply':
        return ['ส่งข้อความถึงลูกค้า'];
      case 'retry_send':
        return [`ส่งข้อความที่ส่งไม่สำเร็จอีกครั้ง ${a.messages?.length ?? 0} ข้อความ`];
      case 'auto_assign':
        return [
          a.enabled === true ? 'เปิดแจกเคสอัตโนมัติ' : a.enabled === false ? 'ปิดแจกเคสอัตโนมัติ' : '',
          a.cap ? `เพดาน ${a.cap} เคสต่อคน` : '',
        ].filter(Boolean);
      case 'macro':
        return a.macro ? [`ใช้มาโคร “${a.macro.name}”`, macroSteps(a.macro)] : [];
      case 'merge_customers':
        return [
          `รวม ${a.customers?.length ?? 0} รายชื่อเป็นรายชื่อเดียว`,
          'เคสและบทสนทนาของรายชื่ออื่นจะย้ายมารายชื่อที่เก็บไว้ แล้วลบรายชื่ออื่น รวมแล้วแยกคืนไม่ได้',
        ];
      case 'set_fields':
        return Object.entries(a.values ?? {}).map(([id, value]) => {
          const field = caseFields.find((f) => f.id === id);
          return field ? `กรอก ${field.name}: ${fieldText(field, value)}` : 'กรอกช่องที่ถูกลบไปแล้ว';
        });
      default:
        return [];
    }
  };
}

/** A message or note to rewrite: as tall as its words, so the whole of it is read before it goes (up to about ten
    lines; past that it scrolls). Set through the CSSOM: the CSP refuses style attributes. */
function GrowingText({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.setProperty('height', 'auto');
    el.style.setProperty('height', `${Math.min(el.scrollHeight + 2, 260)}px`);
    el.style.setProperty('overflow-y', el.scrollHeight > 260 ? 'auto' : 'hidden');
  }, [value]);
  return (
    <textarea ref={box} className="assistant-action-text" rows={2} maxLength={5000} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />
  );
}

export function AssistantActions({
  jobId,
  result,
  onRan,
  onOpenCase,
}: {
  jobId: string;
  result: Pick<AssistantResult, 'actions' | 'dropped' | 'ran'>;
  onRan: (ran: NonNullable<AssistantResult['ran']>) => void;
  /** A case link was followed (the panel gets out of the way on a phone). */
  onOpenCase: () => void;
}) {
  const toast = useToast();
  const refresh = useInvalidate();
  const lines = useActionLines();
  const actions = result.actions ?? [];
  const ran = result.ran;
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set(actions.flatMap((a, i) => (surelyOne(a) ? [i] : []))));
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const outcome = new Map((ran?.results ?? []).map((r) => [r.index, r]));
  const succeeded = ran?.results.filter((r) => r.ok).length ?? 0;

  const toggle = (index: number) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const run = async () => {
    if (!picked.size) return toast('เลือกอย่างน้อย 1 รายการก่อน แล้วกดทำเลย', true);
    const edited = Object.fromEntries(Object.entries(texts).filter(([i]) => picked.has(Number(i))));
    if (Object.values(edited).some((t) => !t.trim())) return toast('ข้อความที่จะส่งต้องไม่ว่าง', true);
    setBusy(true);
    try {
      const done = await runAssistantActions(jobId, [...picked].sort((a, b) => a - b), edited);
      onRan({ at: new Date().toISOString(), results: done.results });
      await refresh(...REFRESH);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assistant-actions">
      <div className="assistant-actions-head">
        <strong>{ran ? 'ผลการทำตามรายการ' : 'สิ่งที่ผู้ช่วยจะทำให้'}</strong>
        <span>{ran ? `สำเร็จ ${succeeded} จาก ${ran.results.length} รายการ` : `เลือกไว้ ${picked.size} จาก ${actions.length} รายการ`}</span>
      </div>
      <ul className="assistant-action-list">
        {actions.map((a, i) => {
          const done = outcome.get(i);
          const id = `${jobId}-action-${i}`;
          const writes = a.type === 'reply' || a.type === 'note';
          return (
            <li key={i} className={ran ? (done ? (done.ok ? 'ok' : 'failed') : 'skipped') : picked.has(i) ? 'picked' : ''}>
              <div className="assistant-action-row">
                {ran ? (
                  <span className="assistant-action-state" aria-label={done ? (done.ok ? 'ทำแล้ว' : 'ทำไม่สำเร็จ') : 'ไม่ได้เลือก'}>
                    <Icon name={done ? (done.ok ? 'check' : 'close') : 'minus'} />
                  </span>
                ) : (
                  <input id={id} type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                )}
                <div className="assistant-action-body">
                  {a.type === 'merge_customers' ? (
                    <span className="assistant-action-case">
                      <span>ข้อมูลลูกค้า</span>
                    </span>
                  ) : (
                    a.type !== 'auto_assign' && (
                      <span className="assistant-action-case">
                        {a.case && a.ticket_id ? (
                          <Link href={`/tickets/${a.ticket_id}`} onClick={onOpenCase}>
                            {a.case}
                          </Link>
                        ) : (
                          <span>แชทที่เปิดอยู่</span>
                        )}
                        {a.subject && <span className="assistant-action-subject">{a.subject}</span>}
                      </span>
                    )
                  )}
                  <label htmlFor={ran ? undefined : id}>
                    {lines(a).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </label>
                  {a.type === 'merge_customers' && <MergePeople a={a} />}
                </div>
              </div>
              {writes &&
                (ran ? (
                  <p className="assistant-action-text">{texts[i] ?? a.text}</p>
                ) : (
                  <GrowingText
                    value={texts[i] ?? a.text ?? ''}
                    label={a.type === 'reply' ? `ข้อความถึงลูกค้า ${a.case ?? ''}` : `บันทึกภายใน ${a.case ?? ''}`}
                    onChange={(value) => setTexts((all) => ({ ...all, [i]: value }))}
                  />
                ))}
              {done && !done.ok && <p className="assistant-action-error">{done.error}</p>}
              {done?.ok && done.note && <p className="assistant-action-note">{done.note}</p>}
            </li>
          );
        })}
      </ul>
      {Boolean(result.dropped) && (
        <p className="assistant-actions-note">ข้าม {result.dropped} รายการที่อ้างถึงเคสหรือคนที่คุณไม่มีสิทธิ์ หรือทำซ้ำกับรายการอื่น</p>
      )}
      {!ran && (
        <div className="assistant-actions-foot">
          <span>ทำด้วยสิทธิ์ของคุณ และบันทึกในประวัติการใช้งาน</span>
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => void run()}>
            <Icon name="check" />
            {busy ? 'กำลังทำ…' : `ทำเลย ${picked.size} รายการ`}
          </button>
        </div>
      )}
    </div>
  );
}
