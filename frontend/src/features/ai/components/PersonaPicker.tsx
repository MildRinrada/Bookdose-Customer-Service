'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { PREFS_PATH, savePreferences, type AssistantPersona } from '@/features/staff-account/prefs';
import { useInvalidate } from '@/lib/query';

/* The personality of the member's own AI assistant (backend staff_prefs 'assistant', ai/assistant.py): asked before
   the first question, and changed any time from the chip in the panel's heading. Formal, friendly, or a character
   the member describes in their own words. It is only the assistant's voice with them: a message written for a
   customer keeps the tone asked for. Markup: pages/ai-assistant.css (.assistant-persona*). */

export const personaLabels: Record<AssistantPersona['persona'], string> = {
  '': 'ยังไม่ได้เลือก',
  formal: 'ทางการ',
  friendly: 'เป็นกันเอง',
  custom: 'ตามใจฉัน',
};

const CHOICES: Array<{ key: 'formal' | 'friendly' | 'custom'; title: string; line: string }> = [
  { key: 'formal', title: 'ทางการ', line: 'สุภาพ ตรงประเด็น เหมือนเพื่อนร่วมงานมืออาชีพ' },
  { key: 'friendly', title: 'สายเป็นกันเอง', line: 'สบาย ๆ เหมือนเพื่อนในทีม คุยง่าย มีมุกบ้าง' },
  { key: 'custom', title: 'ระบุตามใจฉัน', line: 'บอกนิสัยที่อยากให้เป็นด้วยคำของคุณเอง' },
];

export function PersonaPicker({ current, onDone }: { current: AssistantPersona | null; onDone: () => void }) {
  const [choice, setChoice] = useState<AssistantPersona['persona']>(current?.persona || '');
  const [custom, setCustom] = useState(current?.custom ?? '');
  const [busy, setBusy] = useState(false);
  const run = useRunAction();
  const refresh = useInvalidate();
  const ready = choice === 'formal' || choice === 'friendly' || (choice === 'custom' && custom.trim().length >= 3);

  const save = () =>
    void run(async () => {
      setBusy(true);
      try {
        await savePreferences({ assistant: { persona: choice, custom: choice === 'custom' ? custom.trim() : '' } });
        await refresh(PREFS_PATH);
        onDone();
      } finally {
        setBusy(false);
      }
    });

  return (
    <div className="assistant-persona-pick">
      <div className="assistant-hello">
        <h2>อยากให้ผู้ช่วยคุยแบบไหน</h2>
        <p>มีผลกับน้ำเสียงที่คุยกับคุณเท่านั้น เปลี่ยนได้ทุกเมื่อ</p>
      </div>
      <div className="assistant-persona-choices" role="radiogroup" aria-label="บุคลิกของผู้ช่วย AI">
        {CHOICES.map((c) => (
          <label key={c.key} className={`assistant-persona-choice${choice === c.key ? ' chosen' : ''}`}>
            <input type="radio" name="assistant-persona" value={c.key} checked={choice === c.key} onChange={() => setChoice(c.key)} />
            <span>
              <strong>{c.title}</strong>
              <small>{c.line}</small>
            </span>
            <Icon name="check" />
          </label>
        ))}
      </div>
      {choice === 'custom' && (
        <div className="assistant-persona-custom">
          <label className="sr-only" htmlFor="assistant-persona-text">
            บอกนิสัยหรือน้ำเสียงที่อยากให้เป็น
          </label>
          <div className="assistant-persona-box">
            <textarea
              id="assistant-persona-text"
              rows={2}
              maxLength={300}
              value={custom}
              autoFocus
              placeholder="เช่น ใจเย็น พูดสั้นกระชับ ชอบยกตัวอย่างประกอบ"
              onChange={(e) => setCustom(e.target.value)}
            />
            <span className="assistant-persona-count" aria-hidden="true">
              {custom.length}/300
            </span>
          </div>
        </div>
      )}
      <div className="assistant-persona-actions">
        {current?.persona && (
          <button type="button" className="btn subtle" onClick={onDone} disabled={busy}>
            ยกเลิก
          </button>
        )}
        <button type="button" className="btn primary" disabled={!ready || busy} onClick={save}>
          <Icon name="check" />
          {busy ? 'กำลังบันทึก…' : 'ใช้บุคลิกนี้'}
        </button>
      </div>
    </div>
  );
}
