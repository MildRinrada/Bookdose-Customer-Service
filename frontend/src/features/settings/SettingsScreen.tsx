'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { AiSettingsPanel } from '@/features/ai';
import { ChannelSettingsPanel, FacebookSettingsPanel } from '@/features/channels';
import { roleLabels } from '@/lib/labels';
import { useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { JoinLinksPanel } from './components/JoinLinksPanel';
import { OverviewPanel } from './components/OverviewPanel';
import { TeamsPanel } from './components/TeamsPanel';
import { isSettingsTab, settingsTabs, type SettingsTab } from './labels';

/* Organization settings, in sections a person can point at: the organization and how it promises to serve, the
   people who do the work, the links customers join with, the channels customers write from and the AI assistant. Every panel is in the
   page (the others hidden), like before, so each loads its own data when the screen opens.
   Markup: old-frontend/pages/settings/settings.html, settings-tab.html. */

export function SettingsScreen({ tab }: { tab?: string }) {
  const work = useWork();
  const [remembered, setRemembered] = useUiState<SettingsTab>('settings:tab', 'overview');
  const [current, setCurrent] = useState<SettingsTab>(isSettingsTab(tab) ? tab : remembered);

  // A link to /settings?tab=… while already here picks that section.
  const [seenTab, setSeenTab] = useState(tab);
  if (tab !== seenTab) {
    setSeenTab(tab);
    if (isSettingsTab(tab)) setCurrent(tab);
  }
  // The section asked for in the address is remembered for the next visit to /settings.
  useEffect(() => {
    if (isSettingsTab(tab)) setRemembered(tab);
  }, [tab, setRemembered]);

  const select = (key: SettingsTab) => {
    setCurrent(key);
    setRemembered(key);
    // Only the address changes (as history.replaceState did before); the screen is already showing the section.
    window.history.replaceState(null, '', `/settings?tab=${key}`);
  };

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
        <nav className="settings-nav" role="tablist" aria-label="หมวดการตั้งค่า">
          {(Object.keys(settingsTabs) as SettingsTab[]).map((key) => {
            const meta = settingsTabs[key];
            const active = key === current;
            return (
              <button
                key={key}
                type="button"
                className={`settings-nav-item${active ? ' active' : ''}`}
                role="tab"
                aria-label={meta.label}
                aria-selected={active}
                aria-controls={`settings-${key}`}
                data-tab={key}
                onClick={() => select(key)}
              >
                <span className="settings-nav-icon">
                  <Icon name={meta.icon} />
                </span>
                <span className="settings-nav-text">
                  <strong>{meta.label}</strong>
                  <span className="settings-nav-hint">{meta.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="settings-panels">
          <section id="settings-overview" role="tabpanel" aria-label="ภาพรวมและบริการ" hidden={current !== 'overview'}>
            <OverviewPanel />
          </section>
          <section id="settings-teams" role="tabpanel" aria-label="ทีมและสมาชิก" hidden={current !== 'teams'}>
            <TeamsPanel />
          </section>
          <section id="settings-invites" role="tabpanel" aria-label="ลิงก์และ QR สำหรับลูกค้า" hidden={current !== 'invites'}>
            <JoinLinksPanel />
          </section>
          <section id="settings-connections" role="tabpanel" aria-label="LINE / Email / Facebook" hidden={current !== 'connections'}>
            <ChannelSettingsPanel />
            <FacebookSettingsPanel />
          </section>
          <section id="settings-ai" role="tabpanel" aria-label="AI Assistant" hidden={current !== 'ai'}>
            <AiSettingsPanel />
          </section>
        </div>
      </div>
    </>
  );
}
