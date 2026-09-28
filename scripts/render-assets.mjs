import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const executable = process.env.CHROME_BIN ?? (
  process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/google-chrome"
);
if (!existsSync(executable)) {
  throw new Error("Chrome was not found. Set CHROME_BIN to a Chrome or Chromium executable.");
}

const profile = mkdtempSync(join(tmpdir(), "yuya-assets-"));
const chrome = spawn(executable, [
  "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-background-networking", "--disable-component-update", "--disable-sync",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const exited = new Promise((resolve) => {
  chrome.once("exit", resolve);
  chrome.once("error", resolve);
});
let socket;

try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome startup timed out")), 15_000);
    let output = "";
    chrome.once("error", (error) => { clearTimeout(timer); reject(error); });
    chrome.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  socket = new WebSocket(endpoint);
  await once(socket, "open");
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const call = pending.get(message.id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(message.id);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);

  for (const [source, output, width, height] of [
    ["design/social-card.svg", "public/social-card.png", 1200, 630],
    ["public/favicon.svg", "public/favicon.png", 96, 96],
    ["public/favicon.svg", "public/apple-touch-icon.png", 180, 180],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    const navigation = await send("Page.navigate", { url: new URL(source, root).href }, sessionId);
    if (navigation.errorText) throw new Error(navigation.errorText);
    const loaded = await send("Runtime.evaluate", {
      expression: `new Promise(resolve => {
        const ready = () => document.fonts.ready.then(() => requestAnimationFrame(() => resolve(true)));
        if (document.readyState === "complete") ready();
        else addEventListener("load", ready, { once: true });
      })`,
      awaitPromise: true,
    }, sessionId);
    if (loaded.exceptionDetails) throw new Error(JSON.stringify(loaded.exceptionDetails));
    const screenshot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(new URL(output, root), Buffer.from(screenshot.data, "base64"));
    console.log(`${source} -> ${output} (${width} x ${height})`);
  }
} finally {
  socket?.close();
  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill("SIGTERM");
    const timer = setTimeout(() => chrome.kill("SIGKILL"), 2000);
    await exited;
    clearTimeout(timer);
  }
  rmSync(profile, { recursive: true, force: true });
}
