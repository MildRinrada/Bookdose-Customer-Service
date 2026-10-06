'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { LegalButton } from './LegalDocument';

/* เอกสารกฎหมาย where an organization's own people meet them (backend modules/legal):

     TermsBanner        above every page, for the organization's admin, while the organization has not agreed to the
                        terms in force - one the platform made for it never went through the sign-up page, and a new
                        version is agreed to again. Reading and agreeing happen in the window it opens.
     LegalPanel         ตั้งค่าองค์กร → ข้อตกลงและเอกสาร: which version the organization agreed to, when and by whom,
                        and the three documents to read.
     AccountPrivacyCard ตั้งค่าบัญชี: the privacy notice for system users, and the version this account acknowledged.

   Markup: pages/legal.css. */

type OrganizationTerms = {
  current: { version: string; title: string; published_at: string } | null;
  accepted: { version: string; email: string; accepted_at: string } | null;
  pending: boolean;
};
type MemberPrivacy = {
  current: { version: string; published_at: string } | null;
  accepted: { version: string; accepted_at: string } | null;
};

const ORGANIZATION_PATH = '/api/legal/organization';
const ACCOUNT_PATH = '/api/legal/account';

function useAcceptTerms() {
  const toast = useToast();
  const refresh = useInvalidate();
  return async () => {
    try {
      await api(`${ORGANIZATION_PATH}/accept`, {});
      toast('ยอมรับข้อตกลงการใช้บริการในนามองค์กรแล้ว');
      await refresh(ORGANIZATION_PATH);
    } catch (problem) {
      toast((problem as Error).message, true);
    }
  };
}

/** The bar for the organization's admin while the terms in force are not agreed to. Shown to admins only: nobody
    else may agree in the organization's name. */
export function TermsBanner() {
  const terms = useApi<OrganizationTerms>(ORGANIZATION_PATH);
  const accept = useAcceptTerms();
  if (!terms.data?.pending || !terms.data.current) return null;
  const first = !terms.data.accepted;
  return (
    <div className="terms-banner" role="status">
      <Icon name="file" />
      <span>
        {first
          ? 'กรุณาอ่านและยอมรับข้อตกลงการใช้บริการในนามองค์กรของคุณ'
          : `ข้อตกลงการใช้บริการมีฉบับใหม่ (ฉบับ ${terms.data.current.version} เผยแพร่ ${date(terms.data.current.published_at)}) กรุณาอ่านและยอมรับ`}
      </span>
      <LegalButton doc="terms" label="อ่านและยอมรับ" onAccept={() => void accept()} />
    </div>
  );
}

