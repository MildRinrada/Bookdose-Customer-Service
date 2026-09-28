'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useRunAction } from '@/components/ui/actions';
import { useToast } from '@/components/ui/Toast';
import { date, number } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { IP_DATA_PATH, removeIpData, SECURITY_PREFIX, updateIpData } from '../api';
import type { IpDataStatus } from '../types';

/* ข้อมูล IP (backend security/ip_intel.py): free databases of which country each address is in and which network it
   belongs to, downloaded to this server once a platform admin says so and kept up to date each month. Addresses are
   looked up here, never sent out. The download runs on its own thread, so the card asks again every few seconds
   while it does. DB-IP's licence asks for the credit shown at the foot. */

export function IpDataCard() {
  const status = useApi<IpDataStatus>(IP_DATA_PATH, { refetchInterval: (data) => ((data as IpDataStatus | undefined)?.running ? 3000 : false) });
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const data = status.data;

  const download = () =>
    run(async () => {
      await updateIpData();
      toast('เริ่มดาวน์โหลดฐานข้อมูล IP แล้ว ใช้เวลาประมาณ 1 นาที');
      await refresh(IP_DATA_PATH);
    });
  const stop = () =>
    confirm({
      title: 'เลิกใช้ฐานข้อมูล IP',
      message: 'ระบบจะลบไฟล์ฐานข้อมูล IP และไม่ดาวน์โหลดรายเดือนอีก หน้าความปลอดภัยจะไม่บอกประเทศและผู้ให้บริการของ IP และแชทจากเครือข่ายคลาวด์หรือ VPN ได้เพดานเท่าคนทั่วไป',
      confirmLabel: 'เลิกใช้',
      tone: 'danger',
      run: async () => {
        await removeIpData();
        toast('เลิกใช้ฐานข้อมูล IP แล้ว');
        await refresh(SECURITY_PREFIX);
      },
    });

  return (
    <section className="card security-card security-section" id="security-ip-data" aria-labelledby="security-ip-data-title">
      <div className="card-header">
        <div>
          <h2 id="security-ip-data-title">ฐานข้อมูล IP</h2>
          <p>บอกว่า IP มาจากประเทศไหน ผู้ให้บริการเครือข่ายใด และเป็นเครือข่ายคลาวด์หรือ VPN หรือไม่ ค้นในเซิร์ฟเวอร์นี้เอง ไม่ส่ง IP ของผู้ใช้ออกไปที่ใด</p>
        </div>
        <Icon name="globe" />
      </div>
      <div className="card-body">
        {status.error ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        ) : !data ? (
          <PageLoading />
        ) : (
          <>
            <ul className="ip-data-uses">
              <li>แสดงประเทศและผู้ให้บริการข้าง IP ในบันทึกเหตุการณ์ การแจ้งเตือน และรายการ IP ที่บล็อก</li>
              <li>อีเมลแจ้งการเข้าสู่ระบบของผู้ดูแลแพลตฟอร์มบอกประเทศ และเตือนเมื่อเข้าจากต่างประเทศเร็วเกินกว่าจะเดินทางได้จริง</li>
              <li>แชทผู้เยี่ยมชมจากเครือข่ายคลาวด์หรือ VPN เริ่มแชทใหม่ได้น้อยกว่าคนทั่วไป (5 เรื่องต่อวันต่อ IP) แต่ไม่ถูกบล็อก</li>
            </ul>
            <p className="ip-data-state" role="status">
              {data.running
                ? 'กำลังดาวน์โหลดและจัดเตรียมฐานข้อมูล…'
                : data.month
                  ? `ใช้ฉบับเดือน ${data.month} อัปเดตเมื่อ ${date(data.updated_at ?? '', true)} ประเทศ ${number(data.countries)} ช่วง ผู้ให้บริการ ${number(data.networks)} ช่วง ระบบอัปเดตเองทุกเดือน`
                  : data.enabled
                    ? 'เปิดใช้แล้ว แต่ยังไม่มีฐานข้อมูลในเครื่อง'
                    : 'ยังไม่ได้ใช้ กดดาวน์โหลดเพื่อเริ่มใช้ ไฟล์ขนาดประมาณ 12 MB ต่อเดือน'}
            </p>
            {!data.ok && data.error && !data.running && <p className="notice warning">{data.error}</p>}
            <div className="security-form-end">
              {data.enabled && (
                <button type="button" className="btn" disabled={data.running} onClick={stop}>
                  เลิกใช้
                </button>
              )}
              <button type="button" className="btn primary" disabled={data.running} onClick={download}>
                <Icon name="download" />
                {data.running ? 'กำลังดาวน์โหลด…' : data.month ? 'อัปเดตตอนนี้' : 'ดาวน์โหลดฐานข้อมูล'}
              </button>
            </div>
            <p className="tiny muted ip-data-credit">
              <a href={data.credit_url} target="_blank" rel="noopener noreferrer">
                {data.credit}
              </a>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
