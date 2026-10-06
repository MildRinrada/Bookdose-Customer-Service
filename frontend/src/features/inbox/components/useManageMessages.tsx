'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { useStaffUser } from '@/lib/session';
import type { Workspace } from '@/lib/types';
import { CONVERSATION_PREFIXES, deleteMessage, editMessage, pinMessage } from '../api';
import type { Conversation } from '../types';
import type { ManageMessage } from './MessageThread';
import { thaiSide } from './MessageTranslation';

/** What the thread hands the menu: a message as the thread knows it. */
type Item = Parameters<ManageMessage['canEdit']>[0];

/* Correcting or taking back a message that went to the wrong chat.

   Only where it can honestly be taken back: a web chat, which the customer reads from our own pages, and an internal
   note, which never left at all. A reply delivered by LINE, email or Facebook is already in the customer's hands -
   the server refuses those, and the ⋯ is not offered for them, because a menu that only ever says no is worse than
   no menu.

   Who: the writer corrects their own words; the writer or the organization's owner takes a message back, which is
   what an owner is for when something went to the wrong place and the writer has gone home.

   ปักหมุดข้อความ (conversations/pins.py) is not a correction and belongs to nobody in particular: anyone on the team
   may pin any message of a web chat, including an internal note, and the pins show in the column beside the chat. */

const RECALLABLE = new Set(['web']);

export function useManageMessages(conversation: Conversation, work: Workspace): ManageMessage | undefined {
  const { openModal, closeModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const me = useStaffUser().id;
  // A platform admin looking in on a support access may read everything and change nothing.
  if (work.read_only) return undefined;

  const mine = (m: Item) => Boolean(m.author_id) && m.author_id === me;
  const staffWrote = (m: Item) => m.kind === 'reply' || m.kind === 'note';
  // A note goes nowhere; a reply can only be taken back on the channels the customer reads from our own pages.
  const reachable = (m: Item) => m.kind === 'note' || RECALLABLE.has(conversation.channel);
  const ok = (m: Item) => staffWrote(m) && reachable(m) && !m.deleted_at;

  return {
    // A reply held while it is translated (ai/translate.py) is corrected once it has gone.
    canEdit: (m) => ok(m) && mine(m) && !(m.translation?.direction === 'out' && m.translation.status === 'pending'),
    canDelete: (m) => ok(m) && (mine(m) || work.role === 'admin'),
    canPin: (m) => !m.deleted_at && (m.kind === 'note' || RECALLABLE.has(conversation.channel)),
    // The allowance (conversations/pins.py MOST) is the server's to keep: when it is used up it says so, and so do we.
    onPin: async (m, pinned) => {
      try {
        await pinMessage(conversation.id, m.id, pinned);
        toast(pinned ? 'ปักหมุดข้อความแล้ว · ดูได้ในคอลัมน์ขวา' : 'เอาหมุดออกแล้ว');
        await refresh(...CONVERSATION_PREFIXES);
      } catch (problem) {
        toast((problem as Error).message, true);
      }
    },
    onEdit: (m) =>
      openModal(
        'แก้ไขข้อความ',
        <Form
          data-form="edit-message"
          onSubmit={async (values) => {
            await editMessage(conversation.id, m.id, values.body ?? '');
            closeModal(true);
            toast('แก้ไขข้อความแล้ว · ข้อความจะขึ้นว่า แก้ไขแล้ว ให้ทั้งทีมและลูกค้าเห็น');
            await refresh(...CONVERSATION_PREFIXES);
          }}
        >
          <p className="notice">
            ลูกค้าเห็นข้อความที่แก้แล้วทันที และจะมีคำว่า <strong>แก้ไขแล้ว</strong> กำกับไว้ · ถ้าลูกค้าอ่านฉบับเดิมไปแล้ว การแก้ไขไม่ได้ลบสิ่งที่เขาอ่านไปจากความทรงจำ
            เรื่องใหญ่ควรพิมพ์ข้อความใหม่ชี้แจงด้วย
          </p>
          <div className="field">
            <label htmlFor="edit-body">ข้อความ</label>
            <textarea id="edit-body" name="body" rows={6} maxLength={20000} required autoFocus defaultValue={thaiSide(m.translation) ?? m.body} />
          </div>
          <FormActions label="บันทึกการแก้ไข" onCancel={() => closeModal()} />
        </Form>,
      ),
    onDelete: (m) =>
      confirm({
        title: 'ลบข้อความ',
        message:
          m.kind === 'note'
            ? 'บันทึกภายในนี้จะหายจากบทสนทนา · ทีมจะเห็นว่ามีข้อความถูกลบและใครเป็นคนลบ'
            : 'ลูกค้าจะไม่เห็นข้อความนี้อีก · ทีมจะเห็นว่ามีข้อความถูกลบและใครเป็นคนลบ ถ้าลูกค้าอ่านไปแล้วควรพิมพ์ชี้แจงเพิ่ม',
        confirmLabel: 'ลบข้อความ',
        tone: 'danger',
        run: async () => {
          await deleteMessage(conversation.id, m.id);
          toast('ลบข้อความแล้ว');
          await refresh(...CONVERSATION_PREFIXES);
        },
      }),
  };
}