'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';

/* Searchable single-select: a visible combobox input plus a hidden form value. Any list that can grow long
   (customers, team members) uses this instead of a plain dropdown. Keyboard: ↓ ↑ to move, Enter to pick,
   Escape to close; typing filters by label and detail. Leaving the box with text that matches exactly one label
   picks it; otherwise the form refuses to submit with "กรุณาเลือกจากรายการ". An item may have the value '' (e.g.
   "ยังไม่มอบหมาย"): picking it is still a choice. */

export type ComboItem = { value: string; label: string; detail?: string };

export function Combobox({
  id,
  name,
  items,
  placeholder = '',
  value = '',
  required = true,
  onChange,
  label,
}: {
  id: string;
  name: string;
  items: ComboItem[];
  placeholder?: string;
  /** The value chosen when the box first shows. */
  value?: string;
  required?: boolean;
  onChange?: (value: string) => void;
  /** Read by screen readers when there is no <label for={id}>. */
  label?: string;
}) {
  const initial = items.find((i) => i.value === value);
  // null: nothing picked (typed text that matches no item); '' can be a real choice.
  const [selected, setSelected] = useState<string | null>(initial ? initial.value : null);
  const [text, setText] = useState(initial?.label ?? '');
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(-1);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    return items.filter((i) => !t || [i.label, i.detail].some((v) => String(v || '').toLowerCase().includes(t)));
  }, [items, term]);

  // The custom reason is what blocks submitting; it must follow every change.
  useEffect(() => {
    input.current?.setCustomValidity(text.trim() && selected === null ? 'กรุณาเลือกจากรายการ' : '');
  }, [text, selected]);

  useEffect(() => {
    if (open && active >= 0) list.current?.querySelectorAll('[role="option"]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = (filter: string) => {
    setTerm(filter);
    setOpen(true);
    const t = filter.trim().toLowerCase();
    const found = items.filter((i) => !t || [i.label, i.detail].some((v) => String(v || '').toLowerCase().includes(t)));
    setActive(found.findIndex((i) => i.value === selected));
  };

  const pick = (item: ComboItem) => {
    setSelected(item.value);
    setText(item.label);
    setOpen(false);
    setActive(-1);
    input.current?.setCustomValidity('');
    if (error) setError('');
    onChange?.(item.value);
  };

  const validate = () => {
    const node = input.current;
    if (!node) return;
    if (node.validity.valid) setError('');
    else setError(node.validity.valueMissing ? 'กรุณากรอกข้อมูลช่องนี้' : node.validationMessage);
  };

  const leave = () => {
    if (selected === null && text.trim()) {
      const exact = items.filter((i) => i.label.toLowerCase() === text.trim().toLowerCase());
      if (exact.length === 1) {
        pick(exact[0]);
        return;
      }
    }
    setOpen(false);
    setActive(-1);
    // The custom reason is set by the effect after this render; check once it is in place.
    requestAnimationFrame(validate);
  };

  const errorId = `${id}-error`;
  return (
    <div className="combo" data-combobox={id}>
      <div className="combo-control">
        <Icon name="search" />
        <input
          ref={input}
          id={id}
          className="combo-input"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 && matches[active] ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          required={required}
          placeholder={placeholder}
          value={text}
          onClick={() => {
            if (!open) show(selected !== null ? '' : text);
          }}
          onChange={(e) => {
            setText(e.target.value);
            setSelected(null);
            onChange?.('');
            show(e.target.value);
          }}
          onBlur={leave}
          onInvalid={validate}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (!open) show(selected !== null ? '' : text);
              setActive((index) =>
                e.key === 'ArrowDown' ? Math.min(matches.length - 1, index + 1) : Math.max(0, index - 1),
              );
            } else if (e.key === 'Enter' && open) {
              e.preventDefault();
              const choice = matches[active] ?? (matches.length === 1 ? matches[0] : undefined);
              if (choice) pick(choice);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <Icon name="down" />
      </div>
      <input type="hidden" name={name} value={selected ?? ''} data-combo-value="" />
      <ul ref={list} className="combo-list" id={`${id}-list`} role="listbox" aria-label="รายการตัวเลือก" hidden={!open}>
        {matches.length ? (
          matches.map((item, n) => (
            <li
              key={item.value || `empty-${n}`}
              role="option"
              id={`${id}-opt-${n}`}
              data-value={item.value}
              aria-selected={item.value === selected}
              className={n === active ? 'active' : undefined}
              // Picking happens before the input loses focus.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
            >
              <span>{item.label}</span>
              {item.detail && <small>{item.detail}</small>}
            </li>
          ))
        ) : (
          <li className="combo-empty" role="presentation">
            ไม่พบรายการที่ตรงกัน
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
