# 公開 URL を作る（Render）

ハッカソンに提出する公開 URL を、Render の無料の枠で作る手順です。プログラムは変えず、リポジトリの `render.yaml` の設定で動かします。

## なぜ Render か

- このアプリは、接客の記録をサーバーのメモリに置いています（データベースを使わない。backlog S-03）。サーバーが**1台だけずっと動く**ところに置く必要があります。
- Vercel などの「処理ごとに別のサーバーが動く」公開先では、記録が途中で消えます。
- Render なら、固定の URL（`https://〇〇.onrender.com`）が無料でもらえ、プログラムを変えずに動きます。

## 知っておくこと

- 無料の枠では、15分ほど使わないとサーバーが眠ります。次に開いたときに起きるまで1分ほどかかり、**それまでの接客の記録・販売記録は消えます**。デモは毎回新しい接客から始めるので、困らない想定です。審査の前に一度開いて起こしておくと安心です。
- URL を知っている人は誰でも開けます。データは架空のものだけです。
- URL の名前（`〇〇.onrender.com` の〇〇）に、勤務先や店舗の名前を入れないでください（CLAUDE.md）。

## 手順（依頼主がすること）

1. https://render.com で「Get Started」→ **GitHub のアカウントでログイン**する。
2. Render に、このリポジトリを読む許可を出す（GitHub の画面で、このリポジトリだけを選ぶ）。
3. Render の画面で「New」→「**Blueprint**」→ このリポジトリを選ぶ。`render.yaml` が読まれ、`moda-demo` というサービスが出てくる。
4. 秘密の値を入れる画面が出るので、次を入れて「Apply」：
   - `MODA_PHARMACIST_PINS`：`P1:（4〜8桁の数字）,P2:（4〜8桁の数字）`。デモで使う PIN です。手元の `.env.local` と同じでなくてもかまいません。
   - `ANTHROPIC_API_KEY`：仮の AI（`AI_PROVIDER=mock`）のままなら空でよい。
5. 数分でビルドが終わると、`https://moda-demo-xxxx.onrender.com` のような URL が出る。iPad の Safari で開く。
6. うまく動いたら、その URL を提出に使う。

## 本物の AI（Claude）を使うとき

- Render の画面の「Environment」で、`AI_PROVIDER` を `anthropic` に変え、`ANTHROPIC_API_KEY` を入れる（保存すると自動で入れ直される）。
- 公開した URL では他人も AI を使えるので、Anthropic の管理画面で**使う金額の上限**を必ず決めておく。
- デモが終わったら、`AI_PROVIDER` を `mock` に戻すと、お金はかかりません。

## main を更新したとき

- 初期設定では、main に新しいコミットが入るたびに Render が自動で作り直します（作り直すと、メモリの記録は消えます）。
- デモの直前に作り直したくないときは、Render の画面の「Settings」→「Auto-Deploy」を「No」にしておく。
