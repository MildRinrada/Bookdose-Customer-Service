'use client';

import Link from 'next/link';
import { IssuesPanel } from '@/features/incidents/IssuesPanel';
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { usePinnedMenu } from '@/components/ui/usePinnedMenu';
import { AiSettingsPanel } from '@/features/ai';
import { ChannelSettingsPanel, CHANNELS_PATH, FACEBOOK_PATH, FacebookSettingsPanel, type ChannelSetting, type FacebookSetting } from '@/features/channels';
import { roleLabels } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { settingsPages } from '@/lib/routes';
import { useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { CaseFieldsPanel } from './components/CaseFieldsPanel';
import { GuestChatPanel } from './components/GuestChatPanel';
import { JoinLinksPanel } from './components/JoinLinksPanel';
import { BackupPanel, CategoriesPanel, ProfilePanel, ServicePanel } from './components/OverviewPanel';
import { TeamSecurityPanel } from './components/TeamSecurityPanel';
import { TeamsPanel } from './components/TeamsPanel';
import { partsOf, settingsPlaceOf, settingsParts, settingsTabs, type SettingsPart, type SettingsTab } from './labels';

/* Organization settings: the sections in the menu on the left (as before), one open on the right. A section with too
   many fields for one page (ภาพรวมและบริการ, LINE / อีเมล / Facebook / Instagram) opens as icons of its parts first; an icon opens
   that part alone (/settings?tab=<part>), with the way back to the icons above it. Markup: pages/settings.css
   (settings-frame, settings-nav, settings-tiles, settings-part). */

const PAGE_HINTS: Record<string, string> = {
  automation: 'กฎที่ทำงานแทนทีมเมื่อมีเคสหรือข้อความเข้า',
  audit: 'ใครทำอะไร เมื่อไร ในองค์กรนี้',
  trash: 'รายการที่ลบไว้ กู้คืนหรือลบถาวร',
};

type Status ={ label: string; tone: 'on' | 'off' | 'warn' } | null;

/** Whether each channel is connected, from what its page reads anyway (cached, so opening it is instant). */
function useChannelStatuses(): Partial<Record<SettingsPart, Status>> {
  const channels = useApi<ChannelSetting[]>(CHANNELS_PATH).data ?? [];
  const facebook = useApi<FacebookSetting>(FACEBOOK_PATH).data;
  const channel = (c: { enabled: boolean; last_error?: string } | undefined): Status =>
    !c ? null : c.enabled && c.last_error ? { label: 'มีปัญหา', tone: 'warn' } : c.enabled ? { label: 'เชื่อมแล้ว', tone: 'on' } : { label: 'ยังไม่เชื่อม', tone: 'off' };
  return {
    line: channel(channels.find((c) => c.kind === 'line')),
    email: channel(channels.find((c) => c.kind === 'email')),
    facebook: channel(facebook),
  };
}


function StatusChip({ status }: { status: Status | undefined }) {
  if (!status) return null;
  return <span className={`settings-status ${status.tone}`}>{status.label}</span>;
}

export function SettingsScreen({ tab }: { tab?: string }) {
  const work = useWork();
  const [remembered, setRemembered] = useUiState<SettingsTab>('settings:tab', 'overview');
  // /settings alone opens the section used last.
  const place = settingsPlaceOf(tab) ?? { tab: remembered, part: null };
  const current = place.tab;
  useEffect(() => {
    setRemembered(current);
    document.title = `${place.part ? settingsParts[place.part].label : settingsTabs[current].label} · ตั้งค่าองค์กร`;
  }, [current, place.part, setRemembered]);
  const nav = useRef<HTMLElement>(null);
  usePinnedMenu(nav);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ตั้งค่าองค์กร</h1>
          <p>
            {work.tenant.name} · คุณเข้าใช้งานในฐานะ{roleLabels[work.role]}
          </p>
        </div>
      </div>
      <div className="settings-frame">
        <nav ref={nav} className="settings-nav" aria-label="หมวดการตั้งค่า">
          {(Object.keys(settingsTabs) as SettingsTab[]).map((key) => {
            const meta = settingsTabs[key];
            const active = key === current;
            return (
              <Link
                key={key}
                href={`/settings?tab=${key}`}
                className={`settings-nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                data-tab={key}
                scroll={false}
              >
                <span className="settings-nav-icon">
                  <Icon name={meta.icon} />
                </span>
                <span className="settings-nav-text">
                  <strong>{meta.label}</strong>
                  <span className="settings-nav-hint">{meta.hint}</span>
                </span>
              </Link>
            );
          })}
          {/* Screens of their own that are set up once and looked at now and then: reached from here, not the side menu. */}
          {settingsPages.map((p) => (
            <Link key={p.key} href={p.href} className="settings-nav-item">
              <span className="settings-nav-icon">
                <Icon name={p.icon} />
              </span>
              <span className="settings-nav-text">
                <strong>{p.label}</strong>
                <span className="settings-nav-hint">{PAGE_HINTS[p.key]}</span>
              </span>
            </Link>
          ))}
        </nav>
        <div className="settings-panels" id={`settings-${place.part ?? current}`}>
          <Section tab={current} part={place.part} />
        </div>
      </div>
    </>
  );
}

function Section({ tab, part }: { tab: SettingsTab; part: SettingsPart | null }) {
  const statuses = useChannelStatuses();
  const parts = partsOf(tab);
  if (parts.length && !part)
    return (
      <section className="settings-part-list" aria-labelledby="settings-part-title">
        <h2 id="settings-part-title">{settingsTabs[tab].label}</h2>
        <p>เลือกส่วนที่ต้องการตั้งค่า</p>
        <div className="settings-tiles">
          {parts.map((key) => {
            const meta = settingsParts[key];
            return (
              <Link key={key} className="settings-tile" href={`/settings?tab=${key}`} scroll={false}>
                <span className={`settings-tile-icon icon-${key}`}>
                  <Icon name={meta.icon} />
                </span>
                <span className="settings-tile-text">
                  <strong>{meta.label}</strong>
                  <small>{meta.hint}</small>
                </span>
                <StatusChip status={statuses[key]} />
              </Link>
            );
          })}
        </div>
      </section>
    );
  if (part) {
    const meta = settingsParts[part];
    return (
      <>
        <Link className="settings-part-back" href={`/settings?tab=${tab}`} scroll={false}>
          <Icon name="back" />
          {settingsTabs[tab].label}
        </Link>
        <div className="settings-part-head">
          <span className={`settings-tile-icon icon-${part}`}>
            <Icon name={meta.icon} />
          </span>
          <div>
            <h2>{meta.label}</h2>
            <p>{meta.hint}</p>
          </div>
          <StatusChip status={statuses[part]} />
        </div>
        <Part part={part} />
      </>
    );
  }
  switch (tab) {
    case 'teams':
      return <TeamsPanel />;
    case 'invites':
      return <JoinLinksPanel />;
    case 'webchat':
      return <GuestChatPanel />;
    case 'ai':
      return <AiSettingsPanel />;
    case 'issues':
      return <IssuesPanel />;
    default:
      return null;
  }
}

function Part({ part }: { part: SettingsPart }) {
  switch (part) {
    case 'profile':
      return <ProfilePanel />;
    case 'service':
      return <ServicePanel />;
    case 'categories':
      return <CategoriesPanel />;
    case 'fields':
      return <CaseFieldsPanel />;
    case 'backup':
      return <BackupPanel />;
    case 'security':
      return <TeamSecurityPanel />;
    case 'line':
      return <ChannelSettingsPanel kind="line" />;
    case 'email':
      return <ChannelSettingsPanel kind="email" />;
    case 'facebook':
      return <FacebookSettingsPanel />;
  }
}
