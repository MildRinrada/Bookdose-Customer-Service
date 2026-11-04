'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { ApiError } from '@/lib/api/client';
import { number } from '@/lib/format';
import { useApi } from '@/lib/query';
import { signInAddress } from '@/lib/session-expiry';
import { OWN_SOURCES, pdpaLetterPage, pdpaLetterPath, type PdpaLetterData, type PdpaScope } from './api';

/* หนังสือแจ้งผล (/platform/pdpa/letter/<id>, opened from the PDPA tool's history): the formal letter that tells the
   person a request was about what was done. Every line comes from what the log recorded when the file was made or the
   data erased (backend pdpa/service.letter): the day the request came and where from, the counts per organization
   (never the data itself: the file is the copy, and after an erasure there is nothing left to show), the day it was
   done, and a number that stays the same however often it is printed. The provider is named as the legal documents
   name it (เอกสารกฎหมาย → ข้อมูลผู้ให้บริการ). The person's name and the signer are typed here and kept nowhere: the
   log keeps the person masked on purpose. The browser prints the page, or saves it as PDF, so Thai is set exactly as
   the screen sets it. Markup: pages/pdpa.css (.pdpa-letter). */

const THAILAND = 'Asia/Bangkok';
const LAW = 'พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562';
const SYSTEM = 'Bookdose Customer Service';

// Joins the parts of a date or a time, so a line never ends between the day and the month or before "น.".
const NBSP = '\u00a0';

/** "4 พฤศจิกายน 2569": a date as a formal Thai letter writes it, the month in full, the year in the Buddhist Era. */
function thaiDate(value: string | Date) {
  const text = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { day: 'numeric', month: 'long', year: 'numeric', timeZone: THAILAND }).format(new Date(value));
  return text.replace(/\s/g, NBSP);
}

/** "14.30 น." */
function thaiTime(value: string) {
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: THAILAND }).format(new Date(value));
  return `${clock.replace(':', '.')}${NBSP}น.`;
}

/* What each kind of request is called, and the section of the Act that gives the person the right it answers: the
   right of access and a copy (s. 30), and the right to have the data erased, destroyed or made unidentifiable (s. 33),
   which is what the erasure does - the account deleted, the records left with nothing that says who it was. */
const KINDS = {
  export: {
    subject: 'แจ้งผลการดำเนินการตามคำขอเข้าถึงและขอรับสำเนาข้อมูลส่วนบุคคล',
    request: 'คำขอเข้าถึงและขอรับสำเนาข้อมูลส่วนบุคคล',
    section: 30,
    done: 'จัดทำสำเนาข้อมูลส่วนบุคคลของท่านที่พบในระบบ',
    result: 'จัดทำสำเนาข้อมูลแล้ว',
  },
  erase: {
    subject: 'แจ้งผลการดำเนินการตามคำขอลบข้อมูลส่วนบุคคล',
    request: 'คำขอลบข้อมูลส่วนบุคคล',
    section: 33,
    done: 'ลบหรือทำให้ข้อมูลส่วนบุคคลของท่านที่พบในระบบเป็นข้อมูลที่ไม่สามารถระบุตัวท่านได้',
    result: 'ลบข้อมูลแล้ว',
  },
};

const IDENTIFIED_BY = { email: 'อีเมล', phone: 'เบอร์โทรศัพท์', name: 'ชื่อ' };

/* The counts the log keeps per organization, in the order the table shows them. A request logged before the letter
   existed has the records alone, and the table shows only what was recorded. */
type Organization = PdpaScope['organizations'][number];
const COUNTS: Array<[keyof Organization & string, string]> = [
  ['records', 'ข้อมูลลูกค้า'],
  ['conversations', 'บทสนทนา'],
  ['messages', 'ข้อความที่ท่านส่ง'],
  ['files', 'ไฟล์แนบ'],
  ['cases', 'เคส'],
];

/** The provider's details a letter cannot do without, which the legal console has not filled in yet. */
const NEEDED = [
  ['name', 'ชื่อนิติบุคคล'],
  ['address', 'ที่อยู่'],
  ['email', 'อีเมลติดต่อ'],
  ['phone', 'โทรศัพท์'],
] as const;

