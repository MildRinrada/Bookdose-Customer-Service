import { useMemo } from 'react';
import { api } from '@/lib/api/client';
import { date } from '@/lib/format';
import { useWork } from '@/lib/session';

/* ช่องข้อมูลเพิ่มเติมของเคส (backend tickets/fields.py): what the organization records about each case beyond its
   subject and status (an order number, a model, a branch). The list lives in the workspace settings (case_fields,
   JSON, in the owner's order); a case carries {field id: value}. A required field is filled before a member closes
   the case. Staff only. */

export type CaseFieldKind = 'text' | 'number' | 'date' | 'select' | 'checkbox';
/** ask: the chatbot asks the customer for it while they wait for a person (backend ai/gather.py). */
export type CaseField = { id: string; name: string; kind: CaseFieldKind; options: string[]; required: boolean; ask?: boolean };

export const fieldKindLabels: Record<CaseFieldKind, string> = {
  text: 'ข้อความ',
  number: 'ตัวเลข',
  date: 'วันที่',
  select: 'ตัวเลือกจากรายการ',
  checkbox: 'ติ๊กใช่หรือไม่ใช่',
};

/** The backend's limits (fields.py). */
export const FIELD_LIMITS = { fields: 20, name: 40, options: 30, option: 60, text: 200 };

const KINDS = Object.keys(fieldKindLabels);

export function parseCaseFields(value: unknown): CaseField[] {
  try {
    const list: unknown = JSON.parse(String(value ?? '') || '[]');
    return Array.isArray(list)
      ? list
          .filter((f): f is CaseField => typeof f?.id === 'string' && typeof f?.name === 'string' && KINDS.includes(f?.kind))
          .map((f) => ({ ...f, options: Array.isArray(f.options) ? f.options : [], required: Boolean(f.required) }))
      : [];
  } catch {
    return [];
  }
}

/** The organization's fields, in its order. */
export function useCaseFields(): CaseField[] {
  const saved = useWork().settings.case_fields;
  return useMemo(() => parseCaseFields(saved), [saved]);
}

/** A value in words: ticked is ใช่, a date in Thai, a number with separators; '' when there is none. */
export function fieldText(field: CaseField, value: string | undefined): string {
  if (!value) return '';
  if (field.kind === 'checkbox') return 'ใช่';
  if (field.kind === 'date') return date(`${value}T00:00:00`);
  if (field.kind === 'number') return Number(value).toLocaleString('th-TH', { maximumFractionDigits: 4 });
  return value;
}

/** The names of the required fields a case has no value in. */
export function missingToClose(fields: CaseField[], values: Record<string, string> | undefined): string[] {
  return fields.filter((f) => f.required && !values?.[f.id]).map((f) => f.name);
}

/** The case list's filter by a field: "<field id>:<value>", '*' for "has a value", '' after the colon for none. */
export function fieldFilterChoices(fields: CaseField[]): Array<{ value: string; label: string }> {
  return fields.flatMap((f) => {
    const none = { value: `${f.id}:`, label: `${f.name}: ${f.kind === 'checkbox' ? 'ไม่ใช่' : 'ยังไม่กรอก'}` };
    if (f.kind === 'checkbox') return [{ value: `${f.id}:1`, label: `${f.name}: ใช่` }, none];
    if (f.kind === 'select') return [...f.options.map((o) => ({ value: `${f.id}:${o}`, label: `${f.name}: ${o}` })), none];
    return [{ value: `${f.id}:*`, label: `${f.name}: มีข้อมูล` }, none];
  });
}

/** Whether a case's values pass a field filter (fieldFilterChoices). */
export function matchesFieldFilter(values: Record<string, string> | undefined, filter: string): boolean {
  const at = filter.indexOf(':');
  if (at < 1) return true;
  const value = values?.[filter.slice(0, at)] ?? '';
  const want = filter.slice(at + 1);
  return want === '*' ? value !== '' : value === want;
}

/** The owner's list with how many cases have a value in each field (ตั้งค่าองค์กร → ช่องข้อมูลของเคส). */
export const CASE_FIELDS_PATH = '/api/settings/fields';
export type CaseFieldsOverview = { fields: CaseField[]; counts: Record<string, number>; max: number };
export const saveCaseFields = (fields: Array<Omit<CaseField, 'id'> & { id?: string }>) => api<CaseFieldsOverview>(CASE_FIELDS_PATH, { fields });

/** Those fields of the case take these values ('' or false clears one); anyone who may see the case. */
export const fillTicketFields = (id: string, values: Record<string, string | boolean>) =>
  api<{ fields: Record<string, string> }>(`/api/tickets/${id}/fields`, { values });
