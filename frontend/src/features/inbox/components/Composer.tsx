'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { filesOf } from '@/components/ui/FileInput';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { AiControls } from '@/features/ai/components/AiControls';
import { AiDraftButton, AiDraftPanel, useAiDraft } from '@/features/ai/components/AiDraft';
import type { AiConversation } from '@/features/ai/types';
import { useMacroMenu } from '@/features/automation';
import { ArticleRead, useArticleActions, type Article } from '@/features/knowledge';
import { FilePills, FileProblem, useFilePills } from '@/features/rich/FilePills';
import { RichTextField, RichToolbar, useRichEditor, type RichEditor } from '@/features/rich/RichEditor';
import { usePreferences, type Snippet } from '@/features/staff-account/prefs';
import { followThread } from '@/features/rich/thread';
import { readFiles } from '@/lib/files';
import { useInvalidate } from '@/lib/query';
import { useTypingNotifier } from '@/lib/realtime-provider';
import { useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { CONVERSATION_PREFIXES, postMessage, postPortalMessage } from '../api';
import { SEND_SHORTCUT } from '../hooks';
import { KnowledgeSearch } from './KnowledgeSearch';
import { MentionMenu } from './MentionMenu';

/* The reply composer (the old composer()): for the team, reply or internal note, formatting, attachments (also by
   dropping files on it), a canned reply, the knowledge search, macros, @mentions and the AI draft; for a customer
   (publicView) a plain text box and attachments. Unsent team text is kept per conversation while moving around the
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
  /** The conversation, for the AI controls in the composer's head (not compact). */
  conversation?: AiConversation | null;
  /** After a message was sent and the conversation refreshed (e.g. the customer chat refreshes its own session). */
  onSent?: () => unknown | Promise<unknown>;
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

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function StaffComposer({ conversationId: id, channel = 'web', manual = false, compact = false, conversation, onSent }: ComposerProps) {
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
  const [kind, setKind] = useState<'reply' | 'note'>(manual ? 'note' : 'reply');
  const [kindChanged, setKindChanged] = useState(false);
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
    // Only a reply in a web chat reaches the customer's screen; an internal note never says anything to them.
    if (kind === 'reply' && !manual && channel === 'web') notifyTyping(value);
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
    const url = `${window.location.origin}/chat/${work.tenant.slug}/faq/${article.id}`;
    return channel === 'web' ? `แนะนำบทความ: [${article.title}](${url})` : `แนะนำบทความ: ${article.title}\n${url}`;
  };

  const openKnowledge = () => {
    const onInsert = (article: Article) => {
      if (!mounted.current) throw new Error('กรุณาเปิดบทสนทนาก่อน');
      closeModal(true);
      void insert(article.body);
      toast('แทรกเนื้อหาในช่องร่างแล้ว กรุณาตรวจสอบก่อนส่ง');
    };
    const onRead = (article: Article) =>
      openModal(
        article.title,
        <ArticleRead
          article={article}
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

  // The member's own quick replies (ตั้งค่าบัญชี → คำตอบด่วน): "/คีย์ลัด" then a space or Tab, Alt+1 … Alt+9, or the list.
  const snippets = usePreferences().data?.preferences.snippets;
  useSnippetKeys(editor, snippets);
  const openReplies = () =>
    openModal(
      'คำตอบสำเร็จรูป',
      <QuickReplies
        canned={String(work.settings.canned_reply ?? '')}
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
        await postMessage(id, { kind: sent, body: values.body ?? '', attachments });
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
        await onSent?.();
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
      <FilePills files={pills.files} onRemove={pills.remove} />
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

/** "/คีย์ลัด" then a space or Tab turns into the quick reply; Alt+1 … Alt+9 put in the first nine where the cursor is. */
function useSnippetKeys(editor: RichEditor, snippets: Snippet[] | undefined) {
  useEffect(() => {
    const area = editor.element();
    if (!area || !snippets?.length) return;
    const onKey = (event: KeyboardEvent) => {
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (event.altKey && !event.ctrlKey && !event.metaKey && digit) {
        const snippet = snippets[Number(digit[1]) - 1];
        if (!snippet) return;
        event.preventDefault();
        document.execCommand('insertText', false, snippet.text);
        editor.sync();
        return;
      }
      if ((event.key !== ' ' && event.key !== 'Tab') || event.altKey || event.ctrlKey || event.metaKey) return;
      const selection = getSelection();
      const node = selection?.anchorNode;
      if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !area.contains(node)) return;
      const before = (node.textContent ?? '').slice(0, selection.anchorOffset);
      const typed = /(?:^|\s)\/([^\s/]+)$/.exec(before);
      const snippet = typed && snippets.find((s) => s.shortcut === typed[1].toLowerCase());
      if (!typed || !snippet) return;
      event.preventDefault();
      const range = document.createRange();
      range.setStart(node, selection.anchorOffset - typed[1].length - 1);
      range.setEnd(node, selection.anchorOffset);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, snippet.text);
      editor.sync();
    };
    area.addEventListener('keydown', onKey);
    return () => area.removeEventListener('keydown', onKey);
  }, [editor, snippets]);
}

/** The ⚡ list: the organization's canned reply, then the member's own quick replies. */
function QuickReplies({ canned, snippets, onPick }: { canned: string; snippets: Snippet[]; onPick: (text: string) => void }) {
  return (
    <div className="quick-replies">
      {canned && (
        <button type="button" className="quick-reply" onClick={() => onPick(canned)}>
          <strong>คำตอบสำเร็จรูปขององค์กร</strong>
          <span className="muted">{canned}</span>
        </button>
      )}
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

// The text box grows with what is typed (up to the CSS max-height). Set through the DOM (CSSOM), which the
// Content-Security-Policy allows, unlike a style attribute.
function autoGrow(area: HTMLTextAreaElement) {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

function PortalComposer({ conversationId: id, channel = 'web', publicSlug, onSent }: ComposerProps) {
  const toast = useToast();
  const refresh = useInvalidate();
  const pills = useFilePills();
  const drop = useDrop(pills.add);
  const area = useRef<HTMLTextAreaElement>(null);
  const notifyTyping = useTypingNotifier(id);
  const placeholder = 'พิมพ์ข้อความของคุณที่นี่…';
  return (
    <Form
      className={`composer${drop.over ? ' drag-over' : ''}`}
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
        if (area.current) {
          area.current.value = '';
          area.current.style.height = '';
        }
        pills.clear();
        await refresh(`/api/public/${publicSlug}`, '/api/customer/overview');
        followThread(form);
        await onSent?.();
        toast('ส่งข้อความแล้ว');
      }}
    >
      <label className="sr-only" htmlFor={`compose-${id}`}>
        ข้อความ
      </label>
      <textarea
        ref={area}
        id={`compose-${id}`}
        name="body"
        maxLength={channel === 'line' ? 5000 : 20000}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        placeholder={placeholder}
        onInput={(event) => {
          autoGrow(event.currentTarget);
          notifyTyping(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          // Ctrl/⌘+Enter sends.
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <FilePills files={pills.files} onRemove={pills.remove} />
      <div className="composer-bottom">
        <div className="composer-actions">
          <AttachButton id={id} inputRef={pills.inputRef} onChange={pills.onChange} />
          <FileProblem problem={pills.problem} />
        </div>
        <SendButton manual={false} />
      </div>
      <ComposerTip channel={channel} manual={false} />
    </Form>
  );
}
