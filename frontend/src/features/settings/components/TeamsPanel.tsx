'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useWork } from '@/lib/session';

/* ตั้งค่า → ทีมและสมาชิก. The people used to be managed here, in a tab of the settings, as though an organization
   never had more than a handful. They have their own screen now (/members, features/members), with the room a list
   of that kind needs; what is left here is the way to it, so an old link or an old habit still arrives. */

export function TeamsPanel() {
  const work = useWork();
  const active = work.members.filter((m) => m.active).length;
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>ทีมและสมาชิก</h2>
          <p>ย้ายไปอยู่หน้าของตัวเองแล้ว หาได้จากเมนูซ้าย หัวข้อ จัดการ</p>
        </div>
        <Icon name="users" />
      </div>
      <div className="card-body">
        <p className="muted">
          ตอนนี้มี {work.members.length} คนในองค์กร เปิดใช้งาน {active} คน และ {work.teams.length} ทีม เพิ่มสมาชิก เปลี่ยนบทบาท ย้ายทีม
          และเปลี่ยนชื่อทีม ทำได้ที่หน้านั้น
        </p>
        <Link className="btn primary" href="/members">
          <Icon name="users" />
          ไปที่ ทีมและสมาชิก
        </Link>
      </div>
    </section>
  );
}
