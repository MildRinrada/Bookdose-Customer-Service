'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { number } from '@/lib/format';
import { actorLabels } from '../labels';
import type { IpInfoMap, SecurityOverview } from '../types';
import { IpWithInfo } from './IpInfo';
import { BlockIpDialog } from './IpBlocks';

/* The addresses with the most security events in the range (with "บล็อก"), and the accounts most often targeted by
   wrong passwords (the email typed, whether or not the account exists). */

export function TopIpsCard({ rows, info = {} }: { rows: SecurityOverview['top_ips']; info?: IpInfoMap }) {
  const { openModal } = useDialogs();
  return (
    <section className="card security-card" aria-labelledby="security-top-ips-title">
      <div className="card-header">
        <div>
          <h2 id="security-top-ips-title">IP ที่มีเหตุการณ์มากที่สุด</h2>
          <p>ในช่วงเวลาที่เลือก</p>
        </div>
        <Icon name="globe" />
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="security-table">
            <thead>
              <tr>
                <th scope="col">IP</th>
                <th scope="col">เหตุการณ์</th>
                <th scope="col">เข้าสู่ระบบล้มเหลว</th>
                <th scope="col">
                  <span className="sr-only">การจัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ip}>
                  <td>
                    <IpWithInfo ip={row.ip} info={info[row.ip]} />
                  </td>
                  <td className="mono">{number(row.events)}</td>
                  <td className="mono">{number(row.failed_logins)}</td>
                  <td className="security-actions-cell">
                    {row.blocked ? (
                      <span className="badge severity-badge severity-critical">บล็อกอยู่</span>
                    ) : (
                      <button
                        type="button"
                        className="btn sm danger"
                        aria-label={`บล็อก ${row.ip}`}
                        onClick={() =>
                          openModal(
                            'บล็อก IP',
                            <BlockIpDialog ip={row.ip} reason={row.failed_logins ? `เข้าสู่ระบบไม่สำเร็จ ${row.failed_logins} ครั้ง` : ''} />,
                          )
                        }
                      >
                        <Icon name="shield" />
                        บล็อก
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="card-body muted">ยังไม่มีเหตุการณ์จาก IP ใดในช่วงนี้</p>
      )}
    </section>
  );
}

export function TopSubjectsCard({ rows }: { rows: SecurityOverview['top_subjects'] }) {
  return (
    <section className="card security-card" aria-labelledby="security-top-subjects-title">
      <div className="card-header">
        <div>
          <h2 id="security-top-subjects-title">บัญชีที่ถูกพยายามเข้าสู่ระบบมากที่สุด</h2>
          <p>อีเมลที่ถูกกรอกรหัสผิดบ่อยที่สุด (อาจไม่ใช่บัญชีที่มีอยู่จริง)</p>
        </div>
        <Icon name="users" />
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="security-table">
            <thead>
              <tr>
                <th scope="col">บัญชี</th>
                <th scope="col">กลุ่ม</th>
                <th scope="col">ล้มเหลว</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.actor}:${row.subject}`}>
                  <td>{row.subject}</td>
                  <td>{actorLabels[row.actor] ?? row.actor}</td>
                  <td className="mono">{number(row.failures)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="card-body muted">ยังไม่มีการเข้าสู่ระบบที่ล้มเหลวในช่วงนี้</p>
      )}
    </section>
  );
}
