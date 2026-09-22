import { OrganizationScreen } from '@/features/platform/OrganizationScreen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganizationScreen id={id} />;
}
