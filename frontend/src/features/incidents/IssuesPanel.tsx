'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import { relative } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import type { KnownIssue } from './KnownIssues';

/* ตั้งค่า → ประกาศปัญหาถึงลูกค้า: post what is down, see how customers read it, and mark it fixed when it is. Posting
   takes one field; the line for customers is optional. Markup: pages/known-issues.css. */

const PATH = '/api/issues';
type View = { issues: KnownIssue[]; shown_minutes: number };

export function IssuesPanel() {
  const view = useApi<View>(PATH);
  const refresh = useInvalidate();
  const run = useRunAction();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const issues = view.data?.issues ?? [];
  const active = issues.filter((i) => i.status === 'active');
  const past = issues.filter((i) => i.status === 'resolved');

  /** Whether it went through (a refusal is shown by useRunAction). */
  const send = async (path: string, body: unknown, method: 'POST' | 'PATCH' | 'DELETE', done: string) => {
    let ok = false;
    await run(async () => {
      await api(path, body, method);
      ok = true;
      await refresh(PATH);
      toast(done);
    });
    return ok;
  };

  return (
    <div className="card-body issues-panel">
      <p className="muted">
        เมื่อระบบหรือบริการขององค์กรมีปัญหา ประกาศไว้ที่นี่ ลูกค้าจะเห็นแถบแจ้งบนหน้าแชททุกหน้าก่อนพิมพ์ถาม ช่วยลดข้อความถามเรื่องเดียวกัน
        พอแก้เสร็จกด แก้ไขแล้ว แถบจะเปลี่ยนเป็นแจ้งว่ากลับมาใช้ได้ {view.data?.shown_minutes ?? 60} นาทีแล้วหายไป
      </p>
      <form
        className="issues-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          void send(PATH, { title, detail }, 'POST', 'ประกาศแล้ว ลูกค้าจะเห็นบนหน้าแชท').then((ok) => {
            if (!ok) return;
            setTitle('');
            setDetail('');
          });
        }}
      >
        <label className="field">
          <span>ระบบหรือบริการที่มีปัญหา</span>
          <input value={title} maxLength={80} placeholder="เช่น ระบบชำระเงิน" onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="field">
          <span>บอกลูกค้าเพิ่มเติม (ไม่บังคับ)</span>
          <input value={detail} maxLength={300} placeholder="เช่น จ่ายด้วยบัตรไม่ได้ชั่วคราว คาดว่าแก้เสร็จ 15:00" onChange={(e) => setDetail(e.target.value)} />
        </label>
        {title.trim() && (
          <div className="issues-preview">
            <span className="tiny muted">ลูกค้าจะเห็น</span>
            <p className="known-issue active">
              <Icon name="bell" />
              <span>
                <strong>ตอนนี้{title.trim()}มีปัญหา</strong> ทีมงานทราบแล้วและกำลังแก้ไข ไม่ต้องแจ้งซ้ำ
                {detail.trim() && <span className="known-issue-detail">{detail.trim()}</span>}
              </span>
            </p>
          </div>
        )}
        <button className="btn primary" type="submit" disabled={!title.trim()}>
          <Icon name="bell" />
          ประกาศถึงลูกค้า
        </button>
      </form>

      <h3 className="issues-heading">กำลังประกาศอยู่ {active.length ? `(${active.length})` : ''}</h3>
      {active.length ? (
        <ul className="issues-list">
          {active.map((issue) => (
            <li key={issue.id}>
              <div className="grow">
                <strong>{issue.title}</strong>
                {issue.detail && <span className="muted">{issue.detail}</span>}
                <span className="tiny muted">
                  ประกาศโดย {issue.author_name} · {relative(issue.created_at)}
                </span>
                {/* ฉันก็เจอ: how many customers said they hit it (incidents/service.py). */}
                <span className="tiny">{issue.affected ? `ลูกค้าแจ้งว่าเจอปัญหานี้ ${issue.affected.toLocaleString('th-TH')} คน` : 'ยังไม่มีลูกค้ากดว่าเจอปัญหานี้'}</span>
              </div>
              <button type="button" className="btn sm primary" onClick={() => void send(`${PATH}/${issue.id}`, { status: 'resolved' }, 'PATCH', 'แจ้งลูกค้าว่าแก้ไขแล้ว')}>
                <Icon name="check" />
                แก้ไขแล้ว
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tiny muted">ไม่มีประกาศ ลูกค้าไม่เห็นแถบแจ้งปัญหา</p>
      )}

      {past.length > 0 && (
        <>
          <h3 className="issues-heading">แก้ไขแล้ว 7 วันล่าสุด</h3>
          <ul className="issues-list past">
            {past.map((issue) => (
              <li key={issue.id}>
                <div className="grow">
                  <strong>{issue.title}</strong>
                  <span className="tiny muted">
                    แก้ไขแล้ว {relative(issue.resolved_at)}
                    {issue.affected ? ` ลูกค้าแจ้งว่าเจอ ${issue.affected.toLocaleString('th-TH')} คน` : ''}
                  </span>
                </div>
                <button type="button" className="btn sm" onClick={() => void send(`${PATH}/${issue.id}`, { status: 'active' }, 'PATCH', 'ประกาศอีกครั้งแล้ว')}>
                  ประกาศอีกครั้ง
                </button>
                <button type="button" className="icon-btn" aria-label={`ลบประกาศ ${issue.title}`} title="ลบ" onClick={() => void send(`${PATH}/${issue.id}`, undefined, 'DELETE', 'ลบประกาศแล้ว')}>
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
