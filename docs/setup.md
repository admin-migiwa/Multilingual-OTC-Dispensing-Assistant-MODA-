# 開発の準備と毎回の作業の流れ（開発者向け）

README から移した、開発する人向けの手順です。動かすだけなら [README の「動かし方」](../README.md#動かし方) で足ります。

## はじめての準備（Windows、最初の1回だけ）

1. **Git** をインストールする：https://git-scm.com/download/win
2. **Node.js 22 LTS** をインストールする：https://nodejs.org/
3. **pnpm** を有効にする（PowerShell で実行）：
   ```powershell
   corepack enable
   ```
4. **リポジトリを取り込む**（空のフォルダで実行する）：
   ```powershell
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

GitHub でプルリクエストを作り、自動チェック（緑のチェックマーク）を確認してから main に取り込みます。
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

## Vercel のプレビュー画面について

Vercel で GitHub リポジトリを取り込むときは、次のように設定します。

- **Root Directory**：`apps/web`
- **Framework Preset**：Next.js
- **関数のリージョン**：Tokyo（hnd1）

ただし、ハッカソン版は接客の記録をサーバーのメモリに置いているため、Vercel のように処理ごとに別のサーバーが動く公開先では、記録が引き継がれず流れを最後まで通せません。**デモは1台のサーバー（`pnpm build` → `pnpm --filter @moda/web start`）で動かします**（[backlog.md の S-03](backlog.md)）。Vercel のプレビューは見た目の確認だけに使います。

## 秘密情報について

API キーなどは `apps/web/.env.local` に書き、**絶対にコミットしないでください**（`.gitignore` で除外済み）。
書くべき項目は [`.env.example`](../.env.example) を参照してください。
