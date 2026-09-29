'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/Icon';
import { FILE_LIMITS } from '@/lib/files';

/* อัดหน้าจอส่งให้ทีม: one press records the customer's screen - a tab, a window or the whole screen, as the browser asks
   them - with no program to install, so the team sees what was pressed and what happened instead of reading it. The
   browser's own "หยุดแชร์" or this button stops it; it also stops by itself at MAX_SECONDS, or before the file would pass
   what is left of the 5 MB the message may carry. The recording joins the chosen files like any other.

   Computers only: phone browsers cannot record their screen, so the button is not shown there. Recorded at a low
   frame rate and bit rate: a screen barely moves, and a minute then fits. Markup: components (screen-record). */

const MAX_SECONDS = 60;
const BITS_PER_SECOND = 450_000;
// Room kept for the part of the file still being written when the limit is reached.
const MARGIN = 200 * 1024;

const canRecord = () =>
  typeof navigator !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getDisplayMedia) &&
  typeof MediaRecorder !== 'undefined' &&
  !window.matchMedia('(pointer: coarse)').matches;
const noChange = () => () => {};

/** The format this browser can write: WebM where it can (Chrome, Edge, Firefox), else MP4 (Safari). */
function format(): { mime: string; type: string; extension: string } | null {
  for (const mime of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
    if (MediaRecorder.isTypeSupported(mime)) return { mime, type: 'video/webm', extension: 'webm' };
  if (MediaRecorder.isTypeSupported('video/mp4')) return { mime: 'video/mp4', type: 'video/mp4', extension: 'mp4' };
  return null;
}

/** `used`: the bytes of the files already chosen. `look`: a composer's tool button, or a form's button beside แนบไฟล์. */
export function ScreenRecorder({
  used,
  onFile,
  onProblem,
  look = 'tool',
}: {
  used: number;
  onFile: (file: File) => void;
  onProblem: (message: string) => void;
  look?: 'tool' | 'button';
}) {
  const supported = useSyncExternalStore(noChange, canRecord, () => false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);
  if (!supported) return null;

  const start = async () => {
    const room = FILE_LIMITS.bytes - used - MARGIN;
    if (room < 300 * 1024) return onProblem('ไฟล์ที่แนบไว้ใช้พื้นที่เกือบครบ 5 MB แล้ว เอาบางไฟล์ออกก่อนอัดหน้าจอ');
    const chosen = format();
    if (!chosen) return onProblem('เบราว์เซอร์นี้อัดหน้าจอไม่ได้ ลองใช้ Chrome หรือ Edge');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
    } catch {
      // The customer said no in the browser's own question: nothing to say.
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType: chosen.mime, videoBitsPerSecond: BITS_PER_SECOND });
    const parts: Blob[] = [];
    let size = 0;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += 1;
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) finish();
    }, 1000);
    function finish() {
      clearInterval(timer);
      stop.current = null;
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    }
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      parts.push(event.data);
      size += event.data.size;
      if (size >= room) finish();
    };
    recorder.onstop = () => {
      setSeconds(null);
      if (!size) return onProblem('ไม่ได้ภาพหน้าจอ ลองอัดใหม่อีกครั้ง');
      const stamp = new Date().toTimeString().slice(0, 5).replace(':', '');
      onFile(new File(parts, `screen-recording-${stamp}.${chosen.extension}`, { type: chosen.type }));
    };
    // The browser's own "หยุดแชร์" ends the recording too.
    stream.getVideoTracks()[0]?.addEventListener('ended', finish);
    stop.current = finish;
    recorder.start(1000);
    setSeconds(0);
  };

  const recording = seconds !== null;
  return (
    <button
      type="button"
      className={`${look === 'tool' ? 'tool-btn' : 'btn subtle customer-attach'} screen-record${recording ? ' recording' : ''}`}
      aria-pressed={recording}
      title={recording ? 'หยุดอัดและแนบวิดีโอ' : `อัดหน้าจอสั้น ๆ ไม่เกิน ${MAX_SECONDS} วินาที ส่งให้ทีมดูว่าเกิดอะไรขึ้น`}
      onClick={() => (recording ? stop.current?.() : void start())}
    >
      <Icon name={recording ? 'close' : 'camera'} />
      <span>{recording ? `หยุดอัด ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'อัดหน้าจอ'}</span>
    </button>
  );
}
