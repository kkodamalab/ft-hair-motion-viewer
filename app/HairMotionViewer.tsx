"use client";

import { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Point = { x: number; y: number } | null;
type Frame = { t: number; points: Point[] };
type MotionData = { name: string; raw: Frame[]; duration: number; sampleRate: number; missing: number[] };
type ViewData = MotionData & { frames: Frame[] };

const MARKERS = [
  { name: "P1", position: 0, color: "#29b8ff" },
  { name: "P2", position: 51, color: "#46e39b" },
  { name: "P3", position: 79, color: "#ffc44d" },
  { name: "P4", position: 79, color: "#ffc44d" },
];
const CONNECTIONS = [[0, 1], [1, 2], [1, 3]];

function numberOrNull(value: string) {
  const n = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

export function parseDippCsv(buffer: ArrayBuffer, name: string): MotionData {
  const text = new TextDecoder("shift_jis").decode(buffer).replace(/^\uFEFF/, "");
  const rows = text.split(/\r?\n/).map((line) => line.split(","));
  const start = rows.findIndex((row) => row.length >= 9 && numberOrNull(row[0]) !== null);
  if (start < 0) throw new Error("数値データ行を検出できませんでした。");
  const raw: Frame[] = [];
  const valid = [0, 0, 0, 0];
  for (const row of rows.slice(start)) {
    const t = numberOrNull(row[0]);
    if (t === null) continue;
    const points = MARKERS.map((_, i) => {
      const x = numberOrNull(row[i * 2 + 1] ?? "");
      const y = numberOrNull(row[i * 2 + 2] ?? "");
      if (x === null || y === null) return null;
      valid[i] += 1;
      return { x, y };
    });
    raw.push({ t, points });
  }
  if (raw.length < 2) throw new Error("有効な時系列データが不足しています。");
  const offset = raw[0].t;
  raw.forEach((frame) => { frame.t -= offset; });
  const duration = raw.at(-1)!.t;
  return { name, raw, duration, sampleRate: (raw.length - 1) / duration, missing: valid.map((count) => 1 - count / raw.length) };
}

function biquadLowpass(values: number[], fs: number, cutoff: number, q: number) {
  const w0 = 2 * Math.PI * cutoff / fs, alpha = Math.sin(w0) / (2 * q), cos = Math.cos(w0), a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0, b1 = (1 - cos) / a0, b2 = b0, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
  let x1 = values[0], x2 = values[0], y1 = values[0], y2 = values[0];
  return values.map((x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; });
}

function zeroPhaseFourthOrder(values: number[], fs: number, cutoff: number) {
  if (values.length < Math.max(24, Math.ceil(fs / cutoff))) return values;
  const pass = (v: number[]) => [0.5411961, 1.306563].reduce((a, q) => biquadLowpass(a, fs, cutoff, q), v);
  return pass(pass(values).reverse()).reverse();
}

function filteredRaw(data: MotionData, cutoff: number): Frame[] {
  const clone = data.raw.map((f) => ({ t: f.t, points: f.points.map((p) => p ? { ...p } : null) }));
  for (let marker = 0; marker < 4; marker++) {
    let start = 0;
    while (start < clone.length) {
      while (start < clone.length && !clone[start].points[marker]) start++;
      let end = start;
      while (end < clone.length && clone[end].points[marker]) end++;
      if (end > start) for (const axis of ["x", "y"] as const) {
        const values = clone.slice(start, end).map((f) => f.points[marker]![axis]);
        zeroPhaseFourthOrder(values, data.sampleRate, cutoff).forEach((value, j) => { clone[start + j].points[marker]![axis] = value; });
      }
      start = end + 1;
    }
  }
  return clone;
}

function buildViewData(data: MotionData, useFilter: boolean, cutoff: number): ViewData {
  const source = useFilter ? filteredRaw(data, cutoff) : data.raw;
  const frames: Frame[] = [];
  let index = 0;
  for (let t = 0; t <= data.duration + 1e-6; t += 1 / 30) {
    while (index + 1 < source.length && Math.abs(source[index + 1].t - t) < Math.abs(source[index].t - t)) index++;
    frames.push({ t: Math.min(t, data.duration), points: source[index].points.map((p) => p ? { ...p } : null) });
  }
  return { ...data, frames };
}

export default function HairMotionViewer() {
  const [data, setData] = useState<MotionData | null>(null), [error, setError] = useState("");
  const [filterOn, setFilterOn] = useState(true), [cutoff, setCutoff] = useState(5), [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true), [lines, setLines] = useState(true), [history, setHistory] = useState(.5);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [hovered, setHovered] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null), stageRef = useRef<HTMLDivElement>(null), rafRef = useRef(0), clockRef = useRef(0);
  const viewData = useMemo(() => data ? buildViewData(data, filterOn, cutoff) : null, [data, filterOn, cutoff]);
  const bounds = useMemo(() => {
    if (!data) return { minX: -100, maxX: 100, minY: -380, maxY: 40 };
    const pts = data.raw.flatMap((f) => f.points.filter(Boolean) as { x: number; y: number }[]);
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const pad = Math.max(maxX - minX, maxY - minY, 1) * .1;
    return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
  }, [data]);
  const loadBuffer = useCallback((buffer: ArrayBuffer, name: string) => {
    try { setData(parseDippCsv(buffer, name)); setTime(0); setPlaying(false); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "CSVを読み込めませんでした。"); }
  }, []);
  useEffect(() => { fetch("/sample/B2_xy.csv").then((r) => r.arrayBuffer()).then((b) => loadBuffer(b, "B2_xy.csv")).catch(() => setError("サンプルCSVを読み込めませんでした。")); }, [loadBuffer]);
  useEffect(() => {
    if (!playing || !viewData) return;
    clockRef.current = performance.now();
    const tick = (now: number) => { const dt = (now - clockRef.current) / 1000 * speed; clockRef.current = now; setTime((current) => { const next = current + dt; if (next <= viewData.duration) return next; if (loop) return next % viewData.duration; setPlaying(false); return viewData.duration; }); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick); return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, loop, viewData]);
  const draw = useCallback(() => {
    const canvas = canvasRef.current, stage = stageRef.current; if (!canvas || !stage || !viewData) return;
    const dpr = devicePixelRatio || 1, rect = stage.getBoundingClientRect();
    if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) { canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr); }
    const ctx = canvas.getContext("2d")!, w = rect.width, h = rect.height, pad = 50; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const scale = Math.min((w - pad * 2) / (bounds.maxX - bounds.minX), (h - pad * 2) / (bounds.maxY - bounds.minY)), ox = (w - (bounds.maxX - bounds.minX) * scale) / 2, oy = (h - (bounds.maxY - bounds.minY) * scale) / 2;
    const map = (p: { x: number; y: number }) => ({ x: ox + (p.x - bounds.minX) * scale, y: h - oy - (p.y - bounds.minY) * scale });
    ctx.strokeStyle = "rgba(126,166,202,.11)"; ctx.lineWidth = 1;
    for (let x = Math.ceil(bounds.minX / 50) * 50; x <= bounds.maxX; x += 50) { const px = map({ x, y: 0 }).x; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); }
    for (let y = Math.ceil(bounds.minY / 50) * 50; y <= bounds.maxY; y += 50) { const py = map({ x: 0, y }).y; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke(); }
    ctx.strokeStyle = "rgba(178,212,238,.22)";
    if (bounds.minX <= 0 && bounds.maxX >= 0) { const x = map({ x: 0, y: 0 }).x; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    if (bounds.minY <= 0 && bounds.maxY >= 0) { const y = map({ x: 0, y: 0 }).y; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const currentIndex = Math.min(viewData.frames.length - 1, Math.round(time * 30)), current = viewData.frames[currentIndex], trailFrames = Math.round(history * 30);
    MARKERS.forEach((marker, m) => { let open = false; for (let i = Math.max(0, currentIndex - trailFrames); i <= currentIndex; i++) { const p = viewData.frames[i].points[m]; if (!p) { open = false; continue; } const q = map(p), alpha = (i - (currentIndex - trailFrames)) / Math.max(1, trailFrames); if (!open) { ctx.beginPath(); ctx.moveTo(q.x, q.y); open = true; } else ctx.lineTo(q.x, q.y); ctx.strokeStyle = marker.color; ctx.globalAlpha = .08 + alpha * .5; ctx.lineWidth = 1 + alpha * 2; ctx.stroke(); ctx.beginPath(); ctx.moveTo(q.x, q.y); } ctx.globalAlpha = 1; });
    if (lines) { ctx.strokeStyle = "rgba(218,242,255,.64)"; ctx.lineWidth = 1.5; ctx.shadowColor = "#7acfff"; ctx.shadowBlur = 7; CONNECTIONS.forEach(([a, b]) => { const pa = current.points[a], pb = current.points[b]; if (!pa || !pb) return; const x = map(pa), y = map(pb); ctx.beginPath(); ctx.moveTo(x.x, x.y); ctx.lineTo(y.x, y.y); ctx.stroke(); }); ctx.shadowBlur = 0; }
    current.points.forEach((p, i) => { if (!p) return; const q = map(p), color = MARKERS[i].color, r = hovered === i ? 10 : 8, glow = ctx.createRadialGradient(q.x, q.y, r, q.x, q.y, r * 3.6); glow.addColorStop(0, `${color}bb`); glow.addColorStop(1, "transparent"); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(q.x, q.y, r * 3.6, 0, Math.PI * 2); ctx.fill(); const ball = ctx.createRadialGradient(q.x - r * .35, q.y - r * .45, 1, q.x, q.y, r); ball.addColorStop(0, "#fff"); ball.addColorStop(.18, color); ball.addColorStop(1, "#08131d"); ctx.fillStyle = ball; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill(); ctx.font = "600 12px Arial"; ctx.fillStyle = "rgba(238,248,255,.9)"; ctx.fillText(MARKERS[i].name, q.x + 14, q.y - 11); });
  }, [viewData, bounds, time, history, lines, hovered]);
  useEffect(() => { draw(); const resize = new ResizeObserver(draw); if (stageRef.current) resize.observe(stageRef.current); return () => resize.disconnect(); }, [draw]);
  const hitMarker = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!viewData || !canvasRef.current) return setHovered(null);
    const rect = canvasRef.current.getBoundingClientRect(), w = rect.width, h = rect.height, pad = 50, scale = Math.min((w - pad * 2) / (bounds.maxX - bounds.minX), (h - pad * 2) / (bounds.maxY - bounds.minY)), ox = (w - (bounds.maxX - bounds.minX) * scale) / 2, oy = (h - (bounds.maxY - bounds.minY) * scale) / 2, frame = viewData.frames[Math.min(viewData.frames.length - 1, Math.round(time * 30))];
    const found = frame.points.findIndex((p) => p && Math.hypot(event.clientX - rect.left - (ox + (p.x - bounds.minX) * scale), event.clientY - rect.top - (h - oy - (p.y - bounds.minY) * scale)) < 18); setHovered(found >= 0 ? found : null);
  };
  const openFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) file.arrayBuffer().then((b) => loadBuffer(b, file.name)); };
  const drop = (event: DragEvent) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) file.arrayBuffer().then((b) => loadBuffer(b, file.name)); };
  const currentPoint = hovered !== null && viewData ? viewData.frames[Math.min(viewData.frames.length - 1, Math.round(time * 30))].points[hovered] : null;
  return <main className="app-shell" onDragOver={(e) => e.preventDefault()} onDrop={drop}>
    <header className="topbar"><div><p className="eyebrow">FINE TODAY × DIPP-MOTION</p><h1>Hair Motion Viewer</h1></div><label className="file-button"><input type="file" accept=".csv,text/csv" onChange={openFile} />CSVを開く</label></header>
    <section className="workspace"><aside className="sidebar">
      <div className="file-card"><span className="status-dot" /><div><small>ACTIVE DATASET</small><strong>{data?.name ?? "Loading…"}</strong></div></div>
      {data && <div className="stats"><div><span>SAMPLE RATE</span><b>{data.sampleRate.toFixed(1)} Hz</b></div><div><span>DURATION</span><b>{data.duration.toFixed(2)} s</b></div></div>}
      <Control label="LOW-PASS" value={filterOn ? "ON" : "OFF"}><button className={`switch ${filterOn ? "on" : ""}`} onClick={() => setFilterOn((v) => !v)} aria-label="Low-pass filter"><i /></button></Control>
      <Range label="CUTOFF" value={`${cutoff} Hz`} min={1} max={10} step={1} current={cutoff} onChange={setCutoff} disabled={!filterOn} />
      <Range label="SPEED" value={`${speed.toFixed(1)}×`} min={.1} max={1} step={.1} current={speed} onChange={setSpeed} /><Range label="HISTORY" value={`${history.toFixed(1)} s`} min={.1} max={1} step={.1} current={history} onChange={setHistory} />
      <Control label="LOOP" value={loop ? "ON" : "OFF"}><button className={`switch ${loop ? "on" : ""}`} onClick={() => setLoop((v) => !v)} aria-label="Loop playback"><i /></button></Control><Control label="CONNECTIONS" value={lines ? "ON" : "OFF"}><button className={`switch ${lines ? "on" : ""}`} onClick={() => setLines((v) => !v)} aria-label="Connection lines"><i /></button></Control>
      {data && <div className="quality"><small>MISSING RATE</small>{MARKERS.map((m, i) => <div key={m.name}><span style={{ color: m.color }}>{m.name}</span><b>{(data.missing[i] * 100).toFixed(2)}%</b></div>)}</div>}
    </aside><section className="viewer-panel"><div className="viewer-head"><div><span className="live-dot" /> MOTION SPACE <small>XY · mm · 1:1</small></div><span>DISPLAY 30 Hz</span></div>
      <div className="stage" ref={stageRef}><canvas ref={canvasRef} onPointerMove={hitMarker} onPointerLeave={() => setHovered(null)} />{!data && !error && <div className="empty">Loading sample data…</div>}{error && <div className="empty error">{error}<small>CSVをここへドロップしてください</small></div>}{hovered !== null && currentPoint && <div className="tooltip"><b>{MARKERS[hovered].name}</b><span>Time <em>{time.toFixed(2)} s</em></span><span>X <em>{currentPoint.x.toFixed(2)} mm</em></span><span>Y <em>{currentPoint.y.toFixed(2)} mm</em></span><span>Scalp position <em>{MARKERS[hovered].position} / 100</em></span></div>}</div>
      <div className="transport"><div className="buttons"><button onClick={() => setPlaying((v) => !v)} aria-label={playing ? "Pause" : "Play"}>{playing ? "Ⅱ" : "▶"}</button><button onClick={() => { setPlaying(false); setTime(0); }} aria-label="Restart">↺</button></div><div className="timeline"><input aria-label="Timeline" type="range" min={0} max={data?.duration ?? 1} step={.001} value={time} onChange={(e) => setTime(Number(e.target.value))} style={{ "--progress": `${data ? time / data.duration * 100 : 0}%` } as React.CSSProperties} /><div><span>{time.toFixed(2)} s</span><span>{(data?.duration ?? 0).toFixed(2)} s</span></div></div><div className="speed-pill">{speed.toFixed(1)}×</div></div>
    </section></section>
  </main>;
}

function Control({ label, value, children }: { label: string; value: string; children: React.ReactNode }) { return <div className="control-row"><div><small>{label}</small><b>{value}</b></div>{children}</div>; }
function Range({ label, value, min, max, step, current, onChange, disabled }: { label: string; value: string; min: number; max: number; step: number; current: number; onChange: (n: number) => void; disabled?: boolean }) { return <div className={`range-control ${disabled ? "disabled" : ""}`}><div><small>{label}</small><b>{value}</b></div><input aria-label={label} type="range" min={min} max={max} step={step} value={current} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} /></div>; }