/** ตั้งค่าองค์กร → ข้อตกลงและเอกสาร. */
export function LegalPanel() {
  const terms = useApi<OrganizationTerms>(ORGANIZATION_PATH);
  const accept = useAcceptTerms();
  const data = terms.data;
  return (
    <section className="card legal-panel" aria-labelledby="legal-panel-title">
      <div className="card-header">
        <div>
          <h2 id="legal-panel-title">ข้อตกลงและเอกสาร</h2>
          <p>ข้อตกลงระหว่างองค์กรของคุณกับ Bookdose และประกาศความเป็นส่วนตัวที่ใช้ในระบบ</p>
        </div>
      </div>
      <div className="card-body">
        <div className={`legal-standing${data?.pending ? ' pending' : ''}`}>
          <Icon name={data?.pending ? 'bell' : 'checkCircle'} />
          <div>
            <strong>ข้อตกลงการใช้บริการ</strong>
            {!data ? (
              <span className="tiny muted">กำลังโหลด…</span>
            ) : data.accepted ? (
              <span>
                องค์กรยอมรับฉบับ {data.accepted.version} เมื่อ {date(data.accepted.accepted_at, true)} โดย {data.accepted.email}
              </span>
            ) : (
              <span>องค์กรยังไม่ได้ยอมรับข้อตกลง</span>
            )}
            {data?.pending && data.current && data.accepted && <span className="tiny">ฉบับที่ใช้อยู่ตอนนี้คือ {data.current.version}</span>}
          </div>
          {data?.pending ? (
            <LegalButton doc="terms" label="อ่านและยอมรับ" onAccept={() => void accept()} />
          ) : (
            <LegalButton doc="terms" label="อ่าน" />
          )}
        </div>
        <ul className="legal-links">
          <li>
            <Link href="/legal/terms" target="_blank" rel="noopener">
              <Icon name="file" /> ข้อตกลงการใช้บริการ (รวมข้อตกลงการประมวลผลข้อมูลส่วนบุคคล)
            </Link>
          </li>
          <li>
            <Link href="/legal/platform-privacy" target="_blank" rel="noopener">
              <Icon name="shield" /> ประกาศความเป็นส่วนตัวสำหรับผู้ใช้งานระบบ (ทีมงานของคุณ)
            </Link>
          </li>
          <li>
            <Link href="/legal/customer-privacy" target="_blank" rel="noopener">
              <Icon name="shield" /> ประกาศความเป็นส่วนตัวสำหรับลูกค้า (ที่ลูกค้าของคุณยอมรับตอนสมัคร)
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}

/** ตั้งค่าบัญชี: the notice for system users, and which version this account acknowledged. */
export function AccountPrivacyCard() {
  const privacy = useApi<MemberPrivacy>(ACCOUNT_PATH).data;
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>ความเป็นส่วนตัว</h2>
          <p>ข้อมูลของคุณที่ระบบเก็บ ใช้ทำอะไร และสิทธิ์ของคุณ</p>
        </div>
      </div>
      <div className="card-body legal-account">
        <p className="tiny muted">
          {privacy?.accepted
            ? `คุณรับทราบประกาศฉบับ ${privacy.accepted.version} เมื่อ ${date(privacy.accepted.accepted_at, true)}`
            : privacy?.current
              ? `ประกาศฉบับที่ใช้อยู่ ${privacy.current.version}`
              : ''}
        </p>
        <LegalButton doc="platform-privacy" label="อ่านประกาศความเป็นส่วนตัว" />
      </div>
    </section>
  );
}


/** A staff member who has not acknowledged the privacy notice in force: an account made before there was one, or a
    new version since. Acknowledging happens at the foot of the notice. */
export function PrivacyBanner() {
  const privacy = useApi<MemberPrivacy>(ACCOUNT_PATH).data;
  const toast = useToast();
  const refresh = useInvalidate();
  if (!privacy?.current || privacy.accepted?.version === privacy.current.version) return null;
  const acknowledge = async () => {
    try {
      await api(`${ACCOUNT_PATH}/accept`, {});
      toast('รับทราบประกาศความเป็นส่วนตัวแล้ว');
      await refresh(ACCOUNT_PATH);
    } catch (problem) {
      toast((problem as Error).message, true);
    }
  };
  return (
    <div className="terms-banner privacy-banner" role="status">
      <Icon name="shield" />
      <span>
        {privacy.accepted
          ? `ประกาศความเป็นส่วนตัวมีฉบับใหม่ (ฉบับ ${privacy.current.version}) กรุณาอ่านและรับทราบ`
          : 'กรุณาอ่านและรับทราบประกาศความเป็นส่วนตัวสำหรับผู้ใช้งานระบบ'}
      </span>
      <LegalButton doc="platform-privacy" label="อ่านและรับทราบ" onAccept={() => void acknowledge()} />
    </div>
  );
}

/** A customer whose agreed version of the customer privacy notice is no longer the one in force. */
export function CustomerPrivacyBanner({ version }: { version: string }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const agree = async () => {
    try {
      await api('/api/customer/privacy/accept', {});
      toast('ยอมรับประกาศความเป็นส่วนตัวฉบับใหม่แล้ว');
      await refresh('/api/customer/account');
    } catch (problem) {
      toast((problem as Error).message, true);
    }
  };
  return (
    <div className="terms-banner privacy-banner" role="status">
      <Icon name="shield" />
      <span>ประกาศความเป็นส่วนตัวมีฉบับใหม่ (ฉบับ {version}) กรุณาอ่านและยอมรับ</span>
      <LegalButton doc="customer-privacy" organization="องค์กร" label="อ่านและยอมรับ" onAccept={() => void agree()} />
    </div>
  );
}
