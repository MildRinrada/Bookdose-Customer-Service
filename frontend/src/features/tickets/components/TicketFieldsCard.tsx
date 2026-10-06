'use client';

import Link from 'next/link';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { isDone } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { TICKET_PREFIXES } from '../api';
import { FIELD_LIMITS, fieldText, fillTicketFields, missingToClose, useCaseFields, type CaseField } from '../fields';
import type { Ticket } from '../types';
import { FoldCard } from './FoldCard';

/* ข้อมูลเพิ่มเติม on the case screen: the organization's own fields (fields.ts), filled in by the team and saved with
   one press. A field the case must have before it is closed is marked, and while the case is open the ones still
   empty are named, so closing it is never the first time a member hears of them. The form is drawn again when the
   saved values change (after a save, or another member's). Markup: pages/tickets (case-fields-*). */

function FieldInput({ field, value }: { field: CaseField; value: string }) {
  const id = `case-field-${field.id}`;
  const label = (
    <label htmlFor={id}>
      {field.name}
      {field.required && (
        <span className="required-star" title={field.kind === 'checkbox' ? 'ต้องติ๊กก่อนปิดเคส' : 'ต้องกรอกก่อนปิดเคส'}>
          {' '}
          *
        </span>
      )}
    </label>
  );
  if (field.kind === 'checkbox')
    return (
      <label className="check case-field-check" htmlFor={id}>
        <input id={id} name={field.id} type="checkbox" defaultChecked={value === '1'} />
        <span>
          {field.name}
          {field.required && (
            <span className="required-star" title="ต้องติ๊กก่อนปิดเคส">
              {' '}
              *
            </span>
          )}
        </span>
      </label>
    );
  return (
    <div className="field">
      {label}
      {field.kind === 'select' ? (
        <select id={id} name={field.id} defaultValue={value}>
          <option value="">ไม่ระบุ</option>
          {/* A value from an option taken off the list since stays visible until it is changed. */}
          {value && !field.options.includes(value) && <option value={value}>{value}</option>}
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.kind === 'date' ? (
        <input id={id} name={field.id} type="date" defaultValue={value} />
      ) : field.kind === 'number' ? (
        <input id={id} name={field.id} inputMode="decimal" autoComplete="off" pattern="-?[0-9,]+(\.[0-9]+)?" title="ตัวเลข เช่น 1200 หรือ 12.5" defaultValue={value} />
      ) : (
        <input id={id} name={field.id} maxLength={FIELD_LIMITS.text} autoComplete="off" defaultValue={value} />
      )}
    </div>
  );
}

export function TicketFieldsCard({ ticket }: { ticket: Ticket }) {
  const work = useWork();
  const fields = useCaseFields();
  const toast = useToast();
  const refresh = useInvalidate();
  const values = ticket.fields ?? {};
  const owner = work.role === 'admin' && !work.read_only;
  if (!fields.length)
    return owner ? (
      <FoldCard id="fields" title="ข้อมูลเพิ่มเติม" hint="ยังไม่ได้ตั้งช่อง">
        <p className="tiny muted">
          ตั้งช่องที่ทีมต้องกรอกในทุกเคสได้ เช่น เลขคำสั่งซื้อ หรือสาขา <Link href="/settings?tab=fields">ตั้งช่องข้อมูลของเคส</Link>
        </p>
      </FoldCard>
    ) : null;

  const missing = isDone(ticket) ? [] : missingToClose(fields, values);
  const filled = fields.filter((f) => (values[f.id] ?? '') !== '').length;
  // The line says what still has to be filled before the case can close, else how much of it is filled.
  const hint = missing.length ? `ต้องกรอกอีก ${missing.length} ช่องก่อนปิดเคส` : `กรอกแล้ว ${filled}/${fields.length}`;
  if (work.read_only)
    return (
      <FoldCard id="fields" title="ข้อมูลเพิ่มเติม" hint={`กรอกแล้ว ${filled}/${fields.length}`}>
        <dl className="case-fields-read">
          {fields.map((f) => (
            <div key={f.id}>
              <dt>{f.name}</dt>
              <dd>{fieldText(f, values[f.id]) || '-'}</dd>
            </div>
          ))}
        </dl>
      </FoldCard>
    );
  return (
    <FoldCard id="fields" title="ข้อมูลเพิ่มเติม" hint={hint} open={missing.length > 0}>
    <Form
      key={JSON.stringify(values)}
      className="case-fields-card"
      onSubmit={async (sent, form) => {
        const body = Object.fromEntries(
          fields.map((f) => [f.id, f.kind === 'checkbox' ? (form.elements.namedItem(f.id) as HTMLInputElement).checked : (sent[f.id] ?? '')]),
        );
        await fillTicketFields(ticket.id, body);
        toast('บันทึกข้อมูลเพิ่มเติมแล้ว');
        await refresh(...TICKET_PREFIXES);
      }}
    >
      {missing.length > 0 && <p className="case-fields-missing">ต้องกรอกก่อนปิดเคส: {missing.join(', ')}</p>}
      {fields.map((f) => (
        <FieldInput key={f.id} field={f} value={values[f.id] ?? ''} />
      ))}
      <button className="btn" type="submit">
        บันทึกข้อมูล
      </button>
      {fields.some((f) => f.required) && <p className="tiny muted">ช่องที่มี * ต้องกรอกก่อนปิดเคส</p>}
    </Form>
    </FoldCard>
  );
}
