'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from '@/components/Icon';

/* เบลอข้อมูลส่วนตัวในภาพก่อนส่ง: a customer's picture, before it is attached for good - drag over a phone number or an
   account number to blur it (the pixels under it are replaced for good, not covered), or drag to circle where the
   problem is. Undo takes the last mark back. Saving gives a new file in place of the chosen one; nothing leaves the
   browser before the message is sent. The profile photo cropper (PhotoCropper) works the same way: the picture on a
   canvas, the pointer mapped onto it. Opened from a picture's pill (FilePills). Markup: components (image-markup). */

type Tool = 'blur' | 'circle';
type Box = { x: number; y: number; w: number; h: number };

/** The longest side kept: a phone photo is bigger than any screen needs, and a smaller file leaves room for others. */
const LONGEST = 2000;
const UNDO_KEPT = 12;

function box(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Blur for good: the area drawn tiny, then large with no smoothing - a pixelation that cannot be read back. */
function pixelate(ctx: CanvasRenderingContext2D, area: Box) {
  const cell = Math.max(8, Math.round(Math.min(area.w, area.h) / 6));
  const w = Math.max(1, Math.round(area.w / cell));
  const h = Math.max(1, Math.round(area.h / cell));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  small.getContext('2d')?.drawImage(ctx.canvas, area.x, area.y, area.w, area.h, 0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, w, h, area.x, area.y, area.w, area.h);
  ctx.restore();
}

function ring(ctx: CanvasRenderingContext2D, area: Box, preview = false) {
  const width = Math.max(3, Math.round(Math.max(ctx.canvas.width, ctx.canvas.height) / 250));
  ctx.save();
  ctx.strokeStyle = '#e11d2e';
  ctx.lineWidth = width;
  if (preview) ctx.setLineDash([width * 2, width * 1.5]);
  ctx.beginPath();
  ctx.ellipse(area.x + area.w / 2, area.y + area.h / 2, Math.max(1, area.w / 2), Math.max(1, area.h / 2), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function outline(ctx: CanvasRenderingContext2D, area: Box) {
  const width = Math.max(2, Math.round(Math.max(ctx.canvas.width, ctx.canvas.height) / 400));
  ctx.save();
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = width;
  ctx.setLineDash([width * 3, width * 2]);
  ctx.strokeRect(area.x, area.y, area.w, area.h);
  ctx.restore();
}

export function ImageMarkup({ file, onSave, onCancel }: { file: File; onSave: (file: File) => void; onCancel: () => void }) {
  const shown = useRef<HTMLCanvasElement>(null);
  // The picture with every mark so far (what is saved); the shown canvas is it plus the mark being dragged.
  const work = useRef<HTMLCanvasElement | null>(null);
  const undo = useRef<ImageData[]>([]);
  const drag = useRef<{ id: number; from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const [tool, setTool] = useState<Tool>('blur');
  const [marks, setMarks] = useState(0);
  const [problem, setProblem] = useState('');

  const paint = () => {
    const canvas = shown.current;
    const base = work.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !base || !ctx) return;
    ctx.drawImage(base, 0, 0);
    const d = drag.current;
    if (d) {
      const area = box(d.from, d.to);
      if (tool === 'blur') outline(ctx, area);
      else ring(ctx, area, true);
    }
  };

  useEffect(() => {
    let alive = true;
    createImageBitmap(file)
      .then((bitmap) => {
        if (!alive || !shown.current) return;
        const scale = Math.min(1, LONGEST / Math.max(bitmap.width, bitmap.height));
        const base = document.createElement('canvas');
        base.width = shown.current.width = Math.round(bitmap.width * scale);
        base.height = shown.current.height = Math.round(bitmap.height * scale);
        base.getContext('2d')?.drawImage(bitmap, 0, 0, base.width, base.height);
        work.current = base;
        shown.current.getContext('2d')?.drawImage(base, 0, 0);
      })
      .catch(() => alive && setProblem('เปิดภาพนี้ไม่ได้'));
    return () => {
      alive = false;
    };
  }, [file]);

  const at = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  };

  const finish = () => {
    const d = drag.current;
    const base = work.current;
    const ctx = base?.getContext('2d');
    drag.current = null;
    if (!d || !base || !ctx) return;
    const area = box(d.from, d.to);
    if (area.w >= 6 && area.h >= 6) {
      undo.current = [...undo.current.slice(-(UNDO_KEPT - 1)), ctx.getImageData(0, 0, base.width, base.height)];
      if (tool === 'blur') pixelate(ctx, area);
      else ring(ctx, area);
      setMarks((n) => n + 1);
    }
    paint();
  };

  const takeBack = () => {
    const last = undo.current.pop();
    if (!last || !work.current) return;
    work.current.getContext('2d')?.putImageData(last, 0, 0);
    setMarks((n) => Math.max(0, n - 1));
    paint();
  };

  const save = () => {
    const base = work.current;
    if (!base) return;
    // A photo stays a JPEG (small); a screenshot a PNG (sharp text).
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    base.toBlob(
      (blob) => {
        if (!blob) return setProblem('บันทึกภาพไม่สำเร็จ');
        const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/jpeg' ? '.jpg' : '.png');
        onSave(new File([blob], name, { type }));
      },
      type,
      0.9,
    );
  };

  return (
    <div className="image-markup">
      <div className="image-markup-tools" role="group" aria-label="เครื่องมือ">
        <button type="button" className={`btn sm${tool === 'blur' ? ' active' : ''}`} aria-pressed={tool === 'blur'} onClick={() => setTool('blur')}>
          <Icon name="eye" />
          เบลอ
        </button>
        <button type="button" className={`btn sm${tool === 'circle' ? ' active' : ''}`} aria-pressed={tool === 'circle'} onClick={() => setTool('circle')}>
          <Icon name="edit" />
          วงกลม
        </button>
        {marks > 0 && (
          <button type="button" className="btn sm" onClick={takeBack} title="เอาจุดล่าสุดออก">
            <Icon name="restore" />
            ย้อนกลับ
          </button>
        )}
      </div>
      <p className="tiny muted image-markup-hint">
        {tool === 'blur' ? 'ลากคลุมเบอร์โทร เลขบัญชี หรือข้อมูลที่ไม่อยากให้เห็น ส่วนที่เบลอจะอ่านไม่ได้อีก' : 'ลากวงรอบจุดที่มีปัญหา ให้ทีมงานเห็นทันที'}
      </p>
      {problem && <p className="error-text">{problem}</p>}
      <canvas
        ref={shown}
        className={`image-markup-canvas tool-${tool}`}
        aria-label="ภาพที่จะแนบ ลากบนภาพเพื่อเบลอหรือวงกลม"
        onPointerDown={(event) => {
          const point = at(event);
          drag.current = { id: event.pointerId, from: point, to: point };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current || drag.current.id !== event.pointerId) return;
          drag.current.to = at(event);
          paint();
        }}
        onPointerUp={finish}
        onPointerCancel={() => {
          drag.current = null;
          paint();
        }}
      />
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          ไม่แก้
        </button>
        <button type="button" className="btn primary" onClick={save}>
          ใช้ภาพนี้
        </button>
      </div>
    </div>
  );
}
