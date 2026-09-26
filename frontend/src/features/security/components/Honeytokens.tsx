'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { FormActions, TextArea, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date, number, relative } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { createHoneytoken, deleteHoneytoken, HONEYTOKENS_PATH, SECURITY_PREFIX, testHoneytoken, updateHoneytoken } from '../api';
import { honeytokenKindLabel, honeytokenKinds } from '../labels';
import type { Honeytoken, HoneytokenCreated, HoneytokenKind } from '../types';

/* Honeytokens (docs/security/monitoring-and-traps.md): things no real user ever uses — a decoy account email, an API key, a
   password, a shared-file link — planted where an attacker or a curious insider would find them. The list shows
   where each one was planted and when it last went off; each can be switched off, tested (an info event only, no
   block, no email), renamed or deleted. "สร้างกับดัก" shows the secret once. */

function KindName({ kind }: { kind: string }) {
  const meta = honeytokenKinds[kind as HoneytokenKind];
  return (
    <span className="trap-kind">
      <span className="trap-kind-icon" aria-hidden="true">
        <Icon name={meta?.icon ?? 'shield'} />
      </span>
      {honeytokenKindLabel(kind)}
    </span>
  );
}

export function HoneytokensCard() {
  const tokens = useApi<{ tokens: Honeytoken[] }>(HONEYTOKENS_PATH);
  const { openModal } = useDialogs();
  const rows = tokens.data?.tokens ?? [];
  return (
    <section className="card security-card" id="security-honeytokens" aria-labelledby="security-honeytokens-title">
      <div className="card-header">
        <div>
          <h2 id="security-honeytokens-title">กับดัก Honeytoken</h2>
          <p>สิ่งที่ผู้ใช้จริงไม่มีวันใช้ เมื่อมีคนใช้ ระบบบันทึกเหตุการณ์วิกฤต แจ้งเตือนผู้ดูแลทันที และบล็อก IP ตามการตั้งค่า</p>
        </div>
        <button type="button" className="btn primary" onClick={() => openModal('สร้างกับดัก', <CreateHoneytokenDialog />)}>
          <Icon name="plus" />
          สร้างกับดัก
        </button>
      </div>
      {tokens.error ? (
        <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
      ) : !tokens.data ? (
        <PageLoading />
      ) : rows.length ? (
        <div className="table-scroll">
          <table className="security-table trap-table">
            <thead>
              <tr>
                <th scope="col">ชนิด</th>
                <th scope="col">ชื่อ / ที่วางไว้</th>
                <th scope="col">สร้างเมื่อ</th>
                <th scope="col">ทำงาน</th>
                <th scope="col">ครั้งล่าสุด</th>
                <th scope="col">เปิดใช้</th>
                <th scope="col">
                  <span className="sr-only">การจัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((token) => (
                <HoneytokenRow key={token.id} token={token} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-body trap-empty">
          <p className="muted">ยังไม่มีกับดัก สร้างบัญชีล่อ คีย์ API รหัสผ่าน หรือลิงก์ไฟล์ แล้ววางไว้ในที่ที่ผู้ไม่หวังดีน่าจะพบ</p>
        </div>
      )}
    </section>
  );
}

function HoneytokenRow({ token }: { token: Honeytoken }) {
  const refresh = useInvalidate();
  const toast = useToast();
  const run = useRunAction();
  const { openModal, confirmDelete } = useDialogs();
  const [enabled, setEnabled] = useState(token.enabled);
  const [saving, setSaving] = useState(false);
  // A fresh list redraws the switch with the saved value.
  const [seen, setSeen] = useState(token.enabled);
  if (token.enabled !== seen) {
    setSeen(token.enabled);
    setEnabled(token.enabled);
  }

  const toggle = (next: boolean) =>
    void run(async () => {
      setEnabled(next);
      setSaving(true);
      try {
        await updateHoneytoken(token.id, { enabled: next });
        toast(next ? `เปิดกับดัก ${token.label} แล้ว` : `ปิดกับดัก ${token.label} แล้ว`);
      } catch (error) {
        setEnabled(!next);
        throw error;
      } finally {
        setSaving(false);
      }
      await refresh(HONEYTOKENS_PATH, `${SECURITY_PREFIX}/events`);
    });

  const test = () =>
    void run(async () => {
      await testHoneytoken(token.id);
      toast('บันทึกเหตุการณ์ทดสอบแล้ว (ระดับข้อมูล ไม่บล็อก ไม่ส่งอีเมล)');
      await refresh(`${SECURITY_PREFIX}/events`, HONEYTOKENS_PATH);
    });

  const remove = () =>
    confirmDelete({
      title: 'ลบกับดัก',
      warning: `กับดัก “${token.label}” จะหยุดทำงานทันทีและลบออกถาวร`,
      effects: [
        'ถ้ายังมีสำเนาวางอยู่ที่ใด การใช้สิ่งนั้นจะไม่ถูกตรวจจับอีก',
        'เหตุการณ์ที่บันทึกไว้แล้วยังอยู่ในบันทึกเหตุการณ์',
      ],
      confirmLabel: 'ลบกับดัก',
      run: async () => {
        await deleteHoneytoken(token.id);
        toast(`ลบกับดัก ${token.label} แล้ว`);
        await refresh(SECURITY_PREFIX);
      },
    });

  const identity = token.kind === 'decoy_account' ? token.decoy_email : token.preview;
  return (
    <tr className={token.trigger_count > 0 ? 'trap-row-hit' : undefined}>
      <td>
        <KindName kind={token.kind} />
      </td>
      <td className="security-wrap trap-name">
        <strong>{token.label}</strong>
        {identity && <span className="mono tiny">{identity}</span>}
        {token.placed_at_note && <span className="tiny muted">วางไว้ที่: {token.placed_at_note}</span>}
      </td>
      <td>
        <time dateTime={token.created_at} title={date(token.created_at, true)}>
          {relative(token.created_at)}
        </time>
        {token.created_by && <div className="tiny muted">{token.created_by}</div>}
      </td>
      <td className="mono">{number(token.trigger_count)} ครั้ง</td>
      <td>
        {token.last_triggered_at ? (
          <>
            <time dateTime={token.last_triggered_at} title={date(token.last_triggered_at, true)}>
              {relative(token.last_triggered_at)}
            </time>
            {token.last_ip && <div className="tiny mono">{token.last_ip}</div>}
          </>
        ) : (
          <span className="muted">ยังไม่เคย</span>
        )}
      </td>
      <td>
        <input
          type="checkbox"
          className="switch"
          checked={enabled}
          disabled={saving}
          onChange={(e) => toggle(e.currentTarget.checked)}
          aria-label={`เปิดใช้กับดัก ${token.label}`}
        />
      </td>
      <td className="security-actions-cell">
        <div className="trap-actions">
          <button type="button" className="btn sm" onClick={test} title="บันทึกเหตุการณ์ทดสอบระดับข้อมูล ไม่บล็อก ไม่ส่งอีเมล">
            <Icon name="bolt" />
            ทดสอบ
          </button>
          <button type="button" className="btn sm subtle" onClick={() => openModal('แก้ไขกับดัก', <EditHoneytokenDialog token={token} />)} aria-label={`แก้ไข ${token.label}`}>
            <Icon name="edit" />
          </button>
          <button type="button" className="btn sm danger" onClick={remove} aria-label={`ลบ ${token.label}`}>
            <Icon name="trash" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function EditHoneytokenDialog({ token }: { token: Honeytoken }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="security-edit-honeytoken"
      onSubmit={async (values) => {
        await updateHoneytoken(token.id, { label: (values.label ?? '').trim(), placed_at_note: (values.placed_at_note ?? '').trim() });
        closeModal(true);
        toast('บันทึกกับดักแล้ว');
        await refresh(HONEYTOKENS_PATH);
      }}
    >
      <p className="small muted">
        <KindName kind={token.kind} /> · ค่าลับของกับดักเปลี่ยนไม่ได้ ถ้าต้องการค่าใหม่ให้สร้างกับดักใหม่แล้วลบอันเดิม
      </p>
      <TextField label="ชื่อกับดัก" name="label" max={100} defaultValue={token.label} autoComplete="off" />
      <TextArea label="วางไว้ที่ (ไม่บังคับ)" name="placed_at_note" max={300} rows={2} required={false} defaultValue={token.placed_at_note ?? ''} />
      <FormActions onCancel={() => closeModal()} />
    </Form>
  );
}

/** Choose a kind, name it and say where it will be planted; then the secret, once. */
function CreateHoneytokenDialog() {
  const { closeModal } = useDialogs();
  const refresh = useInvalidate();
  const [kind, setKind] = useState<HoneytokenKind>('decoy_account');
  const [created, setCreated] = useState<HoneytokenCreated | null>(null);

  if (created) return <HoneytokenSecret created={created} onDone={() => closeModal(true)} />;

  const meta = honeytokenKinds[kind];
  return (
    <Form
      data-form="security-create-honeytoken"
      onSubmit={async (values) => {
        const result = await createHoneytoken({ kind, label: (values.label ?? '').trim(), placed_at_note: (values.placed_at_note ?? '').trim() });
        setCreated(result);
        await refresh(HONEYTOKENS_PATH);
      }}
    >
      <fieldset className="trap-kinds">
        <legend>ชนิดของกับดัก</legend>
        {(Object.keys(honeytokenKinds) as HoneytokenKind[]).map((value) => {
          const item = honeytokenKinds[value];
          return (
            <label key={value} className="trap-kind-option">
              <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              <span className="trap-kind-icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              <span className="trap-kind-text">
                <strong>{item.label}</strong>
                <span className="small muted">{item.explain}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="notice trap-plant">
        <Icon name="sparkle" />
        <span>
          <strong>วางไว้ที่ไหนดี:</strong> {meta.plant}
        </span>
      </p>
      <TextField label="ชื่อกับดัก" name="label" max={100} placeholder={meta.example} autoComplete="off" hint="ผู้ดูแลเห็นชื่อนี้ในการแจ้งเตือน" />
      <TextArea
        label="วางไว้ที่ (ไม่บังคับ)"
        name="placed_at_note"
        max={300}
        rows={2}
        required={false}
        placeholder="เช่น โฟลเดอร์ IT/backup ใน Google Drive ของทีม"
      />
      <FormActions label="สร้างกับดัก" onCancel={() => closeModal()} />
    </Form>
  );
}

/** The secret, shown this once. Escape / the close button / the dimmed area do not close it before "คัดลอก" (only the
    button at the bottom does), so it is not lost by a slip of the hand. */
function HoneytokenSecret({ created, onDone }: { created: HoneytokenCreated; onDone: () => void }) {
  const toast = useToast();
  const { setCloseGuard } = useDialogs();
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const copiedRef = useRef(false);
  const { token, secret } = created;
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.select());
    setCloseGuard(() => {
      if (copiedRef.current) return true;
      toast('ยังไม่ได้คัดลอก ค่านี้จะดูอีกไม่ได้ กด “คัดลอก” หรือปุ่มปิดด้านล่างเมื่อเก็บไว้แล้ว', true);
      return false;
    });
    return () => {
      cancelAnimationFrame(frame);
      setCloseGuard(null);
    };
  }, [setCloseGuard, toast]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      copiedRef.current = true;
      setCopied(true);
      toast('คัดลอกแล้ว');
    } catch {
      // The browser refused: the value is selected in the box to copy by hand.
      input.current?.select();
      toast('คัดลอกอัตโนมัติไม่ได้ เลือกข้อความในช่องแล้วกดคัดลอกเอง', true);
    }
  };

  const what = { decoy_account: 'อีเมลบัญชีล่อ', api_key: 'คีย์ API', password: 'รหัสผ่าน', link: 'ลิงก์' }[token.kind as HoneytokenKind] ?? 'ค่าลับ';
  return (
    <div className="trap-secret">
      <p className="notice warning trap-once" role="alert">
        <Icon name="lock" />
        <span>
          <strong>จะแสดงครั้งเดียว</strong> คัดลอก{what}นี้ไปวางในที่ที่ตั้งใจไว้ตอนนี้ ระบบเก็บไว้เพียงค่าแฮช ปิดหน้าต่างนี้แล้วจะดูอีกไม่ได้
        </span>
      </p>
      <p className="small">
        <KindName kind={token.kind} /> · {token.label}
      </p>
      <div className="field">
        <label htmlFor="honeytoken-secret">{what}</label>
        <div className="trap-secret-row">
          <input
            ref={input}
            id="honeytoken-secret"
            className="mono"
            value={secret}
            readOnly
            spellCheck={false}
            autoComplete="off"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="btn primary" onClick={() => void copy()}>
            <Icon name={copied ? 'check' : 'code'} />
            {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
          </button>
        </div>
      </div>
      {token.placed_at_note && <p className="small muted">วางไว้ที่: {token.placed_at_note}</p>}
      <p className="tiny muted">กับดักนี้เปิดใช้งานแล้ว ใช้ปุ่ม “ทดสอบ” ในรายการเพื่อตรวจว่าเหตุการณ์และการแจ้งเตือนแสดงตามที่คาด</p>
      <div className="form-actions">
        <button type="button" className="btn primary" onClick={onDone}>
          <Icon name="check" />
          {copied ? 'เสร็จสิ้น' : 'คัดลอกแล้ว ปิดหน้าต่าง'}
        </button>
      </div>
    </div>
  );
}
