'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import { useCustomerLogout } from '@/lib/customer-session';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useStaffLogout } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { LegalButton } from './LegalDocument';
import { LegalGate, useGateOnLoad } from './LegalGate';

/* เอกสารกฎหมาย where an organization's own people and its customers meet them (backend modules/legal):

     StaffLegal         above every page of the staff app. The terms: its admin is asked with a bar while a new
                        version is in its grace (GRACE_DAYS) and with a window that has to be answered once it is over,
                        or at once when the organization never agreed (one the platform made for it); the rest of the
                        team only hears, past the grace, that their admin has not agreed. The privacy notice for
                        system users: the same, for every member - a notice, so one click answers it.
     CustomerPrivacy    the customer's: a window when a new version is in force, with ยอมรับ and ไม่ยอมรับ. Declined,
                        what the customer has stays theirs to read and answer, but a new chat waits for an answer
                        (the server refuses it), and a bar says so.
     LegalPanel         ตั้งค่าองค์กร → ข้อตกลงและเอกสาร: which version the organization agreed to, when and by whom,
                        and the three documents to read.
     AccountPrivacyCard ตั้งค่าบัญชี: the privacy notice for system users, and the version this account acknowledged.

   Markup: pages/legal.css. */

/** Where somebody stands with a document (backend legal _standing): not agreed to the version in force, when its grace
    runs out (none when they never agreed), and whether it has. */
