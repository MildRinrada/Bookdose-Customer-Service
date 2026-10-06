/* The app's line icons (24px grid, stroked by CSS: .icon). One path per name; unknown names draw a file. */

const paths = {
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  eyeOff:
    'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9 M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  inbox: 'M4 4h16v16H4z M4 13h4l2 3h4l2-3h4',
  ticket: 'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4z M15 6v3 M15 12v1 M15 16v2',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  book: 'M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-3-1-6-2-10 1z M12 5v16',
  chart: 'M3 3v18h18 M7 16v-4 M12 16V8 M17 16V5',
  shield: 'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  check: 'M5 12l4 4L19 6',
  checkCircle: 'M9 12l2 2 4-4 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  // The dot of the question mark is a stroke that goes nowhere, so it reads as a dot at every size.
  help: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M9.2 9.3a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.2 M12 17.2v.01',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  back: 'M19 12H5 M10 7l-5 5 5 5',
  down: 'M6 9l6 6 6-6',
  download: 'M12 3v12 M7 10l5 5 5-5 M3 16v5h18v-5',
  logout: 'M9 5H3v14h6 M10 12h11 M17 8l4 4-4 4',
  close: 'M6 6l12 12 M6 18L18 6',
  send: 'M22 2L9 15 M22 2l-7 20-6-7-7-6z',
  paperclip: 'M21 11l-9 9a6 6 0 0 1-8-8L14 2a4 4 0 0 1 6 6L10 18a2 2 0 0 1-3-3l9-9',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2c6 6 6 14 0 20-6-6-6-14 0-20',
  mail: 'M3 5h18v14H3z M3 5l9 8 9-8',
  phone:
    'M22 17v3a2 2 0 0 1-2.2 2A20 20 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  chat: 'M21 11a9 9 0 0 1-9 9H3l1-5a9 9 0 1 1 17-4 M8 10h8 M8 14h5',
  sparkle: 'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',
  // บล็อกผู้ก่อกวน: a circle struck through.
  ban: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M4.9 4.9l14.2 14.2',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  // Three dots stacked: each is a stroke that goes nowhere, so it stays round at every size.
  kebab: 'M12 5.5v.01 M12 12v.01 M12 18.5v.01',
  calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',
  edit: 'M15 5l4 4 M3 21l5-1L21 7l-5-5L3 15z',
  file: 'M5 2h9l5 5v15H5z M14 2v6h5 M8 13h8 M8 17h6',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  bellOff: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4 M3 3l18 18',
  sidebar: 'M3 4h18v16H3z M9 4v16 M15 10l-2 2 2 2',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  // Article editor toolbar
  list: 'M9 6h12 M9 12h12 M9 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  listOrdered: 'M10 6h11 M10 12h11 M10 18h11 M4 5h1v4 M3 9h3 M3 15h3l-3 4h3',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  image: 'M3 5h18v14H3z M7 15l3-3 3 3 2-2 3 3 M8.5 9.5h.01',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 14h10l1-14 M9 7V4h6v3',
  restore: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5',
  code: 'M8 6l-6 6 6 6 M16 6l6 6-6 6',
  // Automation, mentions, ratings and Facebook Messenger
  macro: 'M4 4h16v16H4z M13 7l-4 6h4l-2 4 5-6h-4z',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  // Knowledge base: pins, helpful marks, arranging and earlier versions
  pin: 'M9 3h6 M10 3v6l-3 4h10l-3-4V3 M12 13v8',
  thumbUp: 'M7 11v10H3V11z M7 11l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.4 7a2 2 0 0 1-2 1.7H7',
  thumbDown: 'M7 13V3H3v10z M7 13l4 8a2 2 0 0 0 3-2l-1-5h6a2 2 0 0 0 2-2.3l-1.4-7a2 2 0 0 0-2-1.7H7',
  // Six dots big enough to read as dots: a ring this small under the 1.7 stroke draws as a filled circle.
  grip: 'M7.9 6a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0 M13.9 6a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0 M7.9 12a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0 M13.9 12a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0 M7.9 18a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0 M13.9 18a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2',
  // A customer who is not happy (the mood tag on cases and conversations)
  frown: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 16.5s1.5-2 4-2 4 2 4 2 M9 9.5h.01 M15 9.5h.01',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 14s1.5 2 4 2 4-2 4-2 M9 9.5h.01 M15 9.5h.01',
  expand: 'M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7',
  shrink: 'M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7',
  translate: 'M5 8l6 6 M4 14l6-6 2-3 M2 5h12 M7 2h1 M22 22l-5-10-5 10 M14 18h6',
  // ป้ายเคส: a luggage tag with its hole.
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z M8.5 8.5h.01',
  // A rounded square with the lens and the flash: Instagram's own mark, drawn in the same line as the rest.
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17.5 6.5h.01',
  // Messenger's bubble (SVG Repo "messenger outline"); its zigzag is filled (`solid` below).
  facebook:
    'M12.0015 2C6.36855 2 1.99997 6.12644 1.99997 11.7011C1.99997 14.6169 3.19537 17.1356 5.1402 18.8751C5.30189 19.0215 5.40074 19.2238 5.4084 19.4444L5.46357 21.2245C5.46753 21.3554 5.50362 21.4833 5.56865 21.5969C5.63368 21.7106 5.72567 21.8065 5.8365 21.8762C5.94733 21.9459 6.07361 21.9873 6.2042 21.9968C6.3348 22.0062 6.46572 21.9834 6.58541 21.9303L8.57085 21.0552C8.7402 20.9816 8.92794 20.9671 9.10418 21.0146C10.0161 21.2651 10.9869 21.4008 11.9984 21.4008C17.6314 21.4008 22 17.2751 22 11.7004C22 6.12644 17.6322 2 12.0015 2Z',
  // ยกมือขอช่วย, กำแพงคำชม and ผลงานของฉัน: a raised open hand, a heart, a medal on its ribbon, a crescent moon.
  hand: 'M18 11V6a2 2 0 0 0-4 0v5 M14 10V4a2 2 0 0 0-4 0v6 M10 10.5V6a2 2 0 0 0-4 0v8 M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15',
  heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z',
  award: 'M15.5 12.9L17 21l-5-3-5 3 1.5-8.1 M18 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  // พยากรณ์อากาศของกล่องข้อความ: the overview's sky, in the same line as the rest rather than a coloured emoji.
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  cloudSun: 'M12 2v2 M4.9 4.9l1.4 1.4 M20 12h2 M19.1 4.9l-1.4 1.4 M15.9 13A4 4 0 0 0 8.2 10.8 M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z',
  cloudRain: 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2 M16 14v6 M8 14v6 M12 16v6',
  storm: 'M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 9 M13 11l-4 6h6l-4 6',
  thermometer: 'M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z M12 17.5v.01',
} as const;

