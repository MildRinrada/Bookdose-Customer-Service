'use client';

import { Icon } from '@/components/Icon';
import { SENSITIVE_LABELS, sensitiveKinds } from './sensitive';

/* The line under a customer's text box while what they typed looks like something they should not send (sensitive.ts):
   what it looks like, why, and one press to hide it. Sending stays possible: it is a warning, not a lock.
   Markup: styles/pages/chat-answers.css (sensitive-warning). */

export function SensitiveWarning({ text, onMask }: { text: string; onMask: () => void }) {
  const kinds = sensitiveKinds(text);
  if (!kinds.length) return null;
  return (
    <p className="sensitive-warning" role="alert">
      <Icon name="lock" />
      <span className="grow">
        {kinds.length === 1 && kinds[0] === 'number'
          ? 'ข้อความนี้มีตัวเลขยาวที่อาจเป็นเลขบัตรหรือเลขบัญชี ไม่ควรส่งในแชท ถ้าเป็นเลขคำสั่งซื้อหรือเลขพัสดุ ส่งได้ตามปกติ'
          : `ข้อความนี้ดูเหมือนมี${kinds.map((k) => SENSITIVE_LABELS[k]).join(' และ')} ทีมงานไม่จำเป็นต้องรู้ข้อมูลนี้ และไม่ควรส่งในแชท`}
      </span>
      <button type="button" className="btn sm" onClick={onMask}>
        ปิดเลขให้
      </button>
    </p>
  );
}
