'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';

/* One search box, one pill and one dropdown for every screen, so a filter bar looks and behaves the same everywhere. */

export function SearchInput({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="input-wrap search-input">
      <Icon name="search" />
      <input id={id} type="search" value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** A toggle in a filter bar. `value` is kept as data-value for tests and styles that look for it. */
export function FilterPill({
  label,
  value,
  pressed = false,
  count = 0,
  warning = false,
  onClick,
}: {
  label: ReactNode;
  value: string;
  pressed?: boolean;
  count?: number;
  warning?: boolean;
  onClick: (value: string) => void;
}) {
  return (
    <button
      type="button"
      className={`filter-pill${warning ? ' warning' : ''}`}
      data-value={value}
      aria-pressed={pressed}
      onClick={() => onClick(value)}
    >
      {label}
      {count ? (
        <>
          {' '}
          <span className="tag-count">{count}</span>
        </>
      ) : null}
    </button>
  );
}

/** The same pill as a link, for filters that live in the address (so they can be shared and bookmarked). */
export function FilterLink({
  href,
  value,
  label,
  active = false,
  count = 0,
}: {
  href: string;
  value: string;
  label: ReactNode;
  active?: boolean;
  count?: number;
}) {
  return (
    <Link className={`filter-pill${active ? ' active' : ''}`} href={href} aria-current={active ? 'true' : undefined} data-quick-filter={value}>
      {label}
      {count ? (
        <>
          {' '}
          <span className="tag-count">{count}</span>
        </>
      ) : null}
    </Link>
  );
}

export type Choice = { value: string; label: string };

export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  any,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Choice[];
  /** The first choice, meaning "no filter" (value ''). */
  any?: string;
}) {
  return (
    <select className="filter-select" id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {any && <option value="">{any}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
