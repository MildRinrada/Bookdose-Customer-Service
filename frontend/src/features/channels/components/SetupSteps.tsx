'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import type { ChannelSetting, FacebookSetting } from '../types';

/* The way to a working channel, one step at a time, each ticked by what the system has actually seen - the account
   signed in, LINE pointing its webhook here, a first message received - rather than by the form being filled in.
   The first step not done yet says what to do. Markup: modules/channels (setup-steps). */

type Step = { label: string; done: boolean; hint?: ReactNode };

export function SetupSteps({ steps }: { steps: Step[] }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="setup-steps" aria-label="ขั้นตอนเชื่อมช่องทาง">
      {steps.map((step, index) => (
        <li key={step.label} className={step.done ? 'done' : index === current ? 'current' : ''}>
          <span className="setup-step-mark" aria-hidden="true">
            {step.done ? <Icon name="check" /> : index + 1}
          </span>
          <span className="setup-step-text">
            <span>{step.label}</span>
            {index === current && step.hint && <span className="tiny muted">{step.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

const signedIn = (c: { last_checked: string | null; last_error: string }) => Boolean(c.last_checked) && !c.last_error;

export function lineSteps(c: ChannelSetting): Step[] {
  const hook = c.webhook ?? {};
  const ours = Boolean(c.route_id && hook.endpoint?.endsWith(`/api/webhooks/line/${c.route_id}`));
  return [
    { label: 'ใส่แชนแนล ID และความลับแชนแนล แล้วกดบันทึก', done: c.credentials_configured, hint: 'ทั้งสองค่าอยู่หน้าเดียวกันใน LINE Developers' },
    {
      label: 'ระบบเข้าบัญชี LINE ได้',
      done: Boolean(c.config.identity) && signedIn(c),
      hint: c.last_error || 'กด "ทดสอบบัญชีที่บันทึกไว้" ด้านล่าง',
    },
    { label: 'เปิดใช้ช่องทางนี้', done: c.enabled, hint: 'เปิดสวิตช์ "เปิดใช้ช่องทาง" แล้วกดบันทึก' },
    {
      label: 'วาง Webhook URL ใน LINE Developers และเปิด Use webhook',
      done: (ours && Boolean(hook.active)) || Boolean(c.last_received),
      hint: !hook.endpoint
        ? 'คัดลอก Webhook URL ด้านล่างไปวางในหน้า Messaging API แล้วกด "ทดสอบบัญชีที่บันทึกไว้" อีกครั้งเพื่อให้ระบบตรวจ'
        : !ours
          ? `ตอนนี้ LINE ส่งข้อความไปที่ ${hook.endpoint} ไม่ใช่ Webhook URL ของระบบนี้`
          : 'วาง URL ถูกแล้ว แต่ยังไม่ได้เปิด Use webhook ใน LINE Developers',
    },
    {
      label: 'ส่งข้อความจาก LINE ในมือถือหาบัญชีนี้ และระบบได้รับแล้ว',
      done: Boolean(c.last_received),
      hint: 'ยังไม่มีข้อความเข้ามา ลองส่งข้อความหาบัญชี LINE นี้ แล้วรอสักครู่',
    },
  ];
}

export function emailSteps(c: ChannelSetting): Step[] {
  return [
    {
      label: 'ใส่อีเมลรับเรื่องและรหัสผ่าน (หรือเชื่อมบัญชี Google / Microsoft) แล้วกดบันทึก',
      done: c.credentials_configured,
      hint: 'Gmail และ Outlook ที่เปิดยืนยันตัวตน 2 ขั้น ต้องใช้ App Password หรือเชื่อมด้วย OAuth',
    },
    { label: 'ระบบเข้ากล่องอีเมลได้', done: signedIn(c), hint: c.last_error || 'กด "ทดสอบบัญชีที่บันทึกไว้" ด้านล่าง' },
    { label: 'เปิดใช้ช่องทางนี้', done: c.enabled, hint: 'เปิดสวิตช์ "เปิดใช้ช่องทาง" แล้วกดบันทึก' },
    {
      label: `ส่งอีเมลจากอีเมลอื่นมาที่ ${c.config.address || 'อีเมลรับเรื่อง'} และระบบได้รับแล้ว`,
      done: Boolean(c.last_received),
      hint: 'ยังไม่มีอีเมลเข้ามา ระบบตรวจกล่องตามรอบที่ตั้งไว้ หรือกด "ตรวจอีเมลรอบถัดไปทันที"',
    },
  ];
}

/** Instagram DMs through the Page: its account found, turned on here, Meta sending its DMs, and one received. */
export function instagramSteps(c: FacebookSetting): Step[] {
  const received = Boolean(c.instagram.last_received);
  return [
    {
      label: 'ผูกบัญชี Instagram แบบมืออาชีพกับเพจนี้ แล้วบันทึกโดยเปิดรับ DM Instagram',
      done: Boolean(c.config.instagram_id),
      hint: 'ผูกได้ในการตั้งค่าเพจ Facebook หรือในแอป Instagram (บัญชีต้องเป็นแบบธุรกิจหรือครีเอเตอร์) และ Page Access Token ต้องมีสิทธิ์ instagram_manage_messages',
    },
    { label: 'เปิดใช้ช่องทาง Facebook', done: c.enabled, hint: 'DM Instagram ใช้การเชื่อมต่อเดียวกับเพจ ต้องเปิดช่องทาง Facebook ด้วย' },
    {
      label: 'ใน Meta App ตั้ง Webhooks ของ Instagram ด้วย Callback URL เดิม แล้วติ๊ก messages',
      done: received,
      hint: 'ในแอป Instagram ต้องเปิด การตั้งค่า → ความเป็นส่วนตัว → ข้อความ → อนุญาตให้เข้าถึงข้อความ ด้วย ระบบยืนยันขั้นนี้ได้เมื่อ DM แรกเข้ามา',
    },
    { label: 'ส่ง DM หาบัญชีนี้จาก Instagram บัญชีอื่น และระบบได้รับแล้ว', done: received, hint: 'ยังไม่มี DM เข้ามา ลองส่งจากบัญชีส่วนตัว' },
  ];
}

export function facebookSteps(c: FacebookSetting): Step[] {
  return [
    { label: 'ใส่ Page Access Token และ App Secret แล้วกดบันทึก', done: c.credentials_configured, hint: 'คัดลอกจาก Meta App ที่เปิด Messenger ไว้' },
    { label: 'ระบบเข้าเพจได้', done: Boolean(c.config.page_id) && signedIn(c), hint: c.last_error || 'กด "ทดสอบ" ด้านล่าง' },
    { label: 'เปิดใช้ช่องทางนี้', done: c.enabled, hint: 'เปิดสวิตช์ "เปิดใช้ช่องทาง" แล้วกดบันทึก' },
    {
      label: 'วาง Callback URL และ Verify Token ใน Meta App แล้วติ๊ก messages',
      done: Boolean(c.last_received),
      hint: 'ระบบยืนยันขั้นนี้ได้เมื่อข้อความแรกจากเพจเข้ามา',
    },
    {
      label: 'ส่งข้อความหาเพจจาก Messenger และระบบได้รับแล้ว',
      done: Boolean(c.last_received),
      hint: 'ยังไม่มีข้อความเข้ามา ลองส่งข้อความหาเพจจากบัญชี Facebook อื่น',
    },
  ];
}
