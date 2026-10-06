/* What other features use from the inbox: the message thread, the composer, the notes filter and the helpers
   around a conversation (the case screen and the customer's chat are built from these). */

export { Composer, type ComposerProps } from './components/Composer';
export { Messages, MessageThread, ThreadFilter, type ManageMessage } from './components/MessageThread';
export { PinnedButton } from './components/PinnedMessages';
export { KnowledgeSearch } from './components/KnowledgeSearch';
export { MentionMenu } from './components/MentionMenu';
export { needsReply, SEND_SHORTCUT, useMarkMentionsSeen, useModalOpen, useSinglePane } from './hooks';
export {
  CONVERSATION_PREFIXES,
  conversationPath,
  markMentionsRead,
  openTicketFromConversation,
  pinMessage,
  postMessage,
  postPortalMessage,
  setConversationStatus,
} from './api';
export type * from './types';
