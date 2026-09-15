"use client";

import { createContext, useContext } from "react";
import type { ProjectLinks, ProjectSide } from "../links";
import type { Capability, ContractApproval } from "../types";
import type { ProjectHandlers } from "./ProjectPage";

/* What every part of one project page shares: where its screens and API are (links), what its buttons do
   (handlers), the side looking at it, what that viewer may do, and the customer side's reviews still waiting. The
   team's side may do everything; the customer's side what its role on the contract allows (ContractDetail.access,
   see backend client_team/access.py). */

export type ProjectContextValue = {
  links: ProjectLinks;
  handlers: ProjectHandlers;
  side: ProjectSide;
  /** The viewer may do this; the server checks every request anyway. */
  can: (capability: Capability) => boolean;
  /** Reviews of the customer side's approval flow (ContractDetail.approval); none without reviewers. */
  approval: ContractApproval;
};

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value)
    throw new Error("Project components are drawn inside <ProjectPage>");
  return value;
}
