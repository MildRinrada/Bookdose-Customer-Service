'use client';

import { useCallback } from 'react';
import { priorityLabels, statusLabels } from '@/lib/labels';
import { useMemberName } from '@/lib/session';
import { useCaseFields, type CaseField } from './fields';
import type { TicketRow } from './types';

/* Cases already on screen as a CSV file, built in the browser (selected cases, a report's list). Excel reads the BOM
   as UTF-8; cells a spreadsheet would run as formulas get a leading '. */

type CsvTicket = Pick<TicketRow, 'number' | 'subject' | 'contact_name' | 'status' | 'priority' | 'assignee_id' | 'created_at' | 'fields'>;

/** Rows as CSV text Excel opens as UTF-8. A negative number stays a number; any other text a spreadsheet would run
    as a formula gets a leading '. */
export function csvText(rows: unknown[][]): string {
  return (
    '﻿' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value ?? '');
            if (/^[\s]*[=+@-]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}

/** Save CSV text as `filename`. */
export function saveCSVFile(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The cases as CSV; each of the organization's case fields (`fields`) is a column after the fixed ones (ticked is ใช่,
    as in the server's export). */
export function ticketsCSV(tickets: CsvTicket[], memberName: (id: string | null | undefined) => string, fields: CaseField[] = []): string {
  return csvText([
    ['Case', 'Subject', 'Customer', 'Status', 'Priority', 'Assignee', 'Created at', ...fields.map((f) => f.name)],
    ...tickets.map((t) => [
      'BD-' + t.number,
      t.subject,
      t.contact_name,
      statusLabels[t.status],
      priorityLabels[t.priority],
      memberName(t.assignee_id),
      t.created_at,
      ...fields.map((f) => (t.fields?.[f.id] ? (f.kind === 'checkbox' ? 'ใช่' : t.fields[f.id]) : '')),
    ]),
  ]);
}

/** Save the cases as `filename` (the old downloadTicketsCSV; memberName names the assignee column). */
export function downloadTicketsCSV(tickets: CsvTicket[], filename: string, memberName: (id: string | null | undefined) => string, fields: CaseField[] = []) {
  saveCSVFile(ticketsCSV(tickets, memberName, fields), filename);
}

/** The same with the workspace's member names and case fields: const save = useDownloadTicketsCSV(); save(tickets, 'x.csv'). */
export function useDownloadTicketsCSV() {
  const memberName = useMemberName();
  const fields = useCaseFields();
  return useCallback((tickets: CsvTicket[], filename: string) => downloadTicketsCSV(tickets, filename, memberName, fields), [memberName, fields]);
}
