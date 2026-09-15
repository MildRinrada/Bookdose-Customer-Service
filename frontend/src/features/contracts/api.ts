import { api } from "@/lib/api/client";
import type { Upload } from "@/lib/files";
import type { ContractKind, DocumentMilestone, OtpResult } from "./types";

/* Endpoints of backend/modules/contracts/routes.py used by the team's side, and the signing calls both sides share.
   Reads go through useApi(<path>); after a write refresh CONTRACTS_PREFIX (list, detail and invoices). */

export const CONTRACTS_PREFIX = "/api/contracts";
export const CONTRACTS_PATH = "/api/contracts";
export const TEMPLATES_PATH = "/api/contract-templates";
export const PLATFORM_TEMPLATES_PATH = "/api/platform/contract-templates";
export const BILLING_PATH = "/api/contract-billing";

export const contractPath = (id: string) => `/api/contracts/${id}`;
export const invoicePath = (contractId: string, invoiceId: string) =>
  `/api/contracts/${contractId}/invoices/${invoiceId}`;

export type NewContractBody = {
  kind: ContractKind;
  title: string;
  account_id: string;
  renews_id?: string;
  template_scope?: "org" | "platform";
  template_id?: string;
  body?: string;
};

export type DraftBody = {
  title: string;
  body: string;
  warranty_days: number;
  support_terms: string;
  milestones: DocumentMilestone[];
};

export const createContract = (body: NewContractBody) =>
  api<{ id: string }>(CONTRACTS_PATH, body);
export const importDocument = (file: Upload) =>
  api<{ body: string }>("/api/contracts/import", file);
export const saveDraft = (id: string, body: DraftBody) =>
  api<{ ok: true }>(contractPath(id), body, "PATCH");
export const sendContract = (id: string) =>
  api<{ ok: true }>(`${contractPath(id)}/send`, {});
export const reviseContract = (id: string, note: string) =>
  api<{ version: string }>(`${contractPath(id)}/revise`, { note });
export const cancelContract = (id: string) =>
  api<{ ok: true }>(`${contractPath(id)}/cancel`, {});
export const addContractFiles = (id: string, files: Upload[]) =>
  api<{ ok: true }>(`${contractPath(id)}/files`, { files });
export const removeContractFile = (id: string, fileId: string) =>
  api<{ ok: true }>(`${contractPath(id)}/files/${fileId}`, undefined, "DELETE");

/** Signing (both sides): `base` is the document's API address, /api/contracts/<id> or /api/public/<org>/contracts/<id>. */
export const requestSignCode = (base: string) =>
  api<OtpResult>(`${base}/otp`, {});
export type SignBody = {
  name: string;
  method: "draw" | "type" | "upload";
  mark: string;
  agree: boolean;
  code?: string;
  password?: string;
};
export const signContract = (base: string, body: SignBody) =>
  api<unknown>(`${base}/sign`, body);

export const saveTemplate = (
  scope: "org" | "platform",
  id: string | null,
  body: { title: string; kind: string; body: string },
) => {
  const base = scope === "platform" ? PLATFORM_TEMPLATES_PATH : TEMPLATES_PATH;
  return api<{ id?: string; ok?: true }>(
    id ? `${base}/${id}` : base,
    body,
    id ? "PATCH" : "POST",
  );
};
export const deleteTemplate = (id: string) =>
  api<{ ok: true }>(`${TEMPLATES_PATH}/${id}`, undefined, "DELETE");

// The team's side of a signed project
export const startMilestone = (contractId: string, milestoneId: string) =>
  api<{ ok: true }>(
    `${contractPath(contractId)}/milestones/${milestoneId}/start`,
    {},
  );
export const setMilestoneProgress = (
  contractId: string,
  milestoneId: string,
  progress: number,
) =>
  api<{ ok: true }>(
    `${contractPath(contractId)}/milestones/${milestoneId}/progress`,
    { progress },
  );
export const deliverMilestone = (
  contractId: string,
  milestoneId: string,
  body: { note: string; links: string[]; files: Upload[] },
) =>
  api<{ id: string }>(
    `${contractPath(contractId)}/milestones/${milestoneId}/deliver`,
    body,
  );
export const issueInvoice = (contractId: string, milestoneId: string) =>
  api<{ id: string }>(
    `${contractPath(contractId)}/milestones/${milestoneId}/invoice`,
    {},
  );
export const confirmPayment = (contractId: string, invoiceId: string) =>
  api<{ receipt: string }>(`${invoicePath(contractId, invoiceId)}/confirm`, {});
export const rejectSlip = (
  contractId: string,
  invoiceId: string,
  reason: string,
) =>
  api<{ ok: true }>(`${invoicePath(contractId, invoiceId)}/reject`, { reason });
export const voidInvoice = (
  contractId: string,
  invoiceId: string,
  reason: string,
) =>
  api<{ ok: true }>(`${invoicePath(contractId, invoiceId)}/void`, { reason });

/* The customer's side of one document and its project (/api/public/<org>/contracts/<id>), for the customer feature.
   Refresh `path` (and /api/customer/overview) after a write. */
export function customerContractApi(slug: string, contractId: string) {
  const path = `/api/public/${slug}/contracts/${contractId}`;
  return {
    path,
    invoicePath: (invoiceId: string) => `${path}/invoices/${invoiceId}`,
    accept: (milestoneId: string) =>
      api<{ invoice_id: string | null }>(
        `${path}/milestones/${milestoneId}/accept`,
        {},
      ),
    reject: (milestoneId: string, remark: string) =>
      api<{ conversation_id: string }>(
        `${path}/milestones/${milestoneId}/reject`,
        { remark },
      ),
    uploadSlip: (invoiceId: string, file: Upload, note: string) =>
      api<{ ok: true }>(`${path}/invoices/${invoiceId}/slip`, {
        files: [file],
        note,
      }),
    saveBuyer: (buyer: {
      name: string;
      address: string;
      tax_id: string;
      branch: string;
    }) => api<{ ok: true }>(`${path}/buyer`, buyer),
    openIssue: (issue: {
      kind: "bug" | "change";
      milestone_id: string;
      subject: string;
      body: string;
    }) =>
      api<{ ticket_id: string; conversation_id: string }>(
        `${path}/issues`,
        issue,
      ),
    requestRenewal: (note: string) =>
      api<{ conversation_id: string }>(`${path}/renewal`, { note }),
    ask: (body: string) =>
      api<{ conversation_id: string }>(`${path}/ask`, { body }),
    requestChanges: (note: string) =>
      api<{ conversation_id: string }>(`${path}/changes`, { note }),
  };
}

/** An invoice of any of the customer's projects in one organization (/customer/billing/<org>/<id>). */
export const customerInvoicePath = (slug: string, invoiceId: string) =>
  `/api/public/${slug}/invoices/${invoiceId}`;

export type BillingSettingsBody = {
  pay_bank: string;
  pay_account_name: string;
  pay_account_number: string;
  pay_promptpay: string;
  vat_registered: boolean;
  tax_id: string;
  tax_branch: string;
  org_address: string;
  invoice_due_days: number;
};
export const saveBillingSettings = (body: BillingSettingsBody) =>
  api<{ ok: true }>(BILLING_PATH, body);
