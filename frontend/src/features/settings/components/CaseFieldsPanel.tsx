'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FormActions, SelectField, TextArea, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  CASE_FIELDS_PATH,
  FIELD_LIMITS,
  fieldKindLabels,
  saveCaseFields,
  type CaseField,
  type CaseFieldKind,
  type CaseFieldsOverview,
} from '@/features/tickets/fields';
import { useApi, useInvalidate } from '@/lib/query';

/* ตั้งค่า → ภาพรวมและบริการ → ช่องข้อมูลของเคส (backend tickets/fields.py; owners): the fields the team fills in on
   every case, in the order the case screen shows them. Each is added or edited in a small form, moved up or down, or
   removed after being told how many cases have a value in it. Every change is saved at once. A field's kind is chosen
   when it is made and never changes, since the values already kept would be read wrongly.
   Markup: pages/settings (security-list, case-field-*). */

/** What a change to the list touches: the workspace (the list itself), the counts and the cases. */
const REFRESH = ['/api/workspace', CASE_FIELDS_PATH, '/api/tickets'];

type Draft = Omit<CaseField, 'id'> & { id?: string };

export function CaseFieldsPanel() {
  const found = useApi<CaseFieldsOverview>(CASE_FIELDS_PATH);
  if (found.error && !found.data) return <ErrorState error={found.error} onRetry={() => void found.refetch()} />;
  if (!found.data) return <PageLoading />;
  return <CaseFieldsCard data={found.data} />;
}

