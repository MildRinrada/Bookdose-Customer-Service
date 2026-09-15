'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { NumberField } from '@/components/ui/fields';
import { useApi, useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { AI_SETTINGS_PATH, saveAiSettings, testAiConnection, waitForAiJob } from '../api';
import type { AiSettings } from '../types';

/* The organization's AI settings (settings page, AI tab; admins only): the OpenAI key, the model, the two modes,
   the limits, a connection test and today's usage. Markup: modules/ai/ai-settings. */

export function AiSettingsPanel() {
  const settings = useApi<AiSettings>(AI_SETTINGS_PATH);
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return <PageLoading />;
  return <AiSettingsCard a={settings.data} />;
}

function AiSettingsCard({ a }: { a: AiSettings }) {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const test = async () => {
    setTesting(true);
    try {
      setTestResult('กำลังทดสอบการเชื่อมต่อ…');
      const queued = await testAiConnection();
      const job = await waitForAiJob(queued.id, () => alive.current);
      if (!alive.current) return;
      setTestResult(job.status === 'done' ? 'เชื่อมต่อ AI สำเร็จ' : job.error || 'ยังประมวลผลอยู่ กรุณาลองตรวจสอบอีกครั้ง');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (alive.current) setTestResult(message);
      toast(message, true);
    } finally {
      if (alive.current) setTesting(false);
    }
  };

  return (
    <section className="card mt" id="ai-settings">
      <div className="card-header">
        <div>
          <h2>
            <Icon name="sparkle" /> AI Assistant &amp; Chatbot
          </h2>
          <p>ตั้งค่าแยกสำหรับ {work.tenant.name}</p>
        </div>
        <span className={`badge ${a.key_configured ? 'resolved' : ''}`}>{a.key_configured ? 'บันทึก API Key แล้ว' : 'ยังไม่ได้ตั้งค่า API Key'}</span>
      </div>
      <Form
        // A save shows the saved values again (and an empty key box), like reopening the page did.
        key={`${a.version}:${a.key_configured}`}
        className="card-body"
        data-form="ai-settings"
        onSubmit={async (values, form) => {
          const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
          const body: Record<string, unknown> = { ...values };
          for (const key of ['drafts_enabled', 'chatbot_enabled', 'remove_key']) body[key] = checked(key);
          for (const key of ['daily_limit', 'conversation_limit', 'max_output_tokens']) body[key] = Number(values[key]);
          await saveAiSettings(body);
          (form.elements.namedItem('api_key') as HTMLInputElement).value = '';
          toast('บันทึกการตั้งค่า AI แล้ว');
          await refresh(AI_SETTINGS_PATH, '/api/workspace');
          document.getElementById('ai-settings')?.scrollIntoView({ block: 'start' });
        }}
      >
        <div className="notice mb">
          เมื่อเปิดใช้ ระบบจะส่งข้อความและบทความที่เกี่ยวข้องไปยัง OpenAI เพื่อสร้างคำตอบ มีค่าใช้บริการตามบัญชี API ของคุณ Chatbot
          อ่านเฉพาะบทความที่เผยแพร่ให้ลูกค้า ส่วนร่างสำหรับเจ้าหน้าที่อาจใช้บทความและบันทึกภายใน
        </div>
        <div className="form-grid">
          <TextField
            id="ai-key"
            label="OpenAI API Key"
            name="api_key"
            type="password"
            required={false}
            max={503}
            minLength={undefined}
            autoComplete="new-password"
            placeholder={a.key_configured ? 'เว้นว่างเพื่อใช้คีย์เดิม' : 'sk-…'}
            hint="เก็บเฉพาะฝั่งเซิร์ฟเวอร์ ไม่แสดงคีย์เดิมและไม่รวมในไฟล์สำรอง"
          />
          <TextField
            id="ai-model"
            label="โมเดล"
            name="model"
            defaultValue={a.model}
            max={100}
            hint="ต้องเป็นโมเดลที่บัญชีคุณมีสิทธิ์ และรองรับ Structured Outputs"
          />
          <label className="check">
            <input type="checkbox" name="drafts_enabled" defaultChecked={a.drafts_enabled} />
            เปิด AI ช่วยร่างคำตอบให้เจ้าหน้าที่
          </label>
          <label className="check">
            <input type="checkbox" name="chatbot_enabled" defaultChecked={a.chatbot_enabled} />
            เปิด Chatbot ตอบลูกค้าในแชทบนเว็บ
          </label>
          <NumberField id="ai-daily" label="เพดานคำขอ AI ต่อวัน / องค์กร (UTC)" name="daily_limit" min={1} max={10000} defaultValue={a.daily_limit} />
          <NumberField id="ai-conversation" label="เพดานคำตอบ Chatbot ต่อบทสนทนา" name="conversation_limit" min={1} max={100} defaultValue={a.conversation_limit} />
          <NumberField id="ai-output" label="จำนวน output tokens สูงสุดต่อคำขอ" name="max_output_tokens" min={200} max={2000} defaultValue={a.max_output_tokens} />
          <label className="check">
            <input name="remove_key" type="checkbox" />
            ลบ API Key (ปิดทั้งสองโหมดก่อนบันทึก)
          </label>
        </div>
        <div className="flex wrap mt">
          <button className="btn primary" type="submit">
            บันทึกการตั้งค่า AI
          </button>
          <button className="btn" type="button" disabled={!a.key_configured || testing} onClick={() => void test()}>
            <Icon name="checkCircle" />
            ทดสอบการเชื่อมต่อ
          </button>
          <span className="tiny muted">การทดสอบใช้ข้อความตัวอย่าง ไม่มีข้อมูลลูกค้า</span>
        </div>
        <div id="ai-test-result" role="status" className="mt">
          {testResult}
        </div>
      </Form>
      <div className="card-body">
        <div className="flex wrap">
          <span className="badge">
            วันนี้ {a.usage.requests} / {a.daily_limit} คำขอ
          </span>
          <span className="badge">Input {a.usage.input_tokens.toLocaleString()} tokens</span>
          <span className="badge">Output {a.usage.output_tokens.toLocaleString()} tokens</span>
        </div>
        <p className="tiny muted mt">
          เพดานนับงานที่รับเข้าคิว รวมงานทดสอบและงานไม่สำเร็จ ไม่ใช่วงเงินเป็นบาท เปิด Chatbot แล้วจะเริ่มกับบทสนทนาใหม่
          บทสนทนาเดิมให้เจ้าหน้าที่เลือกเปิดเป็นรายเรื่อง
        </p>
      </div>
    </section>
  );
}
