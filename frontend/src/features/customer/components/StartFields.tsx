'use client';

import type { StartField } from '../types';

/* แบบฟอร์มตามหมวดเรื่อง on both start forms (the signed-in customer's and the visitor's; backend tickets/fields.py):
   the case fields the organization asks for, for the category picked (a field with no categories is always asked).
   None is required: a form that cannot be sent is a customer who gives up. Inputs are named field_<id> and read back
   with startFieldValues. Markup: the forms' own .field and .check. */

const NAME = 'field_';

export function fieldsFor(fields: StartField[] | undefined, category: string): StartField[] {
  return (fields ?? []).filter((f) => !f.categories.length || f.categories.includes(category));
}

/** {field id: value} of what was filled in on the form, the category's fields only. */
export function startFieldValues(values: Record<string, string>, fields: StartField[] | undefined, category: string) {
  const found: Record<string, string> = {};
  for (const field of fieldsFor(fields, category)) {
    const value = (values[NAME + field.id] ?? '').trim();
    if (value) found[field.id] = value;
  }
  return found;
}

export function StartFields({ fields, category, idPrefix }: { fields: StartField[] | undefined; category: string; idPrefix: string }) {
  const shown = fieldsFor(fields, category);
  if (!shown.length) return null;
  return (
    <div className="start-fields">
      {shown.map((field) => {
        const id = `${idPrefix}-${field.id}`;
        const name = NAME + field.id;
        if (field.kind === 'checkbox')
          return (
            <label key={field.id} className="check" htmlFor={id}>
              <input id={id} name={name} type="checkbox" value="1" />
              <span>{field.name}</span>
            </label>
          );
        return (
          <div key={field.id} className="field">
            <label htmlFor={id}>{field.name} (ไม่บังคับ)</label>
            {field.kind === 'select' ? (
              <select id={id} name={name} defaultValue="">
                <option value="">ไม่ระบุ</option>
                {field.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={name}
                type={field.kind === 'date' ? 'date' : 'text'}
                inputMode={field.kind === 'number' ? 'decimal' : undefined}
                maxLength={field.kind === 'text' ? 200 : 30}
                autoComplete="off"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
