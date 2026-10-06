'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { OrgLogo } from '@/components/ui/OrgLogo';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { ORG_CODE } from '@/lib/routes';
import type { CustomerOrg } from '@/lib/types';
import { joinOrganization, ORGS_PATH, OVERVIEW_PATH } from '../api';

/* "ติดต่อองค์กร": a dropdown. The button shows the chosen organization (its picture, name and, for the platform's own,
   its tag); it opens a panel with a search box over the list, which scrolls when the customer is connected with more
   organizations than fit, so the page never grows with the list. The last row adds an organization by the code the
   customer was given (the one in its join link, ?org=<code>): a small box opens for it, and a code typed into the
   search is offered the same way. One chat goes to one organization. Markup: pages/customer (org-dd-*). */

export function OrgPicker({
  id,
  orgs,
  value,
  onChange,
}: {
  id: string;
  /** The organizations the customer can contact (the platform's own first). */
  orgs: CustomerOrg[];
  /** The chosen organization's code, or '' for none. */
  value: string;
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  // เพิ่มองค์กรด้วยรหัส: the box for the code, what is typed in it, and the answer when the code is not accepted.
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const codeBox = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const refresh = useInvalidate();
  const toast = useToast();

  const selected = orgs.find((o) => o.slug === value);
  const term = text.trim().toLowerCase();
  const matches = useMemo(() => orgs.filter((o) => !term || o.name.toLowerCase().includes(term) || o.slug.includes(term)), [orgs, term]);
  // The search box earns its place once the list is long enough to need it.
  const searchable = orgs.length > 5;
  // A code typed into the search that is not on the list yet: offered as a row, added from there.
  const typedCode = ORG_CODE.test(term) && !orgs.some((o) => o.slug === term) ? term : '';

  const show = () => {
    setOpen(true);
    setText('');
    setAdding(false);
    setCode('');
    setError('');
    setActive(Math.max(0, orgs.findIndex((o) => o.slug === value)));
  };
  const hide = (back = true) => {
    setOpen(false);
    if (back) button.current?.focus();
  };
  const choose = (org: CustomerOrg) => {
    onChange(org.slug);
    hide();
  };
  const add = async (given: string) => {
    const slug = given.trim().toLowerCase();
    if (!ORG_CODE.test(slug)) return setError('รหัสองค์กรใช้ตัว a-z ตัวเลข และขีดกลาง เช่น my-shop');
    const known = orgs.find((o) => o.slug === slug);
    if (known) return choose(known);
    setBusy(true);
    try {
      const { organization } = await joinOrganization(slug);
      await refresh(ORGS_PATH, OVERVIEW_PATH);
      toast(`เพิ่ม ${organization.name} ในองค์กรที่ติดต่อได้แล้ว`);
      choose(organization);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openAdd = () => {
    setAdding(true);
    setCode(typedCode);
    setError('');
    setTimeout(() => codeBox.current?.focus(), 0);
  };

  // The search box (or, without one, the list) takes the keys as soon as the panel opens; a click elsewhere closes it.
  useEffect(() => {
    if (!open) return;
    (search.current ?? list.current)?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (adding) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setAdding(false);
        search.current?.focus();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((index) => (e.key === 'ArrowDown' ? Math.min(matches.length - 1, index + 1) : Math.max(0, index - 1)));
    } else if (e.key === 'Enter') {
      // Enter picks the row being read; it must not send a half-filled form.
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  };

  return (
    <div className="org-dd" ref={root}>
      <button
        ref={button}
        type="button"
        id={id}
        className="org-dd-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            show();
          }
        }}
      >
        {selected ? (
          <>
            <OrgLogo slug={selected.slug} name={selected.name} index={selected.home ? 1 : 3} hasLogo={selected.has_logo} />
            <span className="org-dd-name">{selected.name}</span>
            {selected.home && <span className="org-dd-tag">ผู้ให้บริการระบบ</span>}
          </>
        ) : (
          <span className="org-dd-name muted">เลือกองค์กรที่ต้องการติดต่อ</span>
        )}
        <Icon name="down" />
      </button>
      <input type="hidden" name="org" value={selected?.slug ?? ''} />
      {open && (
        <div className="org-dd-panel" onKeyDown={onKey}>
          {searchable && (
            <div className="org-dd-search">
              <Icon name="search" />
              <input
                ref={search}
                type="search"
                aria-label="ค้นหาองค์กร"
                placeholder="ค้นหาองค์กร"
                autoComplete="off"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setActive(0);
                }}
              />
            </div>
          )}
          <ul className="org-dd-list" id={`${id}-list`} role="listbox" aria-label="องค์กรที่ติดต่อได้" tabIndex={searchable ? -1 : 0} ref={list}>
            {matches.map((o, n) => (
              <li
                key={o.slug}
                role="option"
                id={`${id}-opt-${n}`}
                aria-selected={o.slug === value}
                className={n === active ? 'active' : undefined}
                onMouseEnter={() => setActive(n)}
                onClick={() => choose(o)}
              >
                <OrgLogo slug={o.slug} name={o.name} index={o.home ? 1 : 3} hasLogo={o.has_logo} />
                <span>
                  {o.name}
                  <small>{o.home ? 'ผู้ให้บริการระบบ · ปัญหาระบบ แจ้ง Bug' : `องค์กรคู่ค้า · ${o.slug}`}</small>
                </span>
                {o.slug === value && <Icon name="check" />}
              </li>
            ))}
            {!matches.length && !typedCode && (
              <li className="org-dd-empty" role="presentation">
                ไม่พบองค์กรนี้ในรายการของคุณ
              </li>
            )}
          </ul>
          {adding ? (
            // Not a <form>: the page's own form is around this one, and a form inside a form is dropped by the browser.
            <div className="org-dd-add-form">
              <label htmlFor={`${id}-code`}>รหัสองค์กร</label>
              <div className="org-dd-add-row">
                <input
                  ref={codeBox}
                  id={`${id}-code`}
                  value={code}
                  disabled={busy}
                  autoComplete="off"
                  placeholder="รหัสในลิงก์ที่องค์กรให้ไว้ เช่น …/?org=my-shop"
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => {
                    setCode(e.target.value);
                    if (error) setError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (code.trim() && !busy) void add(code);
                    }
                  }}
                />
                <button type="button" className="btn sm primary" disabled={busy || !code.trim()} onClick={() => void add(code)}>
                  {busy ? 'กำลังเพิ่ม…' : 'เพิ่ม'}
                </button>
              </div>
              {error && (
                <span className="field-error" role="alert">
                  {error}
                </span>
              )}
            </div>
          ) : (
            <button type="button" className="org-dd-add" onClick={openAdd}>
              <span className="org-dd-add-icon">
                <Icon name="plus" />
              </span>
              <span>
                {typedCode ? `เพิ่มองค์กรด้วยรหัส “${typedCode}”` : 'เพิ่มองค์กรด้วยรหัส'}
                <small>รหัสอยู่ในลิงก์ที่องค์กรให้ไว้ เช่น …/?org=รหัส</small>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
