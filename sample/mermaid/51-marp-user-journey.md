---
marp: true
theme: default
paginate: true
---

# Marp: ユーザージャーニー

Marpスライド内でPeleが描画するMermaidサンプルです。

利用者が作業を完了するまでの段階と、各段階の評価を示します。

```mermaid
journey
    title 文書を共有するまで
    section 準備
        文書を作成する: 4: 利用者
        内容を確認する: 3: 利用者, エディター
    section 共有
        PDFを出力する: 4: 利用者, エディター
        相手に送る: 5: 利用者
```
