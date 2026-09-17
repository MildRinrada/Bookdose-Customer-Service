import { Brand } from '@/components/shell/chrome';

/* The left half of the sign-in page (.auth-story): full-bleed photos (public/login/, see CREDITS.txt) that cross-fade
   slowly behind the message, animated by CSS alone (pages/auth.css, .story-photos). With reduced motion only the
   first photo shows. The photos are decorative. */

const PHOTOS = ['/login/slide-1.jpg', '/login/slide-2.jpg', '/login/slide-3.jpg', '/login/slide-4.jpg'];

export function AuthStory() {
  return (
    <section className="auth-story">
      <div className="story-photos" aria-hidden="true">
        {PHOTOS.map((src, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} className="story-photo" src={src} alt="" decoding="async" loading={index === 0 ? 'eager' : 'lazy'} />
        ))}
      </div>
      <Brand />
      <div className="story-message">
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
        <div className="story-dots" aria-hidden="true">
          {PHOTOS.map((src) => (
            <span key={src} />
          ))}
        </div>
      </div>
      <div className="story-footer">Bookdose Customer Service · Made for meaningful support.</div>
    </section>
  );
}
