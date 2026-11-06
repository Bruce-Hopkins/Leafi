#!/usr/bin/env node
// Records the landing page's hero animation as a GIF.
//
// It loads the page in headless Chrome, pauses every animation, then steps the
// clock one frame at a time and screenshots each step, so no frame is dropped
// however slow the machine. ffmpeg turns the frames into a looping GIF.
//
// Needs google-chrome (or chromium) and ffmpeg on PATH, and the site running:
//   pnpm site:dev            # in one terminal
//   pnpm site:gif            # in another; writes ./hero.gif
//
// Options: --url <page>  --out <file.gif>  --seconds 7.5  --fps 20  --width 960
//          --viewport 1440x900

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5173/agent-automations/" },
    out: { type: "string", default: "hero.gif" },
    seconds: { type: "string", default: "7.5" },
    fps: { type: "string", default: "20" },
    width: { type: "string", default: "960" },
    viewport: { type: "string", default: "1440x900" },
  },
});
const fps = Number(opt.fps);
const seconds = Number(opt.seconds);
const outWidth = Number(opt.width);
const [vw, vh] = opt.viewport.split("x").map(Number);
const out = resolve(opt.out);

const fail = (msg) => {
  console.error(`record-gif: ${msg}`);
  process.exit(1);
};

const chromeBin = ["google-chrome", "chromium", "chromium-browser"].find(
  (b) => spawnSync(b, ["--version"], { stdio: "ignore" }).status === 0,
);
if (!chromeBin) fail("needs google-chrome or chromium on PATH");
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) fail("needs ffmpeg on PATH");
try {
  await fetch(opt.url);
} catch {
  fail(`nothing answered at ${opt.url}. Start the site first: pnpm site:dev`);
}

const work = mkdtempSync(join(tmpdir(), "hero-gif-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  chromeBin,
  [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--mute-audio",
    `--remote-debugging-port=${port}`, `--user-data-dir=${join(work, "profile")}`, "about:blank",
  ],
  { stdio: "ignore" },
);
const cleanup = () => {
  chrome.kill();
  rmSync(work, { recursive: true, force: true });
};
process.on("exit", cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60 && !targets; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  } catch {
    await sleep(250);
  }
}
const page = targets?.find((t) => t.type === "page");
if (!page) fail("Chrome did not start");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++nextId;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) fail(`page script failed: ${r.result.exceptionDetails.text}`);
  return r.result?.result?.value;
};

await send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
await send("Page.navigate", { url: opt.url });

// Wait for the fonts and for the diagram to go live, then freeze every animation at 0.
const ready = await evaluate(`(async () => {
  for (let i = 0; i < 100 && !document.querySelector('.flow.is-live'); i++) await new Promise(r => setTimeout(r, 100));
  await document.fonts.ready;
  if (!document.querySelector('.flow.is-live')) return null;
  const anims = document.getAnimations();
  anims.forEach(a => { a.pause(); a.currentTime = 0; });
  // Crop from the top of the page to just under the intro paragraph.
  const lead = document.querySelector('.hero .lead').getBoundingClientRect();
  return { animations: anims.length, height: Math.min(innerHeight, Math.ceil(lead.bottom + 36)) };
})()`);
if (!ready) fail("the hero diagram never started; is this the landing page?");

const frames = Math.round(seconds * fps);
const clip = { x: 0, y: 0, width: vw, height: ready.height, scale: 1 };
process.stderr.write(`recording ${frames} frames (${seconds}s at ${fps} fps), ${vw}x${ready.height}\n`);

for (let i = 0; i < frames; i++) {
  const t = (i * 1000) / fps;
  await evaluate(`(async () => {
    document.getAnimations().forEach(a => { a.currentTime = ${t}; });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
  const shot = await send("Page.captureScreenshot", { format: "png", clip });
  writeFileSync(join(work, `f${String(i).padStart(4, "0")}.png`), Buffer.from(shot.result.data, "base64"));
  if (i % fps === 0) process.stderr.write(".");
}
process.stderr.write("\n");
ws.close();

// One palette for the whole clip, and ordered dithering, which stays still
// from frame to frame (error diffusion makes the dark gradient shimmer).
const filters =
  `scale=${outWidth}:-1:flags=lanczos,split[a][b];` +
  `[a]palettegen=max_colors=192:stats_mode=full[p];` +
  `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
const ff = spawnSync(
  "ffmpeg",
  ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(work, "f%04d.png"), "-vf", filters, "-loop", "0", out],
  { stdio: "inherit" },
);
if (ff.status !== 0) fail("ffmpeg failed");
console.log(out);
