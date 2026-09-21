import { api } from '@/lib/api/client';

/* The overview's board (backend/modules/board): handover notes the whole organization reads, and the member's own
   to-dos. Every write answers the board as it now is. */

export const BOARD_PATH = '/api/board';

export type HandoverNote = { id: string; user_id: string; author_name: string; body: string; created_at: string; mine: boolean; removable: boolean };
export type Todo = { id: string; body: string; due_at: string | null; done_at: string | null; created_at: string };
export type Board = { handover: HandoverNote[]; todos: Todo[]; handover_days: number };

export const addNote = (kind: 'handover' | 'todo', body: string, due_at?: string | null) => api<Board>(BOARD_PATH, { kind, body, due_at: due_at ?? null });
export const setTodoDone = (id: string, done: boolean) => api<Board>(`${BOARD_PATH}/${id}`, { done }, 'PATCH');
export const removeNote = (id: string) => api<Board>(`${BOARD_PATH}/${id}`, undefined, 'DELETE');
