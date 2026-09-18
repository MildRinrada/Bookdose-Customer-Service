import { playSound } from './alerts';

/* Small rewards for the member's own work (ตั้งค่าบัญชี → การแจ้งเตือน → ฉลอง): whoever closes a case or sees five
   stars arrive calls celebrate(); <Celebrations /> in the staff frame shows the confetti and the card. The sounds
   follow the member's "เสียงเตือน" switch; setFeedbackPrefs keeps a copy of both switches for code outside React. */

export type Celebration = { kind: 'resolved' | 'praise'; title: string; detail?: string };

const EVENT = 'bookdose:celebrate';
let prefs = { sound: false, celebrate: true };

export const setFeedbackPrefs = (next: { sound: boolean; celebrate: boolean }) => {
  prefs = next;
};
export const feedbackPrefs = () => prefs;

export function celebrate(item: Celebration) {
  if (prefs.celebrate) showCelebration(item);
}

/** Shows it whatever the switch says (the settings' "ลองดูการฉลอง"). */
export function showCelebration(item: Celebration) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<Celebration>(EVENT, { detail: item }));
}

export function onCelebrate(listener: (item: Celebration) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<Celebration>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** The short pop of taking a case, when the member has sounds on. */
export function claimSound() {
  if (prefs.sound) playSound('claim');
}
