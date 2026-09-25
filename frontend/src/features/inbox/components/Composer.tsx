'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { filesOf } from '@/components/ui/FileInput';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { AiControls } from '@/features/ai/components/AiControls';
import { languageName } from '@/features/ai/languages';
import { AiDraftButton, AiDraftPanel, useAiDraft } from '@/features/ai/components/AiDraft';
import type { AiConversation } from '@/features/ai/types';
import { useMacroMenu } from '@/features/automation';
import { ArticleRead, useArticleActions, type Article } from '@/features/knowledge';
import { FilePills, FileProblem, useFilePills } from '@/features/rich/FilePills';
import { RichTextField, RichToolbar, useRichEditor } from '@/features/rich/RichEditor';
import { CUSTOMER_TOOLS } from '@/features/rich/RichTextArea';
import { usePreferences, type Snippet } from '@/features/staff-account/prefs';
import { followThread } from '@/features/rich/thread';
import { readFiles } from '@/lib/files';
import { channelIcons, channelNames } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useTypingNotifier } from '@/lib/realtime-provider';
import { useWork } from '@/lib/session';
import type { TeamSnippet } from '@/lib/types';
import { useUiState } from '@/lib/ui-state';
import { CONVERSATION_PREFIXES, postMessage, postPortalMessage } from '../api';
import { SEND_SHORTCUT } from '../hooks';
import { KnowledgeSearch } from './KnowledgeSearch';
import { MentionMenu } from './MentionMenu';
import { useSnippets } from './SnippetSuggest';

/* The reply composer (the old composer()): for the team, reply or internal note, formatting, attachments (also by
   dropping files on it), a canned reply, the knowledge search, macros, @mentions and the AI draft; for a customer
   (publicView) a text box with simple formatting (CUSTOMER_TOOLS) and attachments. Unsent team text is kept per conversation while moving around the
   app. Markup: pages/inbox/composer, file-pill. While live updates are connected, typing a reply the customer will see
   tells them "กำลังพิมพ์…" (never while writing an internal note). */

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.txt';

export type ComposerProps = {
  conversationId: string;
  /** The conversation's channel: LINE limits replies to 5,000 characters and says how files arrive. */
  channel?: string;
  /** A case recorded by the team (channel "manual"): internal notes only. */
  manual?: boolean;
  /** Inside the inbox, whose header already has the AI controls. */
  compact?: boolean;
  /** The customer's composer in their chat. */
  publicView?: boolean;
  /** publicView: the organization whose portal receives the message. */
  publicSlug?: string;
  /** The team's composer: who the reply goes to and the case it belongs to, for the bar above the box. */
  recipient?: string;
  caseNumber?: number | null;
  /** The team's composer: the customer's language (ISO 639-1) when a Thai reply is translated into it before it goes
      (ai/translate.py); absent when replies go as typed. */
  translateTo?: string | null;
  /** The conversation, for the AI controls in the composer's head (not compact). */
  conversation?: AiConversation | null;
  /** publicView: filled with a way to put text into the draft, so the page around the box can hand it something
      (the answer a customer was reading beside the chat). Empty while no composer is on the screen. */
  insertRef?: RefObject<((text: string) => void) | null>;
  /** publicView: what to show above the box for what is being typed (the customer chats offer matching answers). */
  suggest?: (text: string) => ReactNode;
  /** After a message was sent and the conversation refreshed (e.g. the customer chat refreshes its own session), with
      what was sent. */
  onSent?: (kind?: 'reply' | 'note') => unknown | Promise<unknown>;
  /** The team's composer: the thread shows internal notes only (ThreadFilter), so what is written is a note. */
  notesOnly?: boolean;
};

export function Composer(props: ComposerProps) {
  return props.publicView ? <PortalComposer {...props} /> : <TeamComposer {...props} />;
}

/* A platform admin looking in on support access answers nobody: the box is not there (the server refuses it too). */
function TeamComposer(props: ComposerProps) {
  const work = useWork();
  if (work.read_only)
    return (
      <p className="notice read-only-composer" role="note">
        <Icon name="lock" />
        ดูอย่างเดียว · ผู้ดูแลแพลตฟอร์มไม่ตอบลูกค้าและไม่บันทึกในบทสนทนาขององค์กร
      </p>
    );
  return <StaffComposer {...props} />;
}

