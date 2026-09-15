/* What other features use from automation: the macro buttons and menu, follow-ups, the CSAT result, escalation rows,
   and the words and sentences built from them. */

export { EscalationRow } from './components/EscalationRow';
export { MacroButtons, MacroMenu, useMacroMenu, useMacros, useRunMacro } from './components/MacroButtons';
export { FollowupItem, FollowupsPanel, useFinishFollowup } from './components/FollowupsPanel';
export { SurveySummary } from './components/SurveySummary';
export {
  followupChoices,
  followupState,
  hoursLabel,
  macroResultLabels,
  macroResultText,
  macroStatusLabels,
  macroSteps,
  ruleChannelLabels,
  ruleCondition,
} from './labels';
export { addFollowup, finishFollowup, runMacro, FOLLOWUP_PREFIXES, MACRO_RUN_PREFIXES } from './api';
export type * from './types';
