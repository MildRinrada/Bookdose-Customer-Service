import type { Role } from '@/lib/types';

/* ไกด์การใช้งาน: one walk through the app per role (backend organization/model.py ROLES). Each step lights up one thing
   on one page and says what it is for, in the words the screen itself uses (a guide that names a button the screen
   does not have is worse than none).

   path     the page the step is on: the guide goes there first. None: wherever the guide is (the top bar, the menu).
   target   CSS selectors tried in order; the first one on screen is lit. None: a card in the middle of the screen.
   optional when nothing matches (a card a role or a small screen does not have), the step is left out instead of
            shown in the middle without what it talks about.
   hug      light what is inside the target rather than all of it (the menu, which stretches to the bottom).

   Markup the steps rely on: data-tour="…" on the members screen, the settings menu's data-tab, and the shell's own
   classes (.nav-workspace, .global-search, .help-btn …). Changing those means changing the steps here. */

export type TourStep = {
  path?: string;
  target?: string[];
  optional?: boolean;
  hug?: boolean;
  title: string;
  body: string;
};

export type Tour = { label: string; steps: (context: TourContext) => TourStep[] };

export type TourContext = { organization: string; searchKey: string };

const SEARCH = (c: TourContext): TourStep => ({
  target: ['.global-search'],
  optional: true,
  title: 'ค้นหาด่วน',
  body: `กด ${c.searchKey} จากหน้าไหนก็ได้ เพื่อค้นหาเคส ลูกค้า บทความ หรือหน้าต่าง ๆ แล้วไปที่นั่นทันที`,
});

const HELP: TourStep = {
  target: ['.help-btn'],
  optional: true,
  title: 'เปิดไกด์นี้อีกครั้ง',
  body: 'ปุ่มนี้มีไกด์การใช้งาน คีย์ลัดทั้งหมด คู่มือจาก Bookdose และรายงานปัญหา ลืมตรงไหนก็กลับมาดูได้เสมอ',
};

const INBOX: TourStep = {
  path: '/inbox',
  target: ['.inbox-list'],
  title: 'กล่องข้อความ',
  body: 'แชทจากทุกช่องทางมารวมอยู่ที่นี่ เลือกแชทเพื่ออ่าน แล้วกด รับเคส ก่อนตอบ เพื่อนร่วมทีมจะเห็นว่าคุณดูแลเรื่องนั้นอยู่',
};

