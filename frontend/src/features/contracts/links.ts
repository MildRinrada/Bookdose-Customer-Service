import type { ProjectTab } from "./labels";

/* Where one project's screens are, for the side looking at it (the old state.projectCtx: side 'org' or 'customer').
   Every shared project component takes one of these, so the same markup links to /contracts/... for the team and to
   /customer/documents/... for the customer. */

export type ProjectSide = "org" | "customer";

export type ProjectLinks = {
  side: ProjectSide;
  /** The project page, on a tab (board has no ?tab). */
  project: (tab?: ProjectTab | "") => string;
  /** An invoice, or its receipt with view 'receipt'. */
  invoice: (invoiceId: string, view?: string) => string;
  /** Another contract of the same customer (the MA contract's parent, a renewal). */
  contract: (contractId: string) => string;
  /** A problem / change request (a case). */
  issue: (ticketId: string) => string;
  /** API path to download one of the document's or the project's files. */
  file: (fileId: string) => string;
  /** API address of the document (signing calls append /otp and /sign). */
  base: string;
};

const withTab = (base: string, tab?: string) =>
  tab && tab !== "board" ? `${base}?tab=${tab}` : base;

export function orgProjectLinks(contractId: string): ProjectLinks {
  const base = `/contracts/${contractId}`;
  return {
    side: "org",
    project: (tab) => withTab(base, tab),
    invoice: (id, view = "") =>
      `${base}?tab=billing&invoice=${id}${view ? `&view=${view}` : ""}`,
    contract: (id) => `/contracts/${id}`,
    issue: (ticketId) => `/tickets/${ticketId}`,
    file: (fileId) => `/api/contracts/${contractId}/files/${fileId}`,
    base: `/api/contracts/${contractId}`,
  };
}

export function customerProjectLinks(
  slug: string,
  contractId: string,
): ProjectLinks {
  const base = `/customer/documents/${slug}/${contractId}`;
  return {
    side: "customer",
    project: (tab) => withTab(base, tab),
    invoice: (id, view = "") =>
      `/customer/billing/${slug}/${id}${view ? `?view=${view}` : ""}`,
    contract: (id) => `/customer/documents/${slug}/${id}`,
    issue: (ticketId) => `/customer/cases/${slug}/${ticketId}`,
    file: (fileId) =>
      `/api/public/${slug}/contracts/${contractId}/files/${fileId}`,
    base: `/api/public/${slug}/contracts/${contractId}`,
  };
}
