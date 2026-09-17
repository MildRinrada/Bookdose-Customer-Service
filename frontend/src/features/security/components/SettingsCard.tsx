'use client';

import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { NumberField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { number } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { saveSecuritySettings, SECURITY_PREFIX, SETTINGS_PATH } from '../api';
import { ALERT_BOUNDS, alertSettingLabels, SESSION_BOUNDS, sessionActorLabels } from '../labels';
import type { SecuritySettings } from '../types';

/* Session limits per kind of account and the alert thresholds. The fields check their own bounds (min / max); the
   form also checks that each idle limit is not longer than its absolute limit. The server checks all of it again. */

export function SettingsCard() {
  const settings = useApi<SecuritySettings>(SETTINGS_PATH);
  return (
    <section className="card security-card security-section" id="security-settings" aria-labelledby="security-settings-title">
      <div className="card-header">
        <div>
          <h2 id="security-settings-title">ตั้งค่าความปลอดภัย</h2>
          <p>ระยะเวลาเซสชันของแต่ละกลุ่มผู้ใช้ และเกณฑ์การแจ้งเตือน · การเปลี่ยนแปลงถูกบันทึกเป็นเหตุการณ์ระดับวิกฤต</p>
        </div>
        <Icon name="settings" />
      </div>
      {settings.error ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data ? (
        // A fresh answer redraws the fields with the saved values (the honeypot part has its own card and form).
        <SettingsForm key={JSON.stringify([settings.data.sessions, settings.data.alerts])} value={settings.data} />
      ) : (
        <PageLoading />
      )}
    </section>
  );
}

const int = (values: Record<string, string>, name: string) => Number(values[name]);

function SettingsForm({ value }: { value: SecuritySettings }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const s = value.sessions;
  const b = SESSION_BOUNDS;
  return (
    <Form
      className="card-body"
      data-form="security-settings"
      onSubmit={async (values) => {
        const body: SecuritySettings = {
          sessions: {
            staff: { idle_minutes: int(values, 'staff_idle'), absolute_hours: int(values, 'staff_absolute') },
            platform: { idle_minutes: int(values, 'platform_idle'), absolute_hours: int(values, 'platform_absolute') },
            customer: { idle_days: int(values, 'customer_idle'), absolute_days: int(values, 'customer_absolute') },
          },
          alerts: {
            ip_failed_logins_10m: int(values, 'ip_failed_logins_10m'),
            platform_failed_logins_10m: int(values, 'platform_failed_logins_10m'),
            locks_1h: int(values, 'locks_1h'),
            ip_rate_limited_10m: int(values, 'ip_rate_limited_10m'),
            webhook_failures_10m: int(values, 'webhook_failures_10m'),
          },
        };
        for (const actor of ['staff', 'platform'] as const) {
          const limits = body.sessions[actor];
          if (limits.idle_minutes > limits.absolute_hours * 60)
            throw new Error(`${sessionActorLabels[actor]}: เวลาไม่ใช้งานต้องไม่นานกว่าเวลาเข้าสู่ระบบสูงสุด (${number(limits.absolute_hours * 60)} นาที)`);
        }
        if (body.sessions.customer.idle_days > body.sessions.customer.absolute_days)
          throw new Error(`${sessionActorLabels.customer}: เวลาไม่ใช้งานต้องไม่นานกว่าเวลาเข้าสู่ระบบสูงสุด`);
        await saveSecuritySettings(body);
        toast('บันทึกการตั้งค่าความปลอดภัยแล้ว');
        await refresh(SETTINGS_PATH, `${SECURITY_PREFIX}/events`);
      }}
    >
      <h3 className="security-subhead">ระยะเวลาเซสชัน</h3>
      <p className="tiny muted">
        ไม่ใช้งาน: ออกจากระบบเมื่อไม่มีการใช้งานนานเกินกำหนด (5 นาที – 30 วัน) · สูงสุด: ต้องเข้าสู่ระบบใหม่เมื่อครบกำหนดแม้ใช้งานอยู่ (1 ชั่วโมง – 90 วัน)
      </p>
      <div className="security-settings-grid">
        {(['staff', 'platform'] as const).map((actor) => (
          <fieldset key={actor} className="security-fieldset">
            <legend>{sessionActorLabels[actor]}</legend>
            <NumberField
              label="ไม่ใช้งาน (นาที)"
              name={`${actor}_idle`}
              min={b.idle_minutes.min}
              max={b.idle_minutes.max}
              step={1}
              defaultValue={s[actor].idle_minutes}
            />
            <NumberField
              label="สูงสุด (ชั่วโมง)"
              name={`${actor}_absolute`}
              min={b.absolute_hours.min}
              max={b.absolute_hours.max}
              step={1}
              defaultValue={s[actor].absolute_hours}
            />
          </fieldset>
        ))}
        <fieldset className="security-fieldset">
          <legend>{sessionActorLabels.customer}</legend>
          <NumberField label="ไม่ใช้งาน (วัน)" name="customer_idle" min={b.idle_days.min} max={b.idle_days.max} step={1} defaultValue={s.customer.idle_days} />
          <NumberField
            label="สูงสุด (วัน)"
            name="customer_absolute"
            min={b.absolute_days.min}
            max={b.absolute_days.max}
            step={1}
            defaultValue={s.customer.absolute_days}
          />
        </fieldset>
      </div>
      <h3 className="security-subhead">เกณฑ์การแจ้งเตือน</h3>
      <p className="tiny muted">ระบบตรวจทุกนาที เมื่อถึงเกณฑ์จะแสดงแถบแจ้งเตือนด้านบนของหน้านี้ และส่งอีเมลถึงผู้ดูแลแพลตฟอร์มเมื่อเป็นระดับวิกฤต</p>
      <div className="security-alert-grid">
        {(Object.keys(alertSettingLabels) as Array<keyof SecuritySettings['alerts']>).map((key) => (
          <div key={key} className="security-threshold">
            <NumberField label={alertSettingLabels[key].label} name={key} min={ALERT_BOUNDS.min} max={ALERT_BOUNDS.max} step={1} defaultValue={value.alerts[key]} />
            <p className="tiny muted">{alertSettingLabels[key].hint}</p>
          </div>
        ))}
      </div>
      <div className="security-form-end">
        <button type="submit" className="btn primary">
          <Icon name="check" />
          บันทึกการตั้งค่า
        </button>
      </div>
    </Form>
  );
}
