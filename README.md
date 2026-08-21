# FT Hair Motion Viewer

DIPP-MOTION XYGraphData形式の髪マーカー座標を、研究発表向けの2Dアニメーションとして確認するブラウザアプリです。P1〜P4の発光マーカー、接続線、フェードする軌跡を固定1:1座標系で描画します。

## 必要環境

- Windows 10 / 11
- Node.js 22.13以降（npmを含む）
- Chromium系のモダンブラウザ

## インストールと起動

最も簡単な方法は `run.bat` のダブルクリックです。初回のみ `npm install` を行い、開発サーバーとブラウザを起動します。

手動の場合：

```powershell
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。本番ビルドは `npm run build` です。

## CSV形式

CP932 / Shift-JISのDIPP-MOTION XYGraphDataを読み込みます。ヘッダ行数は固定せず、9列以上かつ先頭列が数値の最初の行をデータ開始行として検出します。

| 列 | 内容 |
|---|---|
| A | Time [s] |
| B–C | P1 X, Y [mm] |
| D–E | P2 X, Y [mm] |
| F–G | P3 X, Y [mm] |
| H–I | P4 X, Y [mm] |

`*`、空欄、NaN、数値変換不能値は欠損として扱います。欠損中は該当マーカー・接続線を描画せず、軌跡も欠損区間を跨いで接続しません。長い欠損を補間することはありません。

## 操作

- `CSVを開く` または画面へのDrag & Dropでファイルを読み込み
- Play / Pause / Restart、タイムラインのドラッグ
- 再生速度 0.1×〜1.0×、Loop ON/OFF
- `LOOP START` / `LOOP END` で繰り返す再生区間を指定（例：0.0〜3.0秒）
- P1〜P4を選び、64段階の青〜シアン〜緑〜黄〜橙カラーパレットから表示色を指定
- 接続線 ON/OFF、軌跡履歴 0.1〜1.0秒
- Low-pass ON/OFF、cutoff 1〜10 Hz
- マーカーのHoverで時刻、XY、頭頂位置を表示

初期状態は表示30 Hz、Low-pass ON、5 Hz、1.0×、Loop ON、接続線ON、履歴0.5秒です。読み込み時に全有効座標から表示範囲を確定し、再生中は変更しません。

## Filter処理

各マーカーの連続した有効区間ごとに、4次Butterworth Low-pass相当の2段biquadを順方向・逆方向に適用してzero-phase化し、その後30 Hzの時刻列へ最近傍リサンプリングします。Filter OFFでは元座標から直接30 Hzへ変換します。欠損区間を跨いだフィルタリングや補間は行いません。

## 頭頂位置 0〜100

XY座標とは別の毛髪上の位置メタデータです。P1=0、P2=51、P3=79、P4=79として保持し、青〜シアン、緑、黄〜オレンジの視覚表現に割り当てています。同じ79のP3とP4は同色です。

## 構成

- `app/HairMotionViewer.tsx` — CSV解析、フィルタ、30 Hz変換、Canvas描画、操作UI
- `app/globals.css` — ダーク研究UIとレスポンシブ表示
- `public/sample/B2_xy.csv` — 実データの起動時サンプル
- `run.bat` — Windows向けワンクリック起動

将来のControl / Treatment同期比較、複数Trial、MP4/GIF export、速度・加速度解析は、データ処理層と描画層を分離して追加できます。
