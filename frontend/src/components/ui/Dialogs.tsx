'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Form } from './Form';
import { useToast } from './Toast';

/* The two dialogs every screen shares.
   - The modal (#modal): forms and quick views; `drawer` slides it in from the right, `wide` gives side-by-side room.
   - The sheet (#sheet): a smaller dialog that may open on top of the modal - a question to answer, a link to type,
     the photo cropper - so the form underneath is never replaced. The app never uses alert / confirm / prompt.
   Clicking the dimmed area or pressing Escape closes a dialog; a modal with unsaved work can refuse through
   setCloseGuard. Moving to another screen closes both; if the modal's guard refuses (unsaved work), the previous
   address is put back, as the old hashchange handler did. */

/** narrow: a short form (a few fields), not stretched across the page. */
export type ModalOptions = { drawer?: boolean; wide?: boolean; narrow?: boolean };

export type ConfirmOptions = {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: 'primary' | 'danger';
  run: () => unknown | Promise<unknown>;
};

export type DeleteOptions = {
  title: ReactNode;
  /** What will disappear, in one sentence. */
  warning: ReactNode;
  /** What else goes with it, one line each. */
  effects?: ReactNode[];
  /** Something with history must be typed out (e.g. the case number) before it can be removed. */
  word?: string;
  confirmLabel?: ReactNode;
  run: () => unknown | Promise<unknown>;
};

type Dialogs = {
  openModal: (title: ReactNode, content: ReactNode, options?: ModalOptions) => void;
  /** Returns false when the close guard kept the modal open. `force` skips the guard. */
  closeModal: (force?: boolean) => boolean;
  /** While set, closing the modal asks it first: return false to stay open (e.g. to ask "throw the draft away?"). */
  setCloseGuard: (guard: (() => boolean) | null) => void;
  /** onClose: told once when this sheet goes, however it goes (closed, replaced, or left by moving to another page). */
  openSheet: (title: ReactNode, content: ReactNode, onClose?: () => void) => void;
  closeSheet: () => void;
  /** One question, one answer: used wherever the old code asked window.confirm(). */
  confirm: (options: ConfirmOptions) => void;
  /** Deleting is deliberate: says what will disappear and uses the dangerous-looking button. */
  confirmDelete: (options: DeleteOptions) => void;
};

const DialogContext = createContext<Dialogs | null>(null);

