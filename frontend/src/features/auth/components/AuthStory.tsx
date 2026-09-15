import { Icon } from '@/components/Icon';
import { Brand } from '@/components/shell/chrome';
import { Avatar } from '@/components/ui/display';

/* The left half of the sign-in page (pages/auth/auth.html, .auth-story). */

export function AuthStory() {
  return (
    <section className="auth-story">
      <Brand />
      <div>
        <div className="story-label">A LITTLE CARE. A BETTER CONNECTION.</div>
        <h1>
          ทุกคำถามมีความหมาย
          <br />
          ทุกการดูแลอยู่ที่เดียว
        </h1>
        <p className="story-copy">
          พื้นที่ทำงานของทีมบริการลูกค้า ที่ช่วยให้คุณรับฟัง
          <br />
          ติดตาม และส่งต่อความใส่ใจได้ในทุกวัน
        </p>
        <div className="story-preview">
          <div className="flex">
            <Avatar name="ทีม" index={1} />
            <div>
              <strong className="small">ทีมที่พร้อมดูแลลูกค้าของคุณ</strong>
              <div className="tiny muted">หนึ่งพื้นที่ทำงาน · ทุกบทสนทนา</div>
            </div>
            <span className="badge resolved">
              <Icon name="check" />
            </span>
          </div>
          <div className="preview-line" />
          <div className="preview-line short" />
        </div>
      </div>
      <div className="story-footer">Bookdose Customer Service · Made for meaningful support.</div>
    </section>
  );
}
