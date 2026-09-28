'use client';

import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, PageLoading } from '@/components/ui/display';
import { TextArea, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { SEND_SHORTCUT } from '@/features/inbox/hooks';
import { useInvalidate } from '@/lib/query';
import { PREFS_PATH, savePreferences, usePreferences, type Snippet } from './prefs';

/* ตั้งค่าบัญชี → คำตอบด่วนและคีย์ลัด: the member's own quick replies. In the reply box, typing /<คีย์ลัด> then a space
   (or Tab) puts the text in; Alt+1 to Alt+9 put in the first nine; the ⚡ button lists them all. The organization's
   canned reply and macros stay under ระบบอัตโนมัติ. Also the keyboard shortcuts the app knows. */

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function RepliesSettings() {
  const view = usePreferences();
  if (!view.data) return <PageLoading />;
  return (
    <div className="account-section">
      <SnippetsCard snippets={view.data.preferences.snippets} />
      <ShortcutsCard />
    </div>
  );
}

function SnippetForm({ snippet, onSave }: { snippet?: Snippet; onSave: (snippet: Snippet) => Promise<void> }) {
  return (
    <Form
      className="dialog-form"
      onSubmit={async (values) => onSave({ id: snippet?.id, shortcut: values.shortcut ?? '', text: values.text ?? '' })}
    >
      <TextField
        label="คีย์ลัด (พิมพ์ / ตามด้วยคำนี้)"
        name="shortcut"
        max={31}
        defaultValue={snippet ? `/${snippet.shortcut}` : '/'}
        hint="ตัวอักษรไทย อังกฤษ ตัวเลข _ หรือ - ไม่มีช่องว่าง เช่น /ขอบคุณ หรือ /thanks"
      />
      <TextArea label="ข้อความ" name="text" max={2000} rows={5} defaultValue={snippet?.text} />
      <button className="btn primary" type="submit">
        <Icon name="check" />
        บันทึกคำตอบด่วน
      </button>
    </Form>
  );
}

function SnippetsCard({ snippets }: { snippets: Snippet[] }) {
  const { openModal, closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const store = async (next: Snippet[], message: string) => {
    await savePreferences({ snippets: next });
    await refresh(PREFS_PATH);
    toast(message);
  };
  const edit = (index?: number) =>
    openModal(
      index === undefined ? 'เพิ่มคำตอบด่วน' : 'แก้ไขคำตอบด่วน',
      <SnippetForm
        snippet={index === undefined ? undefined : snippets[index]}
        onSave={async (snippet) => {
          const next = index === undefined ? [...snippets, snippet] : snippets.map((s, i) => (i === index ? snippet : s));
          await store(next, index === undefined ? 'เพิ่มคำตอบด่วนแล้ว' : 'บันทึกคำตอบด่วนแล้ว');
          closeModal(true);
        }}
      />,
    );
  const move = (index: number, by: number) => {
    const next = [...snippets];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    void run(() => store(next, 'เปลี่ยนลำดับแล้ว'));
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>คำตอบด่วนของฉัน</h2>
          <p>ในช่องตอบกลับ พิมพ์ /คีย์ลัด แล้วเว้นวรรค ข้อความจะแทรกให้ทันที 9 รายการแรกใช้ Alt+1 ถึง Alt+9 ได้ด้วย</p>
        </div>
        <button className="btn primary" type="button" onClick={() => edit()}>
          <Icon name="plus" />
          เพิ่มคำตอบด่วน
        </button>
      </div>
      <div className="card-body">
        {snippets.length === 0 ? (
          <EmptyState icon="bolt" title="ยังไม่มีคำตอบด่วน" description="เพิ่มข้อความที่พิมพ์บ่อย เช่น คำทักทาย คำขอบคุณ หรือขั้นตอนที่อธิบายซ้ำ ๆ" />
        ) : (
          <ul className="security-list snippet-list">
            {snippets.map((snippet, index) => (
              <li key={snippet.id ?? snippet.shortcut}>
                <span className="security-list-icon">
                  <Icon name="bolt" />
                </span>
                <span className="grow">
                  <strong>
                    <code>/{snippet.shortcut}</code>
                    {index < 9 && <span className="kbd">Alt+{index + 1}</span>}
                  </strong>
                  <span className="muted snippet-text">{snippet.text}</span>
                </span>
                <button className="btn sm" type="button" disabled={index === 0} aria-label="เลื่อนขึ้น" title="เลื่อนขึ้น" onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button
                  className="btn sm"
                  type="button"
                  disabled={index === snippets.length - 1}
                  aria-label="เลื่อนลง"
                  title="เลื่อนลง"
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button className="btn sm" type="button" onClick={() => edit(index)}>
                  <Icon name="edit" />
                  แก้ไข
                </button>
                <button
                  className="btn sm danger"
                  type="button"
                  onClick={() => void run(() => store(snippets.filter((_, i) => i !== index), `ลบ /${snippet.shortcut} แล้ว`))}
                >
                  <Icon name="trash" />
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ShortcutsCard() {
  const mod = MAC ? '⌘' : 'Ctrl';
  const rows: [string, string][] = [
    ['/คีย์ลัด แล้วเว้นวรรค', 'แทรกคำตอบด่วนในช่องตอบกลับ'],
    ['Alt+1 ถึง Alt+9', 'แทรกคำตอบด่วนรายการที่ 1-9'],
    [SEND_SHORTCUT, 'ส่งข้อความ'],
    [`${mod}+K`, 'ค้นหาเคส ลูกค้า บทความ และหน้าต่าง ๆ แล้วไปที่นั่นทันที'],
    ['Alt+↑ / Alt+↓', 'ไปบทสนทนาก่อนหน้า / ถัดไปในกล่องข้อความ'],
    [`${mod}+B / ${mod}+I / ${mod}+U`, 'ตัวหนา / ตัวเอียง / ขีดเส้นใต้'],
    [`${mod}+K ในช่องข้อความ`, 'แทรกลิงก์'],
    ['Esc', 'ปิดหน้าต่างหรือเมนูที่เปิดอยู่'],
  ];
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>คีย์ลัดของระบบ</h2>
          <p>ใช้ได้ทุกหน้าในพื้นที่ทำงาน</p>
        </div>
      </div>
      <div className="card-body">
        <div className="table-wrap">
          <table className="shortcut-table">
            <tbody>
              {rows.map(([keys, action]) => (
                <tr key={keys}>
                  <th scope="row">
                    <span className="kbd">{keys}</span>
                  </th>
                  <td>{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
