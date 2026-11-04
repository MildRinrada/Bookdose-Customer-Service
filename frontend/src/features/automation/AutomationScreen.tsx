'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { TextArea, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { usePinnedMenu } from '@/components/ui/usePinnedMenu';
import { RichTextField, RichToolbar, useRichEditor } from '@/features/rich/RichEditor';
import type { RichFormat } from '@/features/rich/types';
import { useCaseTags } from '@/features/tickets/tags';
import { plainText } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useMemberName, useTeamName, useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { AUTOMATION_PATH, deleteMacro, deleteRule, saveAutomationSettings, saveRule } from './api';
import { DistributionCard } from './components/DistributionCard';
import { EscalationRow } from './components/EscalationRow';
import { MacroForm } from './components/MacroForm';
import { RuleForm } from './components/RuleForm';
import { macroSteps, ruleActions, ruleCondition } from './labels';
import type { AutomationPage, AutomationRule, AutomationSettings, Macro } from './types';

/* Automation, managed by admins: laid out as ตั้งค่าองค์กร is, a menu of its parts on the left (pinned while the page
   scrolls) and one part open on the right (/automation?tab=<part>), so each tool has a page of its own instead of
   six cards of unequal height side by side. The menu says at a glance what is on: how many rules, whether cases
   are handed out, the escalation time. Markup: pages/settings.css (settings-frame, settings-nav), pages/automation.css. */

const tabs = {
  rules: { label: 'กฎรับเรื่องและส่งต่อ', icon: 'bolt' },
  distribution: { label: 'แจกเคสอัตโนมัติ', icon: 'users' },
  escalation: { label: 'ยกระดับ SLA', icon: 'clock' },
  macros: { label: 'Macro', icon: 'macro' },
  survey: { label: 'แบบประเมินความพึงพอใจ', icon: 'star' },
  thanks: { label: 'การ์ดขอบคุณหลังปิดเคส', icon: 'heart' },
  log: { label: 'เคสที่ถูกยกระดับล่าสุด', icon: 'history' },
} as const;
type Tab = keyof typeof tabs;
const isTab = (value: string | null | undefined): value is Tab => typeof value === 'string' && Object.prototype.hasOwnProperty.call(tabs, value);

export function AutomationScreen({ tab }: { tab?: string }) {
  const page = useApi<AutomationPage>(AUTOMATION_PATH);
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  return <AutomationView data={page.data} tab={tab} />;
}

