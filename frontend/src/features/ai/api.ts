import { api } from '@/lib/api/client';
import type { AiJob, AiSettings } from './types';

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

export function testAiConnection() {
  return api<{ id: string; status: string }>('/api/ai/test', {});
}

/** The customer asks for a person instead of the chatbot (portal). */
export function portalHandoff(slug: string) {
  return api<{ ok: true }>(`/api/public/${slug}/handoff`, {});
}

/** Wait for a job to finish (1.5 s between checks, 80 checks at most). `alive` false stops waiting with the old
    "moved to another page" reason. A job still running after that is returned as running. */
export async function waitForAiJob(id: string, alive: () => boolean): Promise<AiJob> {
  for (let i = 0; i < 80; i++) {
    if (!alive()) throw new Error('เปลี่ยนหน้าแล้ว คุณกลับมากดร่างคำตอบใหม่ได้');
    const job = await getAiJob(id);
    if (!['pending', 'running'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { id, status: 'running', result: {}, error: '' };
}
