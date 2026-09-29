'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { fileProblem, FILE_LIMITS } from '@/lib/files';
import { ImageMarkup } from './ImageMarkup';

/* The files chosen in a composer, as pills under the text with a button to take one out again (the old
   renderFilePills + file-remove + checkFileInput + drop handling). The composer's own <input type="file"> stays the
   source of truth, so filesOf(form) / readFiles() read it when sending.

     const pills = useFilePills();
     <input ref={pills.inputRef} type="file" name="files" multiple className="attach-input" onChange={pills.onChange} />
     <FilePills files={pills.files} onRemove={pills.remove} />
     <FileProblem problem={pills.problem} />
     onDrop: pills.add(event.dataTransfer.files)      after sending: pills.clear() */

function setInputFiles(input: HTMLInputElement, files: File[]) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
}

export function useFilePills() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState('');

  // Checked the moment files are chosen or dropped: what cannot be sent is taken out again and the reason shown.
  const accept = useCallback((all: File[]) => {
    const input = inputRef.current;
    const reason = fileProblem(all);
    setProblem(reason);
    let kept = all;
    if (reason) kept = all.filter((file) => !fileProblem([file])).slice(0, FILE_LIMITS.count);
    if (input && (kept.length !== all.length || input.files?.length !== all.length)) setInputFiles(input, kept);
    setFiles(kept);
  }, []);

  return useMemo(
    () => ({
      inputRef,
      files,
      problem,
      /** The file input's onChange. */
      onChange: () => accept([...(inputRef.current?.files ?? [])]),
      /** Files dropped on the composer join the ones already chosen. */
      add: (dropped: FileList | File[]) => accept([...(inputRef.current?.files ?? []), ...dropped]),
      /** Say why something could not be added (the screen recorder), in the same place. */
      report: (message: string) => setProblem(message),
      /** The bytes of the files chosen. */
      used: files.reduce((total, file) => total + file.size, 0),
      /** Put a file in place of one (a picture after เบลอ / วงกลม), checked like any other. */
      replace: (index: number, file: File) => accept([...(inputRef.current?.files ?? [])].map((f, i) => (i === index ? file : f))),
      /** Take one file out (the pill's button). */
      remove: (index: number) => {
        const input = inputRef.current;
        const kept = [...(input?.files ?? [])].filter((_, i) => i !== index);
        if (input) setInputFiles(input, kept);
        setFiles(kept);
      },
      /** After sending. */
      clear: () => {
        if (inputRef.current) inputRef.current.value = '';
        setFiles([]);
        setProblem('');
      },
    }),
    [files, problem, accept],
  );
}

/** A picture the markup can open (a GIF would lose its movement). */
const MARKABLE = ['image/png', 'image/jpeg', 'image/webp'];

/** `onReplace`: a picture's pill also offers เบลอหรือวงกลม (ImageMarkup), the edited picture taking its place. */
export function FilePills({ files, onRemove, onReplace }: { files: File[]; onRemove: (index: number) => void; onReplace?: (index: number, file: File) => void }) {
  const { openModal, closeModal } = useDialogs();
  const mark = (index: number, file: File) =>
    openModal(
      'เบลอหรือวงกลมบนภาพ',
      <ImageMarkup
        file={file}
        onCancel={() => closeModal()}
        onSave={(edited) => {
          onReplace?.(index, edited);
          closeModal(true);
        }}
      />,
      { wide: true },
    );
  return (
    <div className="file-list" data-file-list="" aria-live="polite">
      {files.map((file, index) => (
        <span className="file-pill" key={`${index}:${file.name}:${file.size}`}>
          <Icon name="paperclip" />
          <span className="file-name">
            {file.name} · {Math.ceil(file.size / 1024)} KB
          </span>
          {onReplace && MARKABLE.includes(file.type) && (
            <button type="button" className="file-pill-mark" onClick={() => mark(index, file)} aria-label={`เบลอหรือวงกลมบนภาพ ${file.name}`} title="เบลอข้อมูลส่วนตัว หรือวงกลมจุดที่มีปัญหา">
              <Icon name="edit" />
              เบลอ/วงกลม
            </button>
          )}
          <button type="button" onClick={() => onRemove(index)} aria-label={`นำไฟล์ ${file.name} ออก`} title="นำออก">
            <Icon name="close" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Why the chosen files cannot be sent, in red (nothing when they can). */
export function FileProblem({ problem }: { problem: string }) {
  if (!problem) return null;
  return (
    <p className="file-error" role="alert">
      {problem}
    </p>
  );
}
