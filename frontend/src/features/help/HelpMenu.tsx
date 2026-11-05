'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useOpenOnThisPage } from '@/components/shell/chrome';
import { useDialogs } from '@/components/ui/Dialogs';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { readFile } from '@/lib/files';
import { startTour } from '@/features/tour/Tour';
import { reportProblem, reportProblemAsCustomer } from './api';

/* The ? in the top bar: the three things a member reaches for when the screen does not do what they expected -
   the keys that save time, the guides the Bookdose team writes, and a way to say that something is broken.

   A report goes to the platform, not to the organization's own admins: what is reported here is the product, and
   only the team that builds it can fix it. It is read in the platform console (ผู้ดูแลแพลตฟอร์ม → รายงานปัญหา).
   A signed-in customer gets the same ? with what a customer needs: the answers, the system's status and the same
   report (it is marked as a customer's in the console). Markup: styles/layout.css (help-menu). */

type Audience = 'staff' | 'customer';

const MAX = 4000;

/** ⌘ on a Mac, Ctrl everywhere else; the top bar's search hint is written the same way. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const SHORTCUTS: { keys: string; what: string; where: string }[] = [
  { keys: `${MOD} K`, what: 'ค้นหาเคส ลูกค้า บทความ และหน้าต่าง ๆ แล้วไปที่นั่นทันที', where: 'ทุกหน้า' },
  { keys: '/', what: 'แทรกคำตอบสำเร็จรูป พิมพ์ต่อเพื่อค้นหา', where: 'ช่องพิมพ์ตอบ' },
  { keys: '↑ ↓', what: 'เลือกคำตอบในเมนูที่ขึ้นมา', where: 'ช่องพิมพ์ตอบ' },
  { keys: 'Enter หรือ Tab', what: 'แทรกคำตอบที่เลือกไว้', where: 'ช่องพิมพ์ตอบ' },
  { keys: 'Alt 1 … Alt 9', what: 'แทรกคำตอบด่วนของฉันอันที่ 1 ถึง 9', where: 'ช่องพิมพ์ตอบ' },
  { keys: 'Esc', what: 'ปิดเมนู กล่องข้อความ หรือหน้าต่างที่เปิดอยู่', where: 'ทุกหน้า' },
];

/** tour: the member's ไกด์การใช้งาน can be opened here (features/tour), in an organization they work in. */
export function HelpMenu({ audience = 'staff', tour = false }: { audience?: Audience; tour?: boolean }) {
  const [open, setOpen] = useOpenOnThisPage();
  const { openModal } = useDialogs();
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!root.current?.contains(target) || target.closest('.menu-item')) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <div className="profile-menu help-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-btn help-btn"
        aria-expanded={open}
        aria-controls="help-menu"
        aria-label="ความช่วยเหลือ"
        data-tip="ความช่วยเหลือ"
        title="ความช่วยเหลือ"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="help" />
      </button>
      <div className="profile-menu-panel" id="help-menu" hidden={!open}>
        {audience === 'customer' ? (
          <Link className="menu-item" href="/customer/faq">
            <Icon name="book" />
            คำถามที่พบบ่อย
          </Link>
        ) : (
          <>
            {tour && (
              <button type="button" className="menu-item" onClick={() => startTour()}>
                <Icon name="sparkle" />
                ไกด์การใช้งาน
              </button>
            )}
            <button type="button" className="menu-item" onClick={() => openModal('คีย์ลัดทั้งหมด', <ShortcutList />)}>
              <Icon name="bolt" />
              คีย์ลัดทั้งหมด
            </button>
            <Link className="menu-item" href="/guides">
              <Icon name="book" />
              คู่มือจาก Bookdose
            </Link>
          </>
        )}
        {/* Opens in its own tab: when something is broken, the page you are on is the one you want to keep. */}
        <a className="menu-item" href="/status" target="_blank" rel="noopener">
          <Icon name="chart" />
          สถานะระบบ
        </a>
        <button type="button" className="menu-item" onClick={() => openModal('รายงานปัญหา', <ReportForm page={pathname} audience={audience} />)}>
          <Icon name="bell" />
          รายงานปัญหา
        </button>
      </div>
    </div>
  );
}

