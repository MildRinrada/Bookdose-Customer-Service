'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { saveCustomerCategories, WORKSPACE_PATH } from '../api';
import type { CustomerCategory } from '../types';

/* หมวดเรื่องที่ลูกค้าเลือก: up to 12 categories a customer picks when starting a chat, each sent to a team (or the
   first team). Rows are plain inputs read back when saving, like the old form.
   Markup: old-frontend/pages/settings/settings.html (customer-categories), category-row.html. */

const MAX_CATEGORIES = 12;

function parseCategories(saved: string): CustomerCategory[] {
  try {
    const list: unknown = JSON.parse(saved || '[]');
    return Array.isArray(list) ? (list as CustomerCategory[]) : [];
  } catch {
    return [];
  }
}

type Row = CustomerCategory & { key: number };

export function CategoriesForm({ saved }: { saved: string }) {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const [rows, setRows] = useState<Row[]>(() => parseCategories(saved).map((c, key) => ({ ...c, key })));
  const rowsRef = useRef<HTMLDivElement>(null);
  const focusNew = useRef(false);

  // A row just added gets the cursor in its name box.
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    rowsRef.current?.lastElementChild?.querySelector('input')?.focus();
  }, [rows]);

  const add = () => {
    if (rows.length >= MAX_CATEGORIES) return toast('ตั้งได้สูงสุด 12 หมวด', true);
    focusNew.current = true;
    // Rows are only appended, so one past the last key is always free.
    setRows((list) => [...list, { name: '', team_id: '', key: (list.at(-1)?.key ?? -1) + 1 }]);
  };
  const remove = (key: number) => {
    if (rows.length <= 1) return toast('ต้องมีอย่างน้อย 1 หมวด', true);
    setRows((list) => list.filter((row) => row.key !== key));
  };

  return (
    <Form
      onSubmit={async (_values, form) => {
        const categories = [...form.querySelectorAll<HTMLElement>('.category-row')].map((row) => ({
          name: row.querySelector<HTMLInputElement>('[name="category_name"]')?.value.trim() ?? '',
          team_id: row.querySelector<HTMLSelectElement>('[name="category_team"]')?.value ?? '',
        }));
        await saveCustomerCategories(categories);
        toast('บันทึกหมวดเรื่องแล้ว');
        await refresh(WORKSPACE_PATH);
      }}
    >
      <section className="card">
        <div className="card-header">
          <div>
            <h2>หมวดเรื่องที่ลูกค้าเลือก</h2>
            <p>ลูกค้าเลือกหมวดตอนเริ่มแชท แต่ละหมวดส่งเรื่องเข้าทีมที่กำหนดได้ · ไม่เลือกทีม = ทีมแรกขององค์กร</p>
          </div>
        </div>
        <div className="card-body">
          <div className="category-rows" id="category-rows" ref={rowsRef}>
            {rows.map((row) => (
              <div className="category-row" key={row.key}>
                <input
                  name="category_name"
                  maxLength={60}
                  defaultValue={row.name}
                  aria-label="ชื่อหมวดเรื่อง"
                  placeholder="เช่น สอบถามบริการ"
                  required
                />
                <select name="category_team" aria-label="ทีมที่รับเรื่องหมวดนี้" defaultValue={row.team_id || ''}>
                  <option value="">ทีมแรกขององค์กร</option>
                  {work.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn" aria-label="ลบหมวดนี้" title="ลบหมวดนี้" onClick={() => remove(row.key)}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
          <div className="settings-row-actions">
            <button type="button" className="btn subtle" onClick={add}>
              <Icon name="plus" />
              เพิ่มหมวด
            </button>
            <button className="btn primary" type="submit">
              <Icon name="check" />
              บันทึกหมวดเรื่อง
            </button>
          </div>
        </div>
      </section>
    </Form>
  );
}
