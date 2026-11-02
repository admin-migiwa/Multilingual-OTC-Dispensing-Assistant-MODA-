/**
 * 医療判断・業務ルールに違反したときに投げるエラー。
 * 呼び出し側は code を見て画面表示やログを切り替える。
 * message には健康情報（症状・持病など）を入れないこと。
 */
export class DomainRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainRuleError";
    this.code = code;
  }
}
