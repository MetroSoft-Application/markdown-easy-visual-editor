---
marp: true
theme: default
paginate: true
---

# Marp: カンバン

Marpスライド内でPeleが描画するMermaidサンプルです。

作業を列に分け、各項目の状態を示します。

```mermaid
kanban
    todo[未着手]
        read[サンプルを読む]
        choose[図の種類を選ぶ]
    doing[作業中]
        edit[図を編集する]
    done[完了]
        review[表示を確認する]
```