/* Icons taken as they are from an outside set: a filled shape on their own grid, rather than a line on ours
   (.icon.filled fills instead of stroking). */
const filled = {
  // A gear drawn as a ring with a hole (SVG Repo "setting").
  settings: {
    viewBox: '0 0 1024 1024',
    d: 'M600.704 64a32 32 0 0 1 30.464 22.208l35.2 109.376c14.784 7.232 28.928 15.36 42.432 24.512l112.384-24.192a32 32 0 0 1 34.432 15.36L944.32 364.8a32 32 0 0 1-4.032 37.504l-77.12 85.12a357.12 357.12 0 0 1 0 49.024l77.12 85.248a32 32 0 0 1 4.032 37.504l-88.704 153.6a32 32 0 0 1-34.432 15.296L708.8 803.904c-13.44 9.088-27.648 17.28-42.368 24.512l-35.264 109.376A32 32 0 0 1 600.704 960H423.296a32 32 0 0 1-30.464-22.208L357.696 828.48a351.616 351.616 0 0 1-42.56-24.64l-112.32 24.256a32 32 0 0 1-34.432-15.36L79.68 659.2a32 32 0 0 1 4.032-37.504l77.12-85.248a357.12 357.12 0 0 1 0-48.896l-77.12-85.248A32 32 0 0 1 79.68 364.8l88.704-153.6a32 32 0 0 1 34.432-15.296l112.32 24.256c13.568-9.152 27.776-17.408 42.56-24.64l35.2-109.312A32 32 0 0 1 423.232 64H600.64zm-23.424 64H446.72l-36.352 113.088-24.512 11.968a294.113 294.113 0 0 0-34.816 20.096l-22.656 15.36-116.224-25.088-65.28 113.152 79.68 88.192-1.92 27.136a293.12 293.12 0 0 0 0 40.192l1.92 27.136-79.808 88.192 65.344 113.152 116.224-25.024 22.656 15.296a294.113 294.113 0 0 0 34.816 20.096l24.512 11.968L446.72 896h130.688l36.48-113.152 24.448-11.904a288.282 288.282 0 0 0 34.752-20.096l22.592-15.296 116.288 25.024 65.28-113.152-79.744-88.192 1.92-27.136a293.12 293.12 0 0 0 0-40.256l-1.92-27.136 79.808-88.128-65.344-113.152-116.288 24.96-22.592-15.232a287.616 287.616 0 0 0-34.752-20.096l-24.448-11.904L577.344 128zM512 320a192 192 0 1 1 0 384 192 192 0 0 1 0-384zm0 64a128 128 0 1 0 0 256 128 128 0 0 0 0-256z',
  },
} as const;

