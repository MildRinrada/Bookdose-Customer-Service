import { useMemo } from 'react';
import { api } from '@/lib/api/client';
import { useWork } from '@/lib/session';

/* ป้ายเคส (backend tickets/tags.py): the organization's own words for what a case is about. The list lives in the
   workspace settings (case_tags, JSON, in the owner's order); a case carries the ids. Staff only. */

export type CaseTag = { id: string; name: string };

/** The most tags one case may carry (backend tags.PER_CASE). */
export const TAGS_PER_CASE = 10;

export function parseCaseTags(value: unknown): CaseTag[] {
  try {
    const list: unknown = JSON.parse(String(value ?? '') || '[]');
    return Array.isArray(list) ? list.filter((t): t is CaseTag => typeof t?.id === 'string' && typeof t?.name === 'string') : [];
  } catch {
    return [];
  }
}

/** The organization's list, in its order. */
export function useCaseTags(): CaseTag[] {
  const saved = useWork().settings.case_tags;
  return useMemo(() => parseCaseTags(saved), [saved]);
}

/** The case's tags as {id, name}, in the list's order; ids no longer on the list are left out. */
export function tagsOf(ids: string[] | undefined, list: CaseTag[]): CaseTag[] {
  const have = new Set(ids ?? []);
  return list.filter((t) => have.has(t.id));
}

/** The case carries exactly these (anyone who may see the case). */
export const tagTicket = (id: string, tags: string[]) => api<{ tags: string[] }>(`/api/tickets/${id}/tags`, { tags });

/** The owner's list with how many cases carry each tag (เคสบริการ → จัดการป้าย). */
export const CASE_TAGS_PATH = '/api/settings/tags';
export type CaseTagsOverview = { tags: CaseTag[]; counts: Record<string, number>; max: number; per_case: number };
export const saveCaseTags = (tags: Array<{ id?: string; name: string }>) => api<CaseTagsOverview>(CASE_TAGS_PATH, { tags });
