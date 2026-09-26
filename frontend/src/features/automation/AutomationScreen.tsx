'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { TextArea, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useCaseTags } from '@/features/tickets/tags';
import { plainText } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useMemberName, useTeamName } from '@/lib/session';
import { AUTOMATION_PATH, deleteMacro, deleteRule, saveAutomationSettings, saveRule } from './api';
import { DistributionCard } from './components/DistributionCard';
import { EscalationRow } from './components/EscalationRow';
import { MacroForm } from './components/MacroForm';
import { RuleForm } from './components/RuleForm';
import { macroSteps, ruleActions, ruleCondition } from './labels';
import type { AutomationPage, AutomationRule, AutomationSettings, Macro } from './types';

/* Automation, managed by admins and team leads: routing rules for new cases, SLA escalation, macros and the
   satisfaction survey. Markup: old-frontend/pages/automation/automation.html. */

export function AutomationScreen() {
  const page = useApi<AutomationPage>(AUTOMATION_PATH);
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  return <AutomationView data={page.data} />;
}

function AutomationView({ data }: { data: AutomationPage }) {
  const { openModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const teamName = useTeamName();
  const memberName = useMemberName();
  const tagList = useCaseTags();
  const tagName = (id: string) => tagList.find((t) => t.id === id)?.name ?? '';

  // A click that fails says why in the toast, as the old action dispatcher did.
  const act = (work: () => Promise<unknown>) => async () => {
    try {
      await work();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };

  const ruleForm = (rule?: AutomationRule) => openModal(rule ? 'แก้ไขกฎรับเรื่อง' : 'เพิ่มกฎรับเรื่อง', <RuleForm rule={rule} />);
  const macroForm = (macro?: Macro) => openModal(macro ? 'แก้ไข Macro' : 'เพิ่ม Macro', <MacroForm macro={macro} />);

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
      message: `ลบกฎ “${r.name}” หรือไม่? เคสที่กฎตั้งค่าไปแล้วจะไม่เปลี่ยนกลับ`,
      confirmLabel: 'ลบกฎ',
      tone: 'danger',
      run: async () => {
        await deleteRule(r.id);
        toast('ลบกฎแล้ว');
        await refresh(AUTOMATION_PATH);
      },
    });

  const removeMacro = (m: Macro) =>
    confirm({
      title: 'ลบ Macro',
      message: `ลบปุ่ม “${m.name}” หรือไม่? ทีมจะไม่เห็นปุ่มนี้ในหน้าเคสและกล่องข้อความอีก`,
      confirmLabel: 'ลบ Macro',
      tone: 'danger',
      run: async () => {
        await deleteMacro(m.id);
        toast('ลบ Macro แล้ว');
        await refresh(AUTOMATION_PATH, '/api/workspace');
      },
    });

  const s = data.settings;
  const ruleCount = data.rules.filter((r) => r.enabled).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ระบบอัตโนมัติ</h1>
          <p>ลดงานซ้ำ ๆ ด้วยกฎรับเรื่อง การแจกเคส การยกระดับ SLA ปุ่ม Macro และแบบประเมินความพึงพอใจ</p>
        </div>
        <div className="flex">
          <Link className="btn subtle" href="/dashboard">
            <Icon name="back" />
            กลับหน้าภาพรวม
          </Link>
        </div>
      </div>
      <div className="automation-layout">
        <div className="stack">
          <section className="card" id="automation-rules">
            <div className="card-header">
              <div>
                <h2>กฎรับเรื่องและส่งต่อ</h2>
                <p>เปิดใช้ {ruleCount} กฎ · เรื่องใหม่ที่ตรงเงื่อนไขจะเปิดเคสและตั้งค่าให้ทันที</p>
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
                        <button
                          type="button"
                          className="icon-btn danger-link"
                          aria-label={`ลบกฎ ${r.name}`}
                          title="ลบกฎ"
                          onClick={() => removeRule(r)}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <EmptyState
                  title="ยังไม่มีกฎ"
                  description="ตัวอย่าง: ถ้ามาจาก Facebook และมีคำว่า “ระบบล่ม” ให้ความเร่งด่วนสูงและส่งให้ทีมเทคนิคทันที"
                  icon="bolt"
                />
              )}
            </div>
            <p className="auto-foot tiny muted">หลายกฎตรงกัน กฎที่สร้างทีหลังชนะ · ผู้รับผิดชอบต้องอยู่ในทีมของเคส</p>
          </section>
          {data.distribution && <DistributionCard data={data.distribution} />}
          <section className="card" id="automation-macros">
            <div className="card-header">
              <div>
                <h2>Macro · ปุ่มลัดทำหลายอย่างในคลิกเดียว</h2>
                <p>
                  กดครั้งเดียวแล้ว <strong>ส่งจริงและเดินเคสต่อให้</strong>
                </p>
              </div>
              <button type="button" className="btn" onClick={() => macroForm()}>
                <Icon name="plus" />
                เพิ่ม Macro
              </button>
            </div>
            {/* The rules of the thing, for whoever is setting one up - not for everyone who opens the page. Below the
                header rather than inside it, so opening it does not wrap the text around the button. */}
            <details className="auto-more">
              <summary>Macro ทำงานยังไง</summary>
              <p>ต้องเปลี่ยนสถานะเคสหรือตั้งเตือนติดตามผลอย่างน้อย 1 อย่าง</p>
              <p>
                ใช้จากหน้าเคสและกล่องข้อความ · แทนค่า {'{customer}'} {'{case}'} {'{agent}'} ในข้อความได้
              </p>
              <p>
                อยากแค่แทรกข้อความให้เจ้าหน้าที่ตรวจแก้ก่อนส่ง ใช้ <Link href="/settings?tab=service">คำตอบสำเร็จรูปของทีม</Link> แทน
              </p>
            </details>
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
                        <button
                          type="button"
                          className="icon-btn danger-link"
                          aria-label={`ลบ Macro ${m.name}`}
                          title="ลบ Macro"
                          onClick={() => removeMacro(m)}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <EmptyState
                  title="ยังไม่มี Macro"
                  description="เช่น ปุ่ม “ขอข้อมูลเพิ่มเติม” ที่ส่งข้อความแม่แบบ เปลี่ยนสถานะเป็นรอลูกค้า และเตือนติดตามใน 24 ชั่วโมง"
                  icon="bolt"
                />
              )}
            </div>
          </section>
        </div>
        <SettingsForm settings={s} />
        {/* Across both columns: a log reads better on one long line than wrapped into three in a narrow column, and
            the settings beside the rules are nowhere near the same height - this closes the page level. */}
        <section className="card automation-wide">
          <div className="card-header">
            <div>
              <h2>เคสที่ถูกยกระดับล่าสุด</h2>
              <p>20 รายการล่าสุด</p>
            </div>
          </div>
          <div className="card-body">
            {data.escalations.length ? (
              data.escalations.map((e) => <EscalationRow key={e.ticket_id} escalation={e} />)
            ) : (
              <div className="empty-mini">ยังไม่มีเคสที่ถูกยกระดับ</div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

/** SLA escalation and CSAT settings. Uncontrolled, so a refresh of the page data keeps what is being typed. */
function SettingsForm({ settings: s }: { settings: AutomationSettings }) {
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      className="card"
      onSubmit={async (values, form) => {
        const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
        await saveAutomationSettings({
          escalation_enabled: checked('escalation_enabled'),
          escalation_minutes: Number(values.escalation_minutes),
          csat_enabled: checked('csat_enabled'),
          csat_message: values.csat_message,
        });
        toast('บันทึกการตั้งค่าอัตโนมัติแล้ว');
        await refresh(AUTOMATION_PATH);
      }}
    >
      <div className="card-header">
        <div>
          <h2>ยกระดับ SLA อัตโนมัติ</h2>
          <p>ระบบตรวจทุก 30 วินาที</p>
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
        <ul className="auto-notes">
          <li>ไม่มีใครรับและไม่มีใครตอบ · ย้ายให้เจ้าขององค์กรในทีมนั้น</li>
          <li>มีคนรับแล้วแต่ยังไม่ตอบ และใกล้ครบกำหนด · แจ้งเตือน ไม่ย้ายเคส</li>
          <li>ยกระดับเคสละครั้งเดียว และบันทึกในประวัติเคส</li>
        </ul>
      </div>
      <div className="card-header auto-subhead">
        <div>
          <h2>แบบประเมินความพึงพอใจ</h2>
          <p>ส่งเมื่อเปลี่ยนเคสเป็นแก้ไขแล้วหรือปิดเคส</p>
        </div>
      </div>
      <div className="card-body stack">
        <label className="check">
          <input type="checkbox" className="switch" name="csat_enabled" defaultChecked={s.csat_enabled} />
          ส่งแบบประเมินให้ลูกค้าอัตโนมัติ
        </label>
        <TextArea id="csat-message" label="ข้อความแบบประเมิน" name="csat_message" max={1000} rows={4} defaultValue={s.csat_message} />
        <p className="tiny muted">หน้าลูกค้าแสดงปุ่มดาว 1-5 · ช่องทางอื่นตอบเป็นตัวเลขภายใน 7 วัน · คะแนนไม่เปิดเคสกลับ · เคสที่บันทึกเองส่งไม่ได้</p>
        <div className="settings-save">
          <span className="muted">มีผลทันทีหลังบันทึก</span>
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกการตั้งค่า
          </button>
        </div>
      </div>
    </Form>
  );
}