export const tours: Record<Role, Tour> = {
  admin: {
    label: 'ไกด์สำหรับหัวหน้าทีม',
    steps: (c) => [
      {
        title: `ยินดีต้อนรับสู่ ${c.organization}`,
        body: 'คุณเป็นหัวหน้าทีม ดูแลได้ทั้งองค์กร ตั้งค่าช่องทาง เชิญทีมงาน และตอบลูกค้าเองได้ ไกด์นี้พาดูจุดสำคัญทีละจุด ใช้เวลาไม่ถึง 2 นาที',
      },
      {
        path: '/dashboard',
        // On a phone the menu is closed behind its button.
        target: ['.sidebar nav.nav-workspace', '.mobile-toggle'],
        optional: true,
        hug: true,
        title: 'เมนูหลัก',
        body: 'งานประจำวันอยู่ด้านบนของเมนู ตั้งแต่ภาพรวมจนถึงรายงาน ส่วนการดูแลองค์กรอยู่ใต้หัวข้อ MANAGE คือทีมและสมาชิก กับตั้งค่าองค์กร',
      },
      {
        path: '/dashboard',
        target: ['.setup-card'],
        optional: true,
        title: 'เริ่มต้นใช้งาน',
        body: 'ขั้นตอนที่ทำให้องค์กรพร้อมรับลูกค้าจริง ทำตามลำดับเลข ขั้นไหนเสร็จแล้วระบบติ๊กให้เอง',
      },
      {
        path: '/settings?tab=connections',
        target: ['.settings-nav-item[data-tab="connections"]', '.settings-panels'],
        title: 'เชื่อมช่องทางที่ลูกค้าติดต่อ',
        body: 'เชื่อม LINE อีเมล Facebook และ Instagram ขององค์กร ข้อความจากทุกช่องทางจะเข้ามารวมในกล่องข้อความที่เดียว',
      },
      {
        path: '/settings?tab=ai',
        target: ['.settings-nav-item[data-tab="ai"]', '.settings-panels'],
        title: 'AI Assistant',
        body: 'เชื่อม AI แล้วเลือกได้ว่าจะให้ช่วยอะไร เช่น ร่างคำตอบ แปลภาษา หรือตอบลูกค้าจากคลังความรู้ และตั้งเพดานการใช้งานได้',
      },
      {
        path: '/members',
        target: ['[data-tour="invite"]'],
        title: 'เพิ่มทีมงาน',
        body: 'เพิ่มเพื่อนร่วมงานแล้วเลือกบทบาท เจ้าหน้าที่ตอบลูกค้าในทีมของตัวเอง ผู้ดูแลสมาชิกช่วยดูแลรายชื่อคนในองค์กร หัวหน้าทีมดูแลได้ทั้งหมด',
      },
      {
        path: '/members',
        target: ['[data-tour="teams"]'],
        title: 'แบ่งทีม',
        body: 'แยกทีมตามลักษณะงาน แล้วจัดสมาชิกเข้าทีม เจ้าหน้าที่เห็นเฉพาะงานของทีมตัวเอง',
      },
      INBOX,
      {
        path: '/knowledge',
        target: ['.kb-hero-actions', '.kb-hero-head'],
        title: 'คลังความรู้',
        body: 'เขียนบทความ เลือกจากคลังบทความแม่แบบ หรือนำเข้าจากไฟล์ PDF และ Word ทีมใช้หาคำตอบ และ AI ใช้เป็นข้อมูลตอบลูกค้า',
      },
      SEARCH(c),
      HELP,
    ],
  },
  agent: {
    label: 'ไกด์สำหรับเจ้าหน้าที่',
    steps: (c) => [
      {
        title: `ยินดีต้อนรับสู่ ${c.organization}`,
        body: 'คุณเป็นเจ้าหน้าที่ ตอบแชทและดูแลเคสของลูกค้าในทีมของคุณ ไกด์นี้พาดูจุดสำคัญทีละจุด ใช้เวลาไม่ถึง 2 นาที',
      },
      {
        path: '/dashboard',
        target: ['.dashboard-heading'],
        title: 'ภาพรวม',
        body: 'เริ่มวันที่นี่ ดูว่ามีเคสรอการดูแลกี่เรื่อง แล้วกด รับงานถัดไป ระบบจะเปิดเคสที่ควรทำก่อนให้',
      },
      {
        target: ['.status-menu-root'],
        optional: true,
        title: 'สถานะการทำงาน',
        body: 'บอกทีมว่าคุณพร้อมรับเคสใหม่ไหม ถ้าพักหรือติดงาน ระบบจะไม่ส่งเคสใหม่ให้ ส่วนเคสเดิมยังอยู่กับคุณ',
      },
      INBOX,
      {
        path: '/inbox',
        target: ['.inbox-detail'],
        optional: true,
        title: 'ตอบลูกค้า',
        body: 'พิมพ์ตอบในช่องด้านล่างของแชท พิมพ์ / เพื่อแทรกคำตอบสำเร็จรูป ถ้าองค์กรเปิด AI จะมีปุ่มช่วยร่างและเกลาข้อความด้วย',
      },
      {
        path: '/tickets',
        target: ['.page-heading'],
        title: 'เคสบริการ',
        body: 'เรื่องที่ต้องติดตามต่อ แต่ละเคสมีกำหนดเวลาตอบ (SLA) เคสที่ใกล้ครบกำหนดจะขึ้นเตือนให้เห็นก่อน',
      },
      {
        path: '/knowledge',
        target: ['.kb-search-box', '.kb-hero-head'],
        title: 'คลังความรู้',
        body: 'บทความและคำตอบที่องค์กรรวบรวมไว้ พิมพ์แบบที่ลูกค้าถามเพื่อค้นหา แล้วใช้ตอบลูกค้าได้ทันที',
      },
      {
        target: ['.bell-menu'],
        optional: true,
        title: 'การแจ้งเตือน',
        body: 'เคสที่มอบหมายให้คุณ คนที่กล่าวถึงคุณ และเคสที่ใกล้ครบกำหนด ขึ้นที่กระดิ่งนี้',
      },
      {
        target: ['.assistant-fab'],
        optional: true,
        title: 'ผู้ช่วย AI',
        body: 'ถามวิธีใช้งานระบบได้ตลอด ไม่ต้องออกจากหน้าที่ทำงานอยู่',
      },
      SEARCH(c),
      HELP,
    ],
  },
  people: {
    label: 'ไกด์สำหรับผู้ดูแลสมาชิก',
    steps: (c) => [
      {
        title: `ยินดีต้อนรับสู่ ${c.organization}`,
        body: 'คุณเป็นผู้ดูแลสมาชิก ดูแลว่าใครทำงานในองค์กรบ้าง เชิญคนใหม่ แบ่งทีม เปลี่ยนบทบาท และปิดสิทธิ์ของคนที่ไม่ได้ทำงานแล้ว บัญชีนี้ไม่เห็นแชท เคส และข้อมูลลูกค้า',
      },
      {
        path: '/members',
        target: ['[data-tour="members"]'],
        title: 'สมาชิกในองค์กร',
        body: 'ทุกคนในองค์กรพร้อมบทบาทและทีม กด จัดการ ท้ายชื่อเพื่อย้ายทีม เปลี่ยนบทบาท หรือปิดสิทธิ์เข้าใช้งาน ยกเว้นหัวหน้าทีมและบัญชีของคุณเอง',
      },
      {
        path: '/members',
        target: ['[data-tour="invite"]'],
        title: 'เพิ่มสมาชิก',
        body: 'เพิ่มคนใหม่เป็นเจ้าหน้าที่หรือผู้ดูแลสมาชิก ส่วนการตั้งหัวหน้าทีมเป็นสิทธิ์ของหัวหน้าทีมเท่านั้น',
      },
      {
        path: '/members',
        target: ['[data-tour="teams"]'],
        title: 'ทีมในองค์กร',
        body: 'เพิ่มหรือแก้ไขทีม แล้วจัดสมาชิกเข้าทีม เจ้าหน้าที่เห็นเฉพาะงานของทีมตัวเอง',
      },
      {
        target: ['.avatar-btn'],
        optional: true,
        title: 'บัญชีของคุณ',
        body: 'ตั้งค่าบัญชี เปลี่ยนรหัสผ่าน และเปิดการยืนยันตัวตน 2 ขั้น อยู่ในเมนูนี้',
      },
      HELP,
    ],
  },
};
