'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { useToast } from '@/components/ui/Toast';
import { plainText } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { MACRO_RUN_PREFIXES, runMacro } from '../api';
import { macroResultText, macroSteps } from '../labels';
import type { Macro, MacroTarget } from '../types';

/* Running a macro. The buttons are the macros themselves, so one click does every step; the toast says what was
   done and what did not apply. */

/** The organization's macros (from the workspace). */
export function useMacros(): Macro[] {
  return useWork().macros;
}

/** Run a macro on a case or a conversation: toasts the result (or the error) and refreshes what it changed.
    `closeModal` closes the dialog it was started from (the macro menu). Resolves true when it ran. */
export function useRunMacro() {
  const toast = useToast();
  const refresh = useInvalidate();
  const { closeModal } = useDialogs();
  return useCallback(
    async (macroId: string, target: MacroTarget, { fromModal = false }: { fromModal?: boolean } = {}) => {
      try {
        const result = await runMacro(macroId, target);
        if (fromModal) closeModal(true);
        toast(macroResultText(result));
        await refresh(...MACRO_RUN_PREFIXES);
        return true;
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
        return false;
      }
    },
    [toast, refresh, closeModal],
  );
}

/** The "ปุ่มลัด (Macro)" block of a case: one button per macro, or a line saying there are none (with a link to
    the automation page for admins and team leads). Put it under the block's <h3>. */
export function MacroButtons({ kind = 'ticket', targetId }: { kind?: MacroTarget['kind']; targetId: string }) {
  const macros = useMacros();
  const { role } = useWork();
  const run = useRunMacro();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <div className="macro-buttons">
        {macros.map((m) => (
          <button
            key={m.id}
            type="button"
            className="btn sm macro-btn"
            data-id={m.id}
            title={macroSteps(m)}
            disabled={busy === m.id}
            onClick={async () => {
              setBusy(m.id);
              await run(m.id, { kind, id: targetId });
              setBusy(null);
            }}
          >
            <Icon name="macro" />
            {m.name}
          </button>
        ))}
      </div>
      {!macros.length && (
        <p className="small muted">
          ยังไม่มี Macro
          {role !== 'agent' && (
            <>
              {' · '}
              <Link href="/automation">สร้างที่หน้าระบบอัตโนมัติ</Link>
            </>
          )}
        </p>
      )}
    </>
  );
}

/** The content of the "ใช้ Macro" dialog (open it with useMacroMenu). Markup: pages/automation/macro-menu. */
export function MacroMenu({ target }: { target: MacroTarget }) {
  const macros = useMacros();
  const { role } = useWork();
  const run = useRunMacro();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <p className="muted mb">กดครั้งเดียว ระบบทำทุกขั้นตอนของ Macro ให้ทันที</p>
      <div className="macro-list">
        {macros.map((m) => {
          const preview = plainText(m.reply).slice(0, 160);
          return (
            <button
              key={m.id}
              type="button"
              className="macro-item"
              data-id={m.id}
              disabled={busy === m.id}
              onClick={async () => {
                setBusy(m.id);
                const ran = await run(m.id, target, { fromModal: true });
                if (!ran) setBusy(null);
              }}
            >
              <span className="macro-glyph">
                <Icon name="macro" />
              </span>
              <span className="grow">
                <strong>{m.name}</strong>
                <span className="macro-steps">{macroSteps(m)}</span>
                {preview && <span className="auto-preview">“{preview}”</span>}
              </span>
            </button>
          );
        })}
      </div>
      {!macros.length && (
        <div className="empty-mini">
          ยังไม่มี Macro
          {role !== 'agent' && (
            <>
              {' · '}
              <Link href="/automation">สร้างได้ที่หน้าระบบอัตโนมัติ</Link>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Opens the "ใช้ Macro" dialog for a case or conversation (the inbox composer's Macro button). */
export function useMacroMenu() {
  const { openModal } = useDialogs();
  return useCallback((target: MacroTarget) => openModal('ใช้ Macro', <MacroMenu target={target} />), [openModal]);
}