function ShortcutList() {
  return (
    <>
      <dl className="shortcut-list">
        {SHORTCUTS.map((s) => (
          <div className="shortcut-row" key={s.keys}>
            <dt>
              <span className="kbd">{s.keys}</span>
            </dt>
            <dd>
              {s.what}
              <span className="tiny muted block">{s.where}</span>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/* Pictures of the problem: chosen, dropped from the clipboard (a screenshot pasted into the text), up to IMAGES and
   IMAGE_BYTES together, the same limits the server holds (backend platform/schema.py report_images). */
const IMAGES = 5;
const IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

type Picked = { file: File; url: string };

function ReportForm({ page, audience }: { page: string; audience: Audience }) {
  const customer = audience === 'customer';
  const { closeModal } = useDialogs();
  const toast = useToast();
  const [images, setImages] = useState<Picked[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => () => images.forEach((image) => URL.revokeObjectURL(image.url)), [images]);
  const add = (files: File[]) => {
    const pictures = files.filter((file) => IMAGE_TYPES.includes(file.type));
    if (pictures.length < files.length) toast('แนบได้เฉพาะรูป PNG, JPG, GIF หรือ WebP', true);
    const next = [...images, ...pictures.map((file) => ({ file, url: URL.createObjectURL(file) }))];
    if (next.length > IMAGES) toast(`แนบรูปได้สูงสุด ${IMAGES} รูป`, true);
    const kept = next.slice(0, IMAGES);
    if (kept.reduce((total, image) => total + image.file.size, 0) > IMAGE_BYTES) {
      toast('รูปทั้งหมดรวมกันต้องไม่เกิน 5 MB', true);
      return;
    }
    setImages(kept);
  };
  return (
    <Form
      data-form="problem-report"
      onSubmit={async (values) => {
        const uploads = await Promise.all(
          images.map(async ({ file }, i) => {
            const read = await readFile(file);
            // A pasted screenshot is named image.png every time; numbered, they stay apart in the console.
            return {
              ...read,
              name: file.name === 'image.png' ? `screenshot-${i + 1}.png` : file.name,
            };
          }),
        );
        await (customer ? reportProblemAsCustomer : reportProblem)(String(values.message ?? ''), page, uploads);
        closeModal(true);
        toast('ส่งรายงานให้ผู้ดูแลแพลตฟอร์มแล้ว ขอบคุณครับ');
      }}
    >
      <div className="field">
        <label htmlFor="report-message">เกิดอะไรขึ้น</label>
        <textarea
          id="report-message"
          name="message"
          rows={6}
          maxLength={MAX}
          required
          autoFocus
          placeholder={
            customer ? 'เช่น กดส่งข้อความแล้วไม่มีอะไรเกิดขึ้น ทำซ้ำได้ทุกครั้ง' : 'เช่น กดปุ่มมอบหมายในหน้าเคสแล้วไม่มีอะไรเกิดขึ้น ทำซ้ำได้ทุกครั้ง'
          }
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files];
            if (!pasted.length) return;
            event.preventDefault();
            add(pasted);
          }}
        />
      </div>
      <input
        ref={picker}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        multiple
        hidden
        onChange={(event) => {
          add([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      {images.length > 0 && (
        <div className="report-images">
          {images.map((image, i) => (
            <figure key={image.url} className="report-image">
              {/* A local preview (blob: URL) of a file not sent yet. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={image.file.name} />
              <button
                type="button"
                className="report-image-remove"
                aria-label={`เอา ${image.file.name} ออก`}
                onClick={() => setImages(images.filter((_, j) => j !== i))}
              >
                <Icon name="close" />
              </button>
            </figure>
          ))}
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn subtle report-attach" disabled={images.length >= IMAGES} onClick={() => picker.current?.click()}>
          <Icon name="paperclip" />
          {images.length ? `แนบรูป ${images.length}/${IMAGES}` : 'แนบรูป'}
        </button>
        <button type="button" className="btn" onClick={() => closeModal()}>
          ยกเลิก
        </button>
        <button type="submit" className="btn primary">
          <Icon name="send" />
          ส่งรายงาน
        </button>
      </div>
    </Form>
  );
}
