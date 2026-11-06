export { DomainRuleError } from "./errors.ts";
export {
  SESSION_STATUSES,
  TERMINAL_STATUSES,
  POST_APPROVAL_STATUSES,
  isTerminal,
  isPostApproval,
  transition,
  assertActionAllowed,
  type SessionStatus,
  type SessionSnapshot,
  type PostApprovalAction,
} from "./session/state.ts";

// 禁忌判定（T4）
export * from "./contraindication/index.ts";
