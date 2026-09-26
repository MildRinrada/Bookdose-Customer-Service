'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { useToast } from '@/components/ui/Toast';
import { useApi, useInvalidate } from '@/lib/query';
import { CASE_TAGS_PATH, saveCaseTags, type CaseTag, type CaseTagsOverview } from '../tags';

/* จัดการป้ายเคส (backend tickets/tags.py), from the case list, for the organization's owners. A field to make a new
   tag comes first, as a tag input does; below it the tags there are, each with how many cases carry it and a clear
   way to rename or remove it. Every change is saved at once, so there is no "save" to forget. A renamed tag keeps its
   cases; removing one says first how many cases it comes off.

   The list can be fifty long: past SEARCH_FROM it gets a box to find a tag by name, and a tag just made is scrolled
   to and marked, since it lands at the end of the list, out of sight. Markup: pages/tickets (tag-manage-*). */

const SEARCH_FROM = 12;

/** What a change to the list touches: the workspace (the list itself), the counts, the cases and the rules. */
export const TAG_LIST_PREFIXES = ['/api/workspace', CASE_TAGS_PATH, '/api/tickets', '/api/automation'];

/** The case list's "จัดการป้าย": opens the manager in the modal. */
export function ManageTagsButton({ first }: { first: boolean }) {
  const { openModal } = useDialogs();
  return (
    <button type="button" className="btn subtle" onClick={() => openModal('จัดการป้ายเคส', <ManageTags />)}>
      <Icon name="tag" />
      {first ? 'ตั้งป้ายเคส' : 'จัดการป้าย'}
    </button>
  );
}

function ManageTags() {
  const found = useApi<CaseTagsOverview>(CASE_TAGS_PATH);
  if (found.error && !found.data) return <ErrorState error={found.error} onRetry={() => void found.refetch()} />;
  if (!found.data) return <PageLoading />;
  return <TagManager data={found.data} />;
}

const clean = (name: string) => name.trim().split(/\s+/).join(' ');

