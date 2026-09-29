'use client';

import { useEffect, useRef } from 'react';
import type { IconName } from '@/components/Icon';
import { showPopup } from '@/components/ui/Popups';
import { OPEN_ALERTS_PATH } from '@/features/security/api';
import { alertRuleLabel, severityLabels } from '@/features/security/labels';
import type { SecurityAlert } from '@/features/security/types';
import { playSound, showDesktop } from '@/features/staff-account/alerts';
import { usePreferences } from '@/features/staff-account/prefs';
import { useApi } from '@/lib/query';
import { NOTIFICATIONS_PATH } from './api';
import type { PlatformNotice } from './types';

/* The platform admin's pop-up, desktop notification and sound (ตั้งค่าบัญชี → การแจ้งเตือน), run by the staff frame
   wherever they are in the app. Only what cannot wait: a server to-do the console rates critical (a background job
   stopped, the disk almost full, the last backup failed, a published hole in a library, an organization out of space
   or without an admin), and a new security alert rated warning or critical. The rest stays in the bell. A to-do is
   announced when it starts, and again if it comes back after being fixed; an alert once (a continuing attack
   updates the same alert). What was there when the page opened is never announced. On the page it is the app's own
   pop-up; in another tab, the browser's notification, so both lists are asked for in the background too. */

const EVERY_MS = 60000;
const SECURITY_TODOS = new Set(['vulns']);

type Danger = { key: string; critical: boolean; icon?: IconName; label: string; title: string; body: string; href: string };

const securityLabel = (severity: string) => `ความปลอดภัย ระดับ${severityLabels[severity] ?? severity}`;

export function usePlatformAlerts(enabled: boolean) {
  const notify = usePreferences(enabled).data?.preferences.notify;
  const popup = notify?.popup !== false;
  const active = Boolean(enabled && notify && (popup || notify.sound || notify.desktop));
  const notices = useApi<{ items: PlatformNotice[] }>(NOTIFICATIONS_PATH, { enabled: active, refetchInterval: EVERY_MS, background: true }).data?.items;
  const alerts = useApi<{ alerts: SecurityAlert[] }>(OPEN_ALERTS_PATH, { enabled: active, refetchInterval: EVERY_MS, background: true }).data?.alerts;
  // The critical to-dos of the last answer (null until the first), and every alert already taken in.
  const present = useRef<Set<string> | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!active || !notify) return;
    const found: Danger[] = [];
    if (notices) {
      const critical = notices.filter((n) => n.level === 'critical');
      const before = present.current;
      present.current = new Set(critical.map((n) => n.key));
      for (const n of critical)
        if (before && !before.has(n.key)) {
          const security = SECURITY_TODOS.has(n.key);
          found.push({
            key: `todo:${n.key}`,
            critical: true,
            icon: security ? 'shield' : undefined,
            label: security ? securityLabel('critical') : 'ระบบต้องจัดการด่วน',
            title: n.title,
            body: n.detail,
            href: n.href,
          });
        }
    }
    if (alerts) {
      const first = !seen.current;
      seen.current ??= new Set();
      for (const a of alerts) {
        if (a.severity !== 'critical' && a.severity !== 'warning') continue;
        const key = `alert:${a.id}`;
        if (seen.current.has(key)) continue;
        seen.current.add(key);
        if (first) continue;
        const title = alertRuleLabel(a.rule) === a.rule && a.label ? a.label : alertRuleLabel(a.rule);
        const body = [a.ip && `จาก ${a.ip}`, a.count > 1 && `${a.count.toLocaleString('th-TH')} ครั้ง`].filter(Boolean).join(' ');
        found.push({ key, critical: a.severity === 'critical', icon: 'shield', label: securityLabel(a.severity), title, body: body || 'กดเพื่อตรวจและรับทราบ', href: '/platform/security' });
      }
    }
    if (!found.length) return;
    if (notify.sound) playSound(found.some((d) => d.critical) ? 'urgent' : 'alert');
    if (popup && document.visibilityState === 'visible')
      for (const d of found.slice(-3))
        showPopup({ key: d.key, kind: 'work', urgent: d.critical, icon: d.icon, label: d.label, title: d.title, body: d.body, href: d.href });
    else if (notify.desktop) for (const d of found.slice(0, 3)) showDesktop(d.title, `${d.label} ${d.body}`, d.href, d.key);
  }, [active, notify, popup, notices, alerts]);
}
