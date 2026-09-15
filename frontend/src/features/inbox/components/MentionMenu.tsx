'use client';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/display';
import { roleLabels } from '@/lib/labels';
import { useStaffUser, useTeamName, useWork } from '@/lib/session';

/* "แท็กทีม" in the composer: @ทีม or one teammate. Markup: pages/inbox/mention-menu, mention-item. */

export function MentionMenu({ onPick }: { onPick: (name: string) => void }) {
  const work = useWork();
  const user = useStaffUser();
  const teamName = useTeamName();
  const people = work.members.filter((m) => m.active && m.id !== user.id);
  return (
    <>
      <p className="muted mb">ข้อความจะเป็นบันทึกภายใน ลูกค้าไม่เห็น ผู้ถูกแท็กที่มีสิทธิ์เห็นบทสนทนานี้จะได้รับแจ้งเตือน</p>
      <div className="mention-list">
        <button type="button" className="mention-item" data-name="ทีม" onClick={() => onPick('ทีม')}>
          <Icon name="users" />
          <span>
            <strong>@ทีม</strong>
            <span className="tiny muted">ทุกคนในทีมของบทสนทนานี้</span>
          </span>
        </button>
        {people.map((m, i) => (
          <button key={m.id} type="button" className="mention-item" data-name={m.name} onClick={() => onPick(m.name)}>
            <Avatar name={m.name} index={i} />
            <span>
              <strong>{m.name}</strong>
              <span className="tiny muted">
                {roleLabels[m.role]} · {teamName(m.team_id)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
