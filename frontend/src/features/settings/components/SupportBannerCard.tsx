'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { guestPages, publicOrgPath } from '@/features/guest/api';
import { BANNER_TAGLINE_MAX, BANNER_TONES, bannerOf, OrgBannerView, type BannerTone } from '@/features/guest/components/OrgBanner';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { saveSupportBanner, WORKSPACE_PATH } from '../api';

/* แบนเนอร์หน้าช่วยเหลือ (ตั้งค่า → ข้อมูลองค์กร, admins): the line under the organization's name and the band's
   colour on its support pages, with the band drawn as it will look while it is being chosen (backend
   organization/banner.py). The logo and the name are the organization's own, changed with แก้ไขชื่อและโลโก้ above.
   Markup: pages/guest-chat (org-banner), pages/settings (banner-*). */

export function SupportBannerCard() {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const saved = bannerOf(work.settings.support_banner);
  const [tagline, setTagline] = useState(saved.tagline);
  const [tone, setTone] = useState<BannerTone>(saved.tone);
  const slug = work.tenant.slug;

  return (
    <section className="card mt" id="support-banner">
      <div className="card-header">
        <div>
          <h2>แบนเนอร์หน้าช่วยเหลือ</h2>
          <p>ลูกค้าเห็นแบนเนอร์นี้บนสุดของหน้าแชท คำถามที่พบบ่อย และหน้าติดตามเคสขององค์กร จะได้รู้ทันทีว่ากำลังติดต่อใคร</p>
        </div>
      </div>
      <Form
        className="card-body"
        data-form="support-banner"
        onSubmit={async () => {
          await saveSupportBanner({ tagline, tone });
          toast('บันทึกแบนเนอร์แล้ว');
          await refresh(WORKSPACE_PATH, publicOrgPath(slug));
        }}
      >
        <div className="banner-preview">
          <OrgBannerView preview name={work.tenant.name} logo={work.tenant.logo || undefined} banner={{ tagline: tagline.trim(), tone }}>
            {/* The page's links as they will sit in the band: a picture of them, not links. */}
            <div className="guest-nav" aria-hidden="true">
              <span className="btn subtle active">
                <Icon name="chat" />
                <span>แชทกับทีมงาน</span>
              </span>
              <span className="btn subtle">
                <Icon name="book" />
                <span>คำถามที่พบบ่อย</span>
              </span>
            </div>
          </OrgBannerView>
        </div>
        <p className="tiny muted banner-preview-note">ตัวอย่างที่ลูกค้าจะเห็น · โลโก้และชื่อแก้ได้ที่ &ldquo;แก้ไขชื่อและโลโก้&rdquo; ด้านบน</p>

        <div className="field">
          <label htmlFor="banner-tagline">ข้อความใต้ชื่อ</label>
          <input
            id="banner-tagline"
            name="tagline"
            maxLength={BANNER_TAGLINE_MAX}
            value={tagline}
            onChange={(event) => setTagline(event.target.value)}
            placeholder="ข้อความสั้น ๆ ที่ลูกค้าเห็นใต้ชื่อองค์กร"
            aria-describedby="banner-tagline-help"
          />
          <p className="tiny muted" id="banner-tagline-help">
            {tagline.length}/{BANNER_TAGLINE_MAX} ตัวอักษร · เว้นว่างได้ แบนเนอร์จะแสดงเฉพาะโลโก้และชื่อ
          </p>
        </div>

        <fieldset className="banner-tones">
          <legend>สีแบนเนอร์</legend>
          <div className="banner-tone-grid">
            {(Object.keys(BANNER_TONES) as BannerTone[]).map((value) => (
              <label key={value} className={`banner-tone${value === tone ? ' chosen' : ''}`}>
                <input type="radio" name="tone" value={value} checked={value === tone} onChange={() => setTone(value)} />
                <span className={`banner-swatch tone-${value}`} aria-hidden="true">
                  ก
                </span>
                <span className="banner-tone-name">{BANNER_TONES[value]}</span>
              </label>
            ))}
          </div>
          <p className="tiny muted">ทุกสีอ่านตัวหนังสือได้ชัด และเปลี่ยนเป็นโทนเข้มให้เองเมื่อลูกค้าใช้ธีมมืด</p>
        </fieldset>

        <div className="flex wrap mt">
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกแบนเนอร์
          </button>
          <a className="btn" href={guestPages.start(slug)} target="_blank" rel="noopener">
            <Icon name="link" />
            เปิดหน้าช่วยเหลือจริง
          </a>
        </div>
      </Form>
    </section>
  );
}
