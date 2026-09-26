'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { useTeamName, useWork } from '@/lib/session';
import { AUTOMATION_PATH, saveDistribution } from '../api';
import type { Distribution, DistributionSettings } from '../types';

/* แจกเคสอัตโนมัติ (backend automation/distribution.py): new cases nobody owns go straight to the member of the team
   who can take one and holds the fewest, up to a ceiling each. Below the settings, everyone it could consider and,
   for the ones it would pass over now, why - so an owner who sees cases waiting can tell what is stopping them.
   Markup: pages/automation (distribution-*). */

export function DistributionCard({ data }: { data: Distribution }) {
  // What the server saved is where the form starts again from.
  return <DistributionForm key={JSON.stringify(data.settings)} data={data} />;
}

function DistributionForm({ data }: { data: Distribution }) {
  const work = useWork();
  const teamName = useTeamName();
  const toast = useToast();
  const refresh = useInvalidate();
  const [form, setForm] = useState<DistributionSettings>(data.settings);
  const [busy, setBusy] = useState(false);
  const [low, high] = data.cap_range;
  const set = (changes: Partial<DistributionSettings>) => setForm((f) => ({ ...f, ...changes }));
  const manyTeams = work.teams.length > 1;
  const canEdit = work.role === 'admin' && !work.read_only;

  const save = async () => {
    if (!Number.isInteger(form.cap) || form.cap < low || form.cap > high) return toast(`เพดานต่อคนต้องเป็น ${low}-${high} เคส`, true);
    setBusy(true);
    try {
      await saveDistribution(form);
      toast(form.enabled ? 'เปิดแจกเคสอัตโนมัติแล้ว · เคสที่รออยู่ถูกแจกทันที' : 'ปิดแจกเคสอัตโนมัติแล้ว');
      await refresh(AUTOMATION_PATH, '/api/tickets');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  };

  const covered = (teamId: string | null) => data.settings.all_teams || (teamId !== null && data.settings.teams.includes(teamId));
  const people = data.people.filter((p) => covered(p.team_id)).sort((a, b) => Number(b.ready) - Number(a.ready) || a.load - b.load);
  const ready = people.filter((p) => p.ready).length;

  return (
    <section className="card distribution-card" id="automation-distribution">
      <div className="card-header">
        <div>
          <h2>แจกเคสอัตโนมัติ</h2>
          <p>เคสใหม่ที่ยังไม่มีผู้รับผิดชอบ ส่งให้คนในทีมที่พร้อมรับเรื่องและถืองานน้อยที่สุดทันที ไม่ต้องรอใครกดรับ</p>
        </div>
      </div>
      <div className="card-body stack">
        <label className="check">
          <input type="checkbox" className="switch" checked={form.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} />
          เปิดแจกเคสอัตโนมัติ
        </label>
        <div className="distribution-fields">
          <div className="field">
            <label htmlFor="distribution-cap">คนหนึ่งถือเคสได้ไม่เกิน (เคส)</label>
            <input
              id="distribution-cap"
              type="number"
              min={low}
              max={high}
              value={Number.isNaN(form.cap) ? '' : form.cap}
              disabled={!canEdit}
              onChange={(e) => set({ cap: e.target.valueAsNumber })}
            />
            <span className="tiny muted">ครบแล้วเคสใหม่จะไปที่คนถัดไป ถ้าทุกคนครบ เคสรอในคิวของทีม</span>
          </div>
          <label className="check distribution-owners">
            <input type="checkbox" checked={form.owners} disabled={!canEdit} onChange={(e) => set({ owners: e.target.checked })} />
            แจกให้เจ้าขององค์กรด้วย
          </label>
        </div>
        {manyTeams && (
          <fieldset className="auto-fieldset distribution-teams">
            <legend>ใช้กับทีม</legend>
            <label className="check">
              <input type="radio" name="distribution-scope" checked={form.all_teams} disabled={!canEdit} onChange={() => set({ all_teams: true })} />
              ทุกทีม
            </label>
            <label className="check">
              <input type="radio" name="distribution-scope" checked={!form.all_teams} disabled={!canEdit} onChange={() => set({ all_teams: false })} />
              เฉพาะทีมที่เลือก
            </label>
            {!form.all_teams && (
              <div className="distribution-team-list">
                {work.teams.map((t) => (
                  <label key={t.id} className="check">
                    <input
                      type="checkbox"
                      checked={form.teams.includes(t.id)}
                      disabled={!canEdit}
                      onChange={(e) => set({ teams: e.target.checked ? [...form.teams, t.id] : form.teams.filter((id) => id !== t.id) })}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
        {canEdit && (
          <div className="settings-save">
            <span className="muted">เคสที่รออยู่ตอนนี้จะถูกแจกทันทีหลังบันทึก</span>
            <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>
              <Icon name="check" />
              {busy ? 'กำลังบันทึก…' : 'บันทึกการแจกเคส'}
            </button>
          </div>
        )}
      </div>
      <div className="card-header auto-subhead">
        <div>
          <h2>ตอนนี้ใครรับเคสได้บ้าง</h2>
          <p>
            {data.settings.enabled
              ? `วันนี้แจกไปแล้ว ${data.today} เคส · รอคนรับ ${data.waiting} เคส · พร้อมรับ ${ready} จาก ${people.length} คน`
              : 'ยังปิดอยู่ รายชื่อนี้บอกว่าถ้าเปิดตอนนี้ ใครจะได้รับเคส'}
          </p>
        </div>
      </div>
      <div className="card-body">
        {people.length ? (
          <ul className="distribution-people">
            {people.map((p) => (
              <li key={p.id} className={p.ready ? 'ready' : ''}>
                <span className="distribution-name">
                  <strong>{p.name}</strong>
                  {manyTeams && <small className="muted">{teamName(p.team_id)}</small>}
                </span>
                <span className="distribution-load">ถืออยู่ {p.load} เคส</span>
                <span className={`distribution-state${p.ready ? ' ready' : ''}`}>{p.ready ? 'พร้อมรับเคส' : p.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-mini">ยังไม่มีสมาชิกในทีมที่เลือก</p>
        )}
        <ul className="auto-notes">
          <li>รับเคสได้เมื่อสถานะเป็นพร้อมรับเรื่อง อยู่ในเวลาทำงาน ไม่ลา และเปิดโปรแกรมภายใน {data.active_minutes} นาทีที่ผ่านมา</li>
          <li>นับเฉพาะเคสที่ต้องทำตอนนี้ ไม่นับเคสที่รอลูกค้าหรือพักไว้</li>
          <li>กฎรับเรื่องที่ระบุผู้รับผิดชอบ หรือการมอบหมายเอง ทำก่อนเสมอ</li>
          <li>เคสที่ยังไม่มีใครรับได้ ระบบลองแจกใหม่ทุก 30 วินาที และยังยกระดับตามเวลาที่ตั้งไว้</li>
        </ul>
      </div>
    </section>
  );
}
