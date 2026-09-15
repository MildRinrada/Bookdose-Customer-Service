'use client';

import { Icon } from '@/components/Icon';
import { channelNames } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { CHANNELS_PATH, FACEBOOK_PATH } from '../api';
import type { ChannelSetting, FacebookSetting } from '../types';

/* One row per connected channel (LINE, Email, Facebook Messenger) for the settings overview, under the web chat
   row. Markup: modules/channels/channel-summary-row. Renders nothing until both answers are in. */

export function ChannelSummary() {
  const channels = useApi<ChannelSetting[]>(CHANNELS_PATH);
  const facebook = useApi<FacebookSetting>(FACEBOOK_PATH);
  if (!channels.data) return null;
  const fb = facebook.data;
  return (
    <>
      {channels.data.map((c) => (
        <SummaryRow
          key={c.kind}
          icon={c.kind === 'line' ? 'chat' : 'mail'}
          name={channelNames[c.kind]}
          account={c.config.display_name || c.config.address || 'ตั้งค่าบัญชีด้านล่าง'}
          live={c.enabled && c.credentials_configured}
        />
      ))}
      {fb && (
        <SummaryRow icon="facebook" name="Facebook Messenger" account={fb.config.page_name || 'ตั้งค่าเพจด้านล่าง'} live={fb.enabled && fb.credentials_configured} />
      )}
    </>
  );
}

function SummaryRow({ icon, name, account, live }: { icon: string; name: string; account: string; live: boolean }) {
  return (
    <div className="channel-row">
      <div className="channel-icon">
        <Icon name={icon} />
      </div>
      <div className="grow">
        <h3>{name}</h3>
        <p>{account}</p>
      </div>
      <span className={`badge ${live ? 'resolved' : ''}`}>{live ? 'เปิดรับเรื่อง' : 'ยังไม่เปิดใช้งาน'}</span>
    </div>
  );
}
