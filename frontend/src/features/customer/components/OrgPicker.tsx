'use client';

import { useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { OrgLogo } from '@/components/ui/OrgLogo';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { ORG_CODE } from '@/lib/routes';
import type { CustomerOrg } from '@/lib/types';
import { joinOrganization, ORGS_PATH, OVERVIEW_PATH } from '../api';

/* "ติดต่อองค์กร" the way an email client picks a recipient: the chosen organization sits in the box as a chip with its
   picture and a × , and the box always keeps a place to type — searching the organizations the customer can contact,
   or a code they were given, which is added from the same box ("เพิ่มองค์กรด้วยรหัส …"). Picking another organization
   swaps the chip, and Backspace in an empty box takes it off. One chat goes to one organization, so it holds one chip. */

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
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const refresh = useInvalidate();
  const toast = useToast();

  const selected = orgs.find((o) => o.slug === value);
  const term = text.trim().toLowerCase();
  const matches = useMemo(
    () => orgs.filter((o) => !term || o.name.toLowerCase().includes(term) || o.slug.includes(term)),
    [orgs, term],
  );
  // A code the customer was given but has not added yet: offered as the last row, added from this box.
  const newCode = ORG_CODE.test(term) && !orgs.some((o) => o.slug === term) ? term : '';
  const rows = newCode ? matches.length + 1 : matches.length;

  const choose = (org: CustomerOrg) => {
    onChange(org.slug);
    setText('');
    setOpen(false);
    setError('');
  };

  const add = async (code: string) => {
    setBusy(true);
    try {
      const { organization } = await joinOrganization(code);
      await refresh(ORGS_PATH, OVERVIEW_PATH);
      choose(organization);
      toast(`เพิ่ม ${organization.name} แล้ว`);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const take = (index: number) => {
    if (index < matches.length) choose(matches[index]);
    else if (newCode) void add(newCode);
  };

  const errorId = `${id}-error`;
  return (
    <div className="org-picker combo" data-org-picker={id}>
      <div className="combo-control org-picker-control" onClick={() => input.current?.focus()}>
        {selected && (
          <span className="org-chip">
            <OrgLogo slug={selected.slug} name={selected.name} index={selected.home ? 1 : 3} hasLogo={selected.has_logo} />
            <span className="org-chip-name">{selected.name}</span>
            {selected.home && <span className="org-chip-tag">ผู้ให้บริการระบบ</span>}
            <button
              type="button"
              className="org-chip-remove"
              aria-label={`เอา ${selected.name} ออก`}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
                input.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          </span>
        )}
        <input
          ref={input}
          id={id}
          className="combo-input org-picker-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && rows ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          // The hidden field carries the answer once an organization is chosen; before that this box must be filled.
          required={!selected}
          disabled={busy}
          placeholder={selected ? 'เปลี่ยนองค์กร หรือใส่รหัสองค์กร' : 'พิมพ์ชื่อองค์กร หรือรหัสองค์กรที่ได้รับมา'}
          value={text}
          onClick={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
            if (error) setError('');
          }}
          onBlur={() => setOpen(false)}
          onInvalid={() => setError('กรุณาเลือกองค์กรที่ต้องการติดต่อ')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              setActive((index) => (e.key === 'ArrowDown' ? Math.min(rows - 1, index + 1) : Math.max(0, index - 1)));
            } else if (e.key === 'Enter') {
              // Enter picks the row being read; it must not send a half-filled form.
              e.preventDefault();
              if (rows) take(active);
            } else if (e.key === 'Backspace' && !text && selected) {
              onChange('');
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </div>
      <input type="hidden" name="org" value={selected?.slug ?? ''} />
      <ul className="combo-list org-picker-list" id={`${id}-list`} role="listbox" aria-label="องค์กรที่ติดต่อได้" hidden={!open}>
        {matches.map((o, n) => (
          <li
            key={o.slug}
            role="option"
            id={`${id}-opt-${n}`}
            aria-selected={o.slug === value}
            className={n === active ? 'active' : undefined}
            // Picking happens before the input loses focus.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(o);
            }}
          >
            <OrgLogo slug={o.slug} name={o.name} index={o.home ? 1 : 3} hasLogo={o.has_logo} />
            <span>
              {o.name}
              <small>{o.home ? 'ผู้ให้บริการระบบ · ปัญหาระบบ แจ้ง Bug' : `องค์กรคู่ค้า · ${o.slug}`}</small>
            </span>
            {/* The chosen one is ticked; the grey row is only the one the pointer or the arrow keys are on. */}
            {o.slug === value && <Icon name="check" />}
          </li>
        ))}
        {newCode && (
          <li
            role="option"
            id={`${id}-opt-${matches.length}`}
            aria-selected={false}
            className={matches.length === active ? 'active' : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              void add(newCode);
            }}
          >
            <span className="org-add-icon">
              <Icon name="plus" />
            </span>
            <span>
              เพิ่มองค์กรด้วยรหัส “{newCode}”<small>รหัสอยู่ในลิงก์ที่องค์กรให้ไว้ เช่น …/?org={newCode}</small>
            </span>
          </li>
        )}
        {!rows && (
          <li className="combo-empty" role="presentation">
            ไม่พบองค์กรนี้ · ถ้ามีรหัสองค์กร พิมพ์รหัสเพื่อเพิ่ม
          </li>
        )}
      </ul>
      {error && (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
