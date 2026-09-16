'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ORG_CODE } from '@/lib/routes';

/* Reading an organization's QR with the camera. Only this app's links count: /join/<token> and a link with
   ?org=<code>; anything else the camera sees is ignored. The browser's own BarcodeDetector does the reading (no
   library), so the button is shown only where it exists. */

export type JoinCode = { token: string } | { slug: string };

type DetectedBarcode = { rawValue: string };
type Detector = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type DetectorClass = new (options?: { formats?: string[] }) => Detector;

const detectorClass = (): DetectorClass | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

/** True where the browser can read a QR itself (the button is hidden otherwise). */
export const canScanQr = () => Boolean(detectorClass());

/** The organization in one of this app's links (a pasted one or a scanned QR), or null for anything else. */
export function readJoinCode(text: string): JoinCode | null {
  const value = text.trim();
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    // Only a link of this very app counts: a QR poster (or a pasted link) naming another site would otherwise
    // connect the account to whichever organization that site's link names.
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin) return null;
    const join = /^\/join\/([A-Za-z0-9_-]{16,64})\/?$/.exec(url.pathname);
    if (join) return { token: join[1] };
    const slug = url.searchParams.get('org') ?? '';
    if (ORG_CODE.test(slug)) return { slug };
  } catch {
    /* Not a link: it may still be a plain organization code. */
  }
  return ORG_CODE.test(value) ? { slug: value } : null;
}

export function QrScan({ onFound }: { onFound: (found: JoinCode) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(() => (canScanQr() ? '' : 'เบราว์เซอร์นี้ยังอ่าน QR ไม่ได้ กรุณาวางลิงก์หรือกรอกรหัสองค์กรแทน'));
  // The effect starts the camera once; the newest handler is read from the ref when a code is seen.
  const handler = useRef(onFound);
  useEffect(() => {
    handler.current = onFound;
  }, [onFound]);

  useEffect(() => {
    const DetectorClass = detectorClass();
    if (!DetectorClass) return;
    const detector = new DetectorClass({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const stop = () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (opened) => {
        stream = opened;
        const video = videoRef.current;
        if (stopped || !video) return stop();
        video.srcObject = opened;
        await video.play();
        timer = window.setInterval(() => {
          void detector
            .detect(video)
            .then((codes) => {
              const found = codes.map((c) => readJoinCode(c.rawValue)).find(Boolean);
              if (found) {
                stop();
                handler.current(found);
              }
            })
            .catch(() => {
              /* A frame that cannot be read: the next one is tried. */
            });
        }, 400);
      })
      .catch(() => setError('เปิดกล้องไม่ได้ กรุณาอนุญาตให้ใช้กล้องในเบราว์เซอร์ หรือวางลิงก์แทน'));
    return stop;
  }, []);

  if (error)
    return (
      <p className="notice warning">
        <Icon name="camera" />
        {error}
      </p>
    );
  return (
    <div className="qr-scan">
      <video ref={videoRef} className="qr-scan-view" muted playsInline />
      <p className="tiny muted">หันกล้องไปที่ QR ขององค์กร ระบบจะเพิ่มองค์กรให้ทันทีที่อ่านได้</p>
    </div>
  );
}
