'use client';

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from '@/components/Icon';

/* เบลอข้อมูลส่วนตัวในภาพก่อนส่ง: a customer's picture, before it is attached for good - drag over a phone number or an
   account number to blur it (the pixels under it are replaced for good, not covered), or drag to circle where the
   problem is. Undo takes the last mark back. Saving gives a new file in place of the chosen one; nothing leaves the
   browser before the message is sent.

   ย่อขยาย: small writing on a phone photo cannot be drawn over at the size the whole picture fits, so the picture can be
   made bigger - the ย่อ-ขยาย slider, as the profile photo cropper has, or Ctrl/⌘ with the wheel - and moved about
   inside its window: the เลื่อนซ้าย-ขวา slider under it, the mouse wheel held down and dragged (as a design tool does
   it), the wheel turned, or the window's own bars. Zoom is only how large the picture is shown: the marks are drawn in
   the picture's own pixels, so what is saved is the same at any size.

   The profile photo cropper (PhotoCropper) works the same way: the picture on a canvas, the pointer mapped onto it.
   Opened from a picture's pill (FilePills). Markup: components (image-markup). */

type Tool = 'blur' | 'circle';
type Box = { x: number; y: number; w: number; h: number };

/** The longest side kept: a phone photo is bigger than any screen needs, and a smaller file leaves room for others. */
const LONGEST = 2000;
const UNDO_KEPT = 12;
/** ย่อขยาย: 1 is the whole picture in its window, MOST the furthest in the slider goes. */
const MOST = 8;

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
  // ย่อขยาย: the window the picture is moved about inside, how far in, whether there is a picture to zoom yet, the
  // width CSS gives it when the whole of it is shown (the zoom multiplies it), and the point to keep still while it
  // changes size.
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [fitted, setFitted] = useState(0);
  const hold = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null);
  // เลื่อนซ้าย-ขวา: where the window is scrolled across and how far it can go, which is the slider's place and length.
  const [across, setAcross] = useState({ at: 0, most: 0 });
  // กดลูกล้อเมาส์แล้วลาก: the last place the held-down wheel was, and whether it is being dragged (for the cursor).
  const grab = useRef<{ id: number; x: number; y: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

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
        setReady(true);
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

  // The point the zoom was asked at stays where it was: the picture has just changed size, so the scroll moves by as
  // far as that point moved.
  useLayoutEffect(() => {
    const point = hold.current;
    const frame = stage.current;
    const canvas = shown.current;
    hold.current = null;
    if (!point || !frame || !canvas) return;
    const seen = frame.getBoundingClientRect();
    const picture = canvas.getBoundingClientRect();
    frame.scrollLeft += picture.left + point.fx * picture.width - (seen.left + point.vx);
    frame.scrollTop += picture.top + point.fy * picture.height - (seen.top + point.vy);
  }, [zoom]);

  /** Where the เลื่อนซ้าย-ขวา slider stands: wherever the window is scrolled across, however it was moved. */
  const track = () => {
    const frame = stage.current;
    if (!frame) return;
    const most = Math.max(0, Math.round(frame.scrollWidth - frame.clientWidth));
    const at = Math.min(most, Math.round(frame.scrollLeft));
    setAcross((was) => (was.at === at && was.most === most ? was : { at, most }));
  };

  // At zoom 1 the stylesheet decides how large the picture is shown (the whole of it, in its window): that width is
  // read back here, and the zoom is a multiple of it. Measured when the picture arrives, whenever the window is back
  // at พอดีหน้าจอ, and when the screen changes size; the same width again leaves the component as it is. Runs after the
  // effect above, so the slider is read once the zoom has finished moving the window.
  const measure = () => {
    const width = shown.current?.clientWidth ?? 0;
    if (zoom === 1 && width) setFitted(width);
    track();
  };
  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  /** `towards`: the pointer the zoom came from, which keeps its place; without one, the middle of the window does. */
  const zoomTo = (next: number, towards?: { clientX: number; clientY: number }) => {
    const level = Math.min(MOST, Math.max(1, next));
    const frame = stage.current;
    const canvas = shown.current;
    if (!ready || level === zoom) return;
    if (frame && canvas) {
      const seen = frame.getBoundingClientRect();
      const picture = canvas.getBoundingClientRect();
      const x = towards?.clientX ?? seen.left + seen.width / 2;
      const y = towards?.clientY ?? seen.top + seen.height / 2;
      hold.current = {
        fx: Math.min(1, Math.max(0, (x - picture.left) / picture.width)),
        fy: Math.min(1, Math.max(0, (y - picture.top) / picture.height)),
        vx: x - seen.left,
        vy: y - seen.top,
      };
    }
    setZoom(level);
  };

  // Ctrl/⌘ with the wheel (a trackpad's pinch sends that too) zooms the picture instead of the page. Not onWheel:
  // React listens for the wheel passively, and a passive listener cannot take the browser's own zoom away.
  useEffect(() => {
    const frame = stage.current;
    if (!frame) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomTo(zoom * Math.exp(-event.deltaY / 500), event);
    };
    frame.addEventListener('wheel', wheel, { passive: false });
    return () => frame.removeEventListener('wheel', wheel);
  });

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
        <span className="image-markup-dials">
          <label className="image-markup-zoom" title="ลากเพื่อขยาย หรือกด Ctrl ค้างไว้แล้วหมุนลูกล้อเมาส์บนภาพ">
            <Icon name="search" />
            ย่อ-ขยาย
            <input type="range" min={1} max={MOST} step={0.05} value={zoom} disabled={!ready} onChange={(event) => zoomTo(Number(event.target.value))} />
          </label>
          <span className="image-markup-level" aria-live="polite" aria-label={`ขนาดภาพ ${Math.round(zoom * 100)} เปอร์เซ็นต์`}>
            {Math.round(zoom * 100)}%
          </span>
          {zoom > 1 && (
            <button type="button" className="btn sm" onClick={() => zoomTo(1)} title="กลับไปเห็นภาพทั้งหมด">
              <Icon name="shrink" />
              พอดีหน้าจอ
            </button>
          )}
        </span>
      </div>
      <p className="tiny muted image-markup-hint">
        {tool === 'blur' ? 'ลากคลุมเบอร์โทร เลขบัญชี หรือข้อมูลที่ไม่อยากให้เห็น ส่วนที่เบลอจะอ่านไม่ได้อีก' : 'ลากวงรอบจุดที่มีปัญหา ให้ทีมงานเห็นทันที'}
        {zoom > 1 && ' · เลื่อนดูส่วนอื่นได้ด้วยการกดลูกล้อเมาส์ค้างแล้วลาก แถบเลื่อนใต้ภาพ หรือหมุนลูกล้อ'}
      </p>
      {problem && <p className="error-text">{problem}</p>}
      <div className={`image-markup-stage${grabbing ? ' grabbing' : ''}`} ref={stage} onScroll={track}>
        <canvas
          ref={shown}
          className={`image-markup-canvas tool-${tool}`}
          aria-label="ภาพที่จะแนบ ลากบนภาพเพื่อเบลอหรือวงกลม"
          // Zoomed in, the picture is shown at a width of its own and is larger than its window, which then scrolls.
          style={zoom > 1 && fitted ? { width: Math.round(fitted * zoom), maxWidth: 'none', maxHeight: 'none' } : undefined}
          onPointerDown={(event) => {
            // The wheel held down moves the picture and draws nothing; its press is taken so Windows does not start
            // its own scrolling. Only the left button draws - a right click is for the menu.
            if (event.button === 1) {
              event.preventDefault();
              grab.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
              setGrabbing(true);
              event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
            if (event.button !== 0) return;
            const point = at(event);
            drag.current = { id: event.pointerId, from: point, to: point };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const held = grab.current;
            if (held && held.id === event.pointerId) {
              // The picture follows the pointer, so the window moves the other way.
              if (stage.current) {
                stage.current.scrollLeft -= event.clientX - held.x;
                stage.current.scrollTop -= event.clientY - held.y;
              }
              grab.current = { id: held.id, x: event.clientX, y: event.clientY };
              return;
            }
            if (!drag.current || drag.current.id !== event.pointerId) return;
            drag.current.to = at(event);
            paint();
          }}
          onPointerUp={(event) => {
            if (grab.current?.id === event.pointerId) {
              grab.current = null;
              setGrabbing(false);
              return;
            }
            finish();
          }}
          onPointerCancel={() => {
            grab.current = null;
            setGrabbing(false);
            drag.current = null;
            paint();
          }}
          onAuxClick={(event) => event.preventDefault()}
        />
      </div>
      {across.most > 0 && (
        <label className="image-markup-slide">
          เลื่อนซ้าย-ขวา
          <input type="range" min={0} max={across.most} step={1} value={across.at} onChange={(event) => stage.current?.scrollTo({ left: Number(event.target.value) })} />
        </label>
      )}
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