function AutomationView({ data, tab }: { data: AutomationPage; tab?: string }) {
  const [remembered, setRemembered] = useUiState<Tab>('automation:tab', 'rules');
  // แบบคนเดียว (backend platform/team_size.py): every case is the one member's, there is nobody to hand one out to.
  const solo = useWork().team_size.solo;
  const shown = (Object.keys(tabs) as Tab[]).filter((key) => !solo || key !== 'distribution');
  // /automation alone opens the part used last.
  const asked: Tab = isTab(tab) ? tab : remembered;
  const current: Tab = shown.includes(asked) ? asked : 'rules';
  useEffect(() => {
    setRemembered(current);
    document.title = `${tabs[current].label} - ระบบอัตโนมัติ`;
  }, [current, setRemembered]);
  const nav = useRef<HTMLElement>(null);
  usePinnedMenu(nav);

  const s = data.settings;
  const rulesOn = data.rules.filter((r) => r.enabled).length;
  const on = (yes: boolean, word: string) => (yes ? word : 'ปิดอยู่');
  // One line under each name: what the part is set to now, so the menu reads as the page's summary.
  const hints: Record<Tab, string> = {
    rules: data.rules.length ? `เปิดใช้ ${rulesOn} จาก ${data.rules.length} กฎ` : 'ยังไม่มีกฎ',
    distribution: data.distribution ? on(data.distribution.settings.enabled, `เปิดอยู่ รอคนรับ ${data.distribution.waiting} เคส`) : 'ยังไม่มีข้อมูล',
    escalation: on(s.escalation_enabled, `ไม่มีใครรับใน ${s.escalation_minutes} นาที`),
    macros: data.macros.length ? `${data.macros.length} ปุ่ม` : 'ยังไม่มี Macro',
    survey: on(s.csat_enabled, 'ส่งเมื่อปิดเคส'),
    thanks: on(s.thanks_enabled, 'แสดงในแชทบนเว็บ'),
    log: data.escalations.length ? `${data.escalations.length} รายการล่าสุด` : 'ยังไม่มี',
  };

  const content = {
    rules: () => <RulesCard data={data} />,
    distribution: () => (data.distribution ? <DistributionCard data={data.distribution} /> : null),
    escalation: () => <EscalationCard settings={s} />,
    macros: () => <MacrosCard data={data} />,
    survey: () => <SurveyCard settings={s} />,
    thanks: () => <ThanksCard settings={s} />,
    log: () => <LogCard data={data} />,
  }[current]();

  return (
    <>
      <Link href="/settings" className="back-link">
        <Icon name="back" />
        ตั้งค่าองค์กร
      </Link>
      <div className="page-heading">
        <div>
          <h1>ระบบอัตโนมัติ</h1>
        </div>
      </div>
      <div className="settings-frame">
        <nav ref={nav} className="settings-nav" aria-label="ส่วนของระบบอัตโนมัติ">
          {shown.map((key) => {
            const active = key === current;
            return (
              <Link
                key={key}
                href={`/automation?tab=${key}`}
                className={`settings-nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                replace
                scroll={false}
              >
                <span className="settings-nav-icon">
                  <Icon name={tabs[key].icon} />
                </span>
                <span className="settings-nav-text">
                  <strong>{tabs[key].label}</strong>
                  <span className="settings-nav-hint">{hints[key]}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="settings-panels" data-tab={current}>
          {content}
        </div>
      </div>
    </>
  );
}

/** A click that fails says why in the toast, as the old action dispatcher did. */
function useAct() {
  const toast = useToast();
  return (work: () => Promise<unknown>) => async () => {
    try {
      await work();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };
}

function RulesCard({ data }: { data: AutomationPage }) {
  const { openModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const act = useAct();
  const teamName = useTeamName();
  const memberName = useMemberName();
  const tagList = useCaseTags();
  const tagName = (id: string) => tagList.find((t) => t.id === id)?.name ?? '';
  const ruleForm = (rule?: AutomationRule) => openModal(rule ? 'แก้ไขกฎรับเรื่อง' : 'เพิ่มกฎรับเรื่อง', <RuleForm rule={rule} />);
  const toggleRule = (r: AutomationRule) =>
    act(async () => {
      await saveRule(r.id, {
        name: r.name,
        channel: r.channel,
        keywords: r.keywords,
        set_priority: r.set_priority,
        set_team_id: r.set_team_id,
        set_assignee_id: r.set_assignee_id,
        set_tags: r.set_tags ?? [],
        enabled: !r.enabled,
      });
      toast(r.enabled ? `ปิดกฎ “${r.name}” แล้ว` : `เปิดกฎ “${r.name}” แล้ว`);
      await refresh(AUTOMATION_PATH);
    });
  const removeRule = (r: AutomationRule) =>
    confirm({
      title: 'ลบกฎรับเรื่อง',
      message: `ลบกฎ “${r.name}” หรือไม่?`,
      confirmLabel: 'ลบกฎ',
      tone: 'danger',
      run: async () => {
        await deleteRule(r.id);
        toast('ลบกฎแล้ว');
        await refresh(AUTOMATION_PATH);
      },
    });

  return (
    <section className="card" id="automation-rules">
      <div className="card-header">
        <div>
          <h2>กฎรับเรื่องและส่งต่อ</h2>
        </div>
        <button type="button" className="btn" onClick={() => ruleForm()}>
          <Icon name="plus" />
          เพิ่มกฎ
        </button>
      </div>
      <div className="card-body auto-list">
        {data.rules.length ? (
          data.rules.map((r) => {
            const enabled = Boolean(r.enabled);
            return (
              <article key={r.id} className={`auto-row${enabled ? '' : ' is-off'}`}>
                <div className="auto-row-main">
                  <div className="auto-row-title">
                    <strong>{r.name}</strong>
                    {!enabled && <span className="badge closed">ปิดใช้งาน</span>}
                  </div>
                  <p className="auto-flow">
                    <span className="auto-chip when">ถ้า</span>
                    <span>{ruleCondition(r)}</span>
                    <span className="auto-chip then">ให้</span>
                    <span>{ruleActions(r, teamName, memberName, tagName)}</span>
                  </p>
                </div>
                <div className="auto-row-actions">
                  <button type="button" className="btn sm" onClick={toggleRule(r)}>
                    {enabled ? 'ปิดกฎ' : 'เปิดกฎ'}
                  </button>
                  <button type="button" className="btn sm" onClick={() => ruleForm(r)}>
                    <Icon name="edit" />
                    แก้ไข
                  </button>
                  <button type="button" className="icon-btn danger-link" aria-label={`ลบกฎ ${r.name}`} title="ลบกฎ" onClick={() => removeRule(r)}>
                    <Icon name="trash" />
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState
            title="ยังไม่มีกฎ"
            icon="bolt"
          />
        )}
      </div>
    </section>
  );
}

function MacrosCard({ data }: { data: AutomationPage }) {
  const { openModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const macroForm = (macro?: Macro) => openModal(macro ? 'แก้ไข Macro' : 'เพิ่ม Macro', <MacroForm macro={macro} />);
  const removeMacro = (m: Macro) =>
    confirm({
      title: 'ลบ Macro',
      message: `ลบปุ่ม “${m.name}” หรือไม่?`,
      confirmLabel: 'ลบ Macro',
      tone: 'danger',
      run: async () => {
        await deleteMacro(m.id);
        toast('ลบ Macro แล้ว');
        await refresh(AUTOMATION_PATH, '/api/workspace');
      },
    });

  return (
    <section className="card" id="automation-macros">
      <div className="card-header">
        <div>
          <h2>Macro</h2>
        </div>
        <button type="button" className="btn" onClick={() => macroForm()}>
          <Icon name="plus" />
          เพิ่ม Macro
        </button>
      </div>
      <div className="card-body auto-list">
        {data.macros.length ? (
          data.macros.map((m) => {
            const preview = plainText(m.reply).slice(0, 160);
            return (
              <article key={m.id} className="auto-row">
                <div className="auto-row-main">
                  <div className="auto-row-title">
                    <span className="macro-glyph">
                      <Icon name="macro" />
                    </span>
                    <strong>{m.name}</strong>
                  </div>
                  <p className="auto-flow">
                    <span>{macroSteps(m)}</span>
                  </p>
                  {preview && <p className="auto-preview">“{preview}”</p>}
                </div>
                <div className="auto-row-actions">
                  <button type="button" className="btn sm" onClick={() => macroForm(m)}>
                    <Icon name="edit" />
                    แก้ไข
                  </button>
                  <button type="button" className="icon-btn danger-link" aria-label={`ลบ Macro ${m.name}`} title="ลบ Macro" onClick={() => removeMacro(m)}>
                    <Icon name="trash" />
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState
            title="ยังไม่มี Macro"
            icon="bolt"
          />
        )}
      </div>
    </section>
  );
}

/* The three settings below share one save on the server (saveAutomationSettings takes them all): each card sends
   its own values with the others' as they are, so saving one never undoes another. */
function useSaveSettings(s: AutomationSettings) {
  const toast = useToast();
  const refresh = useInvalidate();
  return async (changes: Partial<AutomationSettings>) => {
    await saveAutomationSettings({ ...s, ...changes });
    toast('บันทึกแล้ว');
    await refresh(AUTOMATION_PATH);
  };
}

const checked = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;

function EscalationCard({ settings: s }: { settings: AutomationSettings }) {
  const save = useSaveSettings(s);
  return (
    <Form
      className="card"
      onSubmit={(values, form) => save({ escalation_enabled: checked(form, 'escalation_enabled'), escalation_minutes: Number(values.escalation_minutes) })}
    >
      <div className="card-header">
        <div>
          <h2>ยกระดับ SLA</h2>
        </div>
      </div>
      <div className="card-body stack">
        <label className="check">
          <input type="checkbox" className="switch" name="escalation_enabled" defaultChecked={s.escalation_enabled} />
          เปิดการยกระดับอัตโนมัติ
        </label>
        <TextField
          id="escalation-minutes"
          label="ยกระดับเมื่อไม่มีผู้รับเรื่องภายใน (นาที)"
          name="escalation_minutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={s.escalation_minutes}
        />
        <div className="settings-save">
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกการยกระดับ
          </button>
        </div>
      </div>
    </Form>
  );
}

/** What the survey message is written with: what a reply can carry. LINE and Messenger get it as plain text
    (backend markdown.to_plain); the customer page and email show the formatting. */
const SURVEY_TOOLS: Array<RichFormat | '|'> = ['bold', 'italic', 'underline', '|', 'bullet', 'number', '|', 'link'];

function SurveyCard({ settings: s }: { settings: AutomationSettings }) {
  const save = useSaveSettings(s);
  const editor = useRichEditor();
  return (
    <Form className="card" onSubmit={(values, form) => save({ csat_enabled: checked(form, 'csat_enabled'), csat_message: values.csat_message })}>
      <div className="card-header">
        <div>
          <h2>แบบประเมินความพึงพอใจ</h2>
        </div>
      </div>
      <div className="card-body stack">
        <label className="check">
          <input type="checkbox" className="switch" name="csat_enabled" defaultChecked={s.csat_enabled} />
          ส่งแบบประเมินให้ลูกค้าอัตโนมัติ
        </label>
        <div className="field rich-field">
          <label htmlFor="csat-message">ข้อความแบบประเมิน</label>
          <RichToolbar editor={editor} tools={SURVEY_TOOLS} label="จัดรูปแบบข้อความแบบประเมิน" className="editor-toolbar" role="toolbar" />
          <RichTextField
            editor={editor}
            id="csat-message"
            name="csat_message"
            defaultValue={s.csat_message}
            maxLength={1000}
            label="ข้อความแบบประเมิน"
            className="editor-input rich-box"
          />
        </div>
        <div className="settings-save">
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกแบบประเมิน
          </button>
        </div>
      </div>
    </Form>
  );
}

function ThanksCard({ settings: s }: { settings: AutomationSettings }) {
  const save = useSaveSettings(s);
  return (
    <Form className="card" onSubmit={(values, form) => save({ thanks_enabled: checked(form, 'thanks_enabled'), thanks_message: values.thanks_message ?? '' })}>
      <div className="card-header">
        <div>
          <h2>การ์ดขอบคุณหลังปิดเคส</h2>
        </div>
      </div>
      <div className="card-body stack">
        <label className="check">
          <input type="checkbox" className="switch" name="thanks_enabled" defaultChecked={s.thanks_enabled} />
          ให้ลูกค้าเห็นการ์ดขอบคุณเมื่อปิดเคส
        </label>
        <TextArea
          id="thanks-message"
          label="ข้อความขอบคุณขององค์กร"
          name="thanks_message"
          max={200}
          rows={2}
          required={false}
          defaultValue={s.thanks_message}
          placeholder="ขอบคุณที่ให้เราได้ดูแลเรื่องนี้ ถ้ามีอะไรเพิ่มเติม ทักมาได้เสมอ"
        />
        <div className="settings-save">
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกการ์ดขอบคุณ
          </button>
        </div>
      </div>
    </Form>
  );
}

function LogCard({ data }: { data: AutomationPage }) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>เคสที่ถูกยกระดับล่าสุด</h2>
        </div>
      </div>
      <div className="card-body">
        {data.escalations.length ? data.escalations.map((e) => <EscalationRow key={e.ticket_id} escalation={e} />) : <div className="empty-mini">ยังไม่มีเคสที่ถูกยกระดับ</div>}
      </div>
    </section>
  );
}
