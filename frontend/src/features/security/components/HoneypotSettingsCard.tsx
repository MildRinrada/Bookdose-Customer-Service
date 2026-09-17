'use client';

import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { NumberField, SelectField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useApi, useInvalidate } from '@/lib/query';
import { DECOY_PAGE_PATHS, DECOY_PAGE_PREFIXES } from '@/lib/traps';
import { saveHoneypotSettings, SECURITY_PREFIX, SETTINGS_PATH } from '../api';
import { BUILT_IN_API_DECOYS, CUSTOM_DECOY_PATH, decoyMatchLabels, durationLabels, MAX_CUSTOM_DECOYS, PATH_HIT_BOUNDS } from '../labels';
import type { BlockDuration, DecoyPathMatch, HoneypotSettings, SecuritySettings } from '../types';

/* Honeypot settings (docs/HONEYPOT-DESIGN.md §3): the decoy paths and the hidden form fields on or off, the
   Superadmin's own API decoy paths (the server refuses one that would shadow a real route and says why), and when
   an address is blocked by itself. Saves only the honeypot part of the security settings. */

const DEFAULTS: HoneypotSettings = {
  paths_enabled: true,
  forms_enabled: true,
  custom_api_paths: [],
  block_on_path_hits: { enabled: true, hits: 3, window_minutes: 10, duration: '1h' },
  block_on_honeytoken: { enabled: true, duration: '24h' },
};

export function HoneypotSettingsCard() {
  const settings = useApi<SecuritySettings>(SETTINGS_PATH);
  return (
    <section className="card security-card" id="security-honeypot-settings" aria-labelledby="security-honeypot-settings-title">
      <div className="card-header">
        <div>
          <h2 id="security-honeypot-settings-title">ตั้งค่ากับดัก</h2>
          <p>เส้นทางล่อ ช่องซ่อนในฟอร์ม และการบล็อก IP อัตโนมัติ · การเปลี่ยนแปลงถูกบันทึกเป็นเหตุการณ์ระดับวิกฤต</p>
        </div>
        <Icon name="settings" />
      </div>
      {settings.error ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data ? (
        <HoneypotForm key={JSON.stringify(settings.data.honeypot ?? null)} value={{ ...DEFAULTS, ...settings.data.honeypot }} />
      ) : (
        <PageLoading />
      )}
    </section>
  );
}

type PathRow = { key: number; path: string; match: DecoyPathMatch };

const checked = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? false;

function DurationSelect({ name, label, value }: { name: string; label: string; value: BlockDuration }) {
  return (
    <SelectField label={label} name={name} required defaultValue={value}>
      {(Object.keys(durationLabels) as BlockDuration[]).map((d) => (
        <option key={d} value={d}>
          {durationLabels[d]}
        </option>
      ))}
    </SelectField>
  );
}

