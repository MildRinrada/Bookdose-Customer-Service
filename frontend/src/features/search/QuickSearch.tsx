'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Icon } from '@/components/Icon';
import { settingsParts, settingsTabs } from '@/features/settings/labels';
import { platformHiddenTabs, staffAccountTabs, type StaffAccountTab } from '@/features/staff-account/tabs';
import { statusLabels } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { managePages, otherStaffPages, workspacePages } from '@/lib/routes';
import type { Role } from '@/lib/types';
import { searchPath, type SearchResults } from './api';

/* ค้นหาด่วน, the search box in the top bar (Ctrl+K / ⌘K puts the cursor in it from anywhere): as the member types,
   the cases, customers and articles that match (GET /api/search, only what they may open) and the app's pages and
   settings sections appear under it, to open with a click or ↑ ↓ and Enter. Enter with nothing chosen still searches
   the case list, as the box always did. The list is placed through the CSSOM (no style attributes) so it stays on the
   screen on a phone, where the box is narrow. Markup: pages/quick-search.css. */

type Group = 'cases' | 'customers' | 'articles' | 'pages' | 'more';
type Hit = { key: string; group: Group; href: string; icon: string; title: string; detail: string };
type Page = { href: string; icon: string; title: string; detail: string };

const GROUP_LABELS: Record<Group, string> = {
  cases: 'เคส',
  customers: 'ลูกค้า',
  articles: 'บทความ',
  pages: 'หน้าและการตั้งค่า',
  more: '',
};
const PAGES_SHOWN = 5;
const WAIT_MS = 180;

/** Every screen and settings section this member may open, with the words it is found by. */
function pagesFor(role: Role, platformAdmin: boolean): Page[] {
  const allowed = (roles?: Role[]) => !roles || roles.includes(role);
  const screens = [...workspacePages, ...managePages, ...otherStaffPages]
    .filter((p) => allowed(p.roles))
    .map((p) => ({ href: p.href, icon: p.icon, title: p.label, detail: 'หน้าในระบบ' }));
  const settings =
    role === 'admin'
      ? [
          ...Object.entries(settingsTabs)
            .filter(([key]) => key !== 'teams')
            .map(([key, t]) => ({ href: `/settings?tab=${key}`, icon: t.icon, title: t.label, detail: `ตั้งค่าองค์กร: ${t.hint}` })),
          ...Object.entries(settingsParts).map(([key, t]) => ({ href: `/settings?tab=${key}`, icon: t.icon, title: t.label, detail: `ตั้งค่าองค์กร: ${t.hint}` })),
        ]
      : [];
  const account = (Object.entries(staffAccountTabs) as [StaffAccountTab, (typeof staffAccountTabs)[StaffAccountTab]][])
    .filter(([key]) => !platformAdmin || !platformHiddenTabs.includes(key))
    .map(([key, t]) => ({ href: `/account?tab=${key}`, icon: t.icon, title: t.label, detail: `ตั้งค่าบัญชี: ${t.hint}` }));
  return [...screens, ...settings, ...account];
}

function matchPages(pages: Page[], query: string): Page[] {
  const q = query.toLowerCase();
  return pages
    .filter((p) => p.title.toLowerCase().includes(q) || p.detail.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.title.toLowerCase().includes(q)) - Number(!b.title.toLowerCase().includes(q)))
    .slice(0, PAGES_SHOWN);
}

function hitsOf(results: SearchResults | undefined, pages: Page[], query: string): Hit[] {
  const found: Hit[] = [];
  for (const c of results?.cases ?? [])
    found.push({
      key: `case-${c.id}`,
      group: 'cases',
      href: `/tickets/${c.id}`,
      icon: 'ticket',
      title: `BD-${c.number} ${c.subject}`,
      detail: `${c.contact_name} · ${statusLabels[c.status] ?? c.status}`,
    });
  for (const c of results?.customers ?? [])
    found.push({
      key: `customer-${c.id}`,
      group: 'customers',
      href: `/contacts?q=${encodeURIComponent(c.email || c.name)}`,
      icon: 'users',
      title: c.name,
      detail: [c.email, c.phone, c.company].filter(Boolean).join(' · ') || 'ยังไม่มีช่องทางติดต่อ',
    });
  for (const a of results?.articles ?? [])
    found.push({
      key: `article-${a.id}`,
      group: 'articles',
      href: `/knowledge/${a.id}`,
      icon: 'book',
      title: a.title,
      detail: `${a.category} · ${a.visibility === 'public' ? 'ลูกค้าอ่านได้' : 'ใช้ภายในทีม'}`,
    });
  for (const p of matchPages(pages, query)) found.push({ key: `page-${p.href}`, group: 'pages', ...p });
  found.push({ key: 'more', group: 'more', href: `/tickets?q=${encodeURIComponent(query)}`, icon: 'search', title: `ค้นหา “${query}” ในรายการเคสทั้งหมด`, detail: '' });
  return found;
}

