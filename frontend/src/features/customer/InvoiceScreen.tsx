'use client';

import { ErrorState, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { customerContractApi, customerInvoicePath, customerProjectLinks, InvoicePage, type InvoiceView } from '@/features/contracts';
import { useApi, useInvalidate } from '@/lib/query';
import { OVERVIEW_PATH } from './api';

/* One invoice or, once paid, its receipt (?view=receipt), with the customer's slip form (the old customerInvoicePage). */

export function InvoiceScreen({ slug, id, view = '' }: { slug: string; id: string; view?: string }) {
  const path = customerInvoicePath(slug, id);
  const query = useApi<InvoiceView>(path);
  const toast = useToast();
  const refresh = useInvalidate();
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <PageLoading />;
  const data = query.data;
  const links = customerProjectLinks(slug, data.contract.id);
  return (
    <InvoicePage
      data={data}
      view={view}
      links={links}
      onSlip={async (file, note) => {
        const docApi = customerContractApi(slug, data.contract.id);
        await docApi.uploadSlip(data.invoice.id, file, note);
        toast('ส่งสลิปแล้ว ทีมงานจะตรวจและออกใบเสร็จ');
        await refresh(path, docApi.path, OVERVIEW_PATH);
      }}
    />
  );
}
