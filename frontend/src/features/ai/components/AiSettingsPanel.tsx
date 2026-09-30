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

/* The organization's AI settings (settings page, AI tab; admins only), one form over three cards like the other tabs:
   the connection (an OpenAI or Gemini key and the model, or a workflow in n8n, with a connection test), what the AI
   may do, and the limits with today's usage. Markup: pages/settings.css (.ai-*). */

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
  const service = a.key_provider === 'gemini' ? 'Gemini' : 'OpenAI';
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
    <Form
      // A save shows the saved values again (and empty key and secret boxes), like reopening the page did.
      key={`${a.version}:${a.key_configured}:${a.provider}`}
      data-form="ai-settings"
      onSubmit={async (values, form) => {
          const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
          const body: Record<string, unknown> = { ...values };
          for (const key of ['drafts_enabled', 'chatbot_enabled', 'mood_enabled', 'translate_enabled', 'triage_enabled', 'remove_key']) body[key] = checked(key);
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
      {/* 1. How the organization reaches an AI: its own key, or a workflow in n8n. */}
      <section className="card" id="ai-settings">
        <div className="card-header">
          <div>
            <h2>การเชื่อมต่อ AI</h2>
            <p>
              {n8n
                ? `งาน AI ทั้งหมดของ ${work.tenant.name} ส่งไปที่ workflow ใน n8n (${a.webhook_host}) ซึ่งเลือกโมเดลเอง`
                : `ข้อความและบทความที่เกี่ยวข้องส่งไปที่ ${a.key_configured ? service : 'OpenAI หรือ Gemini'} เพื่อสร้างคำตอบ ค่าใช้บริการคิดตามบัญชี API ของคุณ`}
            </p>
          </div>
          <span className={`badge ${a.key_configured ? 'resolved' : ''}`}>
            {n8n ? 'ใช้ n8n Webhook' : a.key_configured ? `ใช้ ${service}` : 'ยังไม่ได้เชื่อม AI'}
          </span>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <TextField
              id="ai-key"
              label="API Key (OpenAI หรือ Gemini)"
              name="api_key"
              type="password"
              required={false}
              max={503}
              minLength={undefined}
              autoComplete="new-password"
              placeholder={a.openai_key ? `บันทึกคีย์ ${service} แล้ว เว้นว่างเพื่อใช้คีย์เดิม` : 'sk-… หรือ AQ.…'}
              hint={n8n ? 'ไม่ใช้ระหว่างที่เชื่อม n8n Webhook อยู่' : 'ระบบรู้เองว่าเป็นของเจ้าไหนจากคีย์ เก็บเฉพาะฝั่งเซิร์ฟเวอร์ ไม่แสดงคีย์เดิม'}
            />
            <TextField
              id="ai-model"
              label="โมเดล"
              name="model"
              defaultValue={a.model}
              max={100}
              hint={n8n ? 'เมื่อใช้ n8n ให้เลือกโมเดลใน workflow' : 'ต้องเป็นโมเดลที่บัญชีคุณใช้ได้และรองรับ Structured Outputs'}
            />
          </div>
          <div className="flex wrap mt">
            <button className="btn" type="button" disabled={!a.key_configured || testing} onClick={() => void test()}>
              <Icon name="checkCircle" />
              ทดสอบการเชื่อมต่อ
            </button>
            <span id="ai-test-result" role="status" className="tiny muted">
              {testResult || 'การทดสอบใช้ข้อความตัวอย่าง ไม่มีข้อมูลลูกค้า'}
            </span>
          </div>
          <div className="ai-n8n">
            <h3 className="ai-settings-heading">
              ใช้ n8n แทน API Key {n8n && <span className="badge resolved">เชื่อมแล้ว</span>}
            </h3>
            <p className="tiny muted">ใส่ Production URL ของโหนด Webhook และรหัสลับที่ตั้งไว้ใน Header Auth (Name: X-Bookdose-Secret) แล้วบันทึก</p>
            <div className="form-grid">
              <TextField
                id="ai-webhook-url"
                label="Webhook URL"
                name="webhook_url"
                type="url"
                required={false}
                max={500}
                defaultValue={a.webhook_url}
                placeholder="https://xxx.app.n8n.cloud/webhook/bookdose-ai"
                hint={
                  testUrl ? (
                    <span className="ai-webhook-warn">นี่คือ Test URL ใช้ได้เฉพาะตอนกด Listen ใน n8n ให้เปลี่ยน /webhook-test/ เป็น /webhook/ แล้วกด Publish</span>
                  ) : (
                    'ใช้ …/webhook/… ไม่ใช่ …/webhook-test/…'
                  )
                }
              />
              <div className="ai-secret">
                <TextField
                  id="ai-webhook-secret"
                  label="รหัสลับ"
                  name="webhook_secret"
                  type="password"
                  required={false}
                  max={200}
                  placeholder={n8n ? `บันทึกแล้ว ลงท้ายด้วย …${a.webhook_secret_end} เว้นว่างเพื่อใช้รหัสเดิม` : 'อย่างน้อย 16 ตัว'}
                  hint={n8n ? `รหัสที่บันทึกไว้ลงท้ายด้วย ${a.webhook_secret_end}` : 'ต้องตรงกับ Value ใน Header Auth ของ n8n'}
                />
                <button className="btn subtle small" type="button" onClick={makeSecret}>
                  <Icon name="lock" />
                  สร้างรหัสลับ
                </button>
              </div>
            </div>
          </div>
          <div className="ai-remove">
            {n8n && (
              <label className="check">
                <input name="remove_webhook" type="checkbox" />
                เลิกใช้ n8n Webhook แล้วกลับไปใช้ API Key
              </label>
            )}
            <label className="check">
              <input name="remove_key" type="checkbox" />
              ลบ API Key ออกจากระบบ (ปิดสวิตช์ทุกอย่างด้านล่างก่อนบันทึก)
            </label>
          </div>
        </div>
      </section>

      {/* 2. What the AI is allowed to do. */}
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ให้ AI ทำอะไรบ้าง</h2>
            <p>Chatbot อ่านเฉพาะบทความที่เผยแพร่ให้ลูกค้า ส่วนร่างสำหรับเจ้าหน้าที่ใช้บทความและบันทึกภายในได้</p>
          </div>
        </div>
        <div className="card-body hours-switches">
          <label className="check">
            <input type="checkbox" className="switch" name="drafts_enabled" defaultChecked={a.drafts_enabled} />
            <span>
              ช่วยเจ้าหน้าที่
              <small className="tiny muted">ร่างคำตอบ เกลาข้อความ และผู้ช่วย AI มุมขวาล่าง</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="chatbot_enabled" defaultChecked={a.chatbot_enabled} />
            <span>
              Chatbot ตอบลูกค้าในแชทบนเว็บ
              <small className="tiny muted">เริ่มกับบทสนทนาใหม่ บทสนทนาเดิมให้เจ้าหน้าที่เลือกเปิดเป็นรายเรื่อง</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="mood_enabled" defaultChecked={a.mood_enabled} />
            <span>
              อ่านอารมณ์ลูกค้า
              <small className="tiny muted">AI อ่านข้อความล่าสุดว่าไม่พอใจหรือเร่งด่วนไหม เพื่อดันเคสขึ้นก่อน ปิดแล้วยังอ่านจากคำในข้อความเหมือนเดิม</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="translate_enabled" defaultChecked={a.translate_enabled} />
            <span>
              แปลภาษาสองทาง
              <small className="tiny muted">ลูกค้าพิมพ์ภาษาอื่น เจ้าหน้าที่เห็นเป็นภาษาไทย และคำตอบภาษาไทยแปลเป็นภาษาของลูกค้าก่อนส่ง</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="triage_enabled" defaultChecked={a.triage_enabled} />
            <span>
              เสนอป้าย ความเร่งด่วน และทีมให้เคสใหม่
              <small className="tiny muted">AI อ่านข้อความแรกแล้วเสนอบนหน้าเคส ทีมงานเลือกใช้เอง ระบบไม่เปลี่ยนให้</small>
            </span>
          </label>
          <p className="tiny muted">AI ได้รับแค่ตัวข้อความและหัวเรื่อง ไม่มีชื่อหรือข้อมูลติดต่อของลูกค้า การอ่านอารมณ์และการแปลนับโควตาแยกจากงานอื่น</p>
        </div>
      </section>

      {/* 3. How much, and how much of it was used today. */}
      <section className="card">
        <div className="card-header">
          <div>
            <h2>เพดานการใช้งาน</h2>
            <p>นับงานที่รับเข้าคิว รวมงานทดสอบและงานที่ไม่สำเร็จ ไม่ใช่วงเงินเป็นบาท</p>
          </div>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <NumberField id="ai-daily" label="คำขอ AI ต่อวันของทั้งองค์กร (UTC)" name="daily_limit" min={1} max={10000} defaultValue={a.daily_limit} />
            <NumberField id="ai-conversation" label="คำตอบ Chatbot ต่อบทสนทนา" name="conversation_limit" min={1} max={100} defaultValue={a.conversation_limit} />
            <NumberField id="ai-output" label="Output tokens สูงสุดต่อคำขอ" name="max_output_tokens" min={200} max={2000} defaultValue={a.max_output_tokens} />
          </div>
          <div className="flex wrap mt">
            <span className="badge">
              วันนี้ {a.usage.requests} / {a.daily_limit} คำขอ
            </span>
            <span className="badge">Input {a.usage.input_tokens.toLocaleString()} tokens</span>
            <span className="badge">Output {a.usage.output_tokens.toLocaleString()} tokens</span>
          </div>
        </div>
      </section>

      <div className="settings-save">
        <span className="muted">การแก้ไขจะมีผลทันทีหลังบันทึก</span>
        <button className="btn primary" type="submit">
          <Icon name="check" />
          บันทึกการตั้งค่า AI
        </button>
      </div>
    </Form>
  );
}
