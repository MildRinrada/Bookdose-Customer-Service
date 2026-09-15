'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { fileProblem, FILE_LIMITS } from '@/lib/files';

/* A file picker checked the moment files are chosen: what cannot be sent is taken out of the selection again and
   the reason is written in red under the field. Read the chosen files when submitting with filesOf(form). */

export function FileInput({
  name = 'files',
  multiple = true,
  onFiles,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & { name?: string; onFiles?: (files: File[]) => void }) {
  const [problem, setProblem] = useState('');
  const [chosen, setChosen] = useState<File[]>([]);
  return (
    <>
      <input
        type="file"
        name={name}
        multiple={multiple}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => {
          const input = e.currentTarget;
          const files = [...(input.files ?? [])];
          const reason = fileProblem(files);
          setProblem(reason);
          let kept = files;
          if (reason) {
            kept = files.filter((file) => !fileProblem([file])).slice(0, FILE_LIMITS.count);
            const transfer = new DataTransfer();
            kept.forEach((file) => transfer.items.add(file));
            if (kept.length !== files.length) input.files = transfer.files;
          }
          setChosen(kept);
          onFiles?.(kept);
        }}
        {...rest}
      />
      <span className="file-selection" aria-live="polite">
        {chosen.length ? chosen.map((f) => `${f.name} (${Math.ceil(f.size / 1024)} KB)`).join(', ') : ''}
      </span>
      {problem && (
        <p className="file-error" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

/** The files chosen in a form's file input (the first one, or the one with this name). */
export function filesOf(form: HTMLFormElement, name?: string): File[] {
  const input = form.querySelector<HTMLInputElement>(name ? `input[type="file"][name="${name}"]` : 'input[type="file"]');
  return [...(input?.files ?? [])];
}
