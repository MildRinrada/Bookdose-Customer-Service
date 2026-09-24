import { Icon } from '@/components/Icon';

/* How the customer feels (backend/modules/ai/mood.py), as a tag beside a case or a conversation: โกรธมาก in red,
   ไม่พอใจ in amber, and ด่วน when the customer says it cannot wait. Nothing at all for a calm customer - a tag on
   every row would be a tag nobody reads. The reason and who read it (the AI, or the words in the message) are in the
   tooltip. Markup: components.css (mood-tag). */

export type Mood = {
  mood_level?: number | null;
  mood_urgent?: number | boolean | null;
  mood_reason?: string | null;
  mood_source?: string | null;
};

/** How far up the queue a customer's feelings put them: the level counts twice, "it cannot wait" once. */
export const moodHeat = (m: Mood) => (m.mood_level ?? 0) * 2 + (m.mood_urgent ? 1 : 0);

export function MoodTag({ mood, className }: { mood: Mood; className?: string }) {
  const level = mood.mood_level ?? 0;
  const urgent = Boolean(mood.mood_urgent);
  if (!level && !urgent) return null;
  const label = [level === 2 ? 'โกรธมาก' : level === 1 ? 'ไม่พอใจ' : '', urgent ? 'ด่วน' : ''].filter(Boolean).join(' · ');
  const by = mood.mood_source === 'ai' ? 'AI อ่านจากข้อความล่าสุด' : 'จากคำในข้อความล่าสุด';
  return (
    <span
      className={`mood-tag ${level === 2 ? 'angry' : level === 1 ? 'upset' : 'urgent'}${className ? ` ${className}` : ''}`}
      title={`ลูกค้า${label}${mood.mood_reason ? ` · ${mood.mood_reason}` : ''} (${by})`}
    >
      <Icon name={level ? 'frown' : 'bolt'} />
      {label}
    </span>
  );
}
