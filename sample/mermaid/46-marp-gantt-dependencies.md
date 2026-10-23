---
marp: true
theme: default
paginate: true
---

# Marp: ガントチャートの依存関係

Marpスライド内でPeleが描画するMermaidサンプルです。

並行タスク、クリティカルタスク、マイルストーンを示します。

```mermaid
gantt
    title 文書公開までの作業
    dateFormat YYYY-MM-DD
    excludes weekends
    section 内容
        原稿作成 :crit, draft, 2026-10-05, 6d
        技術確認 :crit, review, after draft, 4d
        表記確認 :proof, after draft, 3d
    section 配信準備
        サイト準備 :site, 2026-10-05, 8d
        公開判定 :milestone, gate, after review, 0d
        公開 :milestone, launch, after gate, 0d
```
