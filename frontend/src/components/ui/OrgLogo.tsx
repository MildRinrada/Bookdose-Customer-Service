'use client';

import { Avatar } from './display';

/* An organization wherever it appears beside its name: the switcher in the sidebar, the customer's list of the
   organizations they deal with, the platform console.

   The same rule as a colleague's photo (UserAvatar): the picture is not in the answer that listed the organization -
   one is up to 128 KB, and a console listing a hundred organizations would carry megabytes of them - the answer only
   says whether there is one, and the picture is fetched by its own address and kept by the browser for an hour.

   The address is public because the picture already is: it heads every page the organization's customers open.
   Without a code, or for an organization that never set a picture, it falls back to the letters of its name, so
   nothing ever shows a broken image. */

export function orgLogoUrl(slug: string) {
  return `/api/public/${slug}/logo`;
}

export function OrgLogo({ slug, name, index = 0, hasLogo }: { slug?: string | null; name: string; index?: number; hasLogo?: boolean }) {
  if (!slug || !hasLogo) return <Avatar name={name} index={index} />;
  // A data-backed PNG served by this app; next/image adds nothing for it.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="avatar profile-avatar" src={orgLogoUrl(slug)} alt={`โลโก้ของ ${name}`} loading="lazy" />;
}