type Shown = { title: ReactNode; content: ReactNode; options: ModalOptions; key: number };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<Shown | null>(null);
  const [sheet, setSheet] = useState<Shown | null>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const guard = useRef<(() => boolean) | null>(null);
  const counter = useRef(0);
  const toast = useToast();
  const pathname = usePathname();
  const router = useRouter();
  const shownAt = useRef<string | null>(null);
  const returning = useRef(false);

  const closeModal = useCallback((force = false) => {
    if (!force && guard.current && !guard.current()) return false;
    guard.current = null;
    setModal(null);
    return true;
  }, []);
  const sheetClosed = useRef<(() => void) | null>(null);
  const tellSheetClosed = useCallback(() => {
    const told = sheetClosed.current;
    sheetClosed.current = null;
    told?.();
  }, []);
  const closeSheet = useCallback(() => {
    setSheet(null);
    tellSheetClosed();
  }, [tellSheetClosed]);

  const openModal = useCallback((title: ReactNode, content: ReactNode, options: ModalOptions = {}) => {
    guard.current = null;
    setModal({ title, content, options, key: ++counter.current });
  }, []);
  const openSheet = useCallback(
    (title: ReactNode, content: ReactNode, onClose?: () => void) => {
      tellSheetClosed();
      sheetClosed.current = onClose ?? null;
      setSheet({ title, content, options: {}, key: ++counter.current });
    },
    [tellSheetClosed],
  );

  const confirm = useCallback(
    ({ title, message, confirmLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก', tone = 'primary', run }: ConfirmOptions) => {
      openSheet(
        title,
        <Form
          onSubmit={async () => {
            setSheet(null);
            try {
              await run();
            } catch (error) {
              toast(error instanceof Error ? error.message : String(error), true);
            }
          }}
        >
          <p className="sheet-message">{message}</p>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setSheet(null)}>
              {cancelLabel}
            </button>
            <button type="submit" className={`btn ${tone}`} autoFocus>
              {confirmLabel}
            </button>
          </div>
        </Form>,
      );
    },
    [openSheet, toast],
  );

  const confirmDelete = useCallback(
    ({ title, warning, effects = [], word = '', confirmLabel = 'ลบถาวร', run }: DeleteOptions) => {
      openModal(
        title,
        <Form
          onSubmit={async (values) => {
            if (word && String(values.confirmation || '').trim() !== word) throw new Error(`กรุณาพิมพ์ ${word} ให้ตรงเพื่อยืนยัน`);
            await run();
            closeModal(true);
          }}
        >
          <p className="notice danger-notice">{warning}</p>
          <ul className="delete-effects">
            {effects.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
          {word && (
            <div className="field">
              <label htmlFor="confirm-text">
                พิมพ์ <strong>{word}</strong> เพื่อยืนยันว่าต้องการลบ
              </label>
              <input id="confirm-text" name="confirmation" autoComplete="off" spellCheck={false} placeholder={word} required />
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => closeModal()}>
              ยกเลิก
            </button>
            <button type="submit" className="btn danger">
              <Icon name="close" />
              {confirmLabel}
            </button>
          </div>
        </Form>,
      );
    },
    [openModal, closeModal],
  );

  // Show and hide the native dialogs as the state says.
  useEffect(() => {
    const node = modalRef.current;
    if (!node) return;
    if (modal && !node.open) node.showModal();
    if (!modal && node.open) node.close();
  }, [modal]);
  useEffect(() => {
    const node = sheetRef.current;
    if (!node) return;
    if (sheet && !node.open) node.showModal();
    if (!sheet && node.open) node.close();
  }, [sheet]);

  // A new screen closes whatever was open over the old one.
  useEffect(() => {
    const previous = shownAt.current;
    shownAt.current = pathname + window.location.search;
    if (previous === null) return;
    if (returning.current) {
      // Back on the address a guard kept: the modal is still there.
      returning.current = false;
      return;
    }
    if (guard.current && !guard.current()) {
      returning.current = true;
      shownAt.current = previous;
      router.push(previous);
      return;
    }
    guard.current = null;
    setModal(null);
    setSheet(null);
    tellSheetClosed();
  }, [pathname, router, tellSheetClosed]);

  const value = useMemo<Dialogs>(
    () => ({ openModal, closeModal, setCloseGuard: (g) => (guard.current = g), openSheet, closeSheet, confirm, confirmDelete }),
    [openModal, closeModal, openSheet, closeSheet, confirm, confirmDelete],
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
      <dialog
        id="modal"
        ref={modalRef}
        className={[modal?.options.drawer && 'drawer', modal?.options.wide && 'wide', modal?.options.narrow && 'narrow'].filter(Boolean).join(' ') || undefined}
        onCancel={(e) => {
          e.preventDefault();
          closeModal();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div id="modal-content">
          {modal && (
            <DialogBody key={modal.key} title={modal.title} onClose={() => closeModal()}>
              {modal.content}
            </DialogBody>
          )}
        </div>
      </dialog>
      <dialog
        id="sheet"
        ref={sheetRef}
        onCancel={(e) => {
          e.preventDefault();
          closeSheet();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeSheet();
        }}
      >
        <div id="sheet-content">
          {sheet && (
            <DialogBody key={sheet.key} title={sheet.title} onClose={closeSheet}>
              {sheet.content}
            </DialogBody>
          )}
        </div>
      </dialog>
    </DialogContext.Provider>
  );
}

function DialogBody({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="modal-header">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" aria-label="ปิด" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </>
  );
}

export function useDialogs(): Dialogs {
  const value = useContext(DialogContext);
  if (!value) throw new Error('useDialogs() needs <DialogProvider> (src/app/providers.tsx)');
  return value;
}