/* Files dropped anywhere on the form join the chosen ones. */
function useDrop(add: (files: FileList) => void) {
  const [over, setOver] = useState(false);
  const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent<HTMLFormElement>) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(true);
      },
      onDragLeave: (event: DragEvent<HTMLFormElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent<HTMLFormElement>) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(false);
        if (event.dataTransfer.files.length) add(event.dataTransfer.files);
      },
    },
  };
}

function AttachButton({ id, inputRef, onChange }: { id: string; inputRef: RefObject<HTMLInputElement | null>; onChange: () => void }) {
  return (
    <>
      <input
        ref={inputRef}
        id={`files-${id}`}
        className="attach-input"
        type="file"
        name="files"
        multiple
        accept={ACCEPT}
        data-file-ready="1"
        aria-label="แนบไฟล์ สูงสุด 3 ไฟล์ รวม 5 MB"
        onChange={onChange}
      />
      <label className="tool-btn" htmlFor={`files-${id}`} title="แนบไฟล์ หรือลากไฟล์มาวางในกล่องข้อความ">
        <Icon name="paperclip" />
        <span>แนบไฟล์</span>
      </label>
    </>
  );
}

function ComposerTip({ channel, manual }: { channel: string; manual: boolean }) {
  return (
    <>
      <div className="composer-tip">
        {channel === 'line'
          ? 'LINE: รูปขนาดเล็กแสดงในแชต ไฟล์อื่นเป็นลิงก์ 7 วัน · ต้องตั้งโดเมน HTTPS'
          : 'ลากรูป วิดีโอ หรือเอกสารมาวางได้ · สูงสุด 3 ไฟล์ รวม 5 MB'}
      </div>
      {manual && <p className="tiny muted mt">เคสนี้บันทึกโดยเจ้าหน้าที่ ลูกค้าไม่เห็นเคสนี้ในแชทบนหน้าลูกค้า</p>}
    </>
  );
}

function SendButton({ manual }: { manual: boolean }) {
  return (
    <button className="btn primary composer-send" type="submit" title={`ส่ง (${SEND_SHORTCUT})`}>
      <Icon name="send" />
      <span className="send-reply">{manual ? 'บันทึก' : 'ส่งข้อความ'}</span>
      <span className="send-note">บันทึกภายใน</span>
    </button>
  );
}

/* Words that promise a file. "ไฟล์" inside "โปรไฟล์" is not one. */
const MENTIONS_FILE = /แนบ|ตามเอกสาร|(?<!โปร)ไฟล์|attach/i;

/** Where this message goes, above the box and big enough to read without looking up at the heading: the customer,
    the channel and the case for a reply; for an internal note, that the customer will not see it. */
