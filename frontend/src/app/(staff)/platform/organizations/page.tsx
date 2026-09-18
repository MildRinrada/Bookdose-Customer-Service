import { OrganizationsScreen } from '@/features/platform/OrganizationsScreen';

// ?tab=activity opens the platform's activity; ?admin=<organization id> opens that organization's "invite admin" dialog.
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; admin?: string | string[] }> }) {
  const { tab, admin } = await searchParams;
  return <OrganizationsScreen tab={typeof tab === 'string' ? tab : undefined} admin={typeof admin === 'string' ? admin : undefined} />;
}
