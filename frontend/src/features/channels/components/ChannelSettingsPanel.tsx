'use client';

import type { ChangeEvent } from 'react';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useRunAction } from '@/components/ui/actions';
import { NumberField, SelectField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { TeamOptions } from '@/components/ui/pickers';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { channelNames } from '@/lib/labels';
import { useApi, useInvalidate } from '@/lib/query';
import { CHANNEL_SETTINGS_PREFIXES, CHANNELS_PATH, saveChannel, startEmailOAuth, syncEmail, testChannel } from '../api';
import { deliveryNames, emailAuthModes, smtpPorts } from '../labels';
import type { ChannelSetting, OutboxCount } from '../types';
import { ChannelField } from '../util';

/* The LINE and Email settings (settings page, LINE / Email / Facebook tab; admins only): credentials, the team that
   receives new conversations, on/off, chatbot, a login test, the webhook URL and the delivery queue.
   Markup: modules/channels/channel-settings, channel-field, email-oauth-fields, outbox-badge. */

const origin = () => (typeof window === 'undefined' ? '' : window.location.origin);

export function ChannelSettingsPanel() {
  const channels = useApi<ChannelSetting[]>(CHANNELS_PATH);
  if (channels.error) return <ErrorState error={channels.error} onRetry={() => void channels.refetch()} />;
  if (!channels.data) return <PageLoading />;
  return (
    <>
      {channels.data.map((c) => (
        <ChannelCard key={c.kind} c={c} />
      ))}
    </>
  );
}

export function OutboxBadges({ outbox }: { outbox: OutboxCount[] }) {
  return (
    <div className="flex wrap">
      {outbox.map((o) => (
        <span key={o.status} className="badge">
          {deliveryNames[o.status] || o.status} {o.count}
        </span>
      ))}
    </div>
  );
}

function ChannelCard({ c }: { c: ChannelSetting }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const k = c.kind;
  const v = c.config;
  const name = channelNames[k];
  const webhookURL = k === 'line' && c.route_id ? `${origin()}/api/webhooks/line/${c.route_id}` : '';

  const action = (kind: 'test' | 'sync') =>
    run(async () => {
      if (kind === 'test') await testChannel(k);
      else await syncEmail();
      toast(kind === 'test' ? 'เชื่อมต่อบัญชีสำเร็จ' : 'กำหนดให้ตรวจอีเมลรอบถัดไปแล้ว');
      await refresh(...CHANNEL_SETTINGS_PREFIXES);
    });

  return (
    <section className="card mt" id={`channel-${k}`}>
      <div className="card-header">
        <h2>{name} · เชื่อมบัญชีจริง</h2>
        <span className="badge">{c.credentials_configured ? 'บันทึกข้อมูลเชื่อมต่อแล้ว' : 'ยังไม่มีข้อมูลเชื่อมต่อ'}</span>
      </div>
      <Form
        // After saving, the form shows the saved settings again and the secret boxes start empty.
        key={JSON.stringify([c.enabled, c.config, c.credentials_configured, c.route_id])}
        className="card-body"
        data-form="channel-settings"
        data-kind={k}
        onSubmit={async (values, form) => {
          const box = (key: string) => form.elements.namedItem(key) as HTMLInputElement | null;
          const data: Record<string, unknown> = { ...values };
          for (const key of ['chatbot_enabled', 'groups_enabled', 'group_chatbot_enabled']) {
            const input = box(key);
            if (input) data[key] = input.checked;
          }
          data.enabled = box('enabled')?.checked ?? false;
          data.remove_credentials = box('remove_credentials')?.checked ?? false;
          if (k === 'email') {
            data.smtp_port = Number(data.smtp_port);
            data.poll_seconds = Number(data.poll_seconds);
          }
          await saveChannel(k, data);
          toast('บันทึกช่องทางแล้ว');
          await refresh(...CHANNEL_SETTINGS_PREFIXES);
        }}
      >
        <div className="notice mb">
          {k === 'line' &&
            'รับข้อความส่วนตัวและกลุ่มจาก LINE OA ตอบข้อความ รูป และลิงก์เอกสารผ่านบัญชีเดิม ต้องเปิดโปรแกรมไว้และใช้ Webhook URL แบบ HTTPS ที่ LINE เข้าถึงได้'}
          {k === 'email' &&
            'รับอีเมลผ่าน IMAP (TLS 993) และส่งผ่าน SMTP ใช้รหัสผ่านหรือ App Password เดียวกันทั้งสองบริการ เริ่มรับเฉพาะอีเมลใหม่หลังเปิดครั้งแรก เลือกใช้รหัสผ่าน หรือ OAuth ของ Google / Microsoft ได้'}
        </div>
        <div className="form-grid">
          {k === 'line' && (
            <>
              <ChannelField kind={k} name="channel_secret" label="Channel Secret" type="password" />
              <ChannelField kind={k} name="access_token" label="Channel Access Token" type="password" />
              <ChannelField kind={k} name="public_base_url" label="โดเมน HTTPS สำหรับส่งไฟล์" type="url" value={v.public_base_url || ''} />
              <label className="check">
                <input name="groups_enabled" type="checkbox" className="switch" defaultChecked={Boolean(v.groups_enabled)} />
                รับและตอบในกลุ่ม LINE
              </label>
              <label className="check">
                <input name="group_chatbot_enabled" type="checkbox" className="switch" defaultChecked={Boolean(v.group_chatbot_enabled)} />
                ให้ AI ตอบในกลุ่มเมื่อเรียก /bookdose หรือเมนชัน
              </label>
            </>
          )}
          {k === 'email' && (
            <>
              <EmailOAuthFields c={c} />
              <ChannelField kind={k} name="address" label="อีเมลรับเรื่อง" type="email" value={v.address || ''} required />
              <ChannelField kind={k} name="username" label="ชื่อผู้ใช้ IMAP / SMTP" value={v.username || ''} />
              <ChannelField kind={k} name="password" label="รหัสผ่าน / App Password" type="password" />
              <ChannelField kind={k} name="imap_host" label="เซิร์ฟเวอร์ IMAP" value={v.imap_host || ''} required />
              <ChannelField kind={k} name="smtp_host" label="เซิร์ฟเวอร์ SMTP" value={v.smtp_host || ''} required />
              <SelectField id="email-smtp_port" label="การเชื่อมต่อ SMTP" name="smtp_port" defaultValue={String(v.smtp_port || 465)}>
                {Object.entries(smtpPorts).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>
              <NumberField id="email-poll_seconds" label="ตรวจอีเมลทุก (วินาที)" name="poll_seconds" min={30} max={600} defaultValue={v.poll_seconds || 60} />
            </>
          )}
          <SelectField id={`${k}-team`} label="ทีมรับเรื่องใหม่" name="team_id" defaultValue={v.team_id}>
            <TeamOptions />
          </SelectField>
          <label className="check">
            <input name="enabled" type="checkbox" className="switch" defaultChecked={c.enabled} />
            เปิดรับและส่ง {name}
          </label>
          <label className="check">
            <input name="chatbot_enabled" type="checkbox" className="switch" defaultChecked={Boolean(v.chatbot_enabled)} />
            เปิด Chatbot ตอบอัตโนมัติบน {name}
          </label>
          <label className="check">
            <input name="remove_credentials" type="checkbox" />
            ลบข้อมูลเชื่อมต่อ (ปิดช่องทางก่อนบันทึก)
          </label>
        </div>
        <p className="tiny muted mt">
          ข้อมูลลับเก็บฝั่งเซิร์ฟเวอร์ ไม่แสดงกลับและไม่รวมในไฟล์สำรอง การแก้ตั้งค่าจะยกเลิกข้อความที่ยังรอส่ง ให้เจ้าหน้าที่ตรวจแล้วส่งใหม่
        </p>
        <div className="flex wrap mt">
          <button className="btn primary" type="submit">
            บันทึก {name}
          </button>
          <button className="btn" type="button" disabled={!c.credentials_configured} onClick={() => void action('test')}>
            ทดสอบบัญชีที่บันทึกไว้
          </button>
          {k === 'email' && (
            <button className="btn" type="button" onClick={() => void action('sync')}>
              ตรวจอีเมลรอบถัดไปทันที
            </button>
          )}
        </div>
        <p className="tiny muted mt">ทดสอบการเข้าสู่ระบบเท่านั้น ไม่ส่งข้อความทดสอบ</p>
        {webhookURL && (
          <div className="notice mt">
            <strong>Webhook URL</strong>
            <p className="channel-url">{webhookURL}</p>
            <button
              className="btn sm"
              type="button"
              onClick={() =>
                run(async () => {
                  await navigator.clipboard.writeText(webhookURL);
                  toast('คัดลอก Webhook URL แล้ว');
                })
              }
            >
              คัดลอก Webhook URL
            </button>
            <p>ถ้าเปิดผ่าน localhost ให้เปลี่ยนเป็นโดเมน HTTPS สาธารณะที่ชี้มายังเซิร์ฟเวอร์นี้ แล้วใส่ URL ใน LINE Developers พร้อมเปิด Use webhook</p>
          </div>
        )}
        <div className="mt" role="status">
          {c.last_error && <p className="notice">{c.last_error}</p>}
          <p className="small muted">
            ตรวจล่าสุด: {c.last_checked ? date(c.last_checked, true) : '-'} · รับข้อความล่าสุด: {c.last_received ? date(c.last_received, true) : '-'}
          </p>
          <OutboxBadges outbox={c.outbox} />
        </div>
        <p className="tiny muted mt">
          เมื่อเปิด Chatbot ระบบจะส่งข้อความและความรู้สาธารณะที่เกี่ยวข้องให้ OpenAI เพื่อสร้างคำตอบ มีค่าใช้บริการตามบัญชี AI และช่องทาง
          ต้องตั้ง API Key ในส่วน AI ก่อน เปิดใช้กับเรื่องใหม่ ส่วนเรื่องเดิมให้กดเปิด AI เป็นรายบทสนทนา
        </p>
      </Form>
    </section>
  );
}

/* Password login or Google / Microsoft OAuth. Choosing a provider fills its servers and turns the channel off until
   the account is connected. */
function EmailOAuthFields({ c }: { c: ChannelSetting }) {
  const v = c.config;
  const run = useRunAction();
  const canConnect = Boolean(v.auth_mode && v.auth_mode !== 'password' && c.oauth_client_configured);

  const choose = (event: ChangeEvent<HTMLSelectElement>) => {
    const form = event.currentTarget.form;
    const provider = event.currentTarget.value;
    if (!form || provider === 'password') return;
    const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    input('imap_host').value = provider === 'google' ? 'imap.gmail.com' : 'outlook.office365.com';
    input('smtp_host').value = provider === 'google' ? 'smtp.gmail.com' : 'smtp.office365.com';
    input('smtp_port').value = provider === 'google' ? '465' : '587';
    (input('enabled') as HTMLInputElement).checked = false;
  };

  return (
    <>
      <SelectField id="email-auth_mode" label="วิธีเข้าสู่ระบบ Email" name="auth_mode" defaultValue={v.auth_mode || 'password'} onChange={choose}>
        {Object.entries(emailAuthModes).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <div className="notice span-2">
        OAuth: ลงทะเบียน Web application ขององค์กรกับ Google Cloud หรือ Microsoft Entra แล้วกรอก Client ID/Secret และ Redirect URI
        บันทึกโดยยังไม่เปิดช่องทาง จากนั้นกดเชื่อมบัญชี เมื่ออนุญาตสำเร็จจึงเปิดรับและส่ง Email
      </div>
      <ChannelField kind="email" name="oauth_client_id" label="OAuth Client ID" value={v.oauth_client_id || ''} />
      <ChannelField kind="email" name="oauth_client_secret" label="OAuth Client Secret" type="password" />
      <ChannelField
        kind="email"
        name="oauth_redirect_uri"
        label="OAuth Redirect URI"
        type="url"
        value={v.oauth_redirect_uri || `${origin()}/oauth/email/callback`}
      />
      <div className="field">
        {/* The label names the button beside it, as before (a button is not a labelable form value). */}
        <label htmlFor="email-oauth-connect">เชื่อมบัญชี OAuth ที่บันทึกไว้</label>
        <button
          id="email-oauth-connect"
          type="button"
          className="btn"
          disabled={!canConnect}
          onClick={() =>
            run(async () => {
              const result = await startEmailOAuth();
              window.location.assign(result.url);
            })
          }
        >
          เข้าสู่ Google / Microsoft
        </button>
        <span className="tiny muted">{c.credentials_configured ? 'มีข้อมูลเชื่อมต่อแล้ว' : 'ยังไม่ได้เชื่อมบัญชี'} · token เก็บฝั่งเซิร์ฟเวอร์</span>
      </div>
    </>
  );
}
