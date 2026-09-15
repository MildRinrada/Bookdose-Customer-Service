import type { ProjectSide } from "@/features/contracts/links";
import type { DriveParty } from "./types";

/* Who put a file in the drive, in the words of the side reading it. */

const partyWords: Record<ProjectSide, Record<DriveParty, string>> = {
  org: { org: "ทีมงาน", customer: "ลูกค้า" },
  customer: { org: "ผู้รับจ้าง", customer: "ฝ่ายผู้ว่าจ้าง" },
};

export function partyLabel(side: ProjectSide, party: DriveParty): string {
  return partyWords[side][party];
}
