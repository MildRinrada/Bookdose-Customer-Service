import { api, ApiError } from '@/lib/api/client';
import type { AiJob, AiSettings, AssistantFeedback, AssistantGathered, AssistantRunResult } from './types';

/* AI endpoints (backend/modules/ai/routes.py and the conversation's ai-draft / ai-mode). */

export const AI_SETTINGS_PATH = '/api/ai/settings';

export function requestAiDraft(conversationId: string) {
  return api<{ id: string; status: string }>(`/api/conversations/${conversationId}/ai-draft`, {});
}

export function setAiMode(conversationId: string, mode: 'human' | 'bot') {
  return api<{ ok: true }>(`/api/conversations/${conversationId}/ai-mode`, { mode });
}

export function getAiJob(jobId: string) {
  return api<AiJob>(`/api/ai/jobs/${jobId}`);
}

export function saveAiSettings(body: Record<string, unknown>) {
  return api<AiSettings>(AI_SETTINGS_PATH, body, 'PATCH');
}

/** ผู้ช่วย AI: a question with the last turns of this chat and the case or chat open on screen; the answer is a job
    like a reply draft. */
export function askAssistant(
  question: string,
  history: { role: 'user' | 'assistant'; text: string }[],
  page: { ticket_id?: string; conversation_id?: string } | null,
) {
  return api<{ id: string; status: string; gathered?: AssistantGathered }>('/api/ai/assistant', { question, history, ...(page ? { page } : {}) });
}

/** หยุดรอ: stop waiting for a question; `started` says whether the AI had begun on it. */
export function stopAssistant(jobId: string) {
  return api<{ status: string; started: boolean }>(`/api/ai/assistant/${jobId}`, undefined, 'DELETE');
}

/** ทำเลย: the picked actions of one answer, with the texts the member edited (by index). */
export function runAssistantActions(jobId: string, picked: number[], texts: Record<number, string>) {
  return api<{ results: AssistantRunResult[] }>(`/api/ai/assistant/${jobId}/run`, { picked, texts });
}

/** ถูกใจ / ไม่ถูกใจ under one of the member's answers ('' takes it back); a reason and comment go with ไม่ถูกใจ. */
export function rateAssistantAnswer(jobId: string, body: { rating: AssistantFeedback['rating']; reason?: string; comment?: string }) {
  return api<AssistantFeedback>(`/api/ai/assistant/${jobId}/feedback`, body);
}

export function testAiConnection() {
  return api<{ id: string; status: string }>('/api/ai/test', {});
}

/** The customer asks for a person instead of the chatbot (portal). */
export function portalHandoff(slug: string, conversationId: string) {
  return api<{ ok: true }>(`/api/public/${slug}/handoff`, {}, 'POST', { conversation: conversationId });
}

/** What a caller hears while waiting: every check's answer, and each failed check in a row (the server restarting, the
    network dropping) before it is tried again. */
export type AiJobWatch = { onCheck?: (job: AiJob) => void; onOffline?: (failures: number, most: number) => void };

const OFFLINE_TRIES = 5;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for a job to finish (1.5 s between checks, 220 checks at most: an n8n workflow on a local model may take up
    to 5 minutes). `alive` false stops waiting with the old "moved to another page" reason. A moment without the server
    is tried again (3 s apart, OFFLINE_TRIES times) rather than ending the wait: the job goes on without the page. A
    job still running after all that is returned as running. */
export async function waitForAiJob(id: string, alive: () => boolean, watch: AiJobWatch = {}): Promise<AiJob> {
  let failures = 0;
  for (let i = 0; i < 220; i++) {
    if (!alive()) throw new Error('เปลี่ยนหน้าแล้ว คุณกลับมากดร่างคำตอบใหม่ได้');
    let job: AiJob;
    try {
      job = await getAiJob(id);
      failures = 0;
    } catch (error) {
      const unreachable = error instanceof ApiError && (error.status === 0 || error.status >= 500);
      if (!unreachable || ++failures > OFFLINE_TRIES) throw error;
      watch.onOffline?.(failures, OFFLINE_TRIES);
      await pause(3000);
      continue;
    }
    watch.onCheck?.(job);
    if (!['pending', 'running'].includes(job.status)) return job;
    await pause(1500);
  }
  return { id, status: 'running', result: {}, error: '' };
}
