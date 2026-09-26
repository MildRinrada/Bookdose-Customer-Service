'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PublicOrgInfo } from '@/features/auth/types';
import { useApi } from '@/lib/query';
import { publicOrgPath } from '../api';

/* แบนเนอร์หน้าช่วยเหลือ: the band across the top of an organization's own support pages (/support/<org>: its chat,
   FAQ and a case), so a customer sees at once whom they are writing to: the organization's logo (or the first letters
   of its name), its name, a line of its own under it, on the colour it chose, with the page's links in the band.
   Bookdose, which runs the page, says so once in small print at the foot (PoweredBy). The organization sets the line
   and the colour in ตั้งค่า → ข้อมูลองค์กร (backend organization/banner.py). Markup: pages/guest-chat (org-banner,
   tone-*, powered-by). */

export type BannerTone = 'stone' | 'mint' | 'sky' | 'sand' | 'rose' | 'forest' | 'navy' | 'charcoal';
export type SupportBanner = { tagline: string; tone: BannerTone };

/** The colours to choose from, each readable with its own words in the light and the dark themes (the stylesheet). */
export const BANNER_TONES: Record<BannerTone, string> = {
  stone: 'เทาอ่อน',
  mint: 'เขียวอ่อน',
  sky: 'ฟ้าอ่อน',
  sand: 'ครีม',
  rose: 'ชมพูอ่อน',
  forest: 'เขียวเข้ม',
  navy: 'น้ำเงินเข้ม',
  charcoal: 'ดำ',
};
export const BANNER_TAGLINE_MAX = 80;
const DEFAULT: SupportBanner = { tagline: '', tone: 'stone' };

const isTone = (value: unknown): value is BannerTone => typeof value === 'string' && Object.prototype.hasOwnProperty.call(BANNER_TONES, value);

/** The saved banner, from the public page's answer (an object) or the workspace's settings (its JSON). */
export function bannerOf(raw: unknown): SupportBanner {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = raw ? JSON.parse(raw) : null;
    } catch {
      value = null;
    }
  }
  if (!value || typeof value !== 'object') return DEFAULT;
  const { tagline, tone } = value as Partial<SupportBanner>;
  return { tagline: typeof tagline === 'string' ? tagline : '', tone: isTone(tone) ? tone : DEFAULT.tone };
}

/** The first two letters as the eye reads them (a Thai vowel or tone mark stays on its letter). */
function initials(name: string) {
  const letters = [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(name.replace(/\s+/g, ''))].map((s) => s.segment);
  return letters.slice(0, 2).join('') || '?';
}

/** The band itself. `preview`: the settings page's sample, not the page's header. */
export function OrgBannerView({
  name,
  logo,
  banner,
  preview = false,
  children,
}: {
  name: string;
  logo?: string;
  banner: SupportBanner;
  preview?: boolean;
  children?: ReactNode;
}) {
  const Tag = preview ? 'div' : 'header';
  return (
    <Tag className={`guest-head org-banner tone-${banner.tone}`}>
      <div className="org-banner-id">
        {logo ? (
          // A data: URL from the server; next/image adds nothing for it.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="org-banner-logo" src={logo} width={56} height={56} alt={`โลโก้ของ ${name}`} />
        ) : (
          // Until the organization's details come, an empty tile of the same size, so nothing moves when they do.
          <span className="org-banner-logo org-banner-initials" aria-hidden="true">
            {name && initials(name)}
          </span>
        )}
        <div className="org-banner-text">
          <strong className="org-banner-name">{name}</strong>
          {banner.tagline && <span className="org-banner-tagline">{banner.tagline}</span>}
        </div>
      </div>
      {children && <div className="guest-head-actions">{children}</div>}
    </Tag>
  );
}

/** The support page's header: the organization's band, with the page's links (`children`) in it. */
export function OrgBanner({ slug, name, children }: { slug: string; name: string; children?: ReactNode }) {
  const info = useApi<PublicOrgInfo>(publicOrgPath(slug)).data;
  return (
    <OrgBannerView name={name || info?.organization.name || ''} logo={info?.organization.logo || undefined} banner={bannerOf(info?.organization.banner)}>
      {children}
    </OrgBannerView>
  );
}

/** Who runs the page, once and small, at its foot. */
export function PoweredBy() {
  return (
    <Link className="powered-by" href="/">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" width={18} height={18} alt="" />
      ให้บริการโดย Bookdose
    </Link>
  );
}
