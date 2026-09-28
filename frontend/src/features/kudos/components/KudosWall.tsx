'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { PageLoading } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { useToast } from '@/components/ui/Toast';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { clockTime, shortAgo } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useWorkspace } from '@/lib/session';
import { cheerKudos, hideKudos, KUDOS_PATH, KUDOS_PREFIXES } from '../api';
import type { Kudos, KudosWall } from '../types';

/* กำแพงคำชม: what customers said about the team, for the whole organization - the overview's card with the newest
   few and the whole wall in a dialog. The words are the customer's (masked), never their name or the case. A colleague
   cheers (เป็นกำลังใจ); the praised member and the owners take an item down. Markup: pages/team-spirit (kudos-). */

/** The praised member's name now, or the name they signed with when they are no longer a member. */
function usePraisedName() {
  const members = useWorkspace().data?.members ?? [];
  return (k: Kudos) => members.find((m) => m.id === k.user_id)?.name || k.user_name || 'ทีมงาน';
}

function cheerNames(k: Kudos) {
  return k.cheers.map((c) => c.name).join(', ');
}

function KudosItem({ k, readOnly }: { k: Kudos; readOnly: boolean }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const { confirm } = useDialogs();
  const name = usePraisedName()(k);
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await work();
      if (message) toast(message);
      await refresh(...KUDOS_PREFIXES);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  };
  const count = k.cheers.length;
  return (
    <li className={`kudos-item${k.mine ? ' mine' : ''}`}>
      {k.source === 'thanks' ? (
        <p className="kudos-heart">
          <Icon name="heart" />
          ลูกค้าส่งหัวใจขอบคุณกลับมาจากการ์ดขอบคุณ
        </p>
      ) : (
        <blockquote className="kudos-quote">
          {k.rating ? (
            <span className="kudos-stars" aria-label={`${k.rating} ดาว`}>
              {'★'.repeat(k.rating)}
            </span>
          ) : null}
          <p>{k.text}</p>
        </blockquote>
      )}
      <div className="kudos-meta">
        <UserAvatar id={k.user_id} name={name} index={k.mine ? 0 : 3} />
        <span className="kudos-who">
          <strong>{k.mine ? 'ชมคุณ' : `ชม ${name}`}</strong>
          <time dateTime={k.created_at} title={clockTime(k.created_at)}>
            {k.source === 'csat' ? 'ให้ 5 ดาว' : k.source === 'thanks' ? 'การ์ดขอบคุณ' : 'ในแชท'} · {shortAgo(k.created_at)}
          </time>
        </span>
        <span className="kudos-actions">
          {k.mine || readOnly ? (
            count > 0 && (
              <span className="kudos-count" title={cheerNames(k)}>
                <Icon name="heart" />
                เพื่อนเป็นกำลังใจ {count} คน
              </span>
            )
          ) : (
            <button
              type="button"
              className={`btn sm kudos-cheer${k.cheered ? ' cheered' : ''}`}
              aria-pressed={k.cheered}
              disabled={busy}
              title={count ? `เป็นกำลังใจแล้ว: ${cheerNames(k)}` : 'บอกเพื่อนว่าคุณเห็นคำชมนี้แล้ว'}
              onClick={() => void act(() => cheerKudos(k.id, !k.cheered))}
            >
              <Icon name="heart" />
              {k.cheered ? 'เป็นกำลังใจแล้ว' : 'เป็นกำลังใจ'}
              {count > 0 && <span className="kudos-cheer-count">{count}</span>}
            </button>
          )}
          {k.removable && !readOnly && (
            <button
              type="button"
              className="icon-btn kudos-remove"
              aria-label="นำคำชมนี้ออกจากกำแพง"
              title="นำออกจากกำแพง"
              disabled={busy}
              onClick={() =>
                confirm({
                  title: 'นำคำชมออกจากกำแพง',
                  message: 'ทุกคนในองค์กรจะไม่เห็นคำชมนี้อีก และนำกลับมาไม่ได้',
                  confirmLabel: 'นำออก',
                  tone: 'danger',
                  run: () => act(() => hideKudos(k.id), 'นำคำชมออกจากกำแพงแล้ว'),
                })
              }
            >
              <Icon name="close" />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function KudosList({ items, readOnly }: { items: Kudos[]; readOnly: boolean }) {
  return (
    <ul className="kudos-list">
      {items.map((k) => (
        <KudosItem key={k.id} k={k} readOnly={readOnly} />
      ))}
    </ul>
  );
}

/** The whole wall of the last 90 days (the card's ดูทั้งหมด). */
function WholeWall({ readOnly }: { readOnly: boolean }) {
  const wall = useApi<KudosWall>(KUDOS_PATH).data;
  if (!wall) return <PageLoading />;
  return wall.items.length ? <KudosList items={wall.items} readOnly={readOnly} /> : <KudosEmpty />;
}

function KudosEmpty() {
  return (
    <div className="board-empty kudos-empty">
      <Icon name="heart" />
      <strong>ยังไม่มีคำชม</strong>
      <span>เมื่อลูกค้าชมในแชท ให้ 5 ดาวพร้อมความเห็น หรือส่งหัวใจจากการ์ดขอบคุณ คำชมจะขึ้นที่นี่ให้ทั้งทีมเห็น</span>
    </div>
  );
}

export function KudosCard({ wall, readOnly }: { wall: KudosWall | undefined; readOnly: boolean }) {
  const { openModal } = useDialogs();
  const items = wall?.items ?? [];
  const more = (wall?.total ?? 0) > items.length;
  return (
    <section className="card kudos-card" aria-labelledby="kudos-title">
      <div className="card-header">
        <div>
          <h2 id="kudos-title">
            <Icon name="heart" className="card-title-icon" />
            กำแพงคำชม
          </h2>
          <p>คำชมจากลูกค้า {wall?.days ?? 90} วันล่าสุด · ทุกคนในองค์กรเห็น</p>
        </div>
        {more && (
          <button type="button" className="btn subtle small" onClick={() => openModal(`กำแพงคำชม (${wall?.total} คำชม)`, <WholeWall readOnly={readOnly} />)}>
            ดูทั้งหมด {wall?.total} <Icon name="arrow" />
          </button>
        )}
      </div>
      <div className="card-body">{items.length ? <KudosList items={items} readOnly={readOnly} /> : <KudosEmpty />}</div>
    </section>
  );
}
