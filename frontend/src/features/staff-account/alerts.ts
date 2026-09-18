/* The two ways the page itself tells a member about new work (ตั้งค่าบัญชี → การแจ้งเตือน): a short sound made by
   the browser (Web Audio, no file to download) and a desktop notification (the Notification API, after the member
   allows it). Both are quiet when the browser cannot do them. */

let audio: AudioContext | null = null;

/** Two short rising tones. */
export function playAlertSound() {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return false;
    audio ??= new Context();
    void audio.resume();
    const start = audio.currentTime;
    [880, 1175].forEach((frequency, index) => {
      const tone = audio!.createOscillator();
      const volume = audio!.createGain();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      const at = start + index * 0.16;
      volume.gain.setValueAtTime(0.0001, at);
      volume.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      tone.connect(volume).connect(audio!.destination);
      tone.start(at);
      tone.stop(at + 0.15);
    });
    return true;
  } catch {
    return false;
  }
}

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
    const note = new Notification(title, { body, tag, icon: '/icon.svg' });
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
