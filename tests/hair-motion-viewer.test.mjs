import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server renders the Hair Motion Viewer shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Hair Motion Viewer<\/title>/i);
  assert.match(html, /Hair Motion Viewer/);
  assert.match(html, /CSVを開く/);
});

test("client includes required data safeguards and controls", async () => {
  const source = await readFile(new URL("../app/HairMotionViewer.tsx", import.meta.url), "utf8");
  assert.match(source, /TextDecoder\("shift_jis"\)/);
  assert.match(source, /zeroPhaseFourthOrder/);
  assert.match(source, /t \+= 1 \/ 30/);
  assert.match(source, /if \(!p\) \{ open = false; continue; \}/);
  for (const label of ["Low-pass filter", "Loop playback", "Connection lines", "Timeline", "Restart"]) assert.match(source, new RegExp(label));
});
