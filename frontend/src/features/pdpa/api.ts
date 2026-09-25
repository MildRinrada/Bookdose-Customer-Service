import { api } from '@/lib/api/client';

/* The platform console's PDPA tool (backend modules/pdpa): find a person in every organization, give them their data
   as a file, or erase it; each recorded. */

export const PDPA_PATH = '/api/platform/pdpa';

export type PdpaAccount = { id: string; name: string; email: string; phone: string; created_at: string; last_login_at: string | null };

export type PdpaRecord = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  contact_id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  created_at: string;
  account_id: string | null;
  guest: boolean;
  conversations: number;
  cases: number;
  messages: number;
  files: number;
  deletion_requested_at: string | null;
  erased: boolean;
};

export type PdpaSearch = { kind: 'email' | 'phone' | 'name'; subject: string; accounts: PdpaAccount[]; records: PdpaRecord[]; more: boolean };

export type PdpaOverview = {
  history: Array<{
    id: string;
    kind: 'export' | 'erase';
    subject: string;
    scope: { accounts: number; organizations: Array<{ organization: string; records: number; conversations?: number }> };
    reason: string;
    by_name: string;
    created_at: string;
  }>;
  requested: Array<{ tenant_id: string; tenant_name: string; contact_id: string; name: string; email: string; phone: string; requested_at: string; requested_by: string }>;
  confirm_word: string;
};

export type PdpaChoice = { query: string; accounts: string[]; records: Array<{ tenant_id: string; contact_id: string }> };

export const searchPerson = (query: string) => api<PdpaSearch>(`${PDPA_PATH}/search`, { query });
export const exportPerson = (body: PdpaChoice & { reason: string }) => api<Blob>(`${PDPA_PATH}/export`, body);
export const erasePerson = (body: PdpaChoice & { reason: string; confirm: string }) =>
  api<{ accounts: number; organizations: Array<{ organization: string; records: number; conversations: number }>; files: number }>(`${PDPA_PATH}/erase`, body);
