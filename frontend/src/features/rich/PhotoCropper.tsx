'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';

/* The profile picture cropper (ported from old-frontend/ui/photo.js): drag the picture under the circle, slide to zoom;
   only the cropped square is kept, as a PNG data: URL. Opened in the sheet by <PhotoPicker>. */

const CROP_SIZE = 320;
// The profile API's limit on the stored picture.
const MAX_DATA_URL = 170000;

/** Check and open a chosen picture; throws the reason in Thai when it cannot be used. */
export async function openPhotoFile(file: File): Promise<ImageBitmap> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('รองรับเฉพาะไฟล์รูป PNG หรือ JPG');
  if (file.size > 5 * 1024 * 1024) throw new Error('ไฟล์รูปต้องมีขนาดไม่เกิน 5 MB');
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error('เปิดไฟล์รูปนี้ไม่ได้ กรุณาเลือกไฟล์อื่น');
  }
}

/* The picture being cropped: how far it is zoomed in and where it sits under the circle. */
type Crop = { base: number; zoom: number; x: number; y: number; drag: { id: number; x: number; y: number } | null };

function startCrop(bitmap: ImageBitmap): Crop {
  const base = Math.max(CROP_SIZE / bitmap.width, CROP_SIZE / bitmap.height);
  return { base, zoom: 1, x: (CROP_SIZE - bitmap.width * base) / 2, y: (CROP_SIZE - bitmap.height * base) / 2, drag: null };
}

// What the circle will hold, drawn as it will look: the rest of the picture stays visible but dimmed.
function drawCrop(canvas: HTMLCanvasElement, bitmap: ImageBitmap, crop: Crop) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = bitmap.width * crop.base * crop.zoom;
  const h = bitmap.height * crop.base * crop.zoom;
  crop.x = Math.min(0, Math.max(CROP_SIZE - w, crop.x));
  crop.y = Math.min(0, Math.max(CROP_SIZE - h, crop.y));
  ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
  ctx.drawImage(bitmap, crop.x, crop.y, w, h);
  ctx.fillStyle = '#0f172a99';
  ctx.beginPath();
  ctx.rect(0, 0, CROP_SIZE, CROP_SIZE);
  ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.strokeStyle = '#ffffffd9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
}

/* Saved at 256 px, and smaller if the picture is too detailed to fit the profile size limit. */
function cropToDataURL(bitmap: ImageBitmap, crop: Crop): string {
  let url = '';
  for (const size of [256, 192, 128]) {
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const step = size / CROP_SIZE;
    out
      .getContext('2d')
      ?.drawImage(bitmap, crop.x * step, crop.y * step, bitmap.width * crop.base * crop.zoom * step, bitmap.height * crop.base * crop.zoom * step);
    url = out.toDataURL('image/png');
    if (url.length <= MAX_DATA_URL) break;
  }
  if (url.length > MAX_DATA_URL) throw new Error('รูปนี้มีรายละเอียดมากเกินไป กรุณาเลือกรูปอื่น');
  return url;
}

export function PhotoCropper({ bitmap, onApply, onCancel }: { bitmap: ImageBitmap; onApply: (dataURL: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const crop = useRef<Crop | null>(null);
  const closing = useRef<number | undefined>(undefined);
  const toast = useToast();

  useEffect(() => {
    // Strict mode runs this twice: the bitmap is released only when the cropper really goes away.
    window.clearTimeout(closing.current);
    crop.current ??= startCrop(bitmap);
    if (canvasRef.current) drawCrop(canvasRef.current, bitmap, crop.current);
    return () => {
      closing.current = window.setTimeout(() => bitmap.close());
    };
  }, [bitmap]);

  const redraw = () => {
    if (canvasRef.current && crop.current) drawCrop(canvasRef.current, bitmap, crop.current);
  };

  // Zooming keeps the middle of the circle on the same part of the picture.
  const zoomTo = (zoom: number) => {
    const c = crop.current;
    if (!c) return;
    const middle = CROP_SIZE / 2;
    const step = zoom / c.zoom;
    c.x = middle - (middle - c.x) * step;
    c.y = middle - (middle - c.y) * step;
    c.zoom = zoom;
    redraw();
  };

  return (
    <div className="cropper">
      <canvas
        ref={canvasRef}
        className="crop-canvas"
        id="crop-canvas"
        width={CROP_SIZE}
        height={CROP_SIZE}
        role="img"
        aria-label="ตัวอย่างรูปโปรไฟล์ ลากเพื่อเลื่อนตำแหน่ง"
        onPointerDown={(event) => {
          if (!crop.current) return;
          crop.current.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const c = crop.current;
          if (!c?.drag || event.pointerId !== c.drag.id) return;
          const scale = CROP_SIZE / event.currentTarget.getBoundingClientRect().width;
          c.x += (event.clientX - c.drag.x) * scale;
          c.y += (event.clientY - c.drag.y) * scale;
          c.drag = { id: c.drag.id, x: event.clientX, y: event.clientY };
          redraw();
        }}
        onPointerUp={() => {
          if (crop.current) crop.current.drag = null;
        }}
        onPointerCancel={() => {
          if (crop.current) crop.current.drag = null;
        }}
      />
      <p className="crop-hint muted">ลากรูปเพื่อเลื่อนตำแหน่ง ส่วนที่อยู่ในวงกลมคือรูปที่จะใช้</p>
      <label className="crop-zoom" htmlFor="crop-zoom">
        ย่อ-ขยาย
        <input id="crop-zoom" type="range" min="1" max="3" step="0.01" defaultValue="1" onInput={(event) => zoomTo(Number(event.currentTarget.value))} />
      </label>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            if (!crop.current) return;
            try {
              onApply(cropToDataURL(bitmap, crop.current));
            } catch (error) {
              toast(error instanceof Error ? error.message : String(error), true);
            }
          }}
        >
          <Icon name="check" />
          ใช้รูปนี้
        </button>
      </div>
    </div>
  );
}
