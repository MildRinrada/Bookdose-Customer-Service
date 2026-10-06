'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { date, number } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { erasePerson, exportPerson, PDPA_PATH, searchPerson, type PdpaChoice, type PdpaOverview, type PdpaRecord, type PdpaSearch } from './api';

/* Platform console → เครื่องมือ PDPA (backend modules/pdpa): a person asks for their data or to be erased. Search once
   (email, phone written any way, or name) and every organization answers: the customer account and each record, with
   counts only. Tick what is theirs, say where the request came from, then give them the file (ZIP) or erase it -
   typed confirmation, and each is logged here and in each organization's history. Beside it, the deletion requests
   organizations have noted on their customers, and the log. Opened from a found account on บัญชีผู้ใช้ (?q=<email>),
   that email is searched straight away. Markup: pages/pdpa.css. */

const kindWords = { email: 'อีเมล', phone: 'เบอร์โทร', name: 'ชื่อ' };

/* The ways a request usually arrives. The last one asks for the words instead. */
const OTHER = 'อื่น ๆ';
const SOURCES = [
  'เจ้าของข้อมูลขอทางอีเมล',
  'เจ้าของข้อมูลขอทางแชทหรือเคส',
  'เจ้าของข้อมูลขอทางโทรศัพท์',
  'เจ้าของข้อมูลยื่นหนังสือหรือแบบฟอร์ม',
  'องค์กรแจ้งแทนเจ้าของข้อมูล',
  'คำสั่งของหน่วยงานรัฐหรือตามกฎหมาย',
  OTHER,
];

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PdpaScreen({ initialQuery }: { initialQuery?: string }) {
  const overview = useApi<PdpaOverview>(PDPA_PATH);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [found, setFound] = useState<PdpaSearch | null>(null);
  const run = useRunAction();

  const find = (text: string) =>
    void run(async () => {
      setQuery(text);
      const result = await searchPerson(text.trim());
      setSearched(text.trim());
      setFound(result);
    });
  // Once per address (a development double render runs effects twice).
  const searchedFirst = useRef('');
  useEffect(() => {
    const text = initialQuery?.trim() ?? '';
    if (text.length < 3 || searchedFirst.current === text) return;
    searchedFirst.current = text;
    find(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  if (overview.error) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  if (!overview.data) return <PageLoading />;
  const { history, requested, confirm_word } = overview.data;

  return (
    <>
      <Link href="/platform/accounts" className="back-link">
        <Icon name="back" />
        บัญชีผู้ใช้
      </Link>
      <div className="page-heading">
        <div>
          <h1>เครื่องมือ PDPA</h1>
          <p>ค้นหาคนหนึ่งคนในทุกองค์กร แล้วออกไฟล์ข้อมูลทั้งหมดของเขา หรือลบข้อมูล ทุกครั้งบันทึกว่าใครสั่ง เมื่อไหร่ และเพราะอะไร</p>
        </div>
      </div>
      <div className="pdpa-layout">
        <div className="stack">
          <section className="card">
            <form
              className="card-body pdpa-search"
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim().length >= 3) find(query);
              }}
            >
              <label className="pdpa-search-label" htmlFor="pdpa-query">
                ค้นหาเจ้าของข้อมูล
              </label>
              <div className="pdpa-search-row">
                <input id="pdpa-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="อีเมล เบอร์โทร หรือชื่อ (อย่างน้อย 3 ตัวอักษร)" autoComplete="off" />
                <button className="btn primary" type="submit" disabled={query.trim().length < 3}>
                  <Icon name="search" />
                  ค้นหาในทุกองค์กร
                </button>
              </div>
              <p className="tiny muted">
                ผลการค้นหาแสดงเฉพาะจำนวน ไม่แสดงเนื้อหาบทสนทนา เนื้อหาจะออกไปเฉพาะในไฟล์ที่ออกให้เจ้าของข้อมูล และทุกครั้งถูกบันทึกไว้
              </p>
            </form>
          </section>
          {found ? (
            <Results key={searched} found={found} query={searched} confirmWord={confirm_word} onDone={() => find(searched)} />
          ) : (
            // Before the first search: the three steps of the tool, so the empty page says what it is for.
            <ol className="pdpa-steps" aria-label="ขั้นตอนการใช้เครื่องมือ">
              <li>
                <strong>ค้นหา</strong>
                <span>พิมพ์อีเมล เบอร์โทร หรือชื่อ ระบบค้นในทุกองค์กรพร้อมกัน</span>
              </li>
              <li>
                <strong>เลือกรายการ</strong>
                <span>ติ๊กเฉพาะรายการที่เป็นของเจ้าของข้อมูลจริง</span>
              </li>
              <li>
                <strong>ออกไฟล์หรือลบ</strong>
                <span>ออกไฟล์ ZIP ให้เจ้าของข้อมูล หรือลบถาวร ทุกครั้งบันทึกในประวัติ</span>
              </li>
            </ol>
          )}
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-header">
              <div>
                <h2>คำขอลบที่องค์กรบันทึกไว้</h2>
                <p>ลูกค้าที่ทีมขององค์กรกด “ขอให้ลบข้อมูล” ไว้ และยังไม่ได้ลบ</p>
              </div>
            </div>
            <div className="card-body">
              {requested.length ? (
                <ul className="pdpa-requests">
                  {requested.map((r) => (
                    <li key={`${r.tenant_id}:${r.contact_id}`}>
                      <span>
                        <strong>{r.name}</strong>
                        <small>
                          {r.tenant_name} · ขอเมื่อ {date(r.requested_at)}
                          {r.requested_by ? ` · บันทึกโดย ${r.requested_by}` : ''}
                        </small>
                      </span>
                      {(r.email || r.phone || r.name) && (
                        <button type="button" className="btn sm" onClick={() => find(r.email || r.phone || r.name)}>
                          ค้นหาคนนี้
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tiny muted">ไม่มีคำขอค้างอยู่</p>
              )}
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <div>
                <h2>ประวัติการใช้เครื่องมือ</h2>
                <p>ไม่เก็บอีเมลหรือเบอร์ของเจ้าของข้อมูล เก็บแค่แบบปิดบังบางส่วน</p>
              </div>
            </div>
            <div className="card-body">
              {history.length ? (
                <ul className="pdpa-history">
                  {history.map((h) => (
                    <li key={h.id}>
                      <span className={`pdpa-kind is-${h.kind}`}>{h.kind === 'erase' ? 'ลบข้อมูล' : 'ออกไฟล์'}</span>
                      <span>
                        <strong>{h.subject}</strong>
                        <small>
                          {date(h.created_at, true)} · โดย {h.by_name} · {h.scope.organizations.map((o) => o.organization).join(', ') || 'บัญชีลูกค้าเท่านั้น'}
                        </small>
                        <small>ที่มา: {h.reason}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tiny muted">ยังไม่เคยใช้</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Results({ found, query, confirmWord, onDone }: { found: PdpaSearch; query: string; confirmWord: string; onDone: () => void }) {
  const { openModal, closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const key = (r: PdpaRecord) => `${r.tenant_id}:${r.contact_id}`;
  const [accounts, setAccounts] = useState(() => new Set(found.accounts.map((a) => a.id)));
  const [records, setRecords] = useState(() => new Set(found.records.filter((r) => !r.erased).map(key)));
  const [source, setSource] = useState('');
  const [detail, setDetail] = useState('');
  // What the history keeps: the way it came, then the detail typed (the server asks for 5-300 letters).
  const reason = source === OTHER ? detail.trim() : [source, detail.trim()].filter(Boolean).join(' · ');
  const toggle = <T,>(set: Set<T>, value: T, apply: (next: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };
  // A ticked account brings every record linked to it (the server does the same).
  const chosen = found.records.filter((r) => records.has(key(r)) || (r.account_id && accounts.has(r.account_id)));
  const choice: PdpaChoice = {
    query,
    accounts: [...accounts],
    records: chosen.map((r) => ({ tenant_id: r.tenant_id, contact_id: r.contact_id })),
  };
  const nothing = !accounts.size && !chosen.length;
  const reasonOk = Boolean(source) && reason.length >= 5;
  const total = (field: 'conversations' | 'cases' | 'files') => chosen.reduce((sum, r) => sum + r[field], 0);

  if (!found.accounts.length && !found.records.length)
    return (
      <section className="card">
        <EmptyState title="ไม่พบข้อมูลของคนนี้" description={`ค้นด้วย${kindWords[found.kind]} ${found.subject} ในทุกองค์กรแล้ว`} icon="search" />
      </section>
    );

  const askErase = () =>
    openModal(
      'ลบข้อมูลตามคำขอ PDPA',
      <EraseConfirm
        confirmWord={confirmWord}
        summary={`บัญชีลูกค้า ${accounts.size} บัญชี · ข้อมูลลูกค้า ${chosen.length} รายการใน ${new Set(chosen.map((r) => r.tenant_id)).size} องค์กร · บทสนทนา ${total('conversations')} · เคส ${total('cases')} · ไฟล์ ${total('files')}`}
        onCancel={() => closeModal()}
        onConfirm={async (typed) => {
          const done = await erasePerson({ ...choice, reason: reason.trim(), confirm: typed });
          closeModal(true);
          toast(`ลบข้อมูลแล้ว · ${done.organizations.length} องค์กร · ไฟล์ ${done.files} ไฟล์`);
          await refresh(PDPA_PATH);
          onDone();
        }}
      />,
    );

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>พบข้อมูล</h2>
          <p>
            ค้นด้วย{kindWords[found.kind]} {found.subject} · เลือกเฉพาะรายการที่เป็นของเจ้าของข้อมูลจริง
            {found.more && ' · ผลมากเกินไป แสดงบางส่วน ลองค้นด้วยอีเมลหรือเบอร์แทนชื่อ'}
          </p>
        </div>
      </div>
      <div className="card-body pdpa-results">
        {found.accounts.length > 0 && (
          <>
            <h3>บัญชีลูกค้า (ใช้ได้ทุกองค์กร)</h3>
            <ul className="pdpa-list">
              {found.accounts.map((a) => (
                <li key={a.id}>
                  <label className="check">
                    <input type="checkbox" checked={accounts.has(a.id)} onChange={() => toggle(accounts, a.id, setAccounts)} />
                    <span>
                      <strong>{a.name}</strong>
                      <small>
                        {a.email}
                        {a.phone ? ` · ${a.phone}` : ''} · สมัครเมื่อ {date(a.created_at)}
                        {a.last_login_at ? ` · เข้าล่าสุด ${date(a.last_login_at)}` : ''}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {found.records.length > 0 && (
          <>
            <h3>ข้อมูลลูกค้าในแต่ละองค์กร</h3>
            <ul className="pdpa-list">
              {found.records.map((r) => {
                const viaAccount = Boolean(r.account_id && accounts.has(r.account_id));
                return (
                  <li key={key(r)} className={r.erased ? 'is-erased' : undefined}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={viaAccount || records.has(key(r))}
                        disabled={viaAccount || r.erased}
                        onChange={() => toggle(records, key(r), setRecords)}
                      />
                      <span>
                        <strong>
                          {r.name} <span className="pdpa-org">{r.tenant_name}</span>
                        </strong>
                        <small>{[r.email, r.phone, r.company].filter(Boolean).join(' · ') || 'ไม่มีอีเมลหรือเบอร์'}</small>
                        <small>
                          บทสนทนา {number(r.conversations)} · เคส {number(r.cases)} · ข้อความจากลูกค้า {number(r.messages)} · ไฟล์ {number(r.files)}
                        </small>
                        <span className="pdpa-tags">
                          {r.account_id && <span>ลิงก์กับบัญชีลูกค้า{viaAccount ? ' (เลือกไปกับบัญชีแล้ว)' : ''}</span>}
                          {r.guest && <span>แชทแบบไม่ล็อกอิน</span>}
                          {r.deletion_requested_at && <span className="is-asked">องค์กรบันทึกคำขอลบเมื่อ {date(r.deletion_requested_at)}</span>}
                          {r.erased && <span>ลบข้อมูลแล้ว</span>}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {/* What is ticked, where the request came from, then the two acts. */}
        <div className="pdpa-footer">
          <p className="pdpa-summary">
            {nothing ? (
              <span>ยังไม่ได้เลือกรายการ</span>
            ) : (
              <>
                เลือกแล้ว{' '}
                <span>
                  บัญชีลูกค้า {accounts.size} · ข้อมูลลูกค้า {chosen.length} รายการ · บทสนทนา {number(total('conversations'))} · เคส {number(total('cases'))} · ไฟล์{' '}
                  {number(total('files'))}
                </span>
              </>
            )}
          </p>
          {/* Where the request came from: picked from the ways it usually arrives, so nobody faces an empty box
              wondering what to write. The detail is a reference to find it again, and only needed for "อื่น ๆ". */}
          <div className="pdpa-reason">
            <label className="field">
              <span>คำขอนี้มาทางไหน</span>
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">เลือกที่มาของคำขอ</option>
                {SOURCES.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{source === OTHER ? 'ระบุที่มา' : 'รายละเอียดเพิ่มเติม (ไม่ใส่ก็ได้)'}</span>
              <input value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={200} placeholder="วันที่ได้รับ หรือเลขอ้างอิงของเรื่อง" />
            </label>
            <p className="tiny muted">บันทึกไว้ในประวัติการใช้เครื่องมือ เผื่อต้องตรวจย้อนหลังว่าทำตามคำขอของใคร</p>
          </div>
          <div className="flex wrap pdpa-actions">
            <button
              type="button"
              className="btn primary"
              disabled={nothing || !reasonOk}
              onClick={() =>
                void run(async () => {
                  const blob = await exportPerson({ ...choice, reason });
                  save(blob, `pdpa-export-${new Date().toISOString().slice(0, 10)}.zip`);
                  toast('ออกไฟล์ข้อมูลแล้ว ส่งให้เจ้าของข้อมูลทางช่องทางที่ยืนยันตัวตนแล้ว');
                  await refresh(PDPA_PATH);
                })
              }
            >
              <Icon name="download" />
              ออกไฟล์ข้อมูลทั้งหมด (ZIP)
            </button>
            <button type="button" className="btn danger" disabled={nothing || !reasonOk} onClick={askErase}>
              <Icon name="trash" />
              ลบข้อมูล…
            </button>
            {nothing ? (
              <span className="tiny muted">เลือกอย่างน้อย 1 รายการก่อน</span>
            ) : (
              !reasonOk && <span className="tiny muted">{source === OTHER ? 'ระบุที่มาอย่างน้อย 5 ตัวอักษรก่อน' : 'เลือกที่มาของคำขอก่อน'}</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function EraseConfirm({
  confirmWord,
  summary,
  onCancel,
  onConfirm,
}: {
  confirmWord: string;
  summary: string;
  onCancel: () => void;
  onConfirm: (typed: string) => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useRunAction();
  return (
    <div className="pdpa-erase">
      <p className="notice danger-notice">ลบแล้วกู้คืนไม่ได้ ถังขยะขององค์กรก็ไม่มีสำเนาเหลือ</p>
      <p>
        <strong>{summary}</strong>
      </p>
      <ul>
        <li>บัญชีลูกค้าถูกลบ เข้าสู่ระบบไม่ได้อีก</li>
        <li>ในแต่ละองค์กร ชื่อ อีเมล เบอร์ บริษัท บันทึก ข้อความทุกข้อความ ไฟล์แนบ หัวเรื่อง สรุปจาก AI คำแปล และที่อยู่ LINE/อีเมล ถูกลบ</li>
        <li>เคสยังเหลือเป็นตัวเลขในรายงาน โดยไม่มีข้อมูลที่ระบุตัวตน</li>
        <li>ไฟล์สำรองที่ทำไว้ก่อนหน้านี้ยังมีข้อมูลอยู่ จนกว่าไฟล์จะหมดอายุหรือถูกลบ</li>
      </ul>
      <label className="field">
        <span>
          พิมพ์ <code>{confirmWord}</code> เพื่อยืนยัน
        </span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
      <div className="flex wrap pdpa-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={typed.trim() !== confirmWord || busy}
          onClick={() =>
            void run(async () => {
              setBusy(true);
              try {
                await onConfirm(typed.trim());
              } finally {
                setBusy(false);
              }
            })
          }
        >
          <Icon name="trash" />
          {busy ? 'กำลังลบ…' : 'ลบข้อมูลถาวร'}
        </button>
      </div>
    </div>
  );
}
