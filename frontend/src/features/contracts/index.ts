/* What other features use from contracts: the document and its signing, the project page and its tabs for either
   side, the invoice page, the template form (platform console), the billing settings panel (settings) and the
   labels. The customer feature builds its screens on these with customerProjectLinks() and its own handlers. */

export { ContractDocument } from "./components/ContractDocument";
export { ContractSignBox } from "./components/ContractSignBox";
export {
  ContractEventRows,
  ContractFileItem,
  ContractSteps,
  ContractVersionRows,
  JourneySteps,
  PrintButton,
  printContract,
  ProgressSteps,
  useAct,
} from "./components/common";
export {
  ContractActionButton,
  ContractActionLink,
  ProjectBilling,
  ProjectBoard,
  ProjectDocument,
  ProjectIssues,
  ProjectMilestones,
  ProjectPage,
  ProjectWarranty,
  type ProjectHandlers,
  type SignedContract,
} from "./components/ProjectPage";
export {
  InvoiceDocument,
  InvoicePage,
  InvoiceSlipForm,
  type InvoiceHandlers,
} from "./components/InvoicePage";
export { ProjectReasonForm } from "./components/ProjectReasonForm";
export {
  ContractTemplateForm,
  ContractTemplateRow,
  useContractTemplateForm,
} from "./components/ContractTemplateForm";
export {
  ContractNewForm,
  useOpenContractNew,
  type RenewsContract,
} from "./components/ContractNewForm";
export { BillingSettingsPanel } from "./components/BillingSettingsPanel";
export {
  StaffInvoiceScreen,
  StaffProjectView,
  useStaffInvoiceHandlers,
  useStaffProjectHandlers,
} from "./components/StaffProject";
export {
  customerProjectLinks,
  orgProjectLinks,
  type ProjectLinks,
  type ProjectSide,
} from "./links";
export * from "./labels";
export {
  customerContractApi,
  customerInvoicePath,
  requestSignCode,
  signContract,
  PLATFORM_TEMPLATES_PATH,
  TEMPLATES_PATH,
  CONTRACTS_PREFIX,
} from "./api";
export type * from "./types";
