'use client';

import { useCopyText, useRunAction } from '@/components/ui/actions';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { SelectField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { TeamOptions } from '@/components/ui/pickers';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { CHANNEL_SETTINGS_PREFIXES, FACEBOOK_PATH, saveFacebook, testFacebook } from '../api';
import type { FacebookSetting } from '../types';
import { ChannelField } from '../util';
import { OutboxBadges } from './ChannelSettingsPanel';

/* Facebook Messenger settings (settings page, LINE / Email / Facebook tab; admins only): the Page token and app
   secret, the receiving team, on/off, a test, and the Callback URL + Verify Token to give Meta.
   Markup: modules/channels/facebook-settings. */

export function FacebookSettingsPanel() {
  const facebook = useApi<FacebookSetting>(FACEBOOK_PATH);
  if (facebook.error) return <ErrorState error={facebook.error} onRetry={() => void facebook.refetch()} />;
  if (!facebook.data) return <PageLoading />;
  return <FacebookCard c={facebook.data} />;
}

function FacebookCard({ c }: { c: FacebookSetting }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const copyText = useCopyText();
  const v = c.config;
  const webhookURL = c.route_id && typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/facebook/${c.route_id}` : '';

  return (
    <section className="card mt" id="channel-facebook">
      <div className="card-header">
        <h2>Facebook Messenger · เชื่อมเพจจริง</h2>
        <span className="badge">{c.credentials_configured ? 'บันทึกข้อมูลเชื่อมต่อแล้ว' : 'ยังไม่มีข้อมูลเชื่อมต่อ'}</span>
      </div>
      <Form
        key={JSON.stringify([c.enabled, c.config, c.credentials_configured, c.route_id])}
        className="card-body"
        data-form="facebook-settings"
        onSubmit={async (values, form) => {
          const box = (key: string) => form.elements.namedItem(key) as HTMLInputElement;
          await saveFacebook({ ...values, enabled: box('enabled').checked, remove_credentials: box('remove_credentials').checked });
          toast('บันทึก Facebook Messenger แล้ว');
          await refresh(...CHANNEL_SETTINGS_PREFIXES);
        }}
      >
        <div className="notice mb">
          รับข้อความจากเพจ Facebook เข้ากล่องข้อความเดียวกับ Web / LINE / Email แล้วตอบกลับจากที่นี่ ต้องมี Meta App ที่เปิด Messenger และ
          Page Access Token ที่มีสิทธิ์ pages_messaging · ตอบได้ภายใน 24 ชั่วโมงหลังข้อความล่าสุดของลูกค้าตามนโยบาย Messenger · ส่งได้เฉพาะข้อความ
        </div>
        {v.page_name && (
          <p className="small">
            <strong>เพจที่เชื่อม:</strong> {v.page_name} <span className="muted">(Page ID {v.page_id})</span>
          </p>
        )}
        <div className="form-grid">
          <ChannelField kind="facebook" name="page_access_token" label="Page Access Token" type="password" />
          <ChannelField kind="facebook" name="app_secret" label="App Secret (Meta App)" type="password" />
          <SelectField id="facebook-team" label="ทีมรับเรื่องใหม่" name="team_id" defaultValue={v.team_id}>
            <TeamOptions />
          </SelectField>
          <label className="check">
            <input name="enabled" type="checkbox" className="switch" defaultChecked={c.enabled} />
            เปิดรับและส่ง Facebook Messenger
          </label>
          <label className="check">
            <input name="remove_credentials" type="checkbox" />
            ลบข้อมูลเชื่อมต่อ (ปิดช่องทางก่อนบันทึก)
          </label>
        </div>
        <p className="tiny muted mt">
          Page Access Token และ App Secret เก็บฝั่งเซิร์ฟเวอร์ ไม่แสดงกลับและไม่รวมในไฟล์สำรอง · บันทึกครั้งแรกโดยยังไม่เปิดใช้ได้ เพื่อรับ Callback URL
          และ Verify Token · การแก้ตั้งค่าจะยกเลิกข้อความที่ยังรอส่ง
        </p>
        <div className="flex wrap mt">
          <button className="btn primary" type="submit">
            บันทึก Facebook
          </button>
          <button
            className="btn"
            type="button"
            disabled={!c.credentials_configured}
            onClick={() =>
              run(async () => {
                await testFacebook();
                toast('เชื่อมต่อเพจสำเร็จ (ยังไม่ได้ส่งข้อความจริง)');
                await refresh(...CHANNEL_SETTINGS_PREFIXES);
              })
            }
          >
            ทดสอบบัญชีที่บันทึกไว้
          </button>
        </div>
        {webhookURL && (
          <div className="notice mt">
            <strong>Callback URL</strong>
            <p className="channel-url">{webhookURL}</p>
            <strong>Verify Token</strong>
            <p className="channel-url">{v.verify_token}</p>
            <div className="flex wrap">
              <button className="btn sm" type="button" onClick={() => void copyText(webhookURL)}>
                คัดลอก Callback URL
              </button>
              <button className="btn sm" type="button" onClick={() => void copyText(v.verify_token)}>
                คัดลอก Verify Token
              </button>
            </div>
            <p>
              ใส่ทั้งสองค่าใน Meta for Developers → Messenger → Webhooks แล้ว Subscribe เหตุการณ์ messages ของเพจ ถ้าเปิดผ่าน localhost
              ให้ใช้โดเมน HTTPS สาธารณะที่ชี้มายังเซิร์ฟเวอร์นี้แทน
            </p>
          </div>
        )}
        <div className="mt" role="status">
          {c.last_error && <p className="notice">{c.last_error}</p>}
          <p className="small muted">
            ตรวจล่าสุด: {c.last_checked ? date(c.last_checked, true) : '-'} · รับข้อความล่าสุด: {c.last_received ? date(c.last_received, true) : '-'}
          </p>
          <OutboxBadges outbox={c.outbox} />
        </div>
      </Form>
    </section>
  );
}
