'use client';

import { Fragment, useState, type ChangeEvent } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useRunAction } from '@/components/ui/actions';
import { NumberField, SelectField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { TeamOptions } from '@/components/ui/pickers';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { settingsParts } from '@/features/settings/labels';
import { useApi, useInvalidate } from '@/lib/query';
import { CHANNEL_SETTINGS_PREFIXES, CHANNELS_PATH, saveChannel, saveChannelPresentation, startEmailOAuth, syncEmail, testChannel } from '../api';
import { deliveryNames, emailAuthModes, smtpPorts } from '../labels';
import type { ChannelSetting, OutboxCount } from '../types';
import { ChannelField } from '../util';
import { emailSteps, lineSteps, SetupSteps } from './SetupSteps';

/* The LINE and Email settings (settings page, LINE / อีเมล / Facebook / Instagram section; admins only): credentials, the team that
   receives new conversations, on/off, chatbot, a login test, the webhook URL and the delivery queue.
   Markup: modules/channels/channel-settings, channel-field, email-oauth-fields, outbox-badge. */

const origin = () => (typeof window === 'undefined' ? '' : window.location.origin);

/** The LINE and email settings, or only one of them (`kind`: its own page in ตั้งค่าองค์กร). */
export function ChannelSettingsPanel({ kind }: { kind?: ChannelSetting['kind'] }) {
  const channels = useApi<ChannelSetting[]>(CHANNELS_PATH);
  if (channels.error) return <ErrorState error={channels.error} onRetry={() => void channels.refetch()} />;
  if (!channels.data) return <PageLoading />;
  return (
    <>
      {channels.data.filter((c) => !kind || c.kind === kind).map((c) => (
        <Fragment key={c.kind}>
          <ChannelCard c={c} />
          {c.route_id && <ChannelWordsCard c={c} />}
        </Fragment>
      ))}
    </>
  );
}

/* What customers read from the channel itself: email's sender name and signature, LINE's welcome for a new friend.
   Saved on its own (PATCH …/presentation), so changing a word never checks the account again or cancels a reply
   waiting to go out, as saving the connection above does. */
function ChannelWordsCard({ c }: { c: ChannelSetting }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const v = c.config;
  const [sender, setSender] = useState(v.sender_name || '');
  const email = c.kind === 'email';
  return (
    <section className="card mt" id={`channel-${c.kind}-words`}>
      <div className="card-header">
        <div>
          <h2>{email ? 'ชื่อผู้ส่งและลายเซ็น' : 'ข้อความต้อนรับเพื่อนใหม่'}</h2>
          <p>
            {email
              ? 'ลูกค้าเห็นในทุกอีเมลที่ทีมตอบกลับ · บันทึกแยกจากการเชื่อมต่อด้านบน ข้อความที่รอส่งจะไม่ถูกยกเลิก'
              : 'ส่งทันทีเมื่อลูกค้าเพิ่มบัญชี LINE นี้เป็นเพื่อน เป็นการตอบกลับของ LINE จึงไม่นับโควตาข้อความของบัญชี'}
          </p>
        </div>
      </div>
      <Form
        key={JSON.stringify([v.sender_name, v.signature, v.welcome_enabled, v.welcome_message])}
        className="card-body"
        onSubmit={async (values, form) => {
          await saveChannelPresentation(
            c.kind,
            email
              ? { sender_name: values.sender_name ?? '', signature: values.signature ?? '' }
              : {
                  welcome_enabled: (form.elements.namedItem('welcome_enabled') as HTMLInputElement).checked,
                  welcome_message: values.welcome_message ?? '',
                },
          );
          toast(email ? 'บันทึกชื่อผู้ส่งและลายเซ็นแล้ว' : 'บันทึกข้อความต้อนรับแล้ว');
          await refresh(...CHANNEL_SETTINGS_PREFIXES);
        }}
      >
        {email ? (
          <>
            <div className="field">
              <label htmlFor="email-sender_name">ชื่อผู้ส่ง</label>
              <input
                id="email-sender_name"
                name="sender_name"
                maxLength={80}
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="ชื่อที่ลูกค้าเห็นแทนอีเมล"
              />
              <p className="tiny muted">
                ลูกค้าจะเห็นผู้ส่งเป็น <strong>{sender.trim() ? `${sender.trim()} <${v.address || 'อีเมลรับเรื่อง'}>` : v.address || 'อีเมลรับเรื่อง'}</strong>
              </p>
            </div>
            <div className="field">
              <label htmlFor="email-signature">ลายเซ็นท้ายอีเมล</label>
              <textarea id="email-signature" name="signature" rows={4} maxLength={600} defaultValue={v.signature || ''} />
              <p className="tiny muted">ต่อท้ายทุกอีเมลที่ตอบลูกค้า เช่น ชื่อทีม เบอร์โทร และเวลาทำการ ขึ้นบรรทัดใหม่ได้ · ไม่ใส่ก็ได้</p>
            </div>
          </>
        ) : (
          <>
            <label className="check">
              <input type="checkbox" className="switch" name="welcome_enabled" defaultChecked={Boolean(v.welcome_enabled)} />
              ส่งข้อความต้อนรับเมื่อมีคนเพิ่มเพื่อน
            </label>
            <div className="field mt">
              <label htmlFor="line-welcome_message">ข้อความต้อนรับ</label>
              <textarea id="line-welcome_message" name="welcome_message" rows={4} maxLength={1000} defaultValue={v.welcome_message || ''} />
              <p className="tiny muted">
                ถ้าตั้งข้อความทักทายไว้ใน LINE Official Account Manager ด้วย ลูกค้าจะได้ 2 ข้อความ ให้ปิดฝั่งนั้น หรือเลือกใช้ที่นี่ที่เดียว
              </p>
            </div>
          </>
        )}
        <button className="btn primary" type="submit">
          {email ? 'บันทึกชื่อผู้ส่งและลายเซ็น' : 'บันทึกข้อความต้อนรับ'}
        </button>
      </Form>
    </section>
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
  // As the settings page names the part (LINE, อีเมล).
  const name = settingsParts[k].label;
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
        {/* Saved is good news: green with a tick, not a grey that reads like "nothing here". */}
        <span className={`badge${c.credentials_configured ? ' resolved' : ''}`}>
          <Icon name={c.credentials_configured ? 'checkCircle' : 'clock'} />
          {c.credentials_configured ? 'บันทึกข้อมูลเชื่อมต่อแล้ว' : 'ยังไม่มีข้อมูลเชื่อมต่อ'}
        </span>
      </div>
      <Form
        // After saving, the form shows the saved settings again and the secret boxes start empty.
        key={JSON.stringify([c.enabled, c.config, c.credentials_configured, c.channel_id, c.route_id])}
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
        <SetupSteps steps={k === 'line' ? lineSteps(c) : emailSteps(c)} />
        <div className="notice mb">
          {k === 'line' &&
            'รับข้อความส่วนตัวและกลุ่มจาก LINE OA ตอบข้อความ รูป และลิงก์เอกสารผ่านบัญชีเดิม ต้องเปิดโปรแกรมไว้และใช้ Webhook URL แบบ HTTPS ที่ LINE เข้าถึงได้'}
          {k === 'email' &&
            'รับอีเมลผ่าน IMAP (TLS 993) และส่งผ่าน SMTP ใช้รหัสผ่านหรือ App Password เดียวกันทั้งสองบริการ เริ่มรับเฉพาะอีเมลใหม่หลังเปิดครั้งแรก เลือกใช้รหัสผ่าน หรือ OAuth ของ Google / Microsoft ได้'}
        </div>
        <div className="form-grid">
          {k === 'line' && (
            <>
              {/* The two values LINE Developers shows on the channel's page; the server asks LINE for the token itself. */}
              <ChannelField kind={k} name="channel_id" label="แชนแนล ID" value={c.channel_id || ''} />
              <ChannelField kind={k} name="channel_secret" label="ความลับแชนแนล" type="password" />
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
          เมื่อเปิด Chatbot ระบบจะส่งข้อความและความรู้สาธารณะที่เกี่ยวข้องให้บริการ AI ที่องค์กรเชื่อมไว้ (OpenAI Gemini หรือ n8n) เพื่อสร้างคำตอบ มีค่าใช้บริการตามบัญชี AI และช่องทาง
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
      <SelectField id="email-auth_mode" label="วิธีเข้าสู่ระบบอีเมล" name="auth_mode" defaultValue={v.auth_mode || 'password'} onChange={choose}>
        {Object.entries(emailAuthModes).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <div className="notice span-2">
        OAuth: ลงทะเบียน Web application ขององค์กรกับ Google Cloud หรือ Microsoft Entra แล้วกรอก Client ID/Secret และ Redirect URI
        บันทึกโดยยังไม่เปิดช่องทาง จากนั้นกดเชื่อมบัญชี เมื่ออนุญาตสำเร็จจึงเปิดรับและส่งอีเมล
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
