'use client';

import { relative } from '@/lib/format';
import type { AskedMember, LastMember } from '../types';

/* ขอคนเดิม (backend portal/same_member.py), on the start forms of the signed-in customer and the visitor: within 30
   days of a finished case, the customer may ask for the member who looked after them, named as the thank-you card
   names them. When that member is here the chat goes to them; when not, to the team as usual. Markup: the card of
   "จำแชทไว้ในเครื่องนี้" on the visitor's form (styles/pages/guest-chat.css start-remember). */

/** The tick box, sent as `same_member` ("on" when ticked); nothing when there is nobody to ask for. */
export function SameMemberChoice({ member, id }: { member: LastMember | null | undefined; id: string }) {
  if (!member) return null;
  return (
    <label className="start-remember" htmlFor={id}>
      <input id={id} type="checkbox" name="same_member" />
      <span>
        <strong>ให้ {member.name} ดูแลต่อ</strong>
        <small>เคยดูแลเรื่องของคุณ {relative(member.finished_at)} ถ้าตอนนี้ไม่อยู่ ระบบส่งถึงทีมงานตามปกติ</small>
      </span>
    </label>
  );
}

/** What the customer is told once the chat started: whether the member took it. */
export function askedMemberText(asked: AskedMember | null | undefined): string {
  if (!asked) return '';
  return asked.given ? `ส่งถึง ${asked.name} แล้ว` : `${asked.name} ไม่อยู่ตอนนี้ ทีมงานคนอื่นจะดูแลให้`;
}
