import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = 3456;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9222;
const OUTPUT_DIR = path.resolve(process.cwd(), "docs/images");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return true;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Server at ${url} did not respond within ${timeoutMs}ms`);
}

async function main() {
  console.log("1. Starting Grid Tile Editor server on port " + PORT + "...");
  const serverProcess = spawn("cmd.exe", ["/c", "npx", "vinext", "start", "--port", String(PORT)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  try {
    await waitForServer(`http://localhost:${PORT}/`);
    console.log("Server ready!");

    console.log("2. Launching headless Chrome...");
    const chromeProcess = spawn(
      CHROME_PATH,
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        "--disable-gpu",
        "--window-size=1600,1000",
        "--hide-scrollbars",
        `http://localhost:${PORT}/`,
      ],
      { stdio: "ignore" }
    );

    try {
      await sleep(2500);
      const targetsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const targets = await targetsRes.json();
      const pageTarget = targets.find((t) => t.type === "page" && t.url.includes(String(PORT)));
      if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
        throw new Error("Could not find page target in Chrome debugger");
      }

      console.log("3. Connecting to CDP via WebSocket...");
      const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", reject, { once: true });
      });

      let idCounter = 1;
      const pending = new Map();
      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      });

      function send(method, params = {}) {
        const id = idCounter++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        });
      }

      async function evaluate(expression) {
        const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        return res?.result?.value;
      }

      async function captureScreenshot(filename) {
        const res = await send("Page.captureScreenshot", { format: "png" });
        const buf = Buffer.from(res.data, "base64");
        const filePath = path.join(OUTPUT_DIR, filename);
        fs.writeFileSync(filePath, buf);
        console.log(`Saved screenshot: ${filePath} (${(buf.length / 1024).toFixed(1)} KB)`);
      }

      await send("Page.enable");
      await send("DOM.enable");
      await send("Emulation.setDeviceMetricsOverride", {
        width: 1600,
        height: 1000,
        deviceScaleFactor: 1.5,
        mobile: false,
      });

      await sleep(2000);

      // -------------------------------------------------------------
      // Shot 1: Main Editor View
      // -------------------------------------------------------------
      console.log("Capturing Shot 1: Main Editor...");
      await captureScreenshot("01-main-editor.png");

      // -------------------------------------------------------------
      // Shot 2: Cell Note Popover
      // -------------------------------------------------------------
      const canvasPos = await evaluate(`
        (() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return null;
          const rect = canvas.getBoundingClientRect();
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        })()
      `);

      if (canvasPos) {
        const clickX = Math.round(canvasPos.left + 6 * 22 + 11);
        const clickY = Math.round(canvasPos.top + 4 * 22 + 11);
        console.log("Right clicking at cell C1101:", clickX, clickY);

        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: clickX,
          y: clickY,
          button: "right",
          buttons: 2,
          clickCount: 1,
        });
        await sleep(100);
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: clickX,
          y: clickY,
          button: "right",
          buttons: 0,
          clickCount: 1,
        });
        await sleep(800);

        console.log("Capturing Shot 2: Cell Note Popover...");
        await captureScreenshot("02-cell-inspector.png");

        // Close popover with Esc
        await evaluate(`
          (() => {
            const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '닫기');
            if (closeBtn) closeBtn.click();
          })()
        `);
        await sleep(500);
      }

      // -------------------------------------------------------------
      // Shot 3: Layer Management UI
      // -------------------------------------------------------------
      console.log("Setting up Shot 3: Layer Management...");
      await evaluate(`
        (() => {
          const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('레이어 추가'));
          if (addBtn) addBtn.click();
        })()
      `);
      await sleep(800);
      await captureScreenshot("03-layer-controls.png");

      // Cancel layer add
      await evaluate(`
        (() => {
          const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '취소');
          if (cancelBtn) cancelBtn.click();
        })()
      `);
      await sleep(500);

      // -------------------------------------------------------------
      // Shot 4: Print Split Sheet Guide
      // -------------------------------------------------------------
      console.log("Setting up Shot 4: Print Split Sheet Guide...");
      await evaluate(`
        (() => {
          const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
          for (const cb of checkboxes) {
            const label = cb.closest('label');
            if (label && label.textContent && (label.textContent.includes('인쇄') || label.textContent.includes('경계선'))) {
              if (!cb.checked) cb.click();
            }
          }
        })()
      `);
      await sleep(1000);
      await captureScreenshot("04-print-split-sheet.png");

      ws.close();
      console.log("All screenshots captured successfully!");
    } finally {
      chromeProcess.kill();
    }
  } finally {
    serverProcess.kill();
  }
}

main().catch(console.error);
