'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useToast } from '@/components/ui/Toast';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { date, number, relative } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { HEALTH_PATH, scanVulns, VULNS_PATH } from '../api';
import type { VulnFinding, VulnsView } from '../types';

/* ช่องโหว่ในไลบรารี on ความปลอดภัย → ช่องโหว่ (backend platform/vulns.py): the libraries the server runs checked once a day against
   OSV.dev (the CVE list, GitHub's advisories, PyPI's and npm's), what was found, most serious first, and which
   version fixes it. Those only used to build the web app are folded away: they never run on the server. A new high or
   critical one is emailed to the platform admins at once, and ภาพรวมระบบ's to-do list links here. Markup: pages/platform-health.css (.vuln-*). */

const levelWords: Record<VulnFinding['level'], string> = { critical: 'วิกฤต', high: 'สูง', medium: 'กลาง', low: 'ต่ำ', unknown: 'ไม่ระบุ' };

function Finding({ f }: { f: VulnFinding }) {
  return (
    <li className="vuln">
      <div className="vuln-head">
        <span className={`vuln-level is-${f.level}`}>
          {levelWords[f.level]}
          {f.score ? ` ${f.score.toFixed(1)}` : ''}
        </span>
        <strong>
          {f.name} <span className="vuln-version">{f.version}</span>
        </strong>
        <span className="vuln-tag">{f.ecosystem === 'PyPI' ? 'Python' : f.ecosystem}</span>
        {f.dev && <span className="vuln-tag">ใช้ตอนพัฒนาเท่านั้น</span>}
      </div>
      {f.summary && <p>{f.summary}</p>}
      <p className="vuln-meta">
        <a href={f.url} target="_blank" rel="noopener noreferrer">
          {f.cves.length ? f.cves.join(', ') : f.id}
        </a>
        {' · '}
        {f.fixed.length ? (
          <>
            อัปเดตเป็น <strong>{f.fixed.join(' หรือ ')}</strong> ขึ้นไป
          </>
        ) : (
          'ยังไม่มีเวอร์ชันที่แก้'
        )}
      </p>
    </li>
  );
}

export function VulnsCard() {
  const vulns = useApi<VulnsView>(VULNS_PATH, { refetchInterval: 60000 });
  if (vulns.error) return <ErrorState error={vulns.error} onRetry={() => void vulns.refetch()} />;
  if (!vulns.data) return <PageLoading />;
  return <VulnsBody view={vulns.data} />;
}

function VulnsBody({ view }: { view: VulnsView }) {
  const toast = useToast();
  const run = useRunAction();
  const refresh = useInvalidate();
  const [showDev, setShowDev] = useState(false);
  const last = view.last;
  const findings = last?.findings ?? [];
  const running = findings.filter((f) => !f.dev);
  const dev = findings.filter((f) => f.dev);
  const count = (level: VulnFinding['level']) => running.filter((f) => f.level === level).length;
  const urgent = count('critical') + count('high');
  return (
    <section className="card" id="vulns">
      <div className="card-header">
        <div>
          <h2>ช่องโหว่ในไลบรารี</h2>
          <p>ตรวจไลบรารีที่ระบบใช้เทียบฐานข้อมูลช่องโหว่ CVE ทุกวัน เจอระดับสูงส่งอีเมลถึงผู้ดูแลแพลตฟอร์มทันที</p>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={view.running}
          onClick={() =>
            void run(async () => {
              toast('กำลังตรวจไลบรารี…');
              const found = await scanVulns();
              await refresh(VULNS_PATH, HEALTH_PATH);
              toast(found.last?.ok ? 'ตรวจเสร็จแล้ว' : 'ติดต่อฐานข้อมูลช่องโหว่ไม่ได้ ลองใหม่ภายหลัง');
            })
          }
        >
          <Icon name="shield" />
          {view.running ? 'กำลังตรวจ…' : 'ตรวจตอนนี้'}
        </button>
      </div>
      <div className="card-body">
        {!last ? (
          <p className="muted">ยังไม่เคยตรวจ ระบบจะตรวจเองภายในไม่กี่นาที หรือกดตรวจตอนนี้</p>
        ) : (
          <>
            <p className={!last.ok ? 'notice warning' : urgent ? 'notice danger-notice' : 'vuln-summary'}>
              {!last.ok
                ? `ตรวจครั้งล่าสุดไม่สำเร็จเมื่อ ${date(last.at, true)}: ติดต่อ api.osv.dev ไม่ได้ จะลองใหม่ภายใน 1 ชั่วโมง${findings.length ? ' · รายการด้านล่างมาจากการตรวจครั้งก่อน' : ''}`
                : urgent
                  ? `พบช่องโหว่ระดับสูงในไลบรารีที่ระบบใช้ ${urgent} รายการ ควรอัปเดตโดยเร็ว`
                  : running.length
                    ? `ไม่มีช่องโหว่ระดับสูง · พบระดับกลางหรือต่ำ ${running.length} รายการ`
                    : 'ไม่พบช่องโหว่ที่ประกาศแล้วในไลบรารีที่ระบบใช้'}
            </p>
            <p className="tiny muted">
              ตรวจล่าสุด {relative(last.at)} ({date(last.at, true)}) · Python {number(last.python)} ไลบรารี
              {last.npm == null ? ' · ไม่พบไฟล์ package-lock.json ของเว็บ' : ` · เว็บ (npm) ${number(last.npm)} ไลบรารี`} · ตรวจซ้ำทุก {view.every_hours} ชั่วโมง ·
              ส่งออกไปแค่ชื่อและเวอร์ชันของไลบรารี
            </p>
            {running.length > 0 && (
              <ul className="vuln-list">
                {running.map((f) => (
                  <Finding key={`${f.ecosystem}:${f.name}:${f.version}:${f.id}`} f={f} />
                ))}
              </ul>
            )}
            {dev.length > 0 && (
              <>
                <button type="button" className="btn sm subtle vuln-dev-toggle" aria-expanded={showDev} onClick={() => setShowDev(!showDev)}>
                  {showDev ? 'ซ่อน' : 'ดู'}ไลบรารีที่ใช้ตอนพัฒนาเท่านั้น ({dev.length} รายการ ไม่ได้ทำงานบนเซิร์ฟเวอร์)
                </button>
                {showDev && (
                  <ul className="vuln-list">
                    {dev.map((f) => (
                      <Finding key={`${f.ecosystem}:${f.name}:${f.version}:${f.id}`} f={f} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
