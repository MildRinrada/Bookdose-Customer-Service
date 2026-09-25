'use client';

import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useCopyText } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { GUEST_SETTINGS_PATH, saveGuestSettings } from '@/features/guest/api';
import { widgetPositions, widgetThemes, websiteOrigin } from '@/features/guest/labels';
import type { GuestChatSettings, WidgetPosition, WidgetTheme } from '@/features/guest/types';
import { useApi, useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';

/* ตั้งค่าองค์กร → แชทบนเว็บไซต์ (admin): whether customers may chat without signing in, the public chat link with its QR,
   and the chat button for the organization's own website — on/off, the websites allowed to show it, where it sits,
   its colour (presets only) and title — with the code to paste into the website. GET/POST /api/settings/guest-chat.
   Markup: pages/guest-chat.css. */

const MAX_ORIGINS = 10;

export function GuestChatPanel() {
  const { data, error, refetch } = useApi<GuestChatSettings>(GUEST_SETTINGS_PATH);
  const work = useWork();
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <PageLoading />;
  // A save redraws the forms from what the server kept.
  return <GuestChatCards key={JSON.stringify([data.guest_chat, data.widget, data.members_first])} data={data} slug={work.tenant.slug} orgName={work.tenant.name} />;
}

function GuestChatCards({ data, slug, orgName }: { data: GuestChatSettings; slug: string; orgName: string }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const copyText = useCopyText();
  const { openModal } = useDialogs();
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const chatUrl = data.chat_url || `${origin}/support/${slug}/tickets/new`;
  const snippet = `<script src="${origin}/widget.js" data-org="${slug}" async></script>`;
  const w = data.widget;

  const [origins, setOrigins] = useState<string[]>(w.origins ?? []);
  const [position, setPosition] = useState<WidgetPosition>(w.position === 'left' ? 'left' : 'right');
  const [theme, setTheme] = useState<WidgetTheme>(widgetThemes.some((t) => t.value === w.theme) ? w.theme : 'charcoal');

  const save = async (patch: Partial<Pick<GuestChatSettings, 'guest_chat' | 'widget'>>, message: string) => {
    await saveGuestSettings({ guest_chat: patch.guest_chat ?? data.guest_chat, widget: patch.widget ?? data.widget });
    toast(message);
    await refresh(GUEST_SETTINGS_PATH);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast('คัดลอกโค้ดแล้ว');
    } catch {
      void copyText(snippet);
    }
  };

  return (
    <div className="guest-settings">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>แชทโดยไม่ต้องเข้าสู่ระบบ</h2>
            <p>ลูกค้าเปิดลิงก์แล้วพิมพ์คุยกับทีมได้ทันที ไม่ต้องสมัครสมาชิก ติดตามคำตอบได้ในเบราว์เซอร์เดิม หรือขอลิงก์ทางอีเมล SMS และ LINE</p>
          </div>
        </div>
        <Form
          className="card-body"
          onSubmit={async (_values, form) => {
            const enabled = (form.elements.namedItem('guest_enabled') as HTMLInputElement).checked;
            await save({ guest_chat: { enabled } }, enabled ? 'เปิดแชทโดยไม่ต้องเข้าสู่ระบบแล้ว' : 'ปิดแชทโดยไม่ต้องเข้าสู่ระบบแล้ว');
          }}
        >
          <label className="check">
            <input type="checkbox" className="switch" name="guest_enabled" defaultChecked={data.guest_chat.enabled} />
            ให้ลูกค้าเริ่มแชทได้โดยไม่ต้องเข้าสู่ระบบ
          </label>
          <p className="tiny muted">ปิดแล้ว ลูกค้าต้องเข้าสู่ระบบก่อนจึงจะเริ่มแชทได้ แชทที่เริ่มไว้แล้วยังอยู่ในกล่องข้อความตามเดิม</p>
          <div className="org-link-share mt">
            {data.chat_qr && (
              <figure className="org-qr">
                {/* A data: URL drawn by the server. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.chat_qr} alt="QR ลิงก์แชทขององค์กร" width={180} height={180} />
                <figcaption>สแกนเพื่อเริ่มแชท</figcaption>
              </figure>
            )}
            <div className="grow">
              <span className="muted">ลิงก์แชทขององค์กร · ใส่ในเว็บไซต์ อีเมล เอกสาร หรือพิมพ์ QR ไว้ที่หน้าร้าน</span>
              <a className="portal-url" href={chatUrl} target="_blank" rel="noopener">
                {chatUrl}
              </a>
              <div className="org-link-actions">
                <button type="button" className="btn subtle" onClick={() => void copyText(chatUrl)}>
                  <Icon name="link" />
                  คัดลอกลิงก์
                </button>
                {data.chat_qr && (
                  <button
                    type="button"
                    className="btn subtle"
                    onClick={() =>
                      openModal(
                        'QR ลิงก์แชทขององค์กร',
                        <div className="org-qr-large">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={data.chat_qr} alt="QR ลิงก์แชทขององค์กร" width={320} height={320} />
                          <p className="tiny muted">{chatUrl}</p>
                        </div>,
                      )
                    }
                  >
                    <Icon name="image" />
                    ดู QR ขนาดใหญ่
                  </button>
                )}
                <a className="btn subtle" href={`/support/${slug}/tickets/new`} target="_blank" rel="noopener">
                  <Icon name="chat" />
                  ทดลองดู
                </a>
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn primary" type="submit">
              บันทึก
            </button>
          </div>
        </Form>
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>คิวก่อนสำหรับสมาชิก</h2>
            <p>ลูกค้าที่เข้าสู่ระบบด้วยบัญชีลูกค้าได้ลำดับคิวก่อนลูกค้าที่แชทโดยไม่เข้าสู่ระบบ เป็นสิทธิพิเศษที่ชวนให้ลูกค้าสมัครสมาชิก</p>
          </div>
        </div>
        <Form
          className="card-body"
          onSubmit={async (_values, form) => {
            const on = (form.elements.namedItem('members_first') as HTMLInputElement).checked;
            await saveGuestSettings({ members_first: on });
            toast(on ? 'เปิดคิวก่อนสำหรับสมาชิกแล้ว' : 'ปิดคิวก่อนสำหรับสมาชิกแล้ว');
            await refresh(GUEST_SETTINGS_PATH);
          }}
        >
          <label className="check">
            <input type="checkbox" className="switch" name="members_first" defaultChecked={Boolean(data.members_first)} />
            ให้สมาชิกได้คิวก่อน
          </label>
          <p className="tiny muted">
            มีผลกับลำดับคิวที่ลูกค้าเห็น ปุ่มรับงานถัดไป และเคสที่รอคนรับ แชทของสมาชิกมีป้าย “สมาชิก” ในกล่องข้อความ ลูกค้าที่ไม่เข้าสู่ระบบยังได้รับบริการตามปกติ แค่รอหลังสมาชิก
          </p>
          <div className="form-actions">
            <button className="btn primary" type="submit">
              บันทึก
            </button>
          </div>
        </Form>
      </section>

      <section className="card mt">
        <div className="card-header">
          <div>
            <h2>ปุ่มแชทบนเว็บไซต์ขององค์กร</h2>
            <p>วางโค้ดบรรทัดเดียวในเว็บไซต์ แล้วลูกค้าจะเห็นปุ่มแชทที่มุมจอ เปิดคุยกับทีมได้โดยไม่ต้องออกจากเว็บไซต์</p>
          </div>
        </div>
        <Form
          className="card-body"
          onSubmit={async (values, form) => {
            const enabled = (form.elements.namedItem('widget_enabled') as HTMLInputElement).checked;
            if (enabled && !origins.length) throw new Error('กรุณาเพิ่มเว็บไซต์ที่อนุญาตอย่างน้อย 1 เว็บไซต์ ปุ่มแชทจะแสดงเฉพาะบนเว็บไซต์ในรายการ');
            await save(
              { widget: { enabled, origins, position, theme, title: (values.title ?? '').trim() } },
              enabled ? 'บันทึกปุ่มแชทบนเว็บไซต์แล้ว' : 'ปิดปุ่มแชทบนเว็บไซต์แล้ว',
            );
          }}
        >
          {!data.guest_chat.enabled && (
            <p className="notice warning">ต้องเปิด “ให้ลูกค้าเริ่มแชทได้โดยไม่ต้องเข้าสู่ระบบ” ด้านบนก่อน ปุ่มแชทจึงจะแสดงบนเว็บไซต์</p>
          )}
          <div className="form-grid">
            <label className="check span-2">
              <input type="checkbox" className="switch" name="widget_enabled" defaultChecked={w.enabled} />
              แสดงปุ่มแชทบนเว็บไซต์ขององค์กร
            </label>
            <OriginsField origins={origins} onChange={setOrigins} />
            <fieldset className="guest-choices">
              <legend>ตำแหน่งปุ่ม</legend>
              {widgetPositions.map((p) => (
                <label key={p.value} className="guest-choice">
                  <input type="radio" name="position" value={p.value} checked={position === p.value} onChange={() => setPosition(p.value)} />
                  {p.label}
                </label>
              ))}
            </fieldset>
            <fieldset className="guest-choices">
              <legend>สีของปุ่ม</legend>
              {widgetThemes.map((t) => (
                <label key={t.value} className="guest-choice">
                  <input type="radio" name="theme" value={t.value} checked={theme === t.value} onChange={() => setTheme(t.value)} />
                  <span className="theme-swatch" data-theme={t.value} aria-hidden="true" />
                  {t.label}
                </label>
              ))}
            </fieldset>
            <TextField
              className="span-2"
              label="ข้อความบนแถบหัวของแชท (ไม่บังคับ)"
              name="title"
              id="widget-title"
              max={60}
              required={false}
              defaultValue={w.title}
              placeholder={`แชทกับ ${orgName}`}
              hint="เว้นว่างเพื่อใช้ชื่อองค์กร"
            />
          </div>
          <div className="guest-snippet mt">
            <strong>โค้ดสำหรับวางในเว็บไซต์</strong>
            <pre>
              <code>{snippet}</code>
            </pre>
            <p className="tiny muted">วางไว้ก่อนแท็กปิด &lt;/body&gt; ในทุกหน้าที่ต้องการให้มีปุ่มแชท ปุ่มจะแสดงเมื่อเปิดใช้งานและเว็บไซต์อยู่ในรายการที่อนุญาต</p>
            <div className="guest-settings-actions">
              <button type="button" className="btn subtle" onClick={() => void copyCode()}>
                <Icon name="code" />
                คัดลอกโค้ด
              </button>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn primary" type="submit">
              บันทึกปุ่มแชท
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}

/** The websites allowed to show the chat button, as chips: type an address and press Enter (or "เพิ่ม"). */
function OriginsField({ origins, onChange }: { origins: string[]; onChange: (origins: string[]) => void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const add = () => {
    const value = text.trim();
    if (!value) return;
    const found = websiteOrigin(value);
    if (!found) {
      setProblem('ใส่เป็น https://ชื่อเว็บไซต์ เช่น https://www.example.com (ไม่มีหน้าย่อย) · ทดสอบในเครื่องใช้ http://localhost:พอร์ต ได้');
      return;
    }
    if (origins.includes(found)) {
      setProblem('มีเว็บไซต์นี้ในรายการแล้ว');
      return;
    }
    if (origins.length >= MAX_ORIGINS) {
      setProblem(`เพิ่มได้สูงสุด ${MAX_ORIGINS} เว็บไซต์`);
      return;
    }
    onChange([...origins, found]);
    setText('');
    setProblem('');
  };

  return (
    <div className="field span-2 guest-origins">
      <label htmlFor="widget-origin-input">เว็บไซต์ที่อนุญาตให้แสดงปุ่มแชท</label>
      <div className="guest-origin-box" onClick={() => input.current?.focus()}>
        {origins.map((o) => (
          <span key={o} className="guest-origin-chip">
            {o}
            <button
              type="button"
              aria-label={`เอา ${o} ออก`}
              onClick={(event) => {
                event.stopPropagation();
                onChange(origins.filter((x) => x !== o));
                input.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          id="widget-origin-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          value={text}
          placeholder={origins.length ? 'เพิ่มเว็บไซต์' : 'https://www.example.com'}
          aria-describedby="widget-origin-help"
          aria-invalid={problem ? true : undefined}
          onChange={(event) => {
            setText(event.target.value);
            if (problem) setProblem('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              // Enter adds the address; it must not send the form.
              event.preventDefault();
              add();
            } else if (event.key === 'Backspace' && !text && origins.length) {
              onChange(origins.slice(0, -1));
            }
          }}
        />
        <button type="button" className="btn sm" onClick={add} disabled={!text.trim()}>
          <Icon name="plus" />
          เพิ่ม
        </button>
      </div>
      {problem && (
        <span className="field-error" role="alert">
          {problem}
        </span>
      )}
      <p className="tiny muted" id="widget-origin-help">
        สูงสุด {MAX_ORIGINS} เว็บไซต์ · ต้องขึ้นต้นด้วย https:// · เว็บไซต์อื่นจะเปิดแชทในกรอบของหน้าเว็บไม่ได้
      </p>
    </div>
  );
}
