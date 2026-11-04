export {
  EMERGENCY_KEYWORD_LANGUAGES,
  EMERGENCY_KEYWORD_TRANSLATION,
  EMERGENCY_RULES,
  type EmergencyKeywordLanguage,
  type EmergencyRule,
  type KeywordsByLanguage,
} from "./keywords.ts";
export {
  CHILD_MAX_AGE,
  detectEmergency,
  type EmergencyDetectionOptions,
  type EmergencyDetectionResult,
  type EmergencyHit,
} from "./detect.ts";
