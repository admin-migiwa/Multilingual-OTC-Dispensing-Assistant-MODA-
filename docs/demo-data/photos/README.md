# T12 の確かめ用：架空パッケージの画像

すべて**自作の架空の商品**です（実在の商品・会社とは関係ありません）。HTML で描いて画面を撮りました。
写真の読み取りで、正しい薬が候補のいちばん上に出るかを確かめます（spec.md T12 の完了条件：5枚のうち4枚以上）。

| 画像 | 想定した場面 | 正しい薬（drugs.md） |
| --- | --- | --- |
| p1-box-front.jpg | 箱の正面 | C モダペインS錠 |
| p2-phone-screen.jpg | スマホで見せる通販サイトの画面 | E モダかぜゴールド錠 |
| p3-tilted-box.jpg | 傾いた箱・明朝体・名前が2行 | G モダアイクリア |
| p4-busy-label.jpg | 説明文が多いラベル | H モダシップ |
| p5-glare.jpg | 光の反射・少しぼやけ | F モダいぐすり散 |

確かめ方（`apps/web` で。`.env.local` に `AI_PROVIDER=anthropic` と `ANTHROPIC_API_KEY` が必要）：

```bash
pnpm eval:photos
```
