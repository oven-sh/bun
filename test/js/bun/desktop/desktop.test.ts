import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bun:desktop scaffolding & CLI flags", () => {
  test("bun:desktop and electron modules export core APIs", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--desktop",
        "-e",
        `
        import desktop, { app, BrowserWindow, ipcMain, protocol } from "bun:desktop";
        import electron from "electron";

        if (desktop.app !== electron.app) throw new Error("electron.app mismatch");
        if (!app.isReady()) throw new Error("app.isReady() should be true");
        app.setName("TestDesktopApp");
        if (app.getName() !== "TestDesktopApp") throw new Error("app.getName() mismatch");
        if (!app.getPath("temp")) throw new Error("app.getPath('temp') empty");

        const win = new BrowserWindow({ width: 1024, height: 768, title: "Hello Desktop" });
        if (win.id < 1) throw new Error("invalid window id");
        if (win.getTitle() !== "Hello Desktop") throw new Error("title mismatch");
        win.setTitle("Updated");
        if (win.getTitle() !== "Updated") throw new Error("setTitle mismatch");
        if (win.getSize()[0] !== 1024 || win.getSize()[1] !== 768) throw new Error("getSize mismatch");
        win.setSize(640, 480);
        if (win.getSize()[0] !== 640 || win.getSize()[1] !== 480) throw new Error("setSize mismatch");

        ipcMain.handle("ping", () => "pong");
        ipcMain.removeHandler("ping");

        protocol.handle("app", () => new Response("ok"));
        if (!protocol.isProtocolHandled("app")) throw new Error("protocol should be handled");
        protocol.unhandle("app");
        if (protocol.isProtocolHandled("app")) throw new Error("protocol should be unhandled");

        win.close();
        if (BrowserWindow.getAllWindows().length !== 0) throw new Error("window not removed on close");
        console.log("OK");
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr.replace(/^DEBUG: Reloading\.\.\.\r?\n/gm, "")).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });

  test("bun build --desktop without --compile errors", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--desktop", "nonexistent.ts"],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("--desktop in bun build requires --compile");
    expect(exitCode).not.toBe(0);
  });

  test.if(process.platform === "darwin")("BrowserWindow loadURL and bidirectional IPC roundtrip", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--desktop",
        "-e",
        `
        import { BrowserWindow, ipcMain } from "bun:desktop";

        const win = new BrowserWindow({ width: 400, height: 300, show: false, title: "IPC Roundtrip" });
        ipcMain.handle("echo", async (_ev, msg) => ({ echoed: msg, sum: 40 + 2 }));

        const done = new Promise<any>((resolve) => {
          ipcMain.on("done", (_ev, payload) => resolve(payload));
        });

        const html = \`<!doctype html><html><body><script>
          window.bunDesktopIpc.on("from-main", async (_ev, greeting) => {
            const res = await window.bunDesktopIpc.invoke("echo", greeting + "!");
            window.bunDesktopIpc.send("done", res);
          });
          window.bunDesktopIpc.send("ready");
        </script></body></html>\`;

        const ready = new Promise<void>((resolve) => {
          ipcMain.on("ready", () => resolve());
        });

        await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
        await ready;
        win.webContents.send("from-main", "hello");
        const result = await done;
        win.close();

        if (result?.echoed !== "hello!" || result?.sum !== 42) {
          throw new Error("Unexpected IPC result: " + JSON.stringify(result));
        }
        console.log("IPC_OK");
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr.replace(/^DEBUG: Reloading\.\.\.\r?\n/gm, "")).toBe("");
    expect(stdout.trim()).toBe("IPC_OK");
    expect(exitCode).toBe(0);
  });

  test.if(process.platform === "darwin")(
    "app:// protocol.handle zero-copy Bun.file() and HTTP 206 Range requests",
    async () => {
      using dir = tempDir("desktop-protocol", {
        "media.txt": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--desktop",
          "-e",
          `
        import { join } from "node:path";
        import { BrowserWindow, ipcMain, protocol } from "bun:desktop";

        const mediaPath = join(${JSON.stringify(String(dir))}, "media.txt");
        const html = \`<!doctype html><html><body><script>
          (async () => {
            try {
              const r1 = await fetch("app://localhost/media.txt");
              const t1 = await r1.text();
              const r2 = await fetch("app://localhost/media.txt", { headers: { Range: "bytes=4-10" } });
              const t2 = await r2.text();
              const r3 = await fetch("app://localhost/sliced.txt");
              const t3 = await r3.text();
              window.bunDesktopIpc.send("scheme-result", {
                s1: r1.status,
                t1,
                s2: r2.status,
                cr2: r2.headers.get("content-range"),
                t2,
                s3: r3.status,
                t3,
              });
            } catch (e) {
              window.bunDesktopIpc.send("scheme-result", { error: String(e) });
            }
          })();
        </script></body></html>\`;

        protocol.handle("app", (req) => {
          const url = new URL(req.url);
          if (url.pathname === "/index.html") {
            return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
          }
          if (url.pathname === "/media.txt") {
            return new Response(Bun.file(mediaPath), { headers: { "content-type": "text/plain" } });
          }
          if (url.pathname === "/sliced.txt") {
            return new Response(Bun.file(mediaPath).slice(2, 8), { headers: { "content-type": "text/plain" } });
          }
          return new Response("Not Found", { status: 404 });
        });

        const win = new BrowserWindow({ width: 400, height: 300, show: false });
        const resultPromise = new Promise<any>((resolve) => {
          ipcMain.on("scheme-result", (_ev, payload) => resolve(payload));
        });

        await win.loadURL("app://localhost/index.html");
        const res = await resultPromise;
        win.close();

        if (res.error) throw new Error(res.error);
        if (res.s1 !== 200 || res.t1 !== "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
          throw new Error("Full file mismatch: " + JSON.stringify(res));
        }
        if (res.s2 !== 206 || res.cr2 !== "bytes 4-10/36" || res.t2 !== "456789A") {
          throw new Error("Range 206 mismatch: " + JSON.stringify(res));
        }
        if (res.s3 !== 200 || res.t3 !== "234567") {
          throw new Error("Sliced file mismatch: " + JSON.stringify(res));
        }
        console.log("PROTOCOL_OK");
        `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr.replace(/^DEBUG: Reloading\.\.\.\r?\n/gm, "")).toBe("");
      expect(stdout.trim()).toBe("PROTOCOL_OK");
      expect(exitCode).toBe(0);
    },
  );

  test.if(process.platform === "darwin")("BrowserWindow survives --hot reload with same window id", async () => {
    using dir = tempDir("desktop-hot", {
      "main.ts": `
        import { BrowserWindow } from "bun:desktop";
        const win = new BrowserWindow({ id: "main-win", width: 400, height: 300, show: false, title: "V1" });
        console.log("BOOT:" + win.id + ":" + win.getTitle());
      `,
    });

    const mainPath = `${String(dir)}/main.ts`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--desktop", "--hot", mainPath],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let out = "";
    const waitFor = async (substr: string) => {
      const deadline = Date.now() + 10000;
      while (!out.includes(substr)) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${substr}; got: ${out}`);
        const { value, done } = await reader.read();
        if (done) break;
        out += decoder.decode(value);
      }
    };

    await waitFor("BOOT:");
    await Bun.write(
      mainPath,
      `
      import { BrowserWindow } from "bun:desktop";
      const win = new BrowserWindow({ id: "main-win", width: 420, height: 320, show: false, title: "V2" });
      console.log("RELOAD:" + win.id + ":" + win.getTitle());
      win.close();
      process.exit(0);
      `,
    );
    await waitFor("RELOAD:");
    const exitCode = await proc.exited;
    const stderr = await proc.stderr.text();

    const bootMatch = out.match(/BOOT:(\d+):V1/);
    const reloadMatch = out.match(/RELOAD:(\d+):V2/);
    expect(stderr.replace(/^DEBUG: Reloading\.\.\.\r?\n/gm, "")).toBe("");
    expect(bootMatch).not.toBeNull();
    expect(reloadMatch).not.toBeNull();
    expect(reloadMatch![1]).toBe(bootMatch![1]);
    expect(exitCode).toBe(0);
  });

  test.if(process.platform === "darwin")(
    "app://bundle/ serves in-memory Bun.build TS/HTML without TCP port",
    async () => {
      using dir = tempDir("desktop-bundle", {
        "index.html": `<!doctype html><html><body><script type="module" src="./entry.ts"></script></body></html>`,
        "entry.ts": `
        const greeting: string = "FROM_BUNDLED_TS";
        (window as any).bunDesktopIpc.send("bundled-ok", greeting);
      `,
      });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--desktop",
          "-e",
          `
        import { BrowserWindow, ipcMain } from "bun:desktop";
        const win = new BrowserWindow({ width: 400, height: 300, show: false });
        const done = new Promise<string>((resolve) => {
          ipcMain.on("bundled-ok", (_ev, msg) => resolve(msg));
        });
        await win.loadURL("app://bundle/index.html");
        const res = await done;
        win.close();
        if (res !== "FROM_BUNDLED_TS") throw new Error("Unexpected: " + res);
        console.log("BUNDLE_OK");
        `,
        ],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr.replace(/^DEBUG: Reloading\.\.\.\r?\n/gm, "")).toBe("");
      expect(stdout.trim()).toBe("BUNDLE_OK");
      expect(exitCode).toBe(0);
    },
  );

  test.if(process.platform === "darwin")(
    "bun build --compile --desktop standalone binary serves embedded UI over app://bundle/",
    async () => {
      using dir = tempDir("desktop-compile", {
        "ui.html": `<!doctype html><html><body><script>window.bunDesktopIpc.send("compiled-ui", "VFS_OK");</script></body></html>`,
        "main.ts": `
        import ui from "./ui.html" with { type: "file" };
        import { BrowserWindow, ipcMain } from "bun:desktop";
        if (!(await Bun.file(ui).exists())) throw new Error("missing embedded ui");
        const win = new BrowserWindow({ width: 400, height: 300, show: false });
        const done = new Promise<string>((resolve) => {
          ipcMain.on("compiled-ui", (_ev, msg) => resolve(msg));
        });
        await win.loadURL("app://bundle/ui.html");
        const msg = await done;
        win.close();
        console.log("COMPILED:" + msg);
      `,
      });

      const outBin = `${String(dir)}/desktop-app`;
      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--desktop", "main.ts", "--outfile", outBin],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [buildStderr, buildExit] = await Promise.all([buildProc.stderr.text(), buildProc.exited]);
      expect(buildStderr).toBe("");
      expect(buildExit).toBe(0);

      await using runProc = Bun.spawn({
        cmd: [outBin],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [runStdout, runStderr, runExit] = await Promise.all([
        runProc.stdout.text(),
        runProc.stderr.text(),
        runProc.exited,
      ]);
      expect(runStderr).toBe("");
      expect(runStdout.trim()).toBe("COMPILED:VFS_OK");
      expect(runExit).toBe(0);
    },
    30_000,
  );

  test.if(process.platform === "darwin")(
    "native screen, nativeTheme, clipboard, and BrowserWindow actions work",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--desktop",
          "-e",
          `
        import { BrowserWindow, screen, nativeTheme, clipboard } from "bun:desktop";
        const disp = screen.getPrimaryDisplay();
        const dark = nativeTheme.shouldUseDarkColors;
        const prev = clipboard.readText();
        let readBack = "";
        try {
          clipboard.writeText("bun-desktop-clip-test");
          readBack = clipboard.readText();
        } finally {
          clipboard.writeText(prev);
        }
        const win = new BrowserWindow({ width: 400, height: 300, show: false });
        const initMax = win.isMaximized();
        win.maximize();
        const afterMax = win.isMaximized();
        win.unmaximize();
        const afterUnmax = win.isMaximized();
        win.center();
        win.close();
        console.log(JSON.stringify({
          hasDisp: disp.bounds.width > 0 && disp.bounds.height > 0 && disp.scaleFactor >= 1,
          isBoolDark: typeof dark === "boolean",
          readBack,
          initMax,
          afterMax,
          afterUnmax,
        }));
      `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hasDisp).toBe(true);
      expect(parsed.isBoolDark).toBe(true);
      expect(parsed.readBack).toBe("bun-desktop-clip-test");
      expect(parsed.initMax).toBe(false);
      expect(parsed.afterMax).toBe(true);
      expect(parsed.afterUnmax).toBe(false);
      expect(exitCode).toBe(0);
    },
  );

  test.if(process.platform === "darwin")(
    "native powerSaveBlocker, Menu, nativeImage, Notification, and setProgressBar work",
    async () => {
      // 1x1 PNG bytes
      const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      using dir = tempDir("desktop-native-apis", {
        "pixel.png": Buffer.from(pngBase64, "base64"),
        "main.ts": `
        import { BrowserWindow, Menu, nativeImage, Notification, powerSaveBlocker } from "bun:desktop";
        const img = nativeImage.createFromPath("./pixel.png");
        const empty = nativeImage.createEmpty();
        const psId = powerSaveBlocker.start("prevent-display-sleep");
        const psActive = powerSaveBlocker.isStarted(psId);
        const psStopped = powerSaveBlocker.stop(psId);
        const psAfter = powerSaveBlocker.isStarted(psId);

        const menu = Menu.buildFromTemplate([
          { label: "File", submenu: [{ label: "Open" }, { type: "separator" }, { label: "Quit" }] },
        ]);
        Menu.setApplicationMenu(menu);
        const hasMenu = Menu.getApplicationMenu() !== null;

        const win = new BrowserWindow({ width: 320, height: 240, show: false });
        win.setProgressBar(0.5);
        win.setProgressBar(-1);
        win.close();

        let notifShown = false;
        const notif = new Notification({ title: "Bun Desktop", body: "Native test" });
        notif.on("show", () => { notifShown = true; });
        notif.show();

        console.log(JSON.stringify({
          imgEmpty: img.isEmpty(),
          imgSize: img.getSize(),
          emptyIsEmpty: empty.isEmpty(),
          psIdValid: psId > 0,
          psActive,
          psStopped,
          psAfter,
          hasMenu,
          notifShown,
        }));
      `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--desktop", "main.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.imgEmpty).toBe(false);
      expect(parsed.imgSize).toEqual({ width: 1, height: 1 });
      expect(parsed.emptyIsEmpty).toBe(true);
      expect(parsed.psIdValid).toBe(true);
      expect(parsed.psActive).toBe(true);
      expect(parsed.psStopped).toBe(true);
      expect(parsed.psAfter).toBe(false);
      expect(parsed.hasMenu).toBe(true);
      expect(parsed.notifShown).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  test.if(process.platform === "darwin")(
    "Electron parity APIs (BrowserWindow.fromId/bounds, app.name/getPath, handleOnce, contextBridge)",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--desktop",
          "-e",
          `
        import { app, BrowserWindow, ipcMain, contextBridge } from "electron";
        app.name = "ParityApp";
        const downloads = app.getPath("downloads");
        contextBridge.exposeInMainWorld("__exposedBridge", { ok: 42 });

        let onceCount = 0;
        ipcMain.handleOnce("once-ping", () => ++onceCount);

        const win = new BrowserWindow({ width: 500, height: 400, x: 10, y: 20, show: false, title: "Parity" });
        const byId = BrowserWindow.fromId(win.id);
        win.setBounds({ x: 30, y: 40, width: 640, height: 480 });
        const bounds = win.getBounds();
        await win.loadURL("data:text/html,<h1>hi</h1>");
        const wcUrl = win.webContents.getURL();
        const wcTitle = win.webContents.getTitle();
        let closedAll = false;
        app.on("window-all-closed", () => { closedAll = true; });
        win.close();

        console.log(JSON.stringify({
          appName: app.name,
          hasDownloads: downloads.endsWith("/Downloads"),
          bridgeOk: (globalThis as any).__exposedBridge?.ok === 42,
          sameId: byId === win,
          bounds,
          hasUrl: wcUrl.startsWith("data:text/html"),
          wcTitle,
          closedAll,
        }));
      `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.appName).toBe("ParityApp");
      expect(parsed.hasDownloads).toBe(true);
      expect(parsed.bridgeOk).toBe(true);
      expect(parsed.sameId).toBe(true);
      expect(parsed.bounds).toEqual({ x: 30, y: 40, width: 640, height: 480 });
      expect(parsed.hasUrl).toBe(true);
      expect(parsed.wcTitle).toBe("Parity");
      expect(parsed.closedAll).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  test.if(process.platform === "darwin")(
    "large ipcRenderer.invoke payloads (>4MiB) over app:// use __bunIpcBlob fast path",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--desktop",
          "-e",
          `
        import { app, BrowserWindow, ipcMain, protocol } from "bun:desktop";
        await app.whenReady();
        const largeStr = "A".repeat(4_300_000) + "END";
        ipcMain.handle("big-reply", () => ({ len: largeStr.length, tail: largeStr.slice(-3), data: largeStr }));
        const done = new Promise<any>((resolve) => {
          ipcMain.on("big-done", (_ev, res) => resolve(res));
        });
        protocol.handle("app", () => new Response(\`<!doctype html><html><body><script>
          (async () => {
            const r = await window.bunDesktopIpc.invoke("big-reply");
            window.bunDesktopIpc.send("big-done", { ok: r.data.length === 4300003 && r.tail === "END" && r.data.endsWith("END") });
          })();
        </script></body></html>\`, { headers: { "content-type": "text/html; charset=utf-8" } }));
        const win = new BrowserWindow({ width: 400, height: 300, show: false });
        await win.loadURL("app://localhost/index.html");
        const res = await done;
        win.close();
        console.log(JSON.stringify(res));
        `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({ ok: true });
      expect(exitCode).toBe(0);
    },
  );

  test("backend: 'cef' throws an actionable error when no CEF binary is configured", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--desktop",
        "-e",
        `
        import { BrowserWindow } from "bun:desktop";
        try {
          new BrowserWindow({ backend: { type: "cef", path: "/nonexistent/cefsimple" }, show: false });
          console.log("UNEXPECTED");
        } catch (err) {
          console.log(err instanceof Error ? err.message : String(err));
        }
        `,
      ],
      env: { ...bunEnv, BUN_CEF_PATH: "", CEF_PATH: "" },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("CEF backend requested");
    expect(exitCode).toBe(0);
  });

  test.if(
    process.platform === "darwin" &&
      require("node:fs").existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  )(
    "opt-in backend: 'chrome' (Blink/CDP) loads app:// and runs ipcRenderer.invoke",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--desktop",
          "-e",
          `
        import { app, BrowserWindow, ipcMain, protocol } from "bun:desktop";
        await app.whenReady();
        ipcMain.handle("cdp-ping", (_ev, n: number) => ({ ok: n + 1 }));
        protocol.handle("app", () => new Response(\`<!doctype html><html><body><script>
          (async () => {
            const r = await window.bunDesktopIpc.invoke("cdp-ping", 41);
            window.bunDesktopIpc.send("cdp-done", { ok: r.ok, isChrome: new RegExp("Chrome/").test(navigator.userAgent) });
          })();
        </script></body></html>\`, { headers: { "content-type": "text/html; charset=utf-8" } }));
        const done = new Promise<any>((resolve) => ipcMain.on("cdp-done", (_ev, d) => resolve(d)));
        const win = new BrowserWindow({ width: 400, height: 300, show: false, backend: "chrome" });
        await win.loadURL("app://localhost/index.html");
        const res = await done;
        win.close();
        console.log(JSON.stringify(res));
        `,
        ],
        env: { ...bunEnv, HOME: process.env.HOME ?? "/tmp" },
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({ ok: 42, isChrome: true });
      expect(exitCode).toBe(0);
    },
    15_000,
  );

  test.if(process.platform === "darwin")(
    "ipcMain.handleBinary and invokeBinary transfer raw Uint8Array without JSON or Base64",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--desktop",
          "-e",
          `
          import { app, BrowserWindow, ipcMain, protocol } from "bun:desktop";
          await app.whenReady();
          ipcMain.handleBinary("echo-bin", (_ev, data: Uint8Array) => {
            const out = new Uint8Array(data.byteLength);
            for (let i = 0; i < data.byteLength; i++) out[i] = data[i] ^ 0x55;
            return out;
          });
          protocol.handle("app", () => new Response(\`<!doctype html><html><body><script>
            (async () => {
              const input = new Uint8Array([1, 2, 3, 250, 255]);
              const reply = await window.bunDesktopIpc.invokeBinary("echo-bin", input);
              window.bunDesktopIpc.send("bin-done", {
                isUint8: reply instanceof Uint8Array,
                bytes: Array.from(reply),
              });
            })();
          </script></body></html>\`, { headers: { "content-type": "text/html; charset=utf-8" } }));
          const done = new Promise<any>((resolve) => ipcMain.on("bin-done", (_ev, d) => resolve(d)));
          const win = new BrowserWindow({ width: 320, height: 240, show: false });
          await win.loadURL("app://localhost/index.html");
          const res = await done;
          win.close();
          console.log(JSON.stringify(res));
          `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({
        isUint8: true,
        bytes: [1 ^ 0x55, 2 ^ 0x55, 3 ^ 0x55, 250 ^ 0x55, 255 ^ 0x55],
      });
      expect(exitCode).toBe(0);
    },
  );

  test.if(process.platform === "darwin")(
    "capabilities enforce IPC allow/deny and defaultBundleHandler blocks path traversal",
    async () => {
      using dir = tempDir("desktop-capabilities", {
        "index.html": `<!doctype html><html><body><script>
          (async () => {
            const allowed = await window.bunDesktopIpc.invoke("allowed-ch");
            let deniedErr = "";
            try { await window.bunDesktopIpc.invoke("secret-ch"); } catch (e) { deniedErr = String(e?.message || e); }
            const traversal = await fetch("app://bundle/%2e%2e%2fpackage.json");
            window.bunDesktopIpc.send("cap-done", { allowed, deniedErr, traversalStatus: traversal.status });
          })();
        </script></body></html>`,
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--desktop",
          "-e",
          `
          import { app, BrowserWindow, ipcMain } from "bun:desktop";
          await app.whenReady();
          ipcMain.handle("allowed-ch", () => "ok");
          ipcMain.handle("secret-ch", () => "secret");
          const done = new Promise<any>((resolve) => ipcMain.on("cap-done", (_ev, d) => resolve(d)));
          const win = new BrowserWindow({
            width: 320,
            height: 240,
            show: false,
            capabilities: { ipc: { defaultPolicy: "deny", allow: ["allowed-ch", "cap-done"] } },
          });
          await win.loadURL("app://bundle/index.html");
          const res = await done;
          win.close();
          console.log(JSON.stringify(res));
          `,
        ],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.allowed).toBe("ok");
      expect(parsed.deniedErr).toContain("denied");
      expect(parsed.traversalStatus).toBe(403);
      expect(exitCode).toBe(0);
    },
  );

  test.if(process.platform === "darwin")(
    "sandbox preload with const ipcRenderer, MessageChannelMain, and webRequest port matching work together",
    async () => {
      using dir = tempDir("desktop-sandbox-port", {
        "preload.js": `
          const { contextBridge, ipcRenderer } = require("electron");
          ipcRenderer.on("rpc-port", ev => {
            const port = ev.ports && ev.ports[0];
            if (port) window.postMessage("rpc-port", "*", [port]);
          });
          contextBridge.exposeInMainWorld("bridge", {
            ping: () => ipcRenderer.invoke("sb-ping"),
            ready: () => ipcRenderer.send("rpc-ready"),
          });
        `,
        "index.html": `<!doctype html><html><body><script>
          window.addEventListener("message", async e => {
            if (e.data !== "rpc-port" || !e.ports[0]) return;
            const port = e.ports[0];
            port.onmessage = async ev => {
              const pingVal = await window.bridge.ping();
              const authRes = await fetch(ev.data.srvUrl + "check").then(r => r.json());
              port.postMessage({ pingVal, auth: authRes.auth });
            };
            port.start();
          });
          window.bridge.ready();
        </script></body></html>`,
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--desktop",
          "-e",
          `
          import { app, BrowserWindow, ipcMain, MessageChannelMain, session } from "bun:desktop";
          import path from "node:path";
          await app.whenReady();
          const srv = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(req) {
              const cors = {
                "access-control-allow-origin": "*",
                "access-control-allow-headers": "*",
              };
              if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
              return Response.json({ auth: req.headers.get("authorization") ?? "" }, { headers: cors });
            },
          });
          session.defaultSession.webRequest.onBeforeSendHeaders(
            { urls: ["http://127.0.0.1/*"] },
            (details, cb) => {
              cb({ requestHeaders: { ...details.requestHeaders, Authorization: "Basic dGVzdDp0b2tlbg==" } });
            },
          );
          ipcMain.handle("sb-ping", () => "pong-sb");
          const ready = new Promise<void>(resolve => ipcMain.once("rpc-ready", () => resolve()));
          const win = new BrowserWindow({
            width: 320,
            height: 240,
            show: false,
            webPreferences: {
              preload: path.join(process.cwd(), "preload.js"),
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
          await win.loadURL("app://bundle/index.html");
          await ready;
          const ch = new MessageChannelMain();
          const reply = new Promise<any>(resolve => {
            ch.port1.on("message", ev => resolve(ev.data));
          });
          ch.port1.start();
          win.webContents.postMessage("rpc-port", null, [ch.port2]);
          ch.port1.postMessage({ srvUrl: srv.url.href });
          const res = await reply;
          win.close();
          srv.stop(true);
          console.log(JSON.stringify(res));
          process.exit(0);
          `,
        ],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr.replace(/^DEBUG: Reloading\.\.\.\r?\n/gm, "")).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({
        pingVal: "pong-sb",
        auth: "Basic dGVzdDp0b2tlbg==",
      });
      expect(exitCode).toBe(0);
    },
  );
});
