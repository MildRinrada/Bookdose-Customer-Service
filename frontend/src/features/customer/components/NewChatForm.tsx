'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { RequiredStar, SelectField, TextField } from '@/components/ui/fields';
import { filesOf } from '@/components/ui/FileInput';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { FilePills, FileProblem, useFilePills } from '@/features/rich/FilePills';
import { RichTextArea } from '@/features/rich/RichTextArea';
import { ScreenRecorder } from '@/features/rich/ScreenRecorder';
import { readFiles } from '@/lib/files';
import { useApi, useInvalidate } from '@/lib/query';
import type { CustomerOrg } from '@/lib/types';
import { FAQ_PATH, openChat, OVERVIEW_PATH } from '../api';
import { useOrgFilter, useOrgs, useOverview } from '../hooks';
import { replyPromise } from '../labels';
import type { CustomerArticle } from '../types';
import { KnownIssuesBar } from '@/features/incidents/KnownIssues';
import { AnswerSuggestions, type PeekArticle } from './ArticlePeek';
import { OrgPicker } from './OrgPicker';
import { askedMemberText, SameMemberChoice } from './SameMember';
import { StartFields, startFieldValues } from './StartFields';

/* A new chat starts with who it is for: the platform itself (problems with the system) or one of the organizations
   the customer deals with (their services and their own cases). The welcome, the reply promise and the categories
   are that organization's (pages/customer/customer-new-chat.html). */

function OrgIntro({ org }: { org: CustomerOrg | undefined }) {
  if (!org) return null;
  const promise = replyPromise(org);
  return (
    <>
      {org.welcome && <p className="customer-welcome">{org.welcome}</p>}
      <p className="customer-promise">
        <Icon name="clock" />
        <span>{promise ? `ทีมงาน ${org.name} ตอบกลับครั้งแรกภายใน ${promise}` : `ทีมงาน ${org.name} จะติดต่อกลับโดยเร็วที่สุด`}</span>
      </p>
      {org.ai_enabled && (
        <p className="customer-ai-note">
          <Icon name="sparkle" />
          <span>
            AI ผู้ช่วยของ {org.name} จะอ่านข้อความและบทความช่วยเหลือเพื่อเตรียมคำตอบ กด “คุยกับเจ้าหน้าที่” ในแชทเพื่อคุยกับคนได้ตลอดเวลา
          </span>
        </p>
      )}
    </>
  );
}

