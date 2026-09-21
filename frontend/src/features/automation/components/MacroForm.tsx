'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField, useFieldValidation } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { AUTOMATION_PATH, saveMacro } from '../api';
import { macroStatusLabels } from '../labels';
import type { Macro } from '../types';

/** Add or edit a macro (in the modal). Markup: pages/automation/macro-form. */
export function MacroForm({ macro }: { macro?: Macro }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  // The hours box has a range; say what is wrong under it like every other field.
  const hours = useFieldValidation();

  return (
    <Form
      className="stack"
      onSubmit={async (values) => {
        await saveMacro(macro?.id ?? null, {
          name: values.name,
          reply: values.reply,
          set_status: values.set_status,
          followup_hours: Number(values.followup_hours || 0),
        });
        closeModal(true);
        toast('บันทึก Macro แล้ว');
        // The workspace carries the macro buttons shown on cases and in the inbox.
        await refresh(AUTOMATION_PATH, '/api/workspace');
      }}
    >
      <p className="notice" role="note">
        Macro กดครั้งเดียวแล้ว <strong>ส่งจริงทันที</strong> จึงต้องเดินเคสต่อให้ด้วย คือเปลี่ยนสถานะเคส หรือตั้งเตือนติดตามผล อย่างน้อย 1 อย่าง
        <br />
        ถ้าอยากได้แค่ข้อความสำเร็จรูปที่เจ้าหน้าที่ตรวจแก้ก่อนส่ง ให้เพิ่มที่ ตั้งค่าองค์กร → คำตอบสำเร็จรูปของทีม แทน
      </p>
      <TextField label="ชื่อปุ่ม" name="name" max={100} defaultValue={macro?.name || ''} placeholder="เช่น ขอข้อมูลเพิ่มเติม" />
      <div className="field">
        <label htmlFor="macro-reply">ข้อความแม่แบบที่ส่งหาลูกค้า</label>
        <textarea
          id="macro-reply"
          name="reply"
          maxLength={5000}
          rows={5}
          placeholder="เช่น รบกวนคุณ{customer} ส่งภาพหน้าจอเพิ่มเติมสำหรับเคส {case} ค่ะ"
          defaultValue={macro?.reply || ''}
        />
        <span className="tiny muted">เว้นว่างถ้าไม่ต้องส่งข้อความ · {'{customer}'} ชื่อลูกค้า · {'{case}'} เลขเคส · {'{agent}'} ชื่อผู้กดปุ่ม</span>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="macro-status">เปลี่ยนสถานะเคสเป็น</label>
          <select id="macro-status" name="set_status" defaultValue={macro?.set_status || ''}>
            {Object.entries(macroStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="macro-followup">ตั้งเตือนติดตามผลอีก (ชั่วโมง)</label>
          <input
            id="macro-followup"
            name="followup_hours"
            type="number"
            min={0}
            max={720}
            step={0.5}
            defaultValue={Number(macro?.followup_hours) || 0}
            {...hours.bind}
          />
          {hours.errorNode}
          <span className="tiny muted">24 = พรุ่งนี้เวลาเดิม · 0 = ไม่ตั้งเตือน (ต้องเปลี่ยนสถานะเคสแทน)</span>
        </div>
      </div>
      <FormActions label={macro ? 'บันทึก Macro' : 'เพิ่ม Macro'} onCancel={() => closeModal()} />
    </Form>
  );
}
