'use client';

import { Icon } from '@/components/Icon';
import { useCopyText, useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { SelectField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { TeamOptions } from '@/components/ui/pickers';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { CHANNEL_SETTINGS_PREFIXES, FACEBOOK_PATH, removeFacebook, saveFacebook, testFacebook } from '../api';
import type { FacebookSetting } from '../types';
import { ChannelField } from '../util';
import { OutboxBadges } from './ChannelSettingsPanel';
import { facebookSteps, instagramSteps, SetupSteps } from './SetupSteps';

/* Facebook Messenger and Instagram settings (settings page, LINE / อีเมล / Facebook / Instagram section; admins only): the Page token
   and app secret, the receiving team, on/off for the Page and for its Instagram account's DMs, a test, and the
   Callback URL + Verify Token to give Meta (the same for both). Markup: modules/channels/facebook-settings. */

export function FacebookSettingsPanel() {
  const facebook = useApi<FacebookSetting>(FACEBOOK_PATH);
  if (facebook.error) return <ErrorState error={facebook.error} onRetry={() => void facebook.refetch()} />;
  if (!facebook.data) return <PageLoading />;
  return <FacebookCard c={facebook.data} />;
}

function FacebookCard({ c }: { c: FacebookSetting }) {
  const toast = useToast();
  const { confirm } = useDialogs();
  const refresh = useInvalidate();
  const run = useRunAction();
  const copyText = useCopyText();
  const v = c.config;
  const webhookURL = c.route_id && typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/facebook/${c.route_id}` : '';

  return (
    <section className="card mt" id="channel-facebook">
      <div className="card-header">
        <h2>Facebook และ Instagram เชื่อมเพจจริง</h2>
        {/* Saved is good news: green with a tick, not a grey that reads like "nothing here". */}
        <span className={`badge${c.credentials_configured ? ' resolved' : ''}`}>
          <Icon name={c.credentials_configured ? 'checkCircle' : 'clock'} />
          {c.credentials_configured ? 'บันทึกข้อมูลเชื่อมต่อแล้ว' : 'ยังไม่มีข้อมูลเชื่อมต่อ'}
        </span>
      </div>
      <Form
        key={JSON.stringify([c.enabled, c.config, c.credentials_configured, c.route_id])}
        className="card-body"
        data-form="facebook-settings"
        onSubmit={async (values, form) => {
          const box = (key: string) => form.elements.namedItem(key) as HTMLInputElement;
          await saveFacebook({
            ...values,
            enabled: box('enabled').checked,
            instagram_enabled: box('instagram_enabled').checked,
          });
          toast('บันทึก Facebook และ Instagram แล้ว');
          await refresh(...CHANNEL_SETTINGS_PREFIXES);
        }}
      >
        <SetupSteps steps={facebookSteps(c)} />
        {v.page_name && (
          <p className="small">
            <strong>เพจที่เชื่อม:</strong> {v.page_name} <span className="muted">(Page ID {v.page_id})</span>
            {v.instagram_username && (
              <>
                {' '}
                <strong>Instagram:</strong> @{v.instagram_username}
                {!c.instagram.on && <span className="muted"> (ปิดรับ DM อยู่)</span>}
              </>
            )}
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
            <input name="instagram_enabled" type="checkbox" className="switch" defaultChecked={v.instagram_enabled} />
            รับและตอบ DM Instagram ของบัญชีที่ผูกกับเพจนี้
          </label>
        </div>
        <div className="flex wrap mt">
          <button className="btn primary" type="submit">
            บันทึก Facebook และ Instagram
          </button>
          <button
            className="btn"
            type="button"
            disabled={!c.credentials_configured}
            onClick={() =>
              run(async () => {
                await testFacebook();
                toast('เชื่อมต่อเพจสำเร็จ และเพจพร้อมส่งข้อความเข้าระบบ (ยังไม่ได้ส่งข้อความจริง)');
                await refresh(...CHANNEL_SETTINGS_PREFIXES);
              })
            }
          >
            ทดสอบบัญชีที่บันทึกไว้
          </button>
          {c.credentials_configured && (
            <button
              className="btn danger channel-remove"
              type="button"
              onClick={() =>
                confirm({
                  title: 'ลบการเชื่อมต่อ Facebook และ Instagram',
                  message: 'Facebook และ Instagram จะปิดและหยุดรับส่งข้อความทันที ข้อความที่ยังรอส่งจะไม่ถูกส่ง แชทเดิมยังอยู่ในกล่องข้อความ',
                  confirmLabel: 'ลบการเชื่อมต่อ',
                  tone: 'danger',
                  run: async () => {
                    await removeFacebook();
                    toast('ลบการเชื่อมต่อ Facebook และ Instagram แล้ว');
                    await refresh(...CHANNEL_SETTINGS_PREFIXES);
                  },
                })
              }
            >
              <Icon name="trash" />
              ลบการเชื่อมต่อ
            </button>
          )}
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
          </div>
        )}
        <div className="mt" role="status">
          {c.last_error && <p className="notice">{c.last_error}</p>}
          <p className="small muted">
            ตรวจล่าสุด: {c.last_checked ? date(c.last_checked, true) : '-'} รับข้อความล่าสุด: {c.last_received ? date(c.last_received, true) : '-'}
          </p>
          <OutboxBadges outbox={c.outbox} />
        </div>
        {v.instagram_enabled && (
          <div className="instagram-setup mt">
            <h3>
              <Icon name="instagram" /> ขั้นตอนรับ DM Instagram
            </h3>
            <SetupSteps steps={instagramSteps(c)} />
            <p className="small muted">
              DM ล่าสุด: {c.instagram.last_received ? date(c.instagram.last_received, true) : '-'}
            </p>
            <OutboxBadges outbox={c.instagram.outbox} />
          </div>
        )}
      </Form>
    </section>
  );
}