export function NewChatForm({ preselect = '', follows = '', hasChats }: { preselect?: string; follows?: string; hasChats: boolean }) {
  const orgs = useOrgs();
  const [orgFilter] = useOrgFilter();
  // ต่อจากเรื่องเดิม: the customer's earlier chats with the chosen organization, newest first; a link may name one.
  const earlierChats = useOverview().conversations;
  const carried = earlierChats.find((c) => c.id === follows);
  const initial =
    orgs.find((o) => o.slug === carried?.org_slug) ?? orgs.find((o) => o.slug === preselect) ?? orgs.find((o) => o.slug === orgFilter) ?? orgs[0];
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const earlier = earlierChats.filter((c) => c.org_slug === slug);
  const org = orgs.find((o) => o.slug === slug);
  const toast = useToast();
  const refresh = useInvalidate();
  const router = useRouter();
  // What has been typed so far, searched against the chosen organization's published answers before this is sent.
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // แบบฟอร์มตามหมวดเรื่อง: the fields asked for follow the category picked.
  const [category, setCategory] = useState('');
  const faq = useApi<{ articles: CustomerArticle[] }>(FAQ_PATH);
  const articles: PeekArticle[] = (faq.data?.articles ?? []).filter((a) => a.org_slug === slug);

  return (
    <>
      <div className="card-header conv-header new-chat-header">
        {hasChats && (
          <Link className="icon-btn conv-back" href="/customer/chats" aria-label="กลับไปที่รายการแชท">
            <Icon name="back" />
          </Link>
        )}
        <div className="conv-title">
          <h2>เริ่มแชทใหม่</h2>
          <p className="conv-meta">เลือกองค์กรที่ต้องการติดต่อ แล้วเล่าเรื่องให้ทีมงานฟัง เรื่องจะถึงทีมขององค์กรนั้นโดยตรง</p>
        </div>
      </div>
      <Form
        className="card-body customer-new-chat"
        data-form="customer-request"
        onSubmit={async (values, form) => {
          const attachments = await readFiles(filesOf(form, 'files'));
          const result = await openChat(values.org, {
            subject: values.subject ?? '',
            body: values.body ?? '',
            category: values.category || '',
            attachments,
            fields: startFieldValues(values, org?.form_fields, values.category || ''),
            ...(values.follows ? { follows: values.follows } : {}),
            ...(values.same_member === 'on' ? { same_member: true } : {}),
          });
          const sentTo = `ส่งถึง ${orgs.find((o) => o.slug === values.org)?.name || 'ทีมงาน'} แล้ว`;
          toast(result.asked_member ? `${sentTo} ${askedMemberText(result.asked_member)}` : `${sentTo} ติดตามคำตอบได้ในแชทนี้`);
          // The new chat must be in the list when its page opens.
          await refresh(OVERVIEW_PATH);
          router.push(`/customer/chats/${values.org}/${result.id}`);
        }}
      >
        <div className="field">
          <label htmlFor="request-org">
            ติดต่อองค์กร
            <RequiredStar />
          </label>
          <OrgPicker id="request-org" orgs={orgs} value={slug} onChange={setSlug} />
          <KnownIssuesBar slug={slug} follow />
          <small className="muted">
            ตัวระบบค้าง หน้าเว็บผิดปกติ หรือพบ Bug ติดต่อผู้ให้บริการระบบได้เสมอ · เรื่องบริการ สินค้า หรือเคสขององค์กรใด ให้เลือกองค์กรนั้น · องค์กรใหม่จะอยู่ในรายการเมื่อเปิดเคสให้คุณ หรือให้ลิงก์เข้าร่วมมา
          </small>
        </div>
        <div id="customer-org-intro" className="customer-org-intro" aria-live="polite">
          <OrgIntro org={org} />
        </div>
        {/* ต่อจากเรื่องเดิม: the team sees the earlier chat at once, so nothing has to be told again. */}
        {earlier.length > 0 && (
          <SelectField key={`follows-${slug}`} label="ต่อจากเรื่องเดิม (ไม่บังคับ)" name="follows" id="request-follows" defaultValue={carried?.org_slug === slug ? follows : ''}>
            <option value="">เรื่องใหม่ ไม่เกี่ยวกับเรื่องเดิม</option>
            {earlier.slice(0, 30).map((c) => (
              <option key={c.id} value={c.id}>
                {c.ticket_number ? `BD-${c.ticket_number} · ` : ''}
                {c.subject}
              </option>
            ))}
          </SelectField>
        )}
        {/* ขอคนเดิม: the member of the last case with this organization, when there was one in the last 30 days. */}
        <SameMemberChoice key={`member-${slug}`} member={org?.last_member} id="request-same-member" />
        {/* Another organization has its own categories: the choice starts over. */}
        <SelectField key={slug} label="หมวดเรื่อง" name="category" id="request-category" required defaultValue="" onChange={(e) => setCategory(e.target.value)}>
          <option value="">เลือกหมวดเรื่อง</option>
          {(org?.categories ?? []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </SelectField>
        <StartFields key={`fields-${slug}`} fields={org?.form_fields} category={category} idPrefix="request-field" />
        <TextField
          label="เรื่องที่ต้องการความช่วยเหลือ"
          name="subject"
          max={300}
          placeholder="สรุปสั้น ๆ ว่าเรื่องอะไร"
          onChange={(event) => setSubject(event.target.value)}
        />
        <RichTextArea
          label="รายละเอียด"
          name="body"
          id="request-body"
          placeholder="เกิดอะไรขึ้น ทำอะไรอยู่ตอนนั้น และเห็นข้อความอะไรบ้าง ยิ่งเล่าละเอียด ทีมงานยิ่งช่วยได้ตรงจุด"
          onChange={setBody}
        />
        {/* Their question may already have an answer: it is offered here, while they write, rather than after a wait. */}
        <AnswerSuggestions articles={articles} hrefOf={(a) => `/customer/faq/${a.id}`} text={`${subject} ${body}`} slug={slug} />
        <AttachmentsField />
        <p className="tiny muted">เพื่อความปลอดภัย กรุณาอย่าส่งรหัสผ่านหรือข้อมูลส่วนตัวที่สำคัญในแชท</p>
        <button className="btn primary" type="submit">
          <Icon name="send" />
          ส่งถึงทีมงาน
        </button>
      </Form>
    </>
  );
}

/** The attachments field: it owns the file input, its ref and the pills. The form reads the files from the input
    itself when it is sent (filesOf), so nothing above needs them. */
function AttachmentsField() {
  const { inputRef, files, problem, onChange, remove, replace, add, used, report } = useFilePills();
  return (
    <div className="field">
      <span className="file-field-title">แนบไฟล์ (ไม่บังคับ)</span>
      {/* The two ways to attach side by side, as buttons of their own width (the field is a column that stretched
          each of them across the form). */}
      <div className="attach-row">
        <input
          ref={inputRef}
          id="request-files"
          className="attach-input"
          name="files"
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.txt"
          aria-label="แนบไฟล์"
          aria-describedby="request-files-help"
          data-file-ready="1"
          onChange={onChange}
        />
        <label className="btn subtle customer-attach" htmlFor="request-files">
          <Icon name="paperclip" />
          เลือกไฟล์จากเครื่อง
        </label>
        <ScreenRecorder look="button" used={used} onFile={(file) => add([file])} onProblem={report} />
      </div>
      <p className="tiny muted" id="request-files-help">
        แนบภาพหรือวิดีโออธิบายปัญหาได้ · สูงสุด 3 ไฟล์ รวม 5 MB · PNG, JPG, GIF, WebP, MP4, WebM, PDF และ TXT
      </p>
      <FilePills files={files} onRemove={remove} onReplace={replace} />
      <FileProblem problem={problem} />
    </div>
  );
}
