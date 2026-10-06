'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import type { ManageMessage } from '@/features/inbox';
import { editOwnMessage, pinChatMessage, takeBackOwnMessage } from '../api';

/* What the customer may do with the chat in front of them, through the ⋯ that shows when the pointer rests on a
   message (the team has the same menu on theirs: inbox/components/useManageMessages).

   Their own words: ยกเลิกข้อความ takes a message out of the chat, แก้ไขข้อความ corrects it. Only their own, only in a
   web chat they read from these pages, and only for a while after sending (backend conversations/service.py
   OWN_MINUTES, which refuses it afterwards and says so) - the team works from this thread, and a thread that can be
   rewritten long after the fact is one nobody can rely on.

   Either side's words may be pinned: the pins are shared, and show in the column beside the chat (PinnedMessages). */

/** As long as the server gives them (backend conversations/service.py OWN_MINUTES); the menu stops offering it then,
    and the server is the one that decides. */
const OWN_MINUTES = 15;

export function useOwnMessages({
  slug,
  conversationId,
  refresh,
}: {
  /** The portal the chat belongs to: "<org>", or "<org>/guest" for a visitor. */
  slug: string;
  conversationId: string;
  /** Read the chat again once something changed. */
  refresh: () => Promise<unknown>;
}): ManageMessage {
  const { openModal, closeModal, confirm } = useDialogs();
  const toast = useToast();
  const fresh = (at: string) => Date.now() - Date.parse(at) < OWN_MINUTES * 60_000;
  const own = (m: { kind: string; deleted_at?: string | null; created_at: string }) => m.kind === 'customer' && !m.deleted_at && fresh(m.created_at);
  return {
    removeLabel: 'ยกเลิกข้อความ',
    canEdit: own,
    canDelete: own,
    canPin: (m) => !m.deleted_at,
    onEdit: (m) =>
      openModal(
        'แก้ไขข้อความ',
        <Form
          data-form="edit-own-message"
          onSubmit={async (values) => {
            await editOwnMessage(slug, conversationId, m.id, values.body ?? '');
            closeModal(true);
            toast('แก้ไขข้อความแล้ว');
            await refresh();
          }}
        >
          <p className="notice">
            ข้อความจะขึ้นว่า <strong>แก้ไขแล้ว</strong> ให้ทีมงานเห็นด้วย · ถ้าทีมงานอ่านฉบับเดิมไปแล้ว พิมพ์บอกเพิ่มอีกข้อความจะชัดกว่า
          </p>
          <div className="field">
            <label htmlFor="own-edit-body">ข้อความ</label>
            <textarea id="own-edit-body" name="body" rows={6} maxLength={20000} required autoFocus defaultValue={m.body} />
          </div>
          <FormActions label="บันทึกการแก้ไข" onCancel={() => closeModal()} />
        </Form>,
      ),
    onDelete: (m) =>
      confirm({
        title: 'ยกเลิกข้อความ',
        message: 'ข้อความนี้จะหายจากแชทของคุณ · ทีมงานจะเห็นว่ามีข้อความถูกยกเลิก ถ้าอ่านไปแล้วควรพิมพ์บอกเพิ่ม',
        confirmLabel: 'ยกเลิกข้อความ',
        tone: 'danger',
        run: async () => {
          await takeBackOwnMessage(slug, conversationId, m.id);
          toast('ยกเลิกข้อความแล้ว');
          await refresh();
        },
      }),
    // The allowance (conversations/pins.py MOST) is the server's to keep: when it is used up it says so, and so do we.
    onPin: async (m, pinned) => {
      try {
        await pinChatMessage(slug, conversationId, m.id, pinned);
        toast(pinned ? 'ปักหมุดข้อความแล้ว · ดูได้ที่คอลัมน์ขวา' : 'เอาหมุดออกแล้ว');
        await refresh();
      } catch (problem) {
        toast((problem as Error).message, true);
      }
    },
  };
}
