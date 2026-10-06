'use client';

import type { ReactNode, SyntheticEvent } from 'react';
import { Icon } from '@/components/Icon';
import { useUiState } from '@/lib/ui-state';

/* A part of the case screen's side column used now and then (ยกมือขอช่วย, ข้อมูลเพิ่มเติม, ป้ายเคส, พักเคส, เตือนติดตามผล,
   Macro): one line - its name and, in a few words, what is in it - until it is opened, so the column is not eight
   forms long. It opens by itself while it has something going on (`open`: a hand up, a pause, a field still to fill
   before closing); opened or closed by hand, it stays so for the session (lib/ui-state). `highlight` colours the
   whole card, as the raised hand and the paused case colour theirs. Markup: pages/tickets (fold-card). */

export function FoldCard({
  id,
  title,
  hint,
  open = false,
  highlight = false,
  className,
  children,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  open?: boolean;
  highlight?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [chosen, setChosen] = useUiState<boolean | null>(`ticket-fold:${id}`, null);
  const shown = chosen ?? open;
  // Only a click is remembered: the card opening by itself (a hand just raised) is not a choice to keep.
  const toggled = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open !== shown) setChosen(event.currentTarget.open);
  };
  return (
    <details className={`card info-block fold-card${highlight ? ' highlight' : ''}`} open={shown} onToggle={toggled}>
      <summary>
        <h3>{title}</h3>
        {hint && <span className="fold-hint">{hint}</span>}
        <Icon name="down" />
      </summary>
      <div className={className ? `fold-body ${className}` : 'fold-body'}>{children}</div>
    </details>
  );
}
