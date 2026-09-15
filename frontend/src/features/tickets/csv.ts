'use client';

import { useCallback } from 'react';
import { priorityLabels, statusLabels } from '@/lib/labels';
import { useMemberName } from '@/lib/session';
import type { TicketRow } from './types';

/* Cases already on screen as a CSV file, built in the browser (selected cases, a report's list). Excel reads the BOM
   as UTF-8; cells a spreadsheet would run as formulas get a leading '. */

type CsvTicket = Pick<TicketRow, 'number' | 'subject' | 'contact_name' | 'status' | 'priority' | 'assignee_id' | 'created_at'>;

export function ticketsCSV(tickets: CsvTicket[], memberName: (id: string | null | undefined) => string): string {
  const rows = [
    ['Case', 'Subject', 'Customer', 'Status', 'Priority', 'Assignee', 'Created at'],
    ...tickets.map((t) => [
      'BD-' + t.number,
      t.subject,
      t.contact_name,
      statusLabels[t.status],
      priorityLabels[t.priority],
      memberName(t.assignee_id),
      t.created_at,
    ]),
  ];
  return (
    '﻿' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value ?? '');
            if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}

/** Save the cases as `filename` (the old downloadTicketsCSV; memberName names the assignee column). */
export function downloadTicketsCSV(tickets: CsvTicket[], filename: string, memberName: (id: string | null | undefined) => string) {
  const url = URL.createObjectURL(new Blob([ticketsCSV(tickets, memberName)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The same with the workspace's member names: const save = useDownloadTicketsCSV(); save(tickets, 'x.csv'). */
export function useDownloadTicketsCSV() {
  const memberName = useMemberName();
  return useCallback((tickets: CsvTicket[], filename: string) => downloadTicketsCSV(tickets, filename, memberName), [memberName]);
}
