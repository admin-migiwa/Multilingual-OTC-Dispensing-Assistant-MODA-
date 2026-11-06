// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/next-env.d.ts",
      // デモ動画の場面の部品。HTML に差し込んで使うため、単独ではチェックできない
      "video/scenes/**",
      // Claude Code の作業用フォルダ（ほかのセッションのワークツリーなど）。リポジトリのコードではない
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 健康情報がログに出るのを防ぐため、console.log は原則禁止（警告・エラーのみ許可）
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // デモ動画の書き出し用（Node.js で動かし、一部はブラウザの中で実行する）。アプリ本体とは別
    files: ["video/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", Buffer: "readonly", window: "readonly", document: "readonly" },
    },
  },
);
