'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { useToast } from '@/components/ui/Toast';
import { useApi, useInvalidate } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { purgeItem, RESTORE_PREFIXES, restoreItem, TRASH_PATH } from './api';
import { TrashRow } from './components/TrashRow';
import { trashKind, trashKinds } from './labels';
import type { TrashFilters, TrashItem, TrashPage } from './types';

/* Recycle bin: everything a delete removed, still whole. Putting something back is the safe direction and happens at
   once; clearing it for good is the deliberate action, with the same typed confirmation the delete itself had.
   Markup: old-frontend/pages/trash/trash.html. */

export function TrashScreen() {
  const page = useApi<TrashPage>(TRASH_PATH);
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  return <TrashView data={page.data} onRefresh={() => void page.refetch()} />;
}

function TrashView({ data, onRefresh }: { data: TrashPage; onRefresh: () => void }) {
  const [f, setFilters] = useUiState<TrashFilters>('trash:filters', {});
  const { confirmDelete } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const all = data.items || [];
  const term = (f.q || '').toLowerCase();
  const visible = all.filter(
    (item) => (!f.kind || item.kind === f.kind) && (!term || [item.title, item.detail, item.actor].some((v) => String(v || '').toLowerCase().includes(term))),
  );
  const slice = usePager('trash', visible, { size: 25 });
  const counts = (kind: string) => all.filter((item) => !kind || item.kind === kind).length;
  const update = (next: TrashFilters) => {
    setFilters(next);
    slice.setPage(1);
  };
  const pills = [['', 'ทั้งหมด'] as const, ...Object.entries(trashKinds).map(([key, meta]) => [key, meta.label] as const)].filter(
    ([key]) => !key || counts(key) || f.kind === key,
  );

  // A failed restore says why in the toast, as the old action dispatcher did.
  const restore = async (item: TrashItem) => {
    try {
      await restoreItem(item.id);
      await refresh(...RESTORE_PREFIXES);
      toast('กู้คืนรายการแล้ว');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };

  const purge = (item: TrashItem) => {
    const kind = trashKind(item.kind);
    confirmDelete({
      title: `ลบ${kind.label}ถาวร`,
      warning: `“${item.title}” จะถูกลบออกจากระบบอย่างถาวร และกู้คืนไม่ได้อีก`,
      effects: [`${kind.label}นี้จะหายไปจากถังขยะทันที`, 'ไม่มีสำเนาอื่นในระบบให้กู้คืน', 'การลบถาวรจะถูกบันทึกในประวัติการทำงาน'],
      word: 'ลบถาวร',
      confirmLabel: 'ลบถาวรทันที',
      run: async () => {
        await purgeItem(item.id);
        await refresh(TRASH_PATH, '/api/audit');
        toast('ลบถาวรแล้ว');
      },
    });
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ถังขยะ</h1>
          <p>รายการที่ถูกลบจะเก็บไว้ที่นี่ {data.keep_days || 30} วัน กู้คืนได้ก่อนครบกำหนด หลังจากนั้นระบบจะลบถาวรให้เอง</p>
        </div>
        <div className="flex">
          <button type="button" className="btn subtle" onClick={onRefresh}>
            <Icon name="clock" />
            รีเฟรช
          </button>
        </div>
      </div>
      <section className="filters trash-filters">
        <SearchInput
          id="trash-search"
          label="ค้นหาในถังขยะ"
          placeholder="ค้นหาชื่อรายการ หรือชื่อผู้ที่ลบ"
          value={f.q || ''}
          onChange={(q) => update({ ...f, q })}
        />
        <div className="filter-pills" role="group" aria-label="ประเภทรายการ">
          {pills.map(([key, label]) => (
            <FilterPill
              key={key}
              value={key}
              label={label}
              pressed={(f.kind || '') === key}
              count={counts(key)}
              onClick={(kind) => update({ ...f, kind })}
            />
          ))}
        </div>
        <span className="muted article-count" role="status">
          {visible.length} จาก {all.length} รายการ
        </span>
      </section>
      {visible.length ? (
        <>
          <ul className="trash-list">
            {slice.shown.map((item) => (
              <TrashRow key={item.id} item={item} onRestore={restore} onPurge={purge} />
            ))}
          </ul>
          <Pager slice={slice} unit="รายการ" sizes={[25, 50, 100]} />
        </>
      ) : all.length ? (
        <EmptyState title="ไม่พบรายการที่ค้นหา" description="ลองเปลี่ยนคำค้น หรือเลือกประเภทอื่น" icon="search" />
      ) : (
        <EmptyState title="ถังขยะว่าง" description="เมื่อมีการลบเคส ข้อมูลลูกค้า หรือบทความ รายการจะมารออยู่ที่นี่ก่อน" icon="trash" />
      )}
    </>
  );
}