function Destination({
  kind,
  recipient,
  channel,
  caseNumber,
  translate,
}: {
  kind: 'reply' | 'note';
  recipient?: string;
  channel: string;
  caseNumber?: number | null;
  /** The customer's language and whether this reply is translated into it (the member may send it as typed). */
  translate?: { language: string; on: boolean; set: (on: boolean) => void } | null;
}) {
  const sep = (
    <span className="composer-to-sep" aria-hidden="true">
      |
    </span>
  );
  return (
    <div className={`composer-to${kind === 'note' ? ' is-note' : ''}`}>
      {kind === 'note' ? (
        <span>
          <Icon name="lock" />
          <strong>บันทึกภายใน</strong> ลูกค้าไม่เห็น
        </span>
      ) : (
        <>
          {recipient && (
            <span>
              <Icon name="send" />
              ตอบถึง <strong>{recipient}</strong>
            </span>
          )}
          {recipient && sep}
          <span>
            <Icon name={channelIcons[channel] ?? 'chat'} />
            ทาง <strong>{channelNames[channel] ?? channel}</strong>
          </span>
        </>
      )}
      {caseNumber != null && (
        <>
          {sep}
          <span>
            เคส <strong>BD-{caseNumber}</strong>
          </span>
        </>
      )}
      {kind === 'reply' && translate && (
        <>
          {sep}
          <label className="composer-translate" title="พิมพ์ภาษาไทยได้เลย AI แปลก่อนถึงลูกค้า ปิดเพื่อส่งตามที่พิมพ์">
            <input type="checkbox" className="switch" checked={translate.on} onChange={(e) => translate.set(e.target.checked)} />
            <Icon name="translate" />
            {translate.on ? (
              <span>
                แปลเป็น<strong>{languageName(translate.language)}</strong>ก่อนส่ง
              </span>
            ) : (
              <span>ส่งตามที่พิมพ์ ไม่แปล</span>
            )}
          </label>
        </>
      )}
    </div>
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function StaffComposer({
  conversationId: id,
  channel = 'web',
  manual = false,
  compact = false,
  conversation,
  recipient,
  caseNumber,
  translateTo,
  onSent,
  notesOnly = false,
}: ComposerProps) {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const { openModal, closeModal, openSheet, closeSheet } = useDialogs();
  const openMacros = useMacroMenu();
  const articleActions = useArticleActions();
  const editor = useRichEditor();
  const pills = useFilePills();
  const draft = useAiDraft(id);
  const drop = useDrop(pills.add);
  const [drafts, setDrafts] = useUiState<Record<string, string>>('inbox:drafts', {});
  // The saved draft is where the text box starts; after that the box itself is the truth.
  const [initialDraft] = useState(() => drafts[id] || '');
  const [kind, setKind] = useState<'reply' | 'note'>(manual || notesOnly ? 'note' : 'reply');
  const [kindChanged, setKindChanged] = useState(notesOnly);
  // Reading the notes alone, a member writes a note: a reply typed there went to the customer and vanished from the
  // filtered thread. Turning the filter off brings back what the box was before it.
  const [filtered, setFiltered] = useState({ on: notesOnly, before: kind });
  if (filtered.on !== notesOnly) {
    setFiltered({ on: notesOnly, before: notesOnly ? kind : filtered.before });
    setKind(notesOnly ? 'note' : manual ? 'note' : filtered.before);
    setKindChanged(notesOnly || filtered.before === 'note');
  }
  // What is in the box now, for the warning that a file was promised and none is attached.
  const [text, setText] = useState(initialDraft);
  const forgotFile = MENTIONS_FILE.test(text) && pills.files.length === 0;
  // A Thai reply to a customer who writes another language goes out translated, unless the member turns it off for
  // what they are writing now (back on for the next conversation).
  const [translateOn, setTranslateOn] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const basePlaceholder = manual ? 'บันทึกรายละเอียดการติดตามงาน…' : 'พิมพ์ข้อความของคุณที่นี่…';
  const chooseKind = (next: 'reply' | 'note') => {
    setKind(next);
    setKindChanged(true);
  };

  const keepDraft = useCallback(
    (value: string) =>
      setDrafts((all) => {
        if ((all[id] || '') === value) return all;
        return { ...all, [id]: value };
      }),
    [id, setDrafts],
  );
  const notifyTyping = useTypingNotifier(id);
  const onText = (value: string) => {
    keepDraft(value);
    setText(value);
    // Writing an answer, on any channel: the team hears it so two members do not answer the same customer, and the
    // server passes it on to the customer only where they could see it (a web chat). An internal note is neither.
    if (kind === 'reply' && !manual) notifyTyping(value);
  };

  // Text put into the composer by a tool (an article) appears in the editor and is kept as the draft.
  const insert = async (text: string) => {
    const value = editor.getValue();
    editor.setValue((value.trim() ? value.replace(/\s+$/, '') + '\n\n' : '') + text);
    await nextFrame();
    editor.focus();
  };

  const articleLink = (article: Article) => {
    // A link the customer can open without signing in (the organization's public FAQ page); chat channels get the
    // address on its own line.
    const url = `${window.location.origin}/support/${work.tenant.slug}/faq/${article.id}`;
    return channel === 'web' ? `แนะนำบทความ: [${article.title}](${url})` : `แนะนำบทความ: ${article.title}\n${url}`;
  };

  const openKnowledge = () => {
    const onInsert = (article: Article) => {
      if (!mounted.current) throw new Error('กรุณาเปิดบทสนทนาก่อน');
      closeModal(true);
      void insert(article.body);
      toast('แทรกเนื้อหาในช่องร่างแล้ว กรุณาตรวจสอบก่อนส่ง');
    };
    const onRead = (article: Article, words: string[] = []) =>
      openModal(
        article.title,
        <ArticleRead
          article={article}
          highlight={words}
          onEdit={(a) => articleActions.edit(a)}
          onDelete={articleActions.remove}
          onInsert={(a) => {
            if (!mounted.current) throw new Error('กรุณาเปิดบทสนทนาก่อน');
            const value = editor.getValue();
            editor.setValue(value + (value ? '\n\n' : '') + a.body);
            closeModal();
            void nextFrame().then(() => editor.focus());
            toast('แทรกในช่องร่างแล้ว กรุณาตรวจสอบก่อนส่ง');
          }}
        />,
      );
    openModal(
      'ค้นหาคลังความรู้',
      <KnowledgeSearch
        channel={channel}
        onInsert={onInsert}
        onRead={onRead}
        onSendLink={async (article) => {
          if (!mounted.current) throw new Error('กรุณาเปิดบทสนทนาก่อน');
          await postMessage(id, { kind: 'reply', body: articleLink(article) });
          closeModal(true);
          await refresh(...CONVERSATION_PREFIXES);
          toast(`ส่งลิงก์ “${article.title}” ให้ลูกค้าแล้ว`);
        }}
      />,
      { wide: true },
    );
  };

  const openMentions = () =>
    openSheet(
      'แท็กเพื่อนร่วมทีม',
      <MentionMenu
        onPick={async (name) => {
          closeSheet();
          if (!mounted.current) return;
          // A mention belongs in an internal note: the customer never sees it.
          if (kind !== 'note') chooseKind('note');
          // The editor is inert while the sheet is open: type once it has closed.
          await nextFrame();
          editor.insertText(`@${name} `);
        }}
      />,
    );

  // Prepared replies: the team's (ตั้งค่าองค์กร) and the member's own (ตั้งค่าบัญชี → คำตอบด่วน). Both are reached by
  // typing "/คีย์ลัด" then a space or Tab, or from the ⚡ list; Alt+1 … Alt+9 stay the member's own first nine, which
  // is what ตั้งค่าบัญชี promises. A member's own shortcut wins over a team one of the same name: their own choice.
  const snippets = usePreferences().data?.preferences.snippets;
  const team = work.snippets ?? [];
  // The menu that appears while "/" is being typed is switched per organization in the platform console
  // (platform/model.py FEATURES). Off, the ⚡ list and typing the whole shortcut then a space still work.
  const { menu: snippetMenu } = useSnippets(editor, snippets ?? [], team, work.features?.snippet_menu !== false);
  const openReplies = () =>
    openModal(
      'คำตอบสำเร็จรูป',
      <QuickReplies
        team={team}
        snippets={snippets ?? []}
        onPick={(text) => {
          closeModal(true);
          void insert(text);
        }}
      />,
    );

  const tool = (icon: string, label: string, title: string, onClick: () => void, extra?: Record<string, string>): ReactNode => (
    <button type="button" className="tool-btn" aria-label={title === label ? label : title} title={title} onClick={onClick} {...extra}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );

  return (
    <Form
      className={`composer${compact ? ' composer-compact' : ''}${drop.over ? ' drag-over' : ''}`}
      data-form="message"
      data-conversation={id}
      data-channel={channel}
      {...drop.handlers}
      onSubmit={async (values, form) => {
        const attachments = await readFiles(filesOf(form));
        const sent = (values.kind as 'reply' | 'note') || 'reply';
        await postMessage(id, { kind: sent, body: values.body ?? '', attachments, ...(translateTo ? { translate: translateOn } : {}) });
        followThread(form);
        editor.setValue('');
        setDrafts((all) => {
          const rest = { ...all };
          delete rest[id];
          return rest;
        });
        pills.clear();
        await refresh(...CONVERSATION_PREFIXES);
        followThread(form);
        await onSent?.(sent);
        toast(
          sent === 'note'
            ? 'บันทึกภายในแล้ว'
            : ['line', 'email'].includes(channel)
              ? 'ข้อความเข้าคิวส่งแล้ว ตรวจผลใต้ข้อความได้'
              : 'ข้อความพร้อมอ่านในแชทบนหน้าลูกค้าของลูกค้า',
        );
      }}
    >
      {!compact && (
        <div className="composer-head">
          <div className="flex wrap" data-ai-controls={id}>
            <AiControls conversation={conversation} />
          </div>
        </div>
      )}
      <AiDraftPanel
        draft={draft}
        onUse={(answer) => {
          editor.setValue(answer);
          editor.focus();
          if (!manual) chooseKind('reply');
        }}
      />
      <Destination
        kind={kind}
        recipient={recipient}
        channel={channel}
        caseNumber={caseNumber}
        translate={translateTo ? { language: translateTo, on: translateOn, set: setTranslateOn } : null}
      />
      <label className="sr-only" htmlFor={`compose-${id}`}>
        ข้อความ
      </label>
      <RichTextField
        editor={editor}
        id={`compose-${id}`}
        name="body"
        defaultValue={initialDraft}
        maxLength={channel === 'line' && kind === 'reply' ? 5000 : 20000}
        label="ข้อความ"
        placeholder={`${basePlaceholder} (${SEND_SHORTCUT} เพื่อส่ง)`}
        sourcePlaceholder={kindChanged && kind === 'note' ? 'บันทึกภายใน… ลูกค้าจะไม่เห็นข้อความนี้' : basePlaceholder}
        className="composer-input"
        keyShortcuts="Control+Enter Meta+Enter"
        onChange={onText}
      />
      {snippetMenu}
      <FilePills files={pills.files} onRemove={pills.remove} />
      {forgotFile && (
        <p className="composer-warn" role="status">
          <Icon name="paperclip" />
          ข้อความพูดถึงไฟล์แนบ แต่ยังไม่ได้แนบไฟล์
          <label htmlFor={`files-${id}`}>แนบไฟล์</label>
        </p>
      )}
      <div className="composer-bottom">
        <div className="composer-tabs composer-mode" role="radiogroup" aria-label="ประเภทข้อความ">
          <label>
            <input type="radio" name="kind" value="reply" disabled={manual} checked={kind === 'reply'} onChange={() => chooseKind('reply')} />
            <Icon name="send" />
            ตอบกลับลูกค้า
          </label>
          <label>
            <input type="radio" name="kind" value="note" checked={kind === 'note'} onChange={() => chooseKind('note')} />
            <Icon name="lock" />
            บันทึกภายใน
          </label>
        </div>
        <span className="note-hint">
          <Icon name="lock" />
          ลูกค้าจะไม่เห็นข้อความนี้
        </span>
        <div className="composer-actions">
          <RichToolbar editor={editor} tools={['bold', 'italic', 'bullet', 'link']} label="จัดรูปแบบข้อความ" className="composer-format" role="group" />
          <span className="tool-divider" aria-hidden="true" />
          <AttachButton id={id} inputRef={pills.inputRef} onChange={pills.onChange} />
          {tool('bolt', 'คำตอบสำเร็จรูป', 'แทรกคำตอบสำเร็จรูป หรือพิมพ์ / ตามด้วยคีย์ลัด', openReplies)}
          <button
            type="button"
            className="tool-btn"
            aria-label="ค้นคลังความรู้"
            title="ค้นคลังความรู้ ส่งลิงก์บทความให้ลูกค้าหรือแทรกเนื้อหา"
            onClick={openKnowledge}
          >
            <Icon name="book" />
            <span>ค้นคู่มือ</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            data-kind="conversation"
            data-id={id}
            aria-label="ใช้ Macro"
            title="Macro: ทำหลายขั้นตอนในคลิกเดียว"
            onClick={() => openMacros({ kind: 'conversation', id })}
          >
            <Icon name="macro" />
            <span>Macro</span>
          </button>
          <button type="button" className="tool-btn" aria-label="แท็กเพื่อนร่วมทีม" title="แท็กเพื่อนร่วมทีมในบันทึกภายใน (@) ลูกค้าไม่เห็น" onClick={openMentions}>
            <Icon name="at" />
            <span>แท็กทีม</span>
          </button>
          <AiDraftButton draft={draft} />
          <FileProblem problem={pills.problem} />
        </div>
        <SendButton manual={manual} />
      </div>
      <ComposerTip channel={channel} manual={manual} />
    </Form>
  );
}

/** The ⚡ list: the team's prepared replies, then the member's own. Either is put into the draft to read over and
    change before sending; a Macro is what sends and moves the case on. */
function QuickReplies({ team, snippets, onPick }: { team: TeamSnippet[]; snippets: Snippet[]; onPick: (text: string) => void }) {
  return (
    <div className="quick-replies">
      <p className="tiny muted quick-replies-note">ข้อความจะแทรกในช่องร่าง ตรวจแก้ไขได้ก่อนส่ง</p>
      {team.length > 0 && <p className="quick-replies-head">ของทีม</p>}
      {team.map((snippet) => (
        <button key={snippet.id ?? snippet.shortcut} type="button" className="quick-reply" onClick={() => onPick(snippet.text)}>
          <strong>
            <code>/{snippet.shortcut}</code>
          </strong>
          <span className="muted">{snippet.text}</span>
        </button>
      ))}
      {snippets.length > 0 && <p className="quick-replies-head">ของฉัน</p>}
      {snippets.map((snippet, index) => (
        <button key={snippet.id ?? snippet.shortcut} type="button" className="quick-reply" onClick={() => onPick(snippet.text)}>
          <strong>
            <code>/{snippet.shortcut}</code>
            {index < 9 && <span className="kbd">Alt+{index + 1}</span>}
          </strong>
          <span className="muted">{snippet.text}</span>
        </button>
      ))}
      {!snippets.length && (
        <p className="tiny muted">
          เพิ่มคำตอบด่วนของคุณเองได้ที่ <Link href="/account?tab=replies">ตั้งค่าบัญชี → คำตอบด่วนและคีย์ลัด</Link> แล้วพิมพ์ / ตามด้วยคีย์ลัดในช่องนี้
        </p>
      )}
    </div>
  );
}

function PortalComposer({ conversationId: id, channel = 'web', publicSlug, onSent, insertRef, suggest }: ComposerProps) {
  const toast = useToast();
  const refresh = useInvalidate();
  const editor = useRichEditor();
  const pills = useFilePills();
  const drop = useDrop(pills.add);
  const notifyTyping = useTypingNotifier(id);
  const placeholder = 'พิมพ์ข้อความของคุณที่นี่…';
  // What is in the box now, for the answers offered above it.
  const [text, setText] = useState('');

  // Text handed in from outside joins what is already written, a blank line apart, and the cursor goes there.
  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (text: string) => {
      const value = editor.getValue();
      editor.setValue((value.trim() ? value.replace(/\s+$/, '') + '\n\n' : '') + text);
      void nextFrame().then(() => editor.focus());
    };
    return () => {
      insertRef.current = null;
    };
  }, [editor, insertRef]);

  return (
    <Form
      className={`composer customer-composer${drop.over ? ' drag-over' : ''}`}
      data-form="customer-message"
      data-conversation={id}
      data-channel={channel}
      {...drop.handlers}
      onSubmit={async (values, form) => {
        if (!publicSlug) throw new Error('กรุณาเปิดแชทก่อน');
        const attachments = await readFiles(filesOf(form));
        // The chat this composer belongs to, even when another one was opened while the files were being read.
        await postPortalMessage(publicSlug, id, { body: values.body ?? '', attachments });
        followThread(form);
        editor.setValue('');
        pills.clear();
        await refresh(`/api/public/${publicSlug}`, '/api/customer/overview');
        followThread(form);
        await onSent?.();
        toast('ส่งข้อความแล้ว');
      }}
    >
      {suggest?.(text)}
      <label className="sr-only" htmlFor={`compose-${id}`}>
        ข้อความ
      </label>
      <RichTextField
        editor={editor}
        id={`compose-${id}`}
        name="body"
        maxLength={channel === 'line' ? 5000 : 20000}
        label="ข้อความ"
        placeholder={`${placeholder} (${SEND_SHORTCUT} เพื่อส่ง)`}
        sourcePlaceholder={placeholder}
        className="composer-input"
        keyShortcuts="Control+Enter Meta+Enter"
        onChange={(value) => {
          notifyTyping(value);
          setText(value);
        }}
      />
      <FilePills files={pills.files} onRemove={pills.remove} />
      <div className="composer-bottom">
        <div className="composer-actions">
          <RichToolbar editor={editor} tools={CUSTOMER_TOOLS} label="จัดรูปแบบข้อความ" className="composer-format" role="group" />
          <span className="tool-divider" aria-hidden="true" />
          <AttachButton id={id} inputRef={pills.inputRef} onChange={pills.onChange} />
          <FileProblem problem={pills.problem} />
        </div>
        <SendButton manual={false} />
      </div>
      <ComposerTip channel={channel} manual={false} />
    </Form>
  );
}
