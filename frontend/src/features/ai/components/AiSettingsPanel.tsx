'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { InfoHint } from '@/components/ui/InfoHint';
import { useToast } from '@/components/ui/Toast';
import { NumberField } from '@/components/ui/fields';
import { useApi, useInvalidate } from '@/lib/query';
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
  const toast = useToast();
  const refresh = useInvalidate();
  const { confirm } = useDialogs();
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

  const disconnect = (title: string, message: string, body: Record<string, boolean>, last: boolean) =>
    confirm({
      title,
      message,
      confirmLabel: title,
      tone: 'danger',
      run: async () => {
        // The last connection going: what runs on AI is switched off with it, instead of the admin doing that first.
        const off = last ? { drafts_enabled: false, chatbot_enabled: false, mood_enabled: false, translate_enabled: false, triage_enabled: false } : {};
        await saveAiSettings({ ...body, ...off });
        toast(`${title}แล้ว`);
        await refresh(AI_SETTINGS_PATH, '/api/workspace');
      },
    });

  return (
    <Form
      // A save shows the saved values again (and empty key and secret boxes), like reopening the page did.
      key={`${a.version}:${a.key_configured}:${a.provider}`}
      data-form="ai-settings"
      onSubmit={async (values, form) => {
          // A switch not on the page (แปลภาษาสองทาง while the platform does not offer it) keeps what was saved.
          const checked = (name: 'drafts_enabled' | 'chatbot_enabled' | 'mood_enabled' | 'translate_enabled' | 'triage_enabled') =>
            (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? Boolean(a[name]);
          const body: Record<string, unknown> = { ...values };
          for (const key of ['drafts_enabled', 'chatbot_enabled', 'mood_enabled', 'translate_enabled', 'triage_enabled'] as const) body[key] = checked(key);
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
            <h2>
              การเชื่อมต่อ AI
              <InfoHint>
                {n8n
                  ? `งาน AI ทั้งหมดส่งไปที่ workflow ใน n8n (${a.webhook_host}) และเลือกโมเดลใน workflow`
                  : `ข้อความและบทความที่เกี่ยวข้องส่งไปที่ ${a.key_configured ? service : 'OpenAI หรือ Gemini'} เพื่อสร้างคำตอบ ค่าบริการคิดตามบัญชี API ของคุณ`}
              </InfoHint>
            </h2>
          </div>
          <span className={`badge ${a.key_configured ? 'resolved' : ''}`}>
            {n8n ? 'ใช้ n8n Webhook' : a.key_configured ? `ใช้ ${service}` : 'ยังไม่ได้เชื่อม AI'}
          </span>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <TextField
              id="ai-key"
              label={
                <>
                  API Key (OpenAI หรือ Gemini)
                  <InfoHint>
                    {n8n
                      ? 'ไม่ใช้คีย์นี้ระหว่างที่เชื่อม n8n Webhook อยู่'
                      : 'ระบบรู้เองจากคีย์ว่าเป็น OpenAI หรือ Gemini คีย์เก็บไว้ที่เซิร์ฟเวอร์เท่านั้นและจะไม่แสดงให้เห็นอีก'}
                  </InfoHint>
                </>
              }
              name="api_key"
              type="password"
              required={false}
              max={503}
              minLength={undefined}
              autoComplete="new-password"
              placeholder={a.openai_key ? `บันทึกคีย์ ${service} แล้ว เว้นว่างเพื่อใช้คีย์เดิม` : 'sk-… หรือ AQ.…'}
            />
            <TextField
              id="ai-model"
              label={
                <>
                  โมเดล
                  <InfoHint>
                    {n8n ? 'เมื่อใช้ n8n ให้เลือกโมเดลใน workflow แทน' : 'ต้องเป็นโมเดลที่บัญชีของคุณใช้ได้และรองรับ Structured Outputs'}
                  </InfoHint>
                </>
              }
              name="model"
              defaultValue={a.model}
              max={100}
            />
          </div>
          <div className="flex wrap mt">
            <button className="btn" type="button" disabled={!a.key_configured || testing} onClick={() => void test()}>
              <Icon name="checkCircle" />
              ทดสอบการเชื่อมต่อ
            </button>
            <span id="ai-test-result" role="status" className="tiny muted">
              {testResult}
            </span>
          </div>
          <div className="ai-n8n">
            <h3 className="ai-settings-heading">
              ใช้ n8n แทน API Key
              <InfoHint>ส่งงาน AI ให้ workflow ใน n8n แทนการใช้ API Key ใส่ Production URL ของโหนด Webhook และรหัสลับ แล้วกดบันทึก</InfoHint>
              {n8n && <span className="badge resolved">เชื่อมแล้ว</span>}
            </h3>
            <div className="form-grid">
              <TextField
                id="ai-webhook-url"
                label={
                  <>
                    Webhook URL
                    <InfoHint>ใช้ Production URL ที่มี /webhook/ ไม่ใช่ /webhook-test/ เพราะ Test URL ใช้ได้เฉพาะตอนกด Listen ใน n8n</InfoHint>
                  </>
                }
                name="webhook_url"
                type="url"
                required={false}
                max={500}
                defaultValue={a.webhook_url}
                placeholder="https://xxx.app.n8n.cloud/webhook/bookdose-ai"
                hint={testUrl ? <span className="ai-webhook-warn">นี่คือ Test URL ให้เปลี่ยน /webhook-test/ เป็น /webhook/</span> : undefined}
              />
              <div className="ai-secret">
                <TextField
                  id="ai-webhook-secret"
                  label={
                    <>
                      รหัสลับ
                      <InfoHint>ต้องตรงกับ Value ใน Header Auth ของ n8n ที่ตั้ง Name เป็น X-Bookdose-Secret</InfoHint>
                    </>
                  }
                  name="webhook_secret"
                  type="password"
                  required={false}
                  max={200}
                  placeholder={n8n ? `บันทึกแล้ว ลงท้ายด้วย …${a.webhook_secret_end} เว้นว่างเพื่อใช้รหัสเดิม` : 'อย่างน้อย 16 ตัว'}
                />
                <button className="btn subtle small" type="button" onClick={makeSecret}>
                  <Icon name="lock" />
                  สร้างรหัสลับ
                </button>
              </div>
            </div>
          </div>
          {(n8n || a.openai_key) && (
            <div className="ai-remove">
              {n8n && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={() =>
                    disconnect(
                      'เลิกใช้ n8n Webhook',
                      a.openai_key ? `งาน AI จะกลับไปใช้ API Key ของ ${service} ทันที` : 'AI ทุกอย่างในองค์กรจะหยุดทำงานจนกว่าจะเชื่อมใหม่',
                      { remove_webhook: true },
                      !a.openai_key,
                    )
                  }
                >
                  <Icon name="trash" />
                  เลิกใช้ n8n Webhook
                </button>
              )}
              {a.openai_key && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={() =>
                    disconnect(
                      'ลบ API Key',
                      n8n ? 'คีย์จะถูกลบออกจากระบบ งาน AI ยังส่งไปที่ n8n ตามเดิม' : 'คีย์จะถูกลบออกจากระบบ และ AI ทุกอย่างในองค์กรจะหยุดทำงานจนกว่าจะเชื่อมใหม่',
                      { remove_key: true },
                      !n8n,
                    )
                  }
                >
                  <Icon name="trash" />
                  ลบ API Key
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 2. What the AI is allowed to do. */}
      <section className="card">
        <div className="card-header">
          <div>
            <h2>
              ให้ AI ทำอะไรบ้าง
              <InfoHint>AI ได้รับแค่ตัวข้อความและหัวเรื่อง ไม่ได้รับชื่อหรือข้อมูลติดต่อของลูกค้า การอ่านอารมณ์และการแปลนับโควตาแยกจากงานอื่น</InfoHint>
            </h2>
          </div>
        </div>
        <div className="card-body hours-switches">
          {/* Label text and (i) sit straight in the label: a <span> here is a grid (hours-switches) and would put the (i) on a line of its own. */}
          <label className="check">
            <input type="checkbox" className="switch" name="drafts_enabled" defaultChecked={a.drafts_enabled} />
            ช่วยเจ้าหน้าที่
            <InfoHint>ร่างคำตอบ เกลาข้อความ และผู้ช่วย AI มุมขวาล่าง ใช้ได้ทั้งบทความและบันทึกภายใน</InfoHint>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="chatbot_enabled" defaultChecked={a.chatbot_enabled} />
            Chatbot ตอบลูกค้าในแชทบนเว็บ
            <InfoHint>ตอบจากบทความที่เผยแพร่ให้ลูกค้าเท่านั้น เริ่มกับบทสนทนาใหม่ ส่วนบทสนทนาเดิมเจ้าหน้าที่เลือกเปิดเป็นรายเรื่อง</InfoHint>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="mood_enabled" defaultChecked={a.mood_enabled} />
            อ่านอารมณ์ลูกค้า
            <InfoHint>AI ดูข้อความล่าสุดว่าลูกค้าไม่พอใจหรือเร่งด่วนไหม เพื่อดันเคสขึ้นก่อน ถ้าปิด ระบบยังดูจากคำในข้อความเหมือนเดิม</InfoHint>
          </label>
          {a.translate_offered && (
            <label className="check">
              <input type="checkbox" className="switch" name="translate_enabled" defaultChecked={a.translate_enabled} />
              แปลภาษาสองทาง
              <InfoHint>ลูกค้าพิมพ์ภาษาอื่น เจ้าหน้าที่เห็นเป็นภาษาไทย และคำตอบภาษาไทยจะแปลเป็นภาษาของลูกค้าก่อนส่ง</InfoHint>
            </label>
          )}
          <label className="check">
            <input type="checkbox" className="switch" name="triage_enabled" defaultChecked={a.triage_enabled} />
            เสนอป้าย ความเร่งด่วน และทีมให้เคสใหม่
            <InfoHint>AI อ่านข้อความแรกแล้วแสดงข้อเสนอบนหน้าเคส ทีมงานเลือกใช้เอง ระบบไม่เปลี่ยนให้</InfoHint>
          </label>
        </div>
      </section>

      {/* 3. How much, and how much of it was used today. */}
      <section className="card">
        <div className="card-header">
          <div>
            <h2>
              เพดานการใช้งาน
              <InfoHint>นับจำนวนงานที่รับเข้าคิว รวมงานทดสอบและงานที่ไม่สำเร็จ ไม่ใช่วงเงินเป็นบาท</InfoHint>
            </h2>
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
        <button className="btn primary" type="submit">
          <Icon name="check" />
          บันทึกการตั้งค่า AI
        </button>
      </div>
    </Form>
  );
}