/** The part of a line icon that is filled, drawn over its line in the same colour (Messenger's zigzag). */
const solid: Partial<Record<keyof typeof paths, string>> = {
  facebook:
    'M17.2528 9.57854L14.7486 13.5502C14.6544 13.6997 14.5302 13.8281 14.3839 13.9272C14.2376 14.0263 14.0724 14.0941 13.8986 14.1262C13.7248 14.1583 13.5462 14.154 13.3742 14.1137C13.2021 14.0734 13.0403 13.9979 12.8988 13.892L10.9065 12.3992C10.8178 12.3329 10.71 12.2971 10.5992 12.2971C10.4884 12.2971 10.3807 12.3329 10.2919 12.3992L7.6038 14.4398C7.24748 14.7119 6.77621 14.282 7.0153 13.9034L9.51951 9.9318C9.61375 9.7823 9.73793 9.65394 9.88424 9.55481C10.0305 9.45568 10.1958 9.38793 10.3696 9.35582C10.5434 9.32371 10.7219 9.32795 10.894 9.36826C11.066 9.40857 11.2279 9.48408 11.3693 9.59004L13.3617 11.0828C13.4504 11.149 13.5582 11.1849 13.6689 11.1849C13.7797 11.1849 13.8875 11.149 13.9762 11.0828L16.6643 9.04215C17.0245 8.76628 17.4958 9.19617 17.2528 9.57854Z',
};

export type IconName = keyof typeof paths | keyof typeof filled;

/** `name` may come from data (e.g. a channel's icon), so any string is accepted; unknown names draw a file. */
export function Icon({ name, className }: { name: IconName | (string & {}); className?: string }) {
  const shape = filled[name as keyof typeof filled];
  if (shape)
    return (
      <svg className={className ? `icon filled ${className}` : 'icon filled'} viewBox={shape.viewBox} aria-hidden="true">
        <path d={shape.d} />
      </svg>
    );
  const part = solid[name as keyof typeof paths];
  return (
    <svg className={className ? `icon ${className}` : 'icon'} viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name as keyof typeof paths] ?? paths.file} />
      {part && <path className="icon-solid" d={part} />}
    </svg>
  );
}