/** The words typed, in bold where they appear in the title. */
function Marked({ text, query }: { text: string; query: string }): ReactNode {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <b className="quick-mark">{text.slice(at, at + query.length)}</b>
      {text.slice(at + query.length)}
    </>
  );
}

export function QuickSearch({ inputRef, role, platformAdmin, shortcut }: { inputRef: RefObject<HTMLInputElement | null>; role: Role; platformAdmin: boolean; shortcut: string }) {
  const router = useRouter();
  const listId = useId();
  const form = useRef<HTMLFormElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [term, setTerm] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const query = value.trim().replace(/\s+/g, ' ');

  // Asked once the typing pauses; the last answer stays on screen while the next one comes.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query), WAIT_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const answer = useApi<SearchResults>(term ? searchPath(term) : null, { keepPrevious: true });
  const results = term ? answer.data : undefined;
  const hits = query ? hitsOf(results, pagesFor(role, platformAdmin), query) : [];
  const open = focused && Boolean(query);
  const waiting = Boolean(query) && (term !== query || answer.isFetching);
  const found = hits.some((h) => h.group !== 'more');

  // Beneath the box, kept inside the screen (on a phone the box is narrower than the list).
  useLayoutEffect(() => {
    const box = form.current;
    const list = panel.current;
    if (!open || !box || !list) return;
    const place = () => {
      const at = box.getBoundingClientRect();
      const width = Math.min(Math.max(at.width, 460), window.innerWidth - 32);
      list.style.setProperty('top', `${Math.round(at.bottom + 6)}px`);
      list.style.setProperty('left', `${Math.round(Math.min(Math.max(16, at.left), window.innerWidth - width - 16))}px`);
      list.style.setProperty('width', `${Math.round(width)}px`);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // The chosen row stays in view while ↑ ↓ walk the list.
  useEffect(() => {
    panel.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (hit: Hit) => {
    setValue('');
    setActive(-1);
    inputRef.current?.blur();
    router.push(hit.href);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (value) setValue('');
      else inputRef.current?.blur();
      setActive(-1);
      event.preventDefault();
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && hits.length) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : hits.length - 1) : (i + step + hits.length) % hits.length));
    }
  };

  let index = -1;
  const groups = (['cases', 'customers', 'articles', 'pages', 'more'] as Group[])
    .map((group) => ({ group, items: hits.filter((h) => h.group === group) }))
    .filter((g) => g.items.length);

  return (
    <form
      ref={form}
      id="global-search"
      className="global-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const hit = active >= 0 ? hits[active] : hits.find((h) => h.group === 'more');
        if (hit) go(hit);
      }}
    >
      <Icon name="search" />
      <input
        ref={inputRef}
        name="q"
        value={value}
        autoComplete="off"
        role="combobox"
        aria-label="ค้นหาเคส ลูกค้า บทความ และหน้าต่าง ๆ"
        aria-keyshortcuts="Control+K Meta+K"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder="ค้นหาเคส ลูกค้า บทความ…"
        onChange={(e) => {
          setValue(e.target.value);
          setActive(-1);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKey}
      />
      <span className="kbd" aria-hidden="true" title={`กด ${shortcut} เพื่อค้นหาได้ทันที`}>
        {shortcut}
      </span>
      {open && (
        // Pressing on the list does not take the cursor out of the box, so a click lands on its row.
        <div ref={panel} className="quick-results" id={listId} role="listbox" aria-label="ผลการค้นหา" onMouseDown={(e) => e.preventDefault()}>
          {groups.map(({ group, items }) => (
            <Fragment key={group}>
              {GROUP_LABELS[group] && (
                <div className="quick-group" role="presentation">
                  {GROUP_LABELS[group]}
                </div>
              )}
              {items.map((hit) => {
                index += 1;
                const i = index;
                return (
                  <div
                    key={hit.key}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={`quick-option${hit.group === 'more' ? ' more' : ''}`}
                    onClick={() => go(hit)}
                    onMouseMove={() => i !== active && setActive(i)}
                  >
                    <span className="quick-icon" aria-hidden="true">
                      <Icon name={hit.icon} />
                    </span>
                    <span className="quick-text">
                      <strong>
                        <Marked text={hit.title} query={hit.group === 'more' ? '' : query} />
                      </strong>
                      {hit.detail && <small>{hit.detail}</small>}
                    </span>
                  </div>
                );
              })}
            </Fragment>
          ))}
          {waiting && !results && (
            <div className="quick-status" role="status">
              กำลังค้นหา…
            </div>
          )}
          {!waiting && !found && (
            <div className="quick-status" role="status">
              ไม่พบเคส ลูกค้า บทความ หรือหน้าที่ตรงกับ “{query}”
            </div>
          )}
          <div className="quick-foot" aria-hidden="true">
            <span>
              <span className="kbd">↑</span> <span className="kbd">↓</span> เลือก
            </span>
            <span>
              <span className="kbd">Enter</span> เปิด
            </span>
            <span>
              <span className="kbd">Esc</span> ปิด
            </span>
          </div>
        </div>
      )}
    </form>
  );
}
