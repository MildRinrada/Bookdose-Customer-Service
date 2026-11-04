import { api } from '@/lib/api/client';

/* The platform console's PDPA tool (backend modules/pdpa): find a person in every organization, give them their data
   as a file, or erase it; each recorded, and answered with a letter to the person (PdpaLetter). */

export const PDPA_PATH = '/api/platform/pdpa';

/** The letter of one logged request: what the API gives, and the page of its own that prints it. */
export const pdpaLetterPath = (id: string) => `${PDPA_PATH}/requests/${id}/letter`;
export const pdpaLetterPage = (id: string) => `/platform/pdpa/letter/${id}`;

/* The ways a request usually arrives; the history keeps the words picked (and the detail typed after them). The
   first ones are the person asking for their own data, which the letter answers as their right under the law; an
   order of an authority, or another way typed out, is answered without saying so. */
export const OWN_SOURCES = [
  'เจ้าของข้อมูลขอทางอีเมล',
  'เจ้าของข้อมูลขอทางแชทหรือเคส',
  'เจ้าของข้อมูลขอทางโทรศัพท์',
  'เจ้าของข้อมูลยื่นหนังสือหรือแบบฟอร์ม',
  'องค์กรแจ้งแทนเจ้าของข้อมูล',
];
export const OTHER = 'อื่น ๆ';
export const SOURCES = [...OWN_SOURCES, 'คำสั่งของหน่วยงานรัฐหรือตามกฎหมาย', OTHER];

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

/** What one export or erasure covered, counts only. Requests logged before the letter existed have records alone. */
export type PdpaScope = {
  accounts: number;
  organizations: Array<{ organization: string; records: number; conversations?: number; cases?: number; messages?: number; files?: number }>;
};

export type PdpaOverview = {
  history: Array<{
    id: string;
    kind: 'export' | 'erase';
    subject: string;
    scope: PdpaScope;
    reason: string;
    by_name: string;
    created_at: string;
  }>;
  requested: Array<{ tenant_id: string; tenant_name: string; contact_id: string; name: string; email: string; phone: string; requested_at: string; requested_by: string }>;
  confirm_word: string;
};

export type PdpaLetterData = {
  request: {
    id: string;
    reference: string;
    kind: 'export' | 'erase';
    /** The person as the log keeps them: masked (so***@example.com). */
    subject: string;
    subject_kind: 'email' | 'phone' | 'name';
    scope: PdpaScope;
    reason: string;
    /** YYYY-MM-DD; null for a request logged before the day was asked for. */
    received_on: string | null;
    created_at: string;
  };
  /** The provider as the legal documents name it (เอกสารกฎหมาย → ข้อมูลผู้ให้บริการ); '' where not filled in. */
  company: { name: string; address: string; email: string; phone: string; dpo: string };
};

export type PdpaChoice = { query: string; accounts: string[]; records: Array<{ tenant_id: string; contact_id: string }> };

/** What every act sends besides the choice: where the request came from, and the day it came (YYYY-MM-DD). */
type PdpaRequest = { reason: string; received_on: string };

export const searchPerson = (query: string) => api<PdpaSearch>(`${PDPA_PATH}/search`, { query });
export const exportPerson = (body: PdpaChoice & PdpaRequest) => api<Blob>(`${PDPA_PATH}/export`, body);
export const erasePerson = (body: PdpaChoice & PdpaRequest & { confirm: string }) =>
  api<{ accounts: number; organizations: Array<{ organization: string; records: number; conversations: number }>; files: number }>(`${PDPA_PATH}/erase`, body);
