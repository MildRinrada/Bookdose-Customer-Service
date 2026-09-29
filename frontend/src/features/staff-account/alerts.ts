/* The ways the page itself tells a member about their work (ตั้งค่าบัญชี → การแจ้งเตือน): a short sound made by
   the browser (Web Audio, no file to download) and a desktop notification (the Notification API, after the member
   allows it). Both are quiet when the browser cannot do them. */

let audio: AudioContext | null = null;

type Tone = { frequency: number; at: number; length: number; to?: number; type?: OscillatorType; volume?: number };

/** The page's sounds, each a few tones made on the spot:
    alert - new work (two soft rising tones); message - a new message with its pop-up (a quick "bloop" sliding up
    into a bell-like ding that rings on, a faint octave above it); urgent - a case escalated to the member, past its
    SLA or urgent (three quick firm beeps, then higher); claim - the member takes a case (a short upward pop);
    success - a case closed or five stars (a bright rising chord). */
export type SoundKind = 'alert' | 'message' | 'urgent' | 'claim' | 'success';

const SOUNDS: Record<SoundKind, Tone[]> = {
  message: [
    { frequency: 520, to: 780, at: 0, length: 0.08, volume: 0.2 },
    { frequency: 1047, at: 0.08, length: 0.42, volume: 0.24 },
    { frequency: 2094, at: 0.08, length: 0.16, volume: 0.05 },
    { frequency: 1568, at: 0.09, length: 0.3, type: 'triangle', volume: 0.04 },
  ],
  alert: [
    { frequency: 880, at: 0, length: 0.14 },
    { frequency: 1175, at: 0.16, length: 0.14 },
  ],
  urgent: [
    { frequency: 988, at: 0, length: 0.09, type: 'triangle', volume: 0.3 },
    { frequency: 988, at: 0.13, length: 0.09, type: 'triangle', volume: 0.3 },
    { frequency: 988, at: 0.26, length: 0.09, type: 'triangle', volume: 0.3 },
    { frequency: 1319, at: 0.42, length: 0.22, type: 'triangle', volume: 0.3 },
  ],
  claim: [{ frequency: 520, to: 1040, at: 0, length: 0.1, volume: 0.22 }],
  success: [
    { frequency: 523, at: 0, length: 0.12 },
    { frequency: 659, at: 0.09, length: 0.12 },
    { frequency: 784, at: 0.18, length: 0.12 },
    { frequency: 1047, at: 0.27, length: 0.38, volume: 0.2 },
  ],
};

export function playSound(kind: SoundKind) {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return false;
    audio ??= new Context();
    void audio.resume();
    const start = audio.currentTime;
    for (const t of SOUNDS[kind]) {
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      const at = start + t.at;
      tone.type = t.type ?? 'sine';
      tone.frequency.setValueAtTime(t.frequency, at);
      if (t.to) tone.frequency.exponentialRampToValueAtTime(t.to, at + t.length);
      volume.gain.setValueAtTime(0.0001, at);
      volume.gain.exponentialRampToValueAtTime(t.volume ?? 0.25, at + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + t.length);
      tone.connect(volume).connect(audio.destination);
      tone.start(at);
      tone.stop(at + t.length + 0.01);
    }
    return true;
  } catch {
    return false;
  }
}

/** Two short rising tones (new work). */
export const playAlertSound = () => playSound('alert');

export const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export const desktopPermission = (): NotificationPermission | 'unsupported' => (desktopSupported() ? Notification.permission : 'unsupported');

/** Ask the browser once; true when notifications may be shown. */
export async function allowDesktop(): Promise<boolean> {
  if (!desktopSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** A desktop notification that opens `href` in this tab when clicked. */
export function showDesktop(title: string, body: string, href: string, tag: string) {
  if (!desktopSupported() || Notification.permission !== 'granted') return false;
  try {
    // The logo on a white circle: the plain logo's dark body disappears on a dark notification.
    const note = new Notification(title, { body, tag, icon: '/notify-icon.png' });
    note.onclick = () => {
      window.focus();
      window.location.assign(href);
      note.close();
    };
    return true;
  } catch {
    return false;
  }
}