function CaseFieldsCard({ data }: { data: CaseFieldsOverview }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const { openModal, closeModal, confirm } = useDialogs();
  const fields = data.fields;

  const store = async (next: Draft[], message: string) => {
    await saveCaseFields(next);
    await refresh(...REFRESH);
    toast(message);
  };
  const edit = (index?: number) => {
    if (index === undefined && fields.length >= data.max) return toast(`ตั้งได้สูงสุด ${data.max} ช่อง ลบช่องที่ไม่ใช้ก่อน จึงจะเพิ่มช่องใหม่ได้`, true);
    openModal(
      index === undefined ? 'เพิ่มช่องข้อมูลของเคส' : `แก้ไขช่อง “${fields[index].name}”`,
      <FieldForm
        categories={data.categories ?? []}
        field={index === undefined ? undefined : fields[index]}
        taken={fields.filter((_, i) => i !== index).map((f) => f.name.toLowerCase())}
        onSave={async (field) => {
          const next = index === undefined ? [...fields, field] : fields.map((f, i) => (i === index ? { ...field, id: f.id } : f));
          await store(next, index === undefined ? `เพิ่มช่อง “${field.name}” แล้ว` : 'บันทึกแล้ว');
          closeModal(true);
        }}
      />,
    );
  };
  const move = (index: number, by: number) => {
    const next = [...fields];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    void run(() => store(next, 'เปลี่ยนลำดับแล้ว'));
  };
  const remove = (field: CaseField) => {
    const used = data.counts[field.id] ?? 0;
    confirm({
      title: `ลบช่อง “${field.name}”`,
      message: used
        ? `ช่องนี้มีข้อมูลอยู่ ${used} เคส ข้อมูลเหล่านั้นจะถูกลบด้วยและกู้คืนไม่ได้ ถ้าแค่อยากเปลี่ยนชื่อ ให้กดแก้ไขแทน`
        : 'ยังไม่มีเคสไหนกรอกช่องนี้ ลบแล้วทีมจะไม่เห็นช่องนี้ในหน้าเคสอีก',
      confirmLabel: 'ลบช่อง',
      tone: 'danger',
      run: () => store(fields.filter((f) => f.id !== field.id), `ลบช่อง “${field.name}” แล้ว`),
    });
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>ช่องข้อมูลของเคส</h2>
          <p>ช่องที่ทีมกรอกในหน้าเคส ใช้ค้นหาและกรองรายการเคส แยกดูในรายงาน และอยู่ในไฟล์ส่งออก ลูกค้าไม่เห็นช่องเหล่านี้</p>
        </div>
        <button className="btn primary" type="button" onClick={() => edit()}>
          <Icon name="plus" />
          เพิ่มช่อง
        </button>
      </div>
      <div className="card-body">
        {!fields.length ? (
          <EmptyState icon="file" title="ยังไม่มีช่องข้อมูลของเคส" description="เพิ่มสิ่งที่ทีมต้องบันทึกในทุกเคส เช่น เลขคำสั่งซื้อ รุ่นสินค้า หรือสาขา ตั้งให้ต้องกรอกก่อนปิดเคสได้" />
        ) : (
          <>
            <ul className="security-list case-field-list">
              {fields.map((field, index) => (
                <li key={field.id}>
                  <span className="security-list-icon">
                    <Icon name="file" />
                  </span>
                  <span className="grow case-field-info">
                    <strong>{field.name}</strong>
                    <span className="case-field-meta">
                      <span>{fieldKindLabels[field.kind]}</span>
                      {field.kind === 'select' && <span className="case-field-options">{field.options.join(', ')}</span>}
                      <span>{data.counts[field.id] ? `กรอกแล้ว ${data.counts[field.id]} เคส` : 'ยังไม่มีเคสที่กรอก'}</span>
                    </span>
                    {field.required && <span className="case-field-required">{field.kind === 'checkbox' ? 'ต้องติ๊กก่อนปิดเคส' : 'ต้องกรอกก่อนปิดเคส'}</span>}
                    {field.customer && (
                      <span className="case-field-ask">
                        ลูกค้ากรอกตอนเริ่มแชท{field.categories?.length ? ` (${field.categories.join(', ')})` : ''}
                      </span>
                    )}
                    {field.ask && <span className="case-field-ask">Chatbot ถามลูกค้าก่อนถึงเจ้าหน้าที่</span>}
                  </span>
                  <span className="case-field-actions">
                    <button className="btn sm" type="button" disabled={index === 0} aria-label={`เลื่อน ${field.name} ขึ้น`} title="เลื่อนขึ้น" onClick={() => move(index, -1)}>
                      ↑
                    </button>
                    <button
                      className="btn sm"
                      type="button"
                      disabled={index === fields.length - 1}
                      aria-label={`เลื่อน ${field.name} ลง`}
                      title="เลื่อนลง"
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button className="btn sm" type="button" onClick={() => edit(index)}>
                      <Icon name="edit" />
                      แก้ไข
                    </button>
                    <button className="btn sm danger" type="button" onClick={() => remove(field)}>
                      <Icon name="trash" />
                      ลบ
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="tiny muted mt">
              {fields.length} จาก {data.max} ช่อง ลำดับในรายการนี้คือลำดับที่ทีมเห็นในหน้าเคส ช่องแบบตัวเลือกและแบบติ๊กใช้แยกดูในรายงานได้
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/** One field: its name, its kind (only when it is new), a choice's options (one a line) and whether it must be filled
    before the case is closed. */
function FieldForm({
  field,
  taken,
  categories,
  onSave,
}: {
  field?: CaseField;
  taken: string[];
  categories: string[];
  onSave: (field: Draft) => Promise<void>;
}) {
  const { closeModal } = useDialogs();
  const [kind, setKind] = useState<CaseFieldKind>(field?.kind ?? 'text');
  const [customer, setCustomer] = useState(Boolean(field?.customer));
  return (
    <Form
      className="case-field-form"
      onSubmit={async (values, form) => {
        const name = (values.name ?? '').trim().split(/\s+/).join(' ');
        if (taken.includes(name.toLowerCase())) throw new Error(`มีช่อง “${name}” อยู่แล้ว`);
        const options = kind === 'select' ? [...new Set((values.options ?? '').split('\n').map((o) => o.trim()).filter(Boolean))] : [];
        if (kind === 'select' && !options.length) throw new Error('ใส่ตัวเลือกอย่างน้อย 1 ข้อ บรรทัดละข้อ');
        if (options.length > FIELD_LIMITS.options) throw new Error(`ใส่ตัวเลือกได้ไม่เกิน ${FIELD_LIMITS.options} ข้อ`);
        if (options.some((o) => o.length > FIELD_LIMITS.option)) throw new Error(`แต่ละตัวเลือกยาวไม่เกิน ${FIELD_LIMITS.option} ตัวอักษร`);
        const required = (form.elements.namedItem('required') as HTMLInputElement).checked;
        const ask = (form.elements.namedItem('ask') as HTMLInputElement).checked;
        // None ticked: asked in every category.
        const picked = customer ? categories.filter((c) => (form.elements.namedItem(`category-${c}`) as HTMLInputElement | null)?.checked) : [];
        await onSave({ name, kind, options, required, ask, customer, categories: picked.length === categories.length ? [] : picked });
      }}
    >
      <TextField label="ชื่อช่อง" name="name" max={FIELD_LIMITS.name} defaultValue={field?.name} placeholder="เช่น หมายเลขอ้างอิง" autoFocus />
      {field ? (
        <div className="field">
          <span className="case-field-kind-label">ชนิด</span>
          <p className="case-field-kind">{fieldKindLabels[field.kind]}</p>
          <p className="tiny muted">เปลี่ยนชนิดของช่องที่มีอยู่แล้วไม่ได้ เพราะข้อมูลที่กรอกไว้จะอ่านผิด ถ้าต้องการชนิดอื่น ให้สร้างช่องใหม่</p>
        </div>
      ) : (
        <SelectField label="ชนิด" name="kind" value={kind} onChange={(e) => setKind(e.target.value as CaseFieldKind)}>
          {Object.entries(fieldKindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
      )}
      {kind === 'select' && (
        <TextArea
          label="ตัวเลือก"
          name="options"
          rows={5}
          max={FIELD_LIMITS.options * (FIELD_LIMITS.option + 1)}
          defaultValue={field?.options.join('\n')}
          hint="บรรทัดละ 1 ตัวเลือก ลบตัวเลือกออกแล้ว เคสที่เลือกไว้ยังเก็บค่าเดิม"
        />
      )}
      <label className="check">
        <input type="checkbox" name="required" defaultChecked={field?.required} />
        {kind === 'checkbox' ? 'ต้องติ๊กก่อนปิดเคส' : 'ต้องกรอกก่อนปิดเคส'}
      </label>
      <label className="check case-field-ask-check">
        <input type="checkbox" name="customer" checked={customer} onChange={(e) => setCustomer(e.target.checked)} />
        <span>
          ให้ลูกค้ากรอกตอนเริ่มแชท
          <small className="tiny muted">ขึ้นในแบบฟอร์มเริ่มแชท ทั้งลูกค้าที่เข้าสู่ระบบและไม่เข้าสู่ระบบ ไม่บังคับกรอก ค่าที่กรอกจะอยู่ในเคสที่เปิดจากแชทนั้น</small>
        </span>
      </label>
      {customer && categories.length > 0 && (
        <fieldset className="case-field-categories">
          <legend>ถามในหมวดเรื่อง (ไม่ติ๊กเลย เท่ากับทุกหมวด)</legend>
          {categories.map((c) => (
            <label key={c} className="check">
              <input type="checkbox" name={`category-${c}`} defaultChecked={Boolean(field?.categories?.includes(c))} />
              {c}
            </label>
          ))}
        </fieldset>
      )}
      <label className="check case-field-ask-check">
        <input type="checkbox" name="ask" defaultChecked={field?.ask} />
        <span>
          ให้ Chatbot ถามลูกค้า
          <small className="tiny muted">
            เมื่อ Chatbot ส่งต่อเจ้าหน้าที่ ระหว่างรอจะถามลูกค้าช่องที่ยังว่าง แล้วกรอกคำตอบให้ในหน้าเคส หยุดถามทันทีที่ทีมงานตอบลูกค้า
          </small>
        </span>
      </label>
      <FormActions label={field ? 'บันทึก' : 'เพิ่มช่อง'} onCancel={() => closeModal()} />
    </Form>
  );
}
