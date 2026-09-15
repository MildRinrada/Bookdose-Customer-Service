'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { RequiredStar, useFieldValidation } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { PLATFORM_TEMPLATES_PATH, TEMPLATES_PATH } from '@/features/contracts/api';
import { ContractTemplateRow, useContractTemplateForm } from '@/features/contracts/components/ContractTemplateForm';
import { signatureVerifiedLabels } from '@/features/contracts/labels';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { deletePlatformTemplate, verifyContractHash } from './api';
import type { PlatformTemplates, VerifyResult } from './types';

/* Platform console, Template สัญญากลาง: the standard contract and TOR templates every organization starts from, and
   the check of a signed document's SHA-256 hash against every organization (for disputes).
   Markup: pages/platform/contract-templates.html, contract-verify-result.html, pages/contracts/contract-template-row.html. */

export function ContractTemplatesScreen() {
  const templates = useApi<PlatformTemplates>(PLATFORM_TEMPLATES_PATH);
  if (templates.isPending) return <PageLoading />;
  if (templates.error) return <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />;
  return <ContractTemplatesView data={templates.data} />;
}

function ContractTemplatesView({ data }: { data: PlatformTemplates }) {
  const openForm = useContractTemplateForm();
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Template สัญญากลาง</h1>
          <p>
            แม่แบบมาตรฐานที่ทุกองค์กรเลือกใช้ได้ · {data.templates.length} แม่แบบ · คำแทนค่า <code>{data.placeholders.map((p) => `{${p}}`).join(' ')}</code>
          </p>
        </div>
        <div className="flex">
          <button type="button" className="btn primary" onClick={() => openForm(null, { scope: 'platform' })}>
            <Icon name="plus" />
            สร้างแม่แบบ
          </button>
        </div>
      </div>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>แม่แบบมาตรฐาน</h2>
            <p>แก้แล้วมีผลกับเอกสารที่สร้างหลังจากนี้เท่านั้น</p>
          </div>
        </div>
        {data.templates.length ? (
          <ul className="contract-template-list">
            {data.templates.map((t) => (
              <ContractTemplateRow
                key={t.id}
                template={t}
                editable
                onEdit={() => openForm(t, { scope: 'platform' })}
                onDelete={() =>
                  confirm({
                    title: 'ลบแม่แบบมาตรฐาน',
                    message: 'องค์กรจะไม่เห็นแม่แบบนี้อีก เอกสารที่สร้างจากแม่แบบนี้แล้วไม่เปลี่ยน',
                    cancelLabel: 'ไม่ลบ',
                    confirmLabel: 'ลบแม่แบบ',
                    tone: 'danger',
                    run: async () => {
                      await deletePlatformTemplate(t.id);
                      toast('ลบแม่แบบแล้ว');
                      await refresh(PLATFORM_TEMPLATES_PATH, TEMPLATES_PATH);
                    },
                  })
                }
              />
            ))}
          </ul>
        ) : (
          <div className="card-body">
            <p className="muted">ยังไม่มีแม่แบบมาตรฐาน</p>
          </div>
        )}
      </section>
      <VerifyCard />
    </>
  );
}

function VerifyCard() {
  const [result, setResult] = useState<VerifyResult | null>(null);
  // A plain input like the old template; the app's validation gives it the star and the Thai message.
  const { bind, errorNode } = useFieldValidation();
  return (
    <section className="card mt">
      <div className="card-header">
        <div>
          <h2>ตรวจสอบเอกสารที่ลงนามแล้ว</h2>
          <p>วางรหัส SHA-256 จากท้ายเอกสาร ระบบค้นในทุกองค์กรและตรวจว่าเนื้อหายังตรงกับตอนลงนาม</p>
        </div>
        <Icon name="shield" />
      </div>
      <Form
        className="card-body contract-verify"
        data-form="contract-verify"
        onSubmit={async (values) => setResult(await verifyContractHash(values.hash ?? ''))}
      >
        <div className="field">
          <label htmlFor="verify-hash">
            รหัส SHA-256
            <RequiredStar />
          </label>
          <input id="verify-hash" name="hash" maxLength={64} required spellCheck={false} autoComplete="off" {...bind} />
          {errorNode}
        </div>
        <button className="btn" type="submit">
          <Icon name="search" />
          ตรวจสอบ
        </button>
        <div id="verify-result" aria-live="polite">
          {result && <VerifyResultView result={result} />}
        </div>
      </Form>
    </section>
  );
}

function VerifyResultView({ result }: { result: VerifyResult }) {
  if (!result.found) return <p className="notice danger-notice">ไม่พบเอกสารที่ลงนามครบด้วยรหัสนี้ในทุกองค์กร</p>;
  const signatures = (result.signatures || [])
    .map(
      (s) =>
        `${s.party === 'customer' ? 'ผู้ว่าจ้าง' : 'ผู้รับจ้าง'} ${s.signer_name} · ${date(s.signed_at, true)} · ${signatureVerifiedLabels[s.verified_by] ?? s.verified_by} · IP ${s.ip}`,
    )
    .join('\n');
  return (
    <div className={`notice${result.valid ? '' : ' danger-notice'} verify-result`}>
      <strong>{result.valid ? 'เอกสารถูกต้อง ตรงกับตอนลงนาม' : 'พบเอกสาร แต่เนื้อหาในระบบไม่ตรงกับรหัสแล้ว'}</strong>
      <span>
        {result.organization} · {result.reference} เวอร์ชัน {result.version} · {result.title}
      </span>
      <span>
        ผู้ว่าจ้าง {result.customer_name} · ปิดผนึกเมื่อ {result.completed_at ? date(result.completed_at, true) : ''}
      </span>
      <pre>{signatures}</pre>
    </div>
  );
}
