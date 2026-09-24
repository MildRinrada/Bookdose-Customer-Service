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

  const n8n = a.provider === 'n8n';
  const testUrl = a.webhook_url.includes('/webhook-test/');
  // A random secret to paste into n8n's Header Auth too; it is shown once, before saving.
  const makeSecret = () => {
    const input = document.getElementById('ai-webhook-secret') as HTMLInputElement | null;
    if (!input) return;
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    input.value = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    input.type = 'text';
    input.select();
    toast('สร้างรหัสลับแล้ว คัดลอกไปใส่ใน n8n ก่อนกดบันทึก');
  };

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
        <span className={`badge ${a.key_configured ? 'resolved' : ''}`}>
          {n8n ? 'ใช้ n8n Webhook' : a.key_configured ? 'บันทึก API Key แล้ว' : 'ยังไม่ได้เชื่อม AI'}
        </span>
      </div>
      <Form
        // A save shows the saved values again (and empty key and secret boxes), like reopening the page did.
        key={`${a.version}:${a.key_configured}:${a.provider}`}
        className="card-body"
        data-form="ai-settings"
        onSubmit={async (values, form) => {
          const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
          const body: Record<string, unknown> = { ...values };
          for (const key of ['drafts_enabled', 'chatbot_enabled', 'mood_enabled', 'translate_enabled', 'remove_key']) body[key] = checked(key);
          body.remove_webhook = n8n && checked('remove_webhook');
          for (const key of ['daily_limit', 'conversation_limit', 'max_output_tokens']) body[key] = Number(values[key]);
          await saveAiSettings(body);
          // The form opens again with what was saved (the URL, the secret's ending); the key and secret boxes stay empty.
          for (const key of ['api_key', 'webhook_secret']) (form.elements.namedItem(key) as HTMLInputElement).value = '';
          toast('บันทึกการตั้งค่า AI แล้ว');
          await refresh(AI_SETTINGS_PATH, '/api/workspace');
          document.getElementById('ai-settings')?.scrollIntoView({ block: 'start' });
        }}
      >
        <div className="notice mb">
          เมื่อเปิดใช้ ระบบจะส่งข้อความและบทความที่เกี่ยวข้องไปยัง {n8n ? `workflow n8n ของคุณ (${a.webhook_host})` : 'OpenAI'} เพื่อสร้างคำตอบ
          {n8n ? ' แล้ว workflow ส่งต่อให้โมเดลที่คุณเลือกใน n8n' : ' มีค่าใช้บริการตามบัญชี API ของคุณ'} Chatbot
          อ่านเฉพาะบทความที่เผยแพร่ให้ลูกค้า ส่วนร่างสำหรับเจ้าหน้าที่อาจใช้บทความและบันทึกภายใน
        </div>
        <h3 className="ai-settings-heading">n8n Webhook {n8n && <span className="badge resolved">เชื่อมแล้ว</span>}</h3>
        <p className="tiny muted">
          เชื่อม workflow ใน n8n แล้วระบบจะส่งงาน AI ทั้งหมดของ {work.tenant.name} ไปที่ workflow นั้นแทน OpenAI (ช่วยร่างคำตอบ, Chatbot,
          ผู้ช่วย AI, คำแนะนำในหน้าภาพรวม) และเลือกโมเดลใน AI Agent ของ n8n
        </p>
        <div className="form-grid">
          <TextField
            id="ai-webhook-url"
            label="Webhook URL (Production URL ของ n8n)"
            name="webhook_url"
            type="url"
            required={false}
            max={500}
            defaultValue={a.webhook_url}
            placeholder="https://xxx.app.n8n.cloud/webhook/bookdose-ai"
            hint={
              testUrl ? (
                <span className="ai-webhook-warn">
                  นี่คือ Test URL ใช้ได้เฉพาะตอนกด Listen ใน n8n ให้เปลี่ยน /webhook-test/ เป็น /webhook/ แล้วกด Publish ใน n8n
                </span>
              ) : (
                'ใช้ Production URL ของโหนด Webhook (…/webhook/bookdose-ai) ไม่ใช่ Test URL'
              )
            }
          />
          <div className="ai-secret">
            <TextField
              id="ai-webhook-secret"
              label="รหัสลับ (X-Bookdose-Secret)"
              name="webhook_secret"
              type="password"
              required={false}
              max={200}
              placeholder={n8n ? `บันทึกแล้ว ลงท้ายด้วย …${a.webhook_secret_end} · เว้นว่างเพื่อใช้รหัสเดิม` : 'อย่างน้อย 16 ตัว'}
              hint={
                n8n
                  ? `รหัสที่บันทึกไว้ลงท้ายด้วย ${a.webhook_secret_end} · ต้องตรงกับ Value ใน Header Auth ของ n8n (Name: X-Bookdose-Secret)`
                  : 'ใส่ค่าเดียวกันใน Header Auth ของโหนด Webhook ใน n8n (Name: X-Bookdose-Secret)'
              }
            />
            <button className="btn subtle small" type="button" onClick={makeSecret}>
              <Icon name="lock" />
              สร้างรหัสลับ
            </button>
          </div>
          {n8n && (
            <label className="check">
              <input name="remove_webhook" type="checkbox" />
              เลิกใช้ n8n Webhook (กลับไปใช้ OpenAI API Key)
            </label>
          )}
        </div>
        <h3 className="ai-settings-heading">OpenAI และการใช้งาน</h3>
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
            placeholder={a.openai_key ? 'เว้นว่างเพื่อใช้คีย์เดิม' : 'sk-…'}
            hint={n8n ? 'ไม่ใช้ระหว่างที่เชื่อม n8n Webhook อยู่' : 'เก็บเฉพาะฝั่งเซิร์ฟเวอร์ ไม่แสดงคีย์เดิมและไม่รวมในไฟล์สำรอง'}
          />
          <TextField
            id="ai-model"
            label="โมเดล OpenAI"
            name="model"
            defaultValue={a.model}
            max={100}
            hint={n8n ? 'เมื่อใช้ n8n ให้เลือกโมเดลใน workflow' : 'ต้องเป็นโมเดลที่บัญชีคุณมีสิทธิ์ และรองรับ Structured Outputs'}
          />
          <label className="check">
            <input type="checkbox" className="switch" name="drafts_enabled" defaultChecked={a.drafts_enabled} />
            เปิด AI ช่วยเจ้าหน้าที่ (ร่างคำตอบ และผู้ช่วย AI มุมขวาล่าง)
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="chatbot_enabled" defaultChecked={a.chatbot_enabled} />
            เปิด Chatbot ตอบลูกค้าในแชทบนเว็บ
          </label>
          <label className="check ai-mood-switch">
            <input type="checkbox" className="switch" name="mood_enabled" defaultChecked={a.mood_enabled} />
            <span>
              อ่านอารมณ์ลูกค้าด้วย AI
              <small className="tiny muted">
                ส่งข้อความล่าสุดของลูกค้าให้ AI อ่านว่าไม่พอใจหรือเร่งด่วนไหม เพื่อดันเคสขึ้นก่อน (นับโควตาแยกจากงานอื่น) ปิดแล้วยังอ่านจากคำในข้อความเหมือนเดิม
              </small>
            </span>
          </label>
          <label className="check ai-mood-switch">
            <input type="checkbox" className="switch" name="translate_enabled" defaultChecked={a.translate_enabled} />
            <span>
              แปลภาษาอัตโนมัติสองทาง
              <small className="tiny muted">
                ลูกค้าพิมพ์ภาษาอื่น เจ้าหน้าที่เห็นเป็นภาษาไทย และคำตอบภาษาไทยแปลเป็นภาษาของลูกค้าก่อนส่ง ส่งไปแค่ตัวข้อความ ไม่มีชื่อหรือข้อมูลติดต่อ (นับโควตาแยกจากงานอื่น)
              </small>
            </span>
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
