'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { TICKET_PREFIXES } from '../api';
import { saveCaseTags, tagsOf, tagTicket, TAGS_PER_CASE, useCaseTags } from '../tags';
import type { Ticket } from '../types';
import { TAG_LIST_PREFIXES } from './ManageTags';
import { TagChips, TagPicker } from './TagPicker';

/* ป้ายเคส on the case screen: what the team found the case to be about, from the organization's list. Each click
   saves; while one is on its way the chips wait, so two clicks never race. The case is read again every few seconds,
   and what the server says replaces what is shown only between clicks. An owner who finds the word missing adds it
   to the list right here, and it goes on the case at once (the whole list is managed from the case list). */

export function TicketTagsCard({ ticket }: { ticket: Ticket }) {
  const work = useWork();
  const list = useCaseTags();
  const toast = useToast();
  const refresh = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const saved = ticket.tags ?? [];
  const [picked, setPicked] = useState(saved);
  const [seen, setSeen] = useState(saved.join(','));
  if (!busy && seen !== saved.join(',')) {
    setSeen(saved.join(','));
    setPicked(saved);
  }
  const canEdit = !work.read_only;
  const owner = work.role === 'admin' && canEdit;

  const put = async (next: string[], before: string[]) => {
    setPicked(next);
    try {
      await tagTicket(ticket.id, next);
      await refresh(...TICKET_PREFIXES);
    } catch (error) {
      setPicked(before);
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };

  const toggle = async (id: string) => {
    setBusy(true);
    await put(picked.includes(id) ? picked.filter((t) => t !== id) : [...picked, id], picked);
    setBusy(false);
  };

  // A word not on the list yet: onto the list, then onto this case.
  const create = async () => {
    const name = draft.trim().split(/\s+/).join(' ');
    if (!name) return toast('พิมพ์ชื่อป้ายใหม่ก่อน แล้วกดเพิ่มป้าย', true);
    const same = list.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (same) {
      setDraft('');
      if (!picked.includes(same.id)) void toggle(same.id);
      return;
    }
    if (picked.length >= TAGS_PER_CASE) return toast(`ติดได้ไม่เกิน ${TAGS_PER_CASE} ป้ายต่อเคส`, true);
    setBusy(true);
    try {
      const result = await saveCaseTags([...list, { name }]);
      const made = result.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      setDraft('');
      await refresh(...TAG_LIST_PREFIXES);
      if (made) await put([...picked, made.id], picked);
      toast(`เพิ่มป้าย “${name}” แล้ว`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  };

  const creator = owner && (
    <form
      className="tag-create"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <input value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} placeholder="ชื่อป้ายใหม่" aria-label="ชื่อป้ายใหม่" disabled={busy} />
      <button type="submit" className="btn sm" disabled={busy}>
        <Icon name="plus" />
        เพิ่มป้าย
      </button>
    </form>
  );

  return (
    <section className="card info-block case-tags-card">
      <div className="case-tags-head">
        <h3>ป้ายเคส</h3>
        {canEdit && list.length > 0 && (
          <button type="button" className="btn sm" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            {editing ? 'เสร็จแล้ว' : picked.length ? 'แก้ไขป้าย' : 'เลือกป้าย'}
          </button>
        )}
      </div>
      {!list.length ? (
        owner ? (
          <>
            <p className="tiny muted">ยังไม่มีป้าย ตั้งป้ายแรกได้เลย ทีมจะเลือกจากรายการนี้ รายงานจึงบอกได้ว่าปัญหาเรื่องไหนมากที่สุด</p>
            {creator}
          </>
        ) : (
          <p className="tiny muted">เจ้าขององค์กรยังไม่ได้ตั้งรายการป้าย</p>
        )
      ) : editing ? (
        <>
          <TagPicker tags={list} picked={picked} onToggle={(id) => void toggle(id)} max={TAGS_PER_CASE} disabled={busy} label="ป้ายของเคสนี้" />
          {creator}
          <p className="tiny muted">กดเพื่อติดหรือเอาป้ายออก บันทึกทันที · ติดได้ไม่เกิน {TAGS_PER_CASE} ป้าย</p>
        </>
      ) : picked.length ? (
        <TagChips tags={tagsOf(picked, list)} />
      ) : (
        <p className="tiny muted">ยังไม่ได้ติดป้าย ติดป้ายไว้ รายงานจะบอกได้ว่าปัญหาเรื่องไหนมากที่สุด</p>
      )}
    </section>
  );
}
