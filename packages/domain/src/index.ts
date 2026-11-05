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
export {
  SALES_CATEGORIES,
  SALES_PROCEDURE_VERSIONS,
  selectProcedureVersion,
  classifyPackage,
  checkQuantitySelection,
  buildRequiredProcedure,
  getMissingSteps,
  canApprove,
  canProceedToCheckout,
  assertApprovalAllowed,
  assertCheckoutAllowed,
  type SalesCategory,
  type StepGate,
  type StepCondition,
  type ProcedureStepDefinition,
  type CategoryRule,
  type QuantityNoticeKind,
  type QuantityRules,
  type SalesProcedureVersion,
  type ProcedureDrugInput,
  type PackageSize,
  type PackageClassification,
  type QuantitySelectionResult,
  type DrugSelection,
  type RequiredStep,
  type RequiredProcedure,
} from "./sales-procedure/index.ts";

// 禁忌判定（T4）
export * from "./contraindication/index.ts";
