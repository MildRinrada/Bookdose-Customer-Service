import { api } from '@/lib/api/client';
import type { LegalDocument, LegalKey } from './types';

/* Endpoints of backend/modules/legal/routes.py: the public documents, and the console that edits them. */

export const LEGAL_PATH = '/api/platform/legal';

/** The published document. The customer notice says {{องค์กร}}; the window puts the organization's name in. */
export const legalPath = (key: LegalKey) => `/api/legal/${key}`;

export const saveLegalDraft = (key: LegalKey, body: { title: string; body: string }) => api<{ ok: true }>(`${LEGAL_PATH}/${key}/draft`, body);

export const publishLegal = (key: LegalKey) => api<{ version: string }>(`${LEGAL_PATH}/${key}/publish`, {});

export const legalVersionPath = (key: LegalKey, version: string) => `${LEGAL_PATH}/${key}/versions/${encodeURIComponent(version)}`;

export type { LegalDocument };
