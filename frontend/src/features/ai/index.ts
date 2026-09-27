/* What other features use from the AI module: the conversation controls, the draft button and panel, the sources
   list, the customer's status line, the settings panel and the words for why an assistant's answer was not liked. */

export { AiControls, useWorkspaceAi } from './components/AiControls';
export { AiDraftButton, AiDraftPanel, useAiDraft, type AiDraft, type AiDraftView } from './components/AiDraft';
export { AiCitations } from './components/AiCitations';
export { AiPortalStatus } from './components/AiPortalStatus';
export { AiSettingsPanel } from './components/AiSettingsPanel';
export { feedbackReasonLabels } from './components/AnswerRating';
export { AI_SETTINGS_PATH, getAiJob, portalHandoff, requestAiDraft, saveAiSettings, setAiMode, testAiConnection, waitForAiJob } from './api';
export type * from './types';
