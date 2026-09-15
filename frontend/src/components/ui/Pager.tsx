'use client';

import { Fragment } from 'react';
import { useUiState } from '@/lib/ui-state';

/* One pager for every long list: what is shown, how many per page, ‹ ›, numbered pages and a box to jump to a page.
   The page and the page size are kept per list name while moving between screens. */

export type PageSlice<T> = {
  name: string;
  page: number;
  size: number;
  pages: number;
  total: number;
  start: number;
  shown: T[];
  setPage: (page: number) => void;
  setSize: (size: number) => void;
};

export function usePager<T>(name: string, items: T[], { size = 25 }: { size?: number } = {}): PageSlice<T> {
  const [state, setState] = useUiState(`pager:${name}`, { page: 1, size });
  const pages = Math.max(1, Math.ceil(items.length / state.size));
  const page = Math.min(Math.max(1, state.page), pages);
  const start = (page - 1) * state.size;
  return {
    name,
    page,
    size: state.size,
    pages,
    total: items.length,
    start,
    shown: items.slice(start, start + state.size),
    setPage: (next) => setState((s) => ({ ...s, page: Math.max(1, Number(next) || 1) })),
    setSize: (next) => setState({ page: 1, size: next }),
  };
}

// First page, last page and the pages around the current one; the rest is a gap.
function pageNumbers(page: number, pages: number): number[] {
  const wanted = new Set([1, pages, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => wanted.add(n));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((n) => wanted.add(n));
  return [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
}

export function Pager<T>({ slice, unit = 'รายการ', sizes = [10, 25, 50] }: { slice: PageSlice<T>; unit?: string; sizes?: number[] }) {
  const { name, page, pages, total, size, start, shown, setPage, setSize } = slice;
  const numbers = pageNumbers(page, pages);
  return (
    <div className="table-footer pager">
      <span role="status">
        แสดง {total ? start + 1 : 0}-{start + shown.length} จาก {total} {unit}
      </span>
      <div className="pager-controls">
        <label>
          ต่อหน้า{' '}
          <select data-page-size={name} aria-label="จำนวนต่อหน้า" value={String(size)} onChange={(e) => setSize(Number(e.target.value))}>
            {sizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {pages > 1 && (
          <>
            <button type="button" className="btn sm pager-step" aria-label="หน้าก่อนหน้า" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ‹
            </button>
            <div className="pager-numbers">
              {numbers.map((n, i) => (
                <Fragment key={n}>
                  {i > 0 && n - numbers[i - 1] > 1 && (
                    <span className="pager-gap" aria-hidden="true">
                      …
                    </span>
                  )}
                  <button
                    type="button"
                    className={`pager-number${n === page ? ' current' : ''}`}
                    aria-current={n === page ? 'page' : undefined}
                    aria-label={`หน้า ${n}`}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                </Fragment>
              ))}
            </div>
            <button type="button" className="btn sm pager-step" aria-label="หน้าถัดไป" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              ›
            </button>
            <label className="pager-jump">
              ไปหน้า{' '}
              <input
                key={page}
                type="number"
                min={1}
                max={pages}
                defaultValue={page}
                aria-label="ไปที่หน้าที่ระบุ"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= pages) setPage(n);
                }}
              />{' '}
              / {pages}
            </label>
          </>
        )}
      </div>
    </div>
  );
}
