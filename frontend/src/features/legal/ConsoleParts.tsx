'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { LEGAL_PATH } from './api';
import type { LegalKey } from './types';

/* Two parts of the console's เอกสารกฎหมาย (LegalScreen):

     ProviderCard     who the provider is: the company, its address and the contacts every document names. A document
                      says {{บริษัท}}, {{อีเมลติดต่อ}} and so on, and the pages put these in (backend legal/service
                      fill_company); what is left empty reads "(ยังไม่ได้ระบุ)" rather than a contact that does not exist.
     AcceptanceList   who agreed to which version, when and from where - the record asked for when there is a dispute,
                      and a file of it (CSV) to hand over.

   Markup: pages/legal.css. */

type Company = { name: string; address: string; email: string; phone: string; dpo: string };

const COMPANY_PATH = `${LEGAL_PATH}/company`;

const FIELDS: { key: keyof Company; label: string; mark: string; placeholder: string; wide?: boolean }[] = [
  { key: 'name', label: 'ชื่อนิติบุคคล', mark: '{{บริษัท}}', placeholder: 'ชื่อบริษัทตามหนังสือรับรอง', wide: true },
  { key: 'address', label: 'ที่อยู่', mark: '{{ที่อยู่}}', placeholder: 'ที่อยู่ตามที่จดทะเบียน', wide: true },
  { key: 'email', label: 'อีเมลติดต่อเรื่องข้อมูลส่วนบุคคล', mark: '{{อีเมลติดต่อ}}', placeholder: 'อีเมลที่มีคนอ่านจริง' },
  { key: 'phone', label: 'โทรศัพท์', mark: '{{โทรศัพท์}}', placeholder: 'เบอร์ติดต่อ' },
  { key: 'dpo', label: 'เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO)', mark: '{{เจ้าหน้าที่คุ้มครองข้อมูล}}', placeholder: 'ชื่อ และช่องทางติดต่อ ถ้ามี', wide: true },
];

export function ProviderCard() {
  const found = useApi<{ company: Company }>(COMPANY_PATH);
  const toast = useToast();
  const refresh = useInvalidate();
  if (found.error) return <ErrorState error={found.error} onRetry={() => void found.refetch()} />;
  if (!found.data) return null;
  const saved = found.data.company;
  const missing = FIELDS.filter((f) => f.key !== 'dpo' && !saved[f.key]).length;
  return (
    <section className="card legal-provider">
      <div className="card-header">
        <div>
          <h2>ข้อมูลผู้ให้บริการ</h2>
          <p>ทุกเอกสารดึงข้อมูลนี้ไปแสดงเอง แก้ที่นี่ที่เดียว มีผลกับทุกฉบับรวมฉบับที่เผยแพร่แล้วทันที</p>
        </div>
        {missing > 0 && <span className="legal-missing">ยังไม่ได้กรอก {missing} ช่อง</span>}
      </div>
      <div className="card-body">
        <Form
          className="legal-provider-form"
          data-form="legal-company"
          onSubmit={async (values) => {
            await api(COMPANY_PATH, values);
            toast('บันทึกข้อมูลผู้ให้บริการแล้ว · ทุกเอกสารแสดงข้อมูลใหม่แล้ว');
            await refresh(COMPANY_PATH);
          }}
        >
          {FIELDS.map((f) => (
            <div key={f.key} className={`field${f.wide ? ' wide' : ''}`}>
              <label htmlFor={`legal-company-${f.key}`}>
                {f.label} <code className="tiny muted">{f.mark}</code>
              </label>
              <input id={`legal-company-${f.key}`} name={f.key} defaultValue={saved[f.key]} placeholder={f.placeholder} />
            </div>
          ))}
          <div className="form-actions wide">
            <button type="submit" className="btn primary">
              <Icon name="check" />
              บันทึกข้อมูลผู้ให้บริการ
            </button>
          </div>
        </Form>
      </div>
    </section>
  );
}

type Acceptance = { version: string; email: string; accepted_at: string; ip: string; tenant_id: string | null; organization: string };

/** The record, as a file: one row per agreement, quoted so a comma in a name stays in its column. */
function download(rows: Acceptance[], doc: LegalKey) {
  const quote = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [['ฉบับ', 'อีเมล', 'องค์กร', 'ยอมรับเมื่อ', 'IP'].map(quote).join(',')].concat(
    rows.map((r) => [r.version, r.email, r.organization, r.accepted_at, r.ip].map(quote).join(',')),
  );
  // The BOM is what makes Excel read Thai as Thai.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `acceptances-${doc}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AcceptanceList({ doc }: { doc: LegalKey }) {
  const found = useApi<{ acceptances: Acceptance[] }>(`${LEGAL_PATH}/${doc}/acceptances`);
  const [query, setQuery] = useState('');
  if (found.error) return <ErrorState error={found.error} />;
  if (!found.data) return <PageLoading />;
  const term = query.trim().toLowerCase();
  const rows = found.data.acceptances.filter((r) => !term || `${r.email} ${r.organization} ${r.version}`.toLowerCase().includes(term));
  return (
    <div className="legal-acceptances">
      <div className="legal-acceptances-head">
        <input type="search" placeholder="ค้นหาอีเมล องค์กร หรือฉบับ" aria-label="ค้นหาการยอมรับ" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn" disabled={!found.data.acceptances.length} onClick={() => download(found.data!.acceptances, doc)}>
          <Icon name="download" />
          ส่งออก CSV
        </button>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ฉบับ</th>
                <th>ผู้ยอมรับ</th>
                <th>องค์กร</th>
                <th>เมื่อ</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.email}-${r.accepted_at}-${i}`}>
                  <td>{r.version}</td>
                  <td>{r.email}</td>
                  <td>{r.organization || <span className="muted">-</span>}</td>
                  <td>{date(r.accepted_at, true)}</td>
                  <td className="tiny muted">{r.ip || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{term ? 'ไม่พบรายการที่ตรงกับที่ค้นหา' : 'ยังไม่มีผู้ยอมรับเอกสารนี้'}</p>
      )}
    </div>
  );
}
