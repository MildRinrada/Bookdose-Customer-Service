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
  // A gear with even teeth, drawn as a ring of spokes around the hub, so it still reads as a gear at 18px.
  settings:
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M10.6 2.6h2.8l.5 2.6 2 .8 2.2-1.5 2 2-1.5 2.2.8 2 2.6.5v2.8l-2.6.5-.8 2 1.5 2.2-2 2-2.2-1.5-2 .8-.5 2.6h-2.8l-.5-2.6-2-.8-2.2 1.5-2-2 1.5-2.2-.8-2-2.6-.5v-2.8l2.6-.5.8-2-1.5-2.2 2-2 2.2 1.5 2-.8z',
  shield: 'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 5v14 M5 12h14',
  clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  check: 'M5 12l4 4L19 6',
  checkCircle: 'M9 12l2 2 4-4 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
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
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',
  edit: 'M15 5l4 4 M3 21l5-1L21 7l-5-5L3 15z',
  file: 'M5 2h9l5 5v15H5z M14 2v6h5 M8 13h8 M8 17h6',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
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
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2',
  facebook:
    'M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.4 5.4 3.7 7.1V22l3.4-1.9c.9.3 1.9.4 2.9.4 5.5 0 10-4.1 10-9.3S17.5 2 12 2z M6.5 13.5l3.8-4 2 2 3.7-4-3.8 4-2-2z',
} as const;

export type IconName = keyof typeof paths;

/** `name` may come from data (e.g. a channel's icon), so any string is accepted; unknown names draw a file. */
export function Icon({ name, className }: { name: IconName | (string & {}); className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name as IconName] ?? paths.file} />
    </svg>
  );
}
