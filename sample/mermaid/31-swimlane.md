# スイムレーン図

担当ごとの作業と、レーンをまたぐ受け渡しを示します。

```mermaid
swimlane-beta LR
    subgraph 利用者
        request[依頼を送る]
        confirm[結果を確認する]
    end
    subgraph サポート
        triage[依頼を分類する]
        respond[回答を作成する]
    end
    request --> triage
    triage --> respond
    respond --> confirm
```