export function PdpaLetter({ id }: { id: string }) {
  const found = useApi<PdpaLetterData>(pdpaLetterPath(id));
  const [to, setTo] = useState('');
  const [signer, setSigner] = useState('');
  const [title, setTitle] = useState('');
  const reference = found.data?.request.reference;
  // What the browser offers as the PDF's file name.
  useEffect(() => {
    if (reference) document.title = `หนังสือแจ้งผล ${reference}`;
  }, [reference]);

  if (found.error)
    return (
      <div className="pdpa-letter-screen">
        <ErrorState error={found.error} onRetry={() => void found.refetch()}>
          {found.error instanceof ApiError && found.error.status === 401 && (
            <Link className="btn" href={signInAddress(pdpaLetterPage(id), null)}>
              เข้าสู่ระบบ
            </Link>
          )}
        </ErrorState>
      </div>
    );
  if (!found.data) return <PageLoading />;
  const { company } = found.data;
  const missing = NEEDED.filter(([key]) => !company[key]).map(([, label]) => label);

  return (
    <div className="pdpa-letter-screen">
      <div className="pdpa-letter-tools">
        <Link href="/platform/pdpa" className="back-link">
          <Icon name="back" />
          เครื่องมือ PDPA
        </Link>
        <div className="pdpa-letter-heading">
          <div>
            <h1>หนังสือแจ้งผลถึงเจ้าของข้อมูล</h1>
            <p>
              {KINDS[found.data.request.kind].result} เลขที่ {reference}
            </p>
          </div>
          <button type="button" className="btn primary" onClick={() => window.print()}>
            <Icon name="download" />
            ดาวน์โหลด PDF
          </button>
        </div>
        {missing.length > 0 && (
          <p className="notice warning">
            ยังไม่ได้กรอกข้อมูลผู้ให้บริการ: {missing.join(' ')} หนังสือจึงยังไม่มีส่วนนี้ กรอกได้ที่{' '}
            <Link href="/platform/legal" target="_blank" rel="noopener">
              เอกสารกฎหมาย
            </Link>{' '}
            แล้วเปิดหน้านี้ใหม่
          </p>
        )}
        <div className="pdpa-letter-fields">
          <label className="field">
            <span>เรียน</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} maxLength={120} placeholder="ชื่อเจ้าของข้อมูล" autoComplete="off" />
          </label>
          <label className="field">
            <span>ผู้ลงนาม</span>
            <input value={signer} onChange={(e) => setSigner(e.target.value)} maxLength={120} placeholder="ชื่อผู้ลงนาม" autoComplete="off" />
          </label>
          <label className="field">
            <span>ตำแหน่งผู้ลงนาม</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="ตำแหน่ง" autoComplete="off" />
          </label>
        </div>
        <p className="tiny muted">
          ชื่อที่พิมพ์ที่นี่ใช้ในหนังสือฉบับนี้เท่านั้น ไม่บันทึกในระบบ ช่องที่เว้นว่างจะพิมพ์เป็นเส้นให้เขียนด้วยมือ กดดาวน์โหลด PDF แล้วเลือก
          &quot;บันทึกเป็น PDF&quot; ในหน้าต่างพิมพ์
        </p>
      </div>
      <Letter data={found.data} to={to.trim()} signer={signer.trim()} title={title.trim()} />
    </div>
  );
}

/** A line to write on by hand, for what was left empty. */
const Blank = () => <span className="pdpa-letter-blank" />;