function HoneypotForm({ value }: { value: HoneypotSettings }) {
  const toast = useToast();
  const refresh = useInvalidate();
  // Row keys: the saved rows are 0…n-1, rows added here count on from n.
  const counter = useRef(value.custom_api_paths.length);
  const [paths, setPaths] = useState<PathRow[]>(() => value.custom_api_paths.map((p, key) => ({ key, path: p.path, match: p.match })));
  const [newest, setNewest] = useState<number | null>(null);
  const hits = value.block_on_path_hits;

  const change = (key: number, next: Partial<PathRow>) => setPaths((list) => list.map((row) => (row.key === key ? { ...row, ...next } : row)));
  const add = () => {
    const key = counter.current++;
    setPaths((list) => [...list, { key, path: '/api/', match: 'exact' }]);
    setNewest(key);
  };

  return (
    <Form
      className="card-body"
      data-form="security-honeypot"
      onSubmit={async (values, form) => {
        const custom = paths
          .map((row) => ({ path: row.path.trim().toLowerCase().replace(/\/+$/, ''), match: row.match }))
          .filter((row) => row.path && row.path !== '/api');
        for (const row of custom) {
          if (!CUSTOM_DECOY_PATH.test(row.path)) throw new Error(`เส้นทาง ${row.path} ไม่ถูกต้อง ต้องขึ้นต้นด้วย /api/ และใช้ a-z 0-9 . _ ~ - เท่านั้น`);
        }
        const body: HoneypotSettings = {
          paths_enabled: checked(form, 'paths_enabled'),
          forms_enabled: checked(form, 'forms_enabled'),
          custom_api_paths: custom,
          block_on_path_hits: {
            enabled: checked(form, 'block_paths_enabled'),
            hits: Number(values.block_paths_hits),
            window_minutes: Number(values.block_paths_window),
            duration: values.block_paths_duration as BlockDuration,
          },
          block_on_honeytoken: {
            enabled: checked(form, 'block_token_enabled'),
            duration: values.block_token_duration as BlockDuration,
          },
        };
        await saveHoneypotSettings(body);
        toast('บันทึกการตั้งค่ากับดักแล้ว');
        await refresh(SETTINGS_PATH, `${SECURITY_PREFIX}/events`);
      }}
    >
      <div className="trap-switches">
        <label className="check">
          <input type="checkbox" className="switch" name="paths_enabled" defaultChecked={value.paths_enabled} />
          <span>
            <strong>เส้นทางล่อ</strong>
            <span className="tiny muted">บันทึกเมื่อมีการเปิดเส้นทางที่ผู้ใช้จริงไม่มีวันเปิด เช่น /.env, /wp-admin, /api/admin</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" className="switch" name="forms_enabled" defaultChecked={value.forms_enabled} />
          <span>
            <strong>ช่องซ่อนในฟอร์ม</strong>
            <span className="tiny muted">ช่องที่คนมองไม่เห็นในหน้าเข้าสู่ระบบ สมัครสมาชิก ลืมรหัสผ่าน และเริ่มแชท บอทที่กรอกจะถูกปฏิเสธอย่างเงียบ ๆ</span>
          </span>
        </label>
      </div>

      <h3 className="security-subhead">เส้นทาง API ล่อที่กำหนดเอง</h3>
      <p className="tiny muted">
        ตอบเหมือนเส้นทางที่ไม่มีอยู่ทุกประการ ใช้ได้เฉพาะเส้นทางใต้ /api/ ที่ไม่ซ้อนกับเส้นทางจริงของระบบ สูงสุด {MAX_CUSTOM_DECOYS} รายการ
      </p>
      {paths.length > 0 && (
        <ul className="trap-paths">
          {paths.map((row, index) => (
            <li key={row.key}>
              <input
                aria-label={`เส้นทางที่ ${index + 1}`}
                className="mono"
                value={row.path}
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
                autoFocus={row.key === newest}
                placeholder="/api/..."
                onChange={(e) => change(row.key, { path: e.currentTarget.value })}
              />
              <select aria-label={`การจับคู่ของเส้นทางที่ ${index + 1}`} value={row.match} onChange={(e) => change(row.key, { match: e.currentTarget.value as DecoyPathMatch })}>
                {(Object.keys(decoyMatchLabels) as DecoyPathMatch[]).map((m) => (
                  <option key={m} value={m}>
                    {decoyMatchLabels[m]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                aria-label={`นำเส้นทาง ${row.path} ออก`}
                onClick={() => setPaths((list) => list.filter((item) => item.key !== row.key))}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn subtle" onClick={add} disabled={paths.length >= MAX_CUSTOM_DECOYS}>
        <Icon name="plus" />
        เพิ่มเส้นทาง
      </button>
      <details className="trap-builtins">
        <summary>เส้นทางล่อที่มีอยู่แล้วในระบบ</summary>
        <p className="tiny muted">หน้าเว็บ</p>
        <p className="mono small security-wrap">
          {[...DECOY_PAGE_PATHS, ...DECOY_PAGE_PREFIXES.map((p) => `${p}/…`)].join('  ')}
        </p>
        <p className="tiny muted">API</p>
        <p className="mono small security-wrap">{BUILT_IN_API_DECOYS.join('  ')}</p>
      </details>

      <h3 className="security-subhead">บล็อก IP อัตโนมัติ</h3>
      <p className="tiny muted">ไม่บล็อก IP ของเครื่องนี้เอง (localhost) และ IP ของผู้ดูแลแพลตฟอร์มที่เข้าสู่ระบบอยู่</p>
      <div className="security-settings-grid trap-block-grid">
        <fieldset className="security-fieldset">
          <legend>เมื่อเปิดเส้นทางล่อซ้ำ</legend>
          <label className="check">
            <input type="checkbox" className="switch" name="block_paths_enabled" defaultChecked={hits.enabled} />
            บล็อกอัตโนมัติ
          </label>
          <NumberField label="จำนวนครั้ง" name="block_paths_hits" min={PATH_HIT_BOUNDS.hits.min} max={PATH_HIT_BOUNDS.hits.max} step={1} defaultValue={hits.hits} />
          <NumberField
            label="ภายใน (นาที)"
            name="block_paths_window"
            min={PATH_HIT_BOUNDS.window_minutes.min}
            max={PATH_HIT_BOUNDS.window_minutes.max}
            step={1}
            defaultValue={hits.window_minutes}
          />
          <DurationSelect name="block_paths_duration" label="บล็อกนาน" value={hits.duration} />
        </fieldset>
        <fieldset className="security-fieldset">
          <legend>เมื่อกับดัก Honeytoken ทำงาน</legend>
          <label className="check">
            <input type="checkbox" className="switch" name="block_token_enabled" defaultChecked={value.block_on_honeytoken.enabled} />
            บล็อกอัตโนมัติทันที
          </label>
          <DurationSelect name="block_token_duration" label="บล็อกนาน" value={value.block_on_honeytoken.duration} />
          <p className="tiny muted">การทดสอบกับดักจากรายการไม่บล็อก และไม่ส่งอีเมล</p>
        </fieldset>
      </div>
      <div className="security-form-end">
        <button type="submit" className="btn primary">
          <Icon name="check" />
          บันทึกการตั้งค่ากับดัก
        </button>
      </div>
    </Form>
  );
}
