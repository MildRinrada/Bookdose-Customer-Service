'use client';

import { useState } from 'react';
import { useDialogs } from '@/components/ui/Dialogs';
import { TextField, FormActions } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { priorityLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useTeamName, useWork } from '@/lib/session';
import { TagPicker } from '@/features/tickets/components/TagPicker';
import { TAGS_PER_CASE, useCaseTags } from '@/features/tickets/tags';
import { AUTOMATION_PATH, saveRule } from '../api';
import { ruleChannelLabels } from '../labels';
import type { AutomationRule } from '../types';

/** Add or edit an intake rule (in the modal). Markup: pages/automation/rule-form. */
export function RuleForm({ rule }: { rule?: AutomationRule }) {
  const work = useWork();
  const teamName = useTeamName();
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const [team, setTeam] = useState(rule?.set_team_id || '');
  const [assignee, setAssignee] = useState(rule?.set_assignee_id || '');
  const tagList = useCaseTags();
  const [tags, setTags] = useState<string[]>(() => (rule?.set_tags ?? []).filter((id) => tagList.some((t) => t.id === id)));
  // Only people of the chosen team can own its cases; with no team chosen, the case keeps its own team.
  const assignees = work.members.filter((m) => m.active && (!team || m.team_id === team));

  return (
    <Form
      className="stack"
      onSubmit={async (values, form) => {
        const enabled = (form.elements.namedItem('enabled') as HTMLInputElement).checked;
        await saveRule(rule?.id ?? null, {
          name: values.name,
          channel: values.channel,
          keywords: values.keywords,
          set_priority: values.set_priority,
          set_team_id: values.set_team_id,
          set_assignee_id: values.set_assignee_id,
          set_tags: tags,
          enabled,
        });
        closeModal(true);
        toast('บันทึกกฎแล้ว · มีผลกับเรื่องใหม่ถัดไป');
        await refresh(AUTOMATION_PATH);
      }}
    >
      <TextField label="ชื่อกฎ" name="name" max={100} defaultValue={rule?.name || ''} placeholder="เช่น แจ้งระบบล่มจาก Facebook → ทีมเทคนิค" />
      <fieldset className="auto-fieldset">
        <legend>ถ้าเรื่องใหม่…</legend>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="rule-channel">มาจากช่องทาง</label>
            <select id="rule-channel" name="channel" defaultValue={rule?.channel || ''}>
              {Object.entries(ruleChannelLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rule-keywords">มีคำในหัวเรื่องหรือข้อความ</label>
            <textarea
              id="rule-keywords"
              name="keywords"
              maxLength={2000}
              rows={2}
              placeholder="เช่น ระบบล่ม, เข้าไม่ได้, error"
              defaultValue={(rule?.keywords || '').split('\n').filter(Boolean).join(', ')}
            />
            <span className="tiny muted">คั่นด้วยจุลภาค ตรงคำใดคำหนึ่งก็ทำงาน · เว้นว่างเพื่อใช้กับทุกเรื่องจากช่องทางนี้</span>
          </div>
        </div>
      </fieldset>
      <fieldset className="auto-fieldset">
        <legend>…ให้ระบบ</legend>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="rule-priority">ตั้งความเร่งด่วน</label>
            <select id="rule-priority" name="set_priority" defaultValue={rule?.set_priority || ''}>
              {Object.entries({ '': 'ไม่เปลี่ยน', ...priorityLabels }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rule-team">ส่งให้ทีม</label>
            <select
              id="rule-team"
              name="set_team_id"
              value={team}
              onChange={(e) => {
                setTeam(e.target.value);
                setAssignee('');
              }}
            >
              <option value="">ไม่เปลี่ยนทีม</option>
              {work.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rule-assignee">มอบหมายให้</label>
            <select id="rule-assignee" name="set_assignee_id" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">ไม่มอบหมายเพิ่ม</option>
              {assignees.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.name} · ${teamName(m.team_id)}`}
                </option>
              ))}
            </select>
            {!assignee && <span className="tiny muted">ถ้าเปิดแจกเคสอัตโนมัติไว้ ระบบแจกให้คนในทีมที่พร้อมและถืองานน้อยที่สุด</span>}
          </div>
        </div>
        <div className="field rule-tags">
          <span className="tag-field-label">ติดป้ายเคส</span>
          {tagList.length ? (
            <TagPicker
              tags={tagList}
              picked={tags}
              max={TAGS_PER_CASE}
              label="ป้ายที่กฎนี้ติดให้เคส"
              onToggle={(id) => setTags((all) => (all.includes(id) ? all.filter((t) => t !== id) : [...all, id]))}
            />
          ) : (
            <span className="tiny muted">ยังไม่มีป้ายเคส ตั้งรายการป้ายได้ที่หน้าเคสบริการ ปุ่มจัดการป้าย</span>
          )}
        </div>
      </fieldset>
      <label className="check">
        <input type="checkbox" className="switch" name="enabled" defaultChecked={rule ? Boolean(rule.enabled) : true} />
        เปิดใช้งานกฎนี้
      </label>
      <FormActions label={rule ? 'บันทึกกฎ' : 'เพิ่มกฎ'} onCancel={() => closeModal()} />
    </Form>
  );
}