function TagManager({ data }: { data: CaseTagsOverview }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const { confirm, closeModal } = useDialogs();
  const [view, setView] = useState(data);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const tags = view.tags;
  const words = q.trim().toLowerCase();
  const shown = words ? tags.filter((t) => t.name.toLowerCase().includes(words)) : tags;

  // The tag just made: into view and marked for a moment.
  useEffect(() => {
    if (!fresh) return;
    list.current?.querySelector(`[data-tag="${fresh}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const timer = window.setTimeout(() => setFresh(null), 2400);
    return () => window.clearTimeout(timer);
  }, [fresh]);

  const taken = (name: string, except?: string) => tags.some((t) => t.id !== except && t.name.toLowerCase() === name.toLowerCase());

  const persist = async (next: Array<Pick<CaseTag, 'name'> & { id?: string }>, message: string): Promise<CaseTagsOverview | null> => {
    setBusy(true);
    try {
      const saved = await saveCaseTags(next);
      setView(saved);
      toast(message);
      await refresh(...TAG_LIST_PREFIXES);
      return saved;
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const name = clean(draft);
    if (!name) {
      input.current?.focus();
      return toast('พิมพ์ชื่อป้ายก่อน แล้วกดเพิ่มป้าย', true);
    }
    if (taken(name)) return toast(`มีป้าย “${name}” อยู่แล้ว`, true);
    if (tags.length >= view.max) return toast(`ตั้งได้สูงสุด ${view.max} ป้าย`, true);
    const saved = await persist([...tags, { name }], `เพิ่มป้าย “${name}” แล้ว`);
    if (saved) {
      setDraft('');
      setQ('');
      setFresh(saved.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())?.id ?? null);
      input.current?.focus();
    }
  };

  const rename = async () => {
    if (!editing) return;
    const name = clean(editing.name);
    const before = tags.find((t) => t.id === editing.id);
    if (!name) return toast('ชื่อป้ายต้องไม่ว่าง ถ้าไม่ใช้แล้วให้กดลบแทน', true);
    if (taken(name, editing.id)) return toast(`มีป้าย “${name}” อยู่แล้ว`, true);
    if (name === before?.name) return setEditing(null);
    if (await persist(tags.map((t) => (t.id === editing.id ? { ...t, name } : t)), `เปลี่ยนชื่อเป็น “${name}” แล้ว`)) setEditing(null);
  };

  const remove = (tag: CaseTag) => {
    const used = view.counts[tag.id] ?? 0;
    confirm({
      title: `ลบป้าย “${tag.name}”`,
      message: used
        ? `ป้ายนี้ติดอยู่ ${used} เคส จะหายจากเคสเหล่านั้นและจากกฎรับเรื่องที่ใช้ป้ายนี้ รายงานจะนับป้ายนี้ไม่ได้อีก ถ้าแค่อยากเปลี่ยนคำ ให้แก้ชื่อแทน`
        : 'ป้ายนี้ยังไม่ได้ติดเคสใด ลบแล้วทีมจะเลือกป้ายนี้ไม่ได้อีก',
      confirmLabel: 'ลบป้าย',
      tone: 'danger',
      run: () => persist(tags.filter((t) => t.id !== tag.id), `ลบป้าย “${tag.name}” แล้ว`),
    });
  };

  return (
    <div className="tag-manage">
      <form
        className="field tag-manage-create"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label htmlFor="tag-new">สร้างป้ายใหม่</label>
        <div className="tag-manage-row">
          <input
            id="tag-new"
            ref={input}
            value={draft}
            maxLength={40}
            autoFocus
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            placeholder="พิมพ์ชื่อป้าย แล้วกด Enter"
          />
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name="plus" />
            เพิ่มป้าย
          </button>
        </div>
        {tags.length >= view.max ? (
          <span className="tiny tag-manage-full">ครบ {view.max} ป้ายแล้ว ลบป้ายที่ไม่ได้ใช้ก่อน จึงจะเพิ่มป้ายใหม่ได้</span>
        ) : (
          <span className="tiny muted">ทีมเลือกติดป้ายให้เคสจากรายการนี้ รายงานจึงบอกได้ว่าปัญหาเรื่องไหนมากที่สุด · ลูกค้าไม่เห็นป้าย</span>
        )}
      </form>

      <div className="tag-manage-head">
        <h3>ป้ายขององค์กร</h3>
        <span className="muted">
          {tags.length} จาก {view.max} ป้าย
        </span>
      </div>
      {tags.length > SEARCH_FROM && (
        <label className="tag-picker-search">
          <Icon name="search" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาป้ายในรายการ" aria-label="ค้นหาป้ายในรายการ" />
        </label>
      )}
      {words && !shown.length ? (
        <p className="empty-mini">ไม่พบป้ายที่ชื่อมีคำว่า “{q.trim()}” สร้างเป็นป้ายใหม่ได้ในช่องด้านบน</p>
      ) : tags.length ? (
        <ul className="tag-manage-list" ref={list}>
          {shown.map((tag) =>
            editing?.id === tag.id ? (
              <li key={tag.id} data-tag={tag.id} className="editing">
                <form
                  className="tag-manage-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename();
                  }}
                >
                  <input
                    value={editing.name}
                    maxLength={40}
                    autoFocus
                    aria-label={`ชื่อใหม่ของป้าย ${tag.name}`}
                    onChange={(e) => setEditing({ id: tag.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      // Escape leaves the renaming, not the whole window.
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                  />
                  <button type="submit" className="btn primary sm" disabled={busy}>
                    บันทึก
                  </button>
                  <button type="button" className="btn sm" onClick={() => setEditing(null)}>
                    ยกเลิก
                  </button>
                </form>
              </li>
            ) : (
              <li key={tag.id} data-tag={tag.id} className={tag.id === fresh ? 'fresh' : undefined}>
                <span className="tag-chip">{tag.name}</span>
                <span className="tag-manage-count">{view.counts[tag.id] ? `${view.counts[tag.id]} เคส` : 'ยังไม่มีเคส'}</span>
                <span className="tag-manage-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`แก้ชื่อป้าย ${tag.name}`}
                    title="แก้ชื่อ"
                    disabled={busy}
                    onClick={() => setEditing({ id: tag.id, name: tag.name })}
                  >
                    <Icon name="edit" />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`ลบป้าย ${tag.name}`} title="ลบป้าย" disabled={busy} onClick={() => remove(tag)}>
                    <Icon name="trash" />
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="empty-mini">ยังไม่มีป้าย พิมพ์ชื่อป้ายแรกในช่องด้านบน</p>
      )}
      <p className="tiny muted">แก้ชื่อป้ายแล้ว เคสที่ติดอยู่จะใช้ชื่อใหม่ทันที · ตั้งกฎรับเรื่องให้ติดป้ายเองได้ที่เมนูระบบอัตโนมัติ</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => closeModal()}>
          เสร็จแล้ว
        </button>
      </div>
    </div>
  );
}
