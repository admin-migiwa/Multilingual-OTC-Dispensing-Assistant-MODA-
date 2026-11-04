# MODA（Multilingual OTC Dispensing Assistant）

外国人の患者さんが母国語で市販薬を購入でき、薬剤師が薬機法上の手順を漏れなく守れるようにする、店頭の iPad 用 Web アプリです。

> **言語の壁をなくす接客支援ツールです。AI は助言しません。** AI は問診の聞き取りと翻訳を手伝うだけで、薬の候補・禁忌の判定・販売してよいかの判断は、すべて薬剤師が行います。
> このリポジトリはハッカソン提出版で、**薬も患者さんもすべて架空のデータ**です（[`docs/demo-data/`](docs/demo-data/README.md)）。

- 設計方針：[`docs/design.md`](docs/design.md)
- Claude への指示書（開発ルール）：[`CLAUDE.md`](CLAUDE.md)

## 構成

```
apps/web          画面とサーバー（Next.js）
packages/domain   医療判断のルール（状態遷移・禁忌判定・販売手順など）とテスト
packages/i18n     対応言語の一元管理
docs/             設計書
```

## はじめての準備（Windows、最初の1回だけ）

1. **Git** をインストールする：https://git-scm.com/download/win
2. **Node.js 22 LTS** をインストールする：https://nodejs.org/
3. **pnpm** を有効にする（PowerShell で実行）：
   ```powershell
   corepack enable
   ```
4. **リポジトリを取り込む**（`C:\dev\MODA` が空のフォルダであること）：
   ```powershell
   cd C:\dev\MODA
   git clone https://github.com/admin-migiwa/Multilingual-OTC-Dispensing-Assistant-MODA-.git .
   ```
5. **依存パッケージを入れる**：
   ```powershell
   pnpm install
   ```
6. **動作確認**：
   ```powershell
   pnpm check   # 型チェック・書き方チェック・テスト
   pnpm dev     # http://localhost:3000 を開くと言語選択画面が出る
   ```

## 毎回の作業の流れ

```powershell
git checkout main
git pull                          # 最新を取り込む
git checkout -b feature/作業名     # 作業用のブランチを作る
# … Claude に1タスクずつ指示する …
pnpm check                        # 確認
git push -u origin feature/作業名  # GitHub に送る
```

GitHub でプルリクエストを作り、自動チェック（緑のチェックマーク）と Vercel のプレビュー画面を確認してから main に取り込みます。
ブランチの作成・コミット・プルリクエストは、Claude に「ブランチを切って」「プルリクエストを作って」と頼めば行ってくれます。

## コマンド一覧

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | 開発サーバーを起動 |
| `pnpm test` | テスト |
| `pnpm typecheck` | 型チェック |
| `pnpm lint` | コードの書き方のチェック |
| `pnpm check` | 上の3つをまとめて実行 |
| `pnpm build` | 本番用ビルド |

## Vercel の設定（プレビュー画面を使うとき）

Vercel で GitHub リポジトリを取り込み、次のように設定します。

- **Root Directory**：`apps/web`
- **Framework Preset**：Next.js
- **関数のリージョン**：Tokyo（hnd1）

## 秘密情報について

API キーなどは `.env.local` に書き、**絶対にコミットしないでください**（`.gitignore` で除外済み）。
書くべき項目は [`.env.example`](.env.example) を参照してください。
