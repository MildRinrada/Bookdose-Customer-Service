/* Shapes of กำแพงคำชม (backend/modules/kudos). Field names are the server's. */

/** One praise: the customer's words (masked), the stars when it came from the survey, who was praised and who cheered.
    A heart from the thank-you card ('thanks') has no words of the customer's. */
export type Kudos = {
  id: string;
  source: 'csat' | 'message' | 'thanks';
  user_id: string;
  /** The name the praised member signed with then; the page shows their current name when they are still a member. */
  user_name: string;
  text: string;
  rating: number | null;
  created_at: string;
  cheers: Array<{ user_id: string; name: string }>;
  /** This member cheered it. */
  cheered: boolean;
  /** It praises this member. */
  mine: boolean;
  /** This member may take it down (the praised member, or an owner). */
  removable: boolean;
};

/** GET /api/kudos (and the overview's newest few): `total` in the last `days` days. */
export type KudosWall = { items: Kudos[]; total: number; days: number };
