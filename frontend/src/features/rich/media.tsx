'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { useToast } from '@/components/ui/Toast';
import { download, fetchBlob } from '@/lib/api/client';
import type { MessageFile } from '@/lib/types';
import { pinThread } from './thread';

/* Files in a message (ported from old-frontend/ui/media.js). Private attachments are fetched through the same
   authenticated API as downloads and shown from blob: URLs that stay local to the page; no tenant or visitor
   credentials go into media URLs. Images and videos load when they come near the screen; everything else is a
   chip that downloads. React keeps each message's elements across polling, so a playing video is not reloaded. */

const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const INLINE_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

/** Staff read attachments at /api/attachments/<id>; a customer through the organization's portal. */
export function attachmentPath(id: string, publicSlug?: string | null): string {
  return publicSlug ? `/api/public/${publicSlug}/attachments/${id}` : `/api/attachments/${id}`;
}

function useDownload(path: string, name: string) {
  const toast = useToast();
  return () => void download(path, name).catch((error: Error) => toast(error.message, true));
}

// Newest messages are at the bottom: a picture that finishes loading keeps a pinned thread at the end.
function pinAfterMedia(node: HTMLElement | null) {
  const thread = node?.closest<HTMLElement>('[data-thread]');
  if (thread && thread.dataset.pinned !== 'no') pinThread(thread);
}

/** One attachment of a message. `publicSlug`: the organization's slug when a customer is reading. */
export function MessageAttachment({ file, publicSlug }: { file: MessageFile; publicSlug?: string | null }) {
  if (INLINE_IMAGE_TYPES.has(file.mime) || INLINE_VIDEO_TYPES.has(file.mime)) return <MessageMedia file={file} publicSlug={publicSlug} />;
  return <FileChip file={file} publicSlug={publicSlug} />;
}

/** A message's attachments in their row (nothing when there are none). */
export function MessageFiles({ files, publicSlug }: { files: MessageFile[] | null | undefined; publicSlug?: string | null }) {
  if (!files?.length) return null;
  return (
    <div className="message-files">
      {files.map((file) => (
        <MessageAttachment key={file.id} file={file} publicSlug={publicSlug} />
      ))}
    </div>
  );
}

function FileChip({ file, publicSlug }: { file: MessageFile; publicSlug?: string | null }) {
  const save = useDownload(attachmentPath(file.id, publicSlug), file.name);
  return (
    <button type="button" className="file-chip" onClick={save}>
      <Icon name="paperclip" />
      {file.name} · {Math.ceil(file.size / 1024)} KB
    </button>
  );
}

type MediaState = 'loading' | 'ready' | 'error';

function MessageMedia({ file, publicSlug }: { file: MessageFile; publicSlug?: string | null }) {
  const image = INLINE_IMAGE_TYPES.has(file.mime);
  const path = attachmentPath(file.id, publicSlug);
  const [state, setState] = useState<MediaState>('loading');
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const figureRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const blob = useRef<Blob | null>(null);
  const { openModal } = useDialogs();
  const save = useDownload(path, file.name);

  // Load only when the message comes near the screen.
  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setVisible(true);
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(figure);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = imageRef.current ?? videoRef.current;
    if (!visible || !media) return;
    let alive = true;
    let url = '';
    fetchBlob(path)
      .then((result) => {
        if (!alive) return;
        if (result.type.split(';')[0] !== file.mime) throw new Error('Unexpected media type');
        blob.current = result;
        url = URL.createObjectURL(result);
        media.src = url;
      })
      .catch(() => {
        if (!alive) return;
        setState('error');
        pinAfterMedia(figureRef.current);
      });
    return () => {
      alive = false;
      if (media instanceof HTMLVideoElement) media.pause();
      media.removeAttribute('src');
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, attempt, path, file.mime]);

  const ready = () => {
    setState('ready');
    pinAfterMedia(figureRef.current);
  };
  const failed = (event: { currentTarget: HTMLImageElement | HTMLVideoElement }) => {
    // Taking the source away (leaving, retrying) is not a failure.
    if (!event.currentTarget.getAttribute('src')) return;
    setState('error');
    pinAfterMedia(figureRef.current);
  };
  const size = Math.ceil(file.size / 1024);

  return (
    <figure
      ref={figureRef}
      className="message-media"
      data-media-id={file.id}
      data-name={file.name}
      data-public={publicSlug ? 'yes' : 'no'}
      data-mime={file.mime}
      data-media-state={state}
    >
      <div className="media-placeholder" role="status">
        กำลังโหลด{image ? 'ภาพ' : 'วิดีโอ'}…
      </div>
      {image ? (
        <button
          type="button"
          className="media-image-button"
          aria-label={`ขยายภาพ ${file.name}`}
          title="คลิกเพื่อขยายภาพ"
          onClick={() => {
            if (blob.current) openModal(file.name, <MediaViewer blob={blob.current} name={file.name} path={path} />, { wide: true });
          }}
        >
          {/* A blob: URL set once the file has been fetched; next/image cannot use it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imageRef} alt={file.name} decoding="async" onLoad={ready} onError={failed} />
        </button>
      ) : (
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          aria-label={`วิดีโอ ${file.name}`}
          onLoadedData={ready}
          // Show the controls as soon as the length is known, without starting playback.
          onLoadedMetadata={ready}
          onError={failed}
        />
      )}
      <div className="media-error" role="status">
        <span>แสดงไฟล์นี้ไม่ได้</span>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            blob.current = null;
            setState('loading');
            setVisible(true);
            setAttempt((n) => n + 1);
          }}
        >
          ลองอีกครั้ง
        </button>
      </div>
      <figcaption>
        <span className="media-filename" title={file.name}>
          {file.name}
        </span>
        <button type="button" className="icon-btn" aria-label={`ดาวน์โหลด ${file.name}`} title={`ดาวน์โหลด · ${size} KB`} onClick={save}>
          <Icon name="download" />
        </button>
      </figcaption>
    </figure>
  );
}

/** The enlarged picture in the modal, with its download button. Its own blob: URL is released when it closes. */
export function MediaViewer({ blob, name, path }: { blob: Blob; name: string; path: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const save = useDownload(path, name);
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const url = URL.createObjectURL(blob);
    image.src = url;
    return () => {
      image.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return (
    <div className="media-viewer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imageRef} alt={name} />
      <div className="form-actions">
        <button type="button" className="btn" onClick={save}>
          <Icon name="download" />
          ดาวน์โหลดภาพ
        </button>
      </div>
    </div>
  );
}