function Letter({ data, to, signer, title }: { data: PdpaLetterData; to: string; signer: string; title: string }) {
  const { request, company } = data;
  const kind = KINDS[request.kind];
  const exported = request.kind === 'export';
  const organizations = request.scope.organizations;
  const accounts = request.scope.accounts;
  // The person's own request (or their organization's on their behalf) is their right under the Act; an order of an
  // authority, or another way typed out, is answered without claiming so.
  const own = OWN_SOURCES.some((source) => request.reason.startsWith(source));
  const received = request.received_on ? thaiDate(request.received_on) : '';
  const done = `${thaiDate(request.created_at)} เวลา ${thaiTime(request.created_at)}`;
  const provider = company.name ? `${company.name} ซึ่งเป็นผู้ให้บริการระบบ ${SYSTEM}` : `ผู้ให้บริการระบบ ${SYSTEM}`;
  const reachable = Boolean(company.email || company.phone || company.dpo);
  const identifier = `${IDENTIFIED_BY[request.subject_kind]} ${request.subject.replace(/\s*\(ชื่อ\)$/, '')} (แสดงบางส่วน)`;
  const columns = COUNTS.filter(([key]) => organizations.some((o) => o[key] != null));
  const total = (key: keyof Organization) => organizations.reduce((sum, o) => sum + (Number(o[key]) || 0), 0);

  // The number heads the letter and every page's foot; the Act is named in full in the first paragraph.
  const facts: Array<[string, ReactNode]> = [
    ['ประเภทคำขอ', own ? `${kind.request} (มาตรา ${kind.section})` : kind.request],
    ['ข้อมูลที่ใช้ระบุตัวเจ้าของข้อมูล', identifier],
    ['ที่มาของคำขอ', request.reason],
    ...(received ? ([['วันที่ได้รับคำขอ', received]] as Array<[string, ReactNode]>) : []),
    ['วันที่ดำเนินการแล้วเสร็จ', done],
    ['ผลการดำเนินการ', kind.result],
  ];

  return (
    <article className="pdpa-letter" aria-label={`หนังสือแจ้งผล เลขที่ ${request.reference}`}>
      {/* The head and foot bands are the page's top and bottom margins: the browser repeats a table's head and foot
          on every printed page. The foot band is empty room for the line below it, which prints on every page. */}
      <table className="pdpa-letter-page" role="presentation">
        <thead>
          <tr>
            <td>
              <div className="pdpa-letter-band" />
            </td>
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td>
              <div className="pdpa-letter-band" />
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td>
              <header className="pdpa-letter-letterhead">
                <strong>{company.name || SYSTEM}</strong>
                {company.address && <span>{company.address}</span>}
                {(company.phone || company.email) && (
                  <span>
                    {company.phone && `โทรศัพท์ ${company.phone}`}
                    {company.phone && company.email && <span className="pdpa-letter-gap" />}
                    {company.email && `อีเมล ${company.email}`}
                  </span>
                )}
              </header>
              <div className="pdpa-letter-meta">
                <span>ที่ {request.reference}</span>
                <span>{thaiDate(new Date())}</span>
              </div>
              <dl className="pdpa-letter-lines">
                <div>
                  <dt>เรื่อง</dt>
                  <dd>{kind.subject}</dd>
                </div>
                <div>
                  <dt>เรียน</dt>
                  <dd>{to || 'เจ้าของข้อมูลส่วนบุคคล'}</dd>
                </div>
                {exported && (
                  <div>
                    <dt>สิ่งที่ส่งมาด้วย</dt>
                    <dd>สำเนาข้อมูลส่วนบุคคลของท่าน ในรูปแบบไฟล์ ZIP จำนวน 1 ไฟล์</dd>
                  </div>
                )}
              </dl>

              <p className="pdpa-letter-para">
                ตามที่{provider} ได้รับ{exported ? 'คำขอเข้าถึงและขอรับสำเนาข้อมูลส่วนบุคคลของท่าน' : 'คำขอให้ลบข้อมูลส่วนบุคคลของท่าน'}
                {received && ` เมื่อวันที่ ${received}`}
                {own ? ` ซึ่งเป็นการใช้สิทธิของเจ้าของข้อมูลส่วนบุคคลตามมาตรา ${kind.section} แห่ง${LAW} นั้น` : ' ตามที่มาที่ระบุในข้อ 1 นั้น'}
              </p>
              <p className="pdpa-letter-para">
                บัดนี้ ผู้ให้บริการได้ดำเนินการตามคำขอดังกล่าวแล้วเสร็จเมื่อวันที่ {done} โดย{kind.done} ตามรายละเอียดดังต่อไปนี้
              </p>

              <section className="pdpa-letter-section">
                <h2>1. รายละเอียดคำขอ</h2>
                <table className="pdpa-letter-table is-facts">
                  <tbody>
                    {facts.map(([label, value]) => (
                      <tr key={label}>
                        <th scope="row">{label}</th>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="pdpa-letter-section">
                <h2>2. ข้อมูลที่พบในระบบ</h2>
                {accounts > 0 && <p>บัญชีลูกค้าซึ่งใช้เข้าสู่ระบบได้ทุกองค์กร จำนวน {number(accounts)} บัญชี</p>}
                {organizations.length > 0 ? (
                  <table className="pdpa-letter-table is-counts">
                    <caption>ข้อมูลในแต่ละองค์กรที่ใช้ระบบ (จำนวนรายการ)</caption>
                    <thead>
                      <tr>
                        <th scope="col">ลำดับ</th>
                        <th scope="col">องค์กร</th>
                        {columns.map(([key, label]) => (
                          <th scope="col" key={key}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {organizations.map((o, index) => (
                        <tr key={`${o.organization}:${index}`}>
                          <td className="is-place">{index + 1}</td>
                          <td>{o.organization}</td>
                          {columns.map(([key]) => (
                            <td key={key} className="is-figure">
                              {o[key] == null ? '-' : number(o[key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {organizations.length > 1 && (
                        <tr className="is-total">
                          <td colSpan={2}>รวม</td>
                          {columns.map(([key]) => (
                            <td key={key} className="is-figure">
                              {number(total(key))}
                            </td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                  </table>
                ) : (
                  <p>ไม่พบข้อมูลลูกค้าของท่านในองค์กรใด</p>
                )}
                <p className="pdpa-letter-note">
                  ตัวเลขข้างต้นเป็นจำนวนรายการ ณ เวลาที่ดำเนินการ หนังสือนี้ไม่แสดงเนื้อหาของข้อมูล
                  {exported && ' เนื้อหาทั้งหมดอยู่ในสำเนาที่ส่งมาด้วย'}
                </p>
              </section>

              {exported ? (
                <>
                  <section className="pdpa-letter-section">
                    <h2>3. ข้อมูลในสำเนาที่ส่งมาด้วย</h2>
                    <ul>
                      <li>
                        ไฟล์ ZIP ประกอบด้วย data.json ซึ่งเก็บข้อมูลทั้งหมดในรูปแบบที่อ่านด้วยเครื่องคอมพิวเตอร์ได้ README.txt ซึ่งอธิบายว่าข้อมูลใดอยู่ส่วนใด
                        และโฟลเดอร์ files ซึ่งเก็บไฟล์แนบในบทสนทนา
                      </li>
                      {accounts > 0 && (
                        <li>ข้อมูลบัญชีลูกค้า ได้แก่ ชื่อ อีเมล เบอร์โทรศัพท์ การให้ความยินยอม องค์กรที่ท่านเข้าร่วม ประวัติการเข้าสู่ระบบ กิจกรรมของบัญชี และ Passkey ที่ลงทะเบียนไว้</li>
                      )}
                      {organizations.length > 0 && (
                        <li>
                          ข้อมูลในแต่ละองค์กร ได้แก่ ข้อมูลลูกค้า ข้อมูลที่ให้ไว้เมื่อแชทโดยไม่เข้าสู่ระบบ บทสนทนาทุกเรื่องตามที่ท่านเห็นพร้อมไฟล์แนบ
                          และเคสพร้อมคะแนนความพึงพอใจและข้อมูลที่ทีมงานกรอกไว้ในเคส
                        </li>
                      )}
                      <li>สำเนานี้ไม่รวมบันทึกภายในที่ทีมงานขององค์กรเขียนไว้ระหว่างการทำงาน ซึ่งไม่ได้แสดงต่อท่านในบทสนทนา</li>
                      <li>เวลาในไฟล์เป็นเวลาสากลเชิงพิกัด (UTC) ซึ่งช้ากว่าเวลาประเทศไทย 7 ชั่วโมง</li>
                    </ul>
                  </section>
                  <section className="pdpa-letter-section">
                    <h2>4. ข้อมูลในระบบหลังการจัดทำสำเนา</h2>
                    <ul>
                      <li>การจัดทำสำเนาไม่ได้เปลี่ยนแปลงหรือลบข้อมูลของท่าน ข้อมูลยังคงอยู่ในระบบตามเดิม</li>
                      <li>การจัดทำสำเนาครั้งนี้บันทึกไว้ในประวัติการดำเนินการของระบบ และของแต่ละองค์กรที่เกี่ยวข้อง</li>
                    </ul>
                  </section>
                </>
              ) : (
                <>
                  <section className="pdpa-letter-section">
                    <h2>3. การดำเนินการ</h2>
                    <ul>
                      {accounts > 0 && (
                        <li>ลบบัญชีลูกค้า พร้อมประวัติการเข้าสู่ระบบ กิจกรรมของบัญชี Passkey และการตั้งค่าความปลอดภัย ท่านจะเข้าสู่ระบบด้วยบัญชีนี้ไม่ได้อีก</li>
                      )}
                      {organizations.length > 0 && (
                        <>
                          <li>ลบชื่อ อีเมล เบอร์โทรศัพท์ ชื่อบริษัท บันทึก และข้อมูลโปรไฟล์ของท่าน ออกจากข้อมูลลูกค้าในแต่ละองค์กร</li>
                          <li>ล้างเนื้อหาทุกข้อความในบทสนทนา และลบไฟล์แนบ</li>
                          <li>ลบหัวข้อเรื่อง สรุปบทสนทนา คำแปล ความคิดเห็นในแบบประเมินความพึงพอใจ ข้อมูลที่ทีมงานกรอกไว้ในเคส และข้อมูลที่ให้ไว้เมื่อแชทโดยไม่เข้าสู่ระบบ</li>
                          <li>ทิ้งสำเนาของข้อมูลเหล่านี้ที่อยู่ในถังขยะของระบบ</li>
                        </>
                      )}
                    </ul>
                  </section>
                  <section className="pdpa-letter-section">
                    <h2>4. ข้อมูลที่ยังคงอยู่และเหตุผล</h2>
                    <ul>
                      {organizations.length > 0 && (
                        <li>
                          รายการข้อมูลลูกค้า บทสนทนา และเคส ยังคงอยู่ในระบบโดยไม่มีชื่อ ข้อมูลติดต่อ หรือเนื้อหาที่ท่านส่ง เพื่อให้จำนวนเคสและรายงานสถิติขององค์กรยังคงถูกต้อง
                        </li>
                      )}
                      <li>
                        บันทึกการดำเนินการตามคำขอนี้ ได้แก่ ประเภทคำขอ ที่มาของคำขอ วันเวลา จำนวนรายการ และข้อมูลที่ใช้ระบุตัวแบบแสดงบางส่วนตามข้อ 1
                        เก็บไว้เป็นหลักฐานการดำเนินการตามคำขอ โดยไม่เก็บอีเมล เบอร์โทรศัพท์ หรือชื่อของท่านในรูปที่อ่านได้
                      </li>
                      <li>ไฟล์สำรองข้อมูลของระบบที่จัดทำไว้ก่อนวันที่ลบ ยังมีข้อมูลดังกล่าวอยู่จนกว่าไฟล์สำรองนั้นจะหมดอายุ</li>
                    </ul>
                  </section>
                </>
              )}

              <div className="pdpa-letter-close">
                <p className="pdpa-letter-para">
                  หากท่านมีข้อสงสัยเกี่ยวกับการดำเนินการนี้ หรือประสงค์จะใช้สิทธิอื่นเกี่ยวกับข้อมูลส่วนบุคคลของท่าน โปรดติดต่อผู้ให้บริการ
                  {reachable && 'ตามช่องทางด้านล่าง'} โดยแจ้งเลขที่ {request.reference} ทั้งนี้ ท่านมีสิทธิร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลตามที่กฎหมายกำหนด
                </p>
                <p className="pdpa-letter-para">จึงเรียนมาเพื่อโปรดทราบ</p>
                <div className="pdpa-letter-sign">
                  <p>ขอแสดงความนับถือ</p>
                  <div className="pdpa-letter-signature" />
                  <p>({signer || <Blank />})</p>
                  <p>{title || <>ตำแหน่ง <Blank /></>}</p>
                  {company.name && <p>{company.name}</p>}
                </div>
                {reachable && (
                  <div className="pdpa-letter-contact">
                    <strong>ติดต่อเรื่องข้อมูลส่วนบุคคล</strong>
                    {company.dpo && <span>เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล {company.dpo}</span>}
                    {company.email && <span>อีเมล {company.email}</span>}
                    {company.phone && <span>โทรศัพท์ {company.phone}</span>}
                  </div>
                )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <footer className="pdpa-letter-foot">
        <span>{company.name || SYSTEM}</span>
        <span>เลขที่ {request.reference}</span>
      </footer>
    </article>
  );
}