type Standing = { pending: boolean; due: string | null; overdue: boolean };
type OrganizationTerms = Standing & {
  current: { version: string; title: string; published_at: string } | null;
  accepted: { version: string; email: string; accepted_at: string } | null;
};
type MemberPrivacy = Standing & {
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

/** Everything the staff app asks about the documents, above the page: one window at a time (the terms before the
    notice), else the bars. */
export function StaffLegal({ admin, organization }: { admin: boolean; organization: string }) {
  const terms = useApi<OrganizationTerms>(ORGANIZATION_PATH).data;
  const privacy = useApi<MemberPrivacy>(ACCOUNT_PATH).data;
  const acceptTerms = useAcceptTerms();
  const acknowledge = useAcknowledgePrivacy();
  const logout = useStaffLogout();
  const termsGate = useGateOnLoad(terms ? admin && terms.overdue : undefined, terms ? !terms.pending : false);
  const privacyGate = useGateOnLoad(privacy?.overdue, privacy ? !privacy.pending : false);

  if (termsGate && terms?.current)
    return (
      <LegalGate
        doc="terms"
        heading={terms.accepted ? 'ข้อตกลงการใช้บริการฉบับใหม่' : 'ก่อนเริ่มใช้งาน'}
        lead={
          terms.accepted
            ? `ฉบับ ${terms.current.version} เผยแพร่เมื่อ ${date(terms.current.published_at)} และครบกำหนดยอมรับแล้ว ในฐานะผู้ดูแล กรุณาอ่านและยอมรับในนาม ${organization} เพื่อใช้งานต่อ`
            : `กรุณาอ่านและยอมรับข้อตกลงการใช้บริการในนาม ${organization} ข้อตกลงนี้คือสัญญาระหว่างองค์กรของคุณกับ Bookdose`
        }
        terms="ระหว่างนี้ทีมงานคนอื่นและลูกค้าขององค์กรใช้งานได้ตามปกติ หากองค์กรไม่ต้องการยอมรับ ยกเลิกการใช้บริการได้ตามข้อ 10 ของข้อตกลง"
        acceptLabel="ฉันอ่านและยอมรับในนามองค์กร"
        onAccept={acceptTerms}
        aside={
          <button type="button" className="btn subtle" onClick={() => void logout()}>
            ออกจากระบบ
          </button>
        }
      />
    );
  if (privacyGate && privacy?.current)
    return (
      <LegalGate
        doc="platform-privacy"
        heading={privacy.accepted ? 'ประกาศความเป็นส่วนตัวฉบับใหม่' : 'ก่อนเริ่มใช้งาน'}
        lead={
          privacy.accepted
            ? `ประกาศฉบับ ${privacy.current.version} ครบกำหนดรับทราบแล้ว กรุณาอ่านว่ามีอะไรเปลี่ยน แล้วกดรับทราบเพื่อใช้งานต่อ`
            : 'ระบบเก็บข้อมูลบางอย่างของคุณระหว่างทำงาน เช่น ชื่อ อีเมล และประวัติการเข้าสู่ระบบ กรุณาอ่านว่าเก็บอะไร ใช้ทำอะไร และคุณมีสิทธิ์อะไรบ้าง'
        }
        terms="นี่คือการแจ้งให้ทราบ ไม่ใช่การขออนุญาต กดรับทราบแล้วใช้งานต่อได้ทันที และเปิดอ่านอีกครั้งได้ที่ตั้งค่าบัญชี"
        acceptLabel="รับทราบ"
        onAccept={acknowledge}
      />
    );
  return (
    <>
      {admin && terms?.pending && terms.current && (
        <div className="terms-banner" role="status">
          <Icon name="file" />
          <span>
            ข้อตกลงการใช้บริการมีฉบับใหม่ (ฉบับ {terms.current.version}) กรุณาอ่านและยอมรับ
            {terms.due && <> ภายในวันที่ {date(terms.due)} หลังจากนั้นต้องยอมรับก่อนจึงจะใช้งานต่อได้</>}
          </span>
          <LegalButton doc="terms" label="อ่านและยอมรับ" onAccept={() => void acceptTerms()} />
        </div>
      )}
      {!admin && terms?.overdue && (
        <div className="terms-banner" role="status">
          <Icon name="file" />
          <span>องค์กรของคุณยังไม่ได้ยอมรับข้อตกลงการใช้บริการฉบับใหม่ กรุณาแจ้งหัวหน้าทีม คุณยังทำงานได้ตามปกติ</span>
        </div>
      )}
      {privacy?.pending && privacy.current && (
        <div className="terms-banner privacy-banner" role="status">
          <Icon name="shield" />
          <span>
            ประกาศความเป็นส่วนตัวมีฉบับใหม่ (ฉบับ {privacy.current.version}) กรุณาอ่านและรับทราบ
            {privacy.due && <> ภายในวันที่ {date(privacy.due)}</>}
          </span>
          <LegalButton doc="platform-privacy" label="อ่านและรับทราบ" onAccept={() => void acknowledge()} />
        </div>
      )}
    </>
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


function useAcknowledgePrivacy() {
  const toast = useToast();
  const refresh = useInvalidate();
  return async () => {
    try {
      await api(`${ACCOUNT_PATH}/accept`, {});
      toast('รับทราบประกาศความเป็นส่วนตัวแล้ว');
      await refresh(ACCOUNT_PATH);
    } catch (problem) {
      toast((problem as Error).message, true);
    }
  };
}

/** The customer side: a window when the account agreed to an older version of the customer notice, then a bar for
    as long as the answer is ไม่ยอมรับ (until the next visit, which asks again). */
export function CustomerPrivacy({ version }: { version: string }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const logout = useCustomerLogout();
  const [declined, setDeclined] = useUiState('customer-privacy-declined', false);
  const agree = async () => {
    try {
      await api('/api/customer/privacy/accept', {});
      toast('ยอมรับประกาศความเป็นส่วนตัวฉบับใหม่แล้ว');
      setDeclined(false);
      await refresh('/api/customer/account');
    } catch (problem) {
      toast((problem as Error).message, true);
    }
  };
  if (!declined)
    return (
      <LegalGate
        doc="customer-privacy"
        organization="องค์กร"
        heading="ประกาศความเป็นส่วนตัวฉบับใหม่"
        lead={`ประกาศฉบับ ${version} เปลี่ยนวิธีที่เราดูแลข้อมูลของคุณ กรุณาอ่านแล้วเลือกว่ายอมรับหรือไม่`}
        terms="ถ้าไม่ยอมรับ คุณยังอ่านแชทและเคสเดิม ตอบในแชทที่เปิดอยู่ และดาวน์โหลดข้อมูลของคุณได้ แต่จะเริ่มแชทใหม่ไม่ได้จนกว่าจะยอมรับ หรือจะขอลบบัญชีที่ตั้งค่าบัญชีก็ได้"
        acceptLabel="ยอมรับ"
        onAccept={agree}
        aside={
          <>
            <button type="button" className="btn subtle" onClick={() => void logout()}>
              ออกจากระบบ
            </button>
            <button type="button" className="btn" onClick={() => setDeclined(true)}>
              ไม่ยอมรับ
            </button>
          </>
        }
      />
    );
  return (
    <div className="terms-banner privacy-banner" role="status">
      <Icon name="shield" />
      <span>คุณยังไม่ยอมรับประกาศความเป็นส่วนตัวฉบับ {version} จึงเริ่มแชทใหม่ไม่ได้ แชทและเคสเดิมยังใช้ได้ตามปกติ</span>
      <LegalButton doc="customer-privacy" organization="องค์กร" label="อ่านและยอมรับ" onAccept={() => void agree()} />
      <Link className="btn privacy-open" href="/customer/account">
        ขอลบบัญชี
      </Link>
    </div>
  );
}
