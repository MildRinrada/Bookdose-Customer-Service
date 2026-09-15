'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { fileProblem, FILE_LIMITS } from '@/lib/files';

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

export function FilePills({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  return (
    <div className="file-list" data-file-list="" aria-live="polite">
      {files.map((file, index) => (
        <span className="file-pill" key={`${index}:${file.name}:${file.size}`}>
          <Icon name="paperclip" />
          <span className="file-name">
            {file.name} · {Math.ceil(file.size / 1024)} KB
          </span>
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
