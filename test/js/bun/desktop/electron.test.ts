import { hasLibrary } from "./library";
import { hasScreen, openScreen } from "./screen";

import { $ } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMacOS, isWindows, tempDir, tls } from "harness";
import { chmodSync, copyFileSync, existsSync, linkSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

const hasNss = isLinux && !!Bun.which("openssl") && !new Bun.Glob("lib*/**/libnss3.so").scanSync("/usr").next().done;

const prelude = `
  const electron = require("electron");
  const { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, net } = electron;
  const { once } = require("events");
  const path = require("path");
  app.setPath("userData", path.join(__dirname, "data"));
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
  app.trustOrigins(["app://trusted"]);
  const print = value => console.log(JSON.stringify(value));
  const types = { ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const serve = (files, headers) =>
    protocol.handle("app", request => {
      const { pathname } = new URL(request.url);
      const file = files[pathname];
      if (typeof file === "function") return file(request);
      if (file === undefined) return new Response("", { status: 404 });
      return new Response(file, { headers: { "content-type": types[path.extname(pathname)] ?? "text/html", ...headers } });
    });
  const open = async (url = "app://trusted/", options) => {
    const window = new BrowserWindow({ width: 400, height: 300, ...options });
    await window.loadURL(url);
    return window.webContents;
  };
  const preload = { webPreferences: { preload: path.join(__dirname, "preload.js") } };
  const collectGarbage = page => {
    if (page.getOSProcessId() === process.pid) return Bun.gc(true);
    if (!page.debugger.isAttached()) page.debugger.attach();
    return page.debugger.sendCommand("HeapProfiler.collectGarbage");
  };
`;

/** electron-sandbox.test.ts runs these tests with pages in other processes. */
const place = import.meta.url.endsWith("?sandbox") ? { BUN_DESKTOP_PAGE_PROCESSES: "1" } : {};

/** What the app has passed to `print`. */
async function run(main: string, files: Record<string, string> = {}, args: string[] = [], env = {}) {
  return (await runWithErrors(main, files, args, env))[0];
}

async function runWithErrors(main: string, files: Record<string, string>, args: string[], env: object) {
  using dir = tempDir("electron", {
    "package.json": JSON.stringify({ name: "fixture", productName: "Fixture", version: "1.2.3", main: "main.js" }),
    "main.js": `${prelude}\napp.whenReady().then(async () => {${main}\n}).then(() => app.quit(), error => { console.error(error); app.exit(1); });`,
    ...files,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload=bun:desktop/electron", ".", ...args],
    env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", ...place, ...env },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`exited with ${exitCode}\n${stdout}\n${stderr}`);
  const lines = stdout.trim().split("\n");
  return [lines.map(line => JSON.parse(line)), stderr] as const;
}

/** What a debugger needs to find in it. */
function readMinidump(dump: Buffer) {
  const [word, address] = [(at: number) => dump.readUInt32LE(at), (at: number) => dump.readBigUInt64LE(at)];
  const rows = (at: number, size: number) => Array.from({ length: word(at) }, (_, index) => at + 4 + size * index);
  const streams = new Map(
    Array.from({ length: word(8) }, (_, index) => word(12) + 12 * index).map(at => [word(at), word(at + 8)]),
  );
  const text = (at: number, encoding: BufferEncoding = "utf8") => dump.toString(encoding, at + 4, at + 4 + word(at));
  const table = (at: number, size: number) =>
    Object.fromEntries(rows(at, size).map(it => [text(word(it)), text(word(it + size - 4))]));
  const [[thread], crashpad, exception] = [rows(streams.get(3)!, 48), streams.get(0x43500001)!, streams.get(6)!];
  const [sp, pc] = (process.arch === "x64" ? [152, 248] : [256, 264]).map(at => address(word(thread + 44) + at));
  const isIn = (it: bigint, at: number) => address(at) <= it && it < address(at) + BigInt(word(at + 8));
  const modules = rows(streams.get(4)!, 108);
  return {
    magic: dump.toString("latin1", 0, 4),
    exception: [word(exception + 8), address(exception + 24)],
    pc,
    hasStack: isIn(sp, thread + 24) && word(thread + 36) + word(thread + 32) === dump.length,
    crashedIn: modules.filter(it => isIn(pc, it)).map(it => [text(word(it + 20), "utf16le"), word(it + 76) > 4]),
    modules: modules.length,
    ofApp: table(word(crashpad + 40), 8),
    ofProcess: table(word(word(word(crashpad + 48) + 12) + 24), 12),
  };
}

describe.skipIf(!hasLibrary || !(isLinux || isMacOS)).concurrent("crashReporter", () => {
  const files = (start: string, main: string) => ({
    "package.json": JSON.stringify({ name: "fixture", productName: "Fixture", version: "1.2.3", main: "main.js" }),
    "main.js": `${prelude}
      const { crashReporter } = electron;
      const { crash_handler } = require("bun:internal-for-testing");
      const step = process.env.STEP;
      ${start};
      app.whenReady().then(async () => {${main}\n}).then(() => app.quit());`,
    "utility.js": `process.crash();`,
  });
  async function launch(dir: { toString(): string }, env: object) {
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        'ulimit -c 0 && exec "$@"',
        "--",
        bunExe(),
        "--preload=bun:desktop/electron",
        ".",
        "--debug-crash-handler-use-trace-string",
      ],
      env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0", ...env },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const dumps = [...new Bun.Glob("*/*.dmp").scanSync(join(String(dir), "data/Crashpad"))];
    return { printed: stdout && JSON.parse(stdout), signal: proc.signalCode, dumps };
  }
  const read = (dir: { toString(): string }, dump: string) => readFileSync(join(String(dir), "data/Crashpad", dump));

  test.each([
    ["crash_handler.segfault()", "SIGSEGV", isMacOS ? 1 : 11, "Segmentation fault at address 0xDEADBEEF"],
    ["crash_handler.panic()", "SIGABRT", isMacOS ? 10 : 6, "invoked crashByPanic() handler"],
  ])("writes a minidump after %s", async (crash, signal, code, message) => {
    using dir = tempDir(
      "crash",
      files(
        `crashReporter.start({ uploadToServer: false, companyName: "Acme", extra: { a: "1", gone: "x" }, globalExtra: { all: "2" } })`,
        `crashReporter.addExtraParameter("b", "é");
         crashReporter.addExtraParameter(Buffer.alloc(40, "k").toString(), "too long a key");
         crashReporter.addExtraParameter("long", Buffer.alloc(30000, "v").toString());
         crashReporter.removeExtraParameter("gone");
         if (step === "crash") ${crash};
         print([crashReporter.getUploadToServer(), crashReporter.getLastCrashReport(), crashReporter.getUploadedReports().length, Object.keys(crashReporter.getParameters())]);`,
      ),
    );
    const secret = crypto.randomUUID();
    const { dumps, ...crashed } = await launch(dir, { STEP: "crash", SECRET: secret });
    expect(crashed).toEqual({ printed: "", signal });
    expect(dumps).toEqual([expect.stringMatching(/^completed\/[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}\.dmp$/)]);
    const { pc, modules, ...found } = readMinidump(read(dir, dumps[0]));
    expect(found).toMatchObject({
      magic: "MDMP",
      exception: [code, signal === "SIGSEGV" ? 0xdeadbeefn : pc],
      hasStack: true,
      crashedIn: [[realpathSync(bunExe()), true]],
      ofApp: { _companyName: "Acme", _productName: "Fixture", _version: "1.2.3", all: "2", prod: "Electron" },
    });
    expect({ ...found.ofProcess, pid: 0, osarch: 0, long: found.ofProcess.long.length }).toEqual({
      LOG_FATAL: message,
      platform: process.platform,
      process_type: "browser",
      ptype: "browser",
      pid: 0,
      osarch: 0,
      a: "1",
      b: "é",
      long: 20320,
    });
    expect(modules).toBeGreaterThan(1);
    expect(read(dir, dumps[0]).includes(secret)).toBe(false);
    expect(await launch(dir, { STEP: "look" })).toEqual({
      printed: [false, { date: "1970-01-01T00:00:00.000Z", id: "" }, 1, ["a", "b", "long"]],
      signal: null,
      dumps,
    });
  });

  test("writes nothing unless it has been started", async () => {
    using dir = tempDir(
      "crash",
      files(
        `require("fs").mkdirSync(app.getPath("crashDumps"), { recursive: true });
         try { crashReporter.start({}); } catch (error) { require("fs").writeSync(1, JSON.stringify(error.message)); }`,
        `crash_handler.panic();`,
      ),
    );
    expect(await launch(dir, {})).toEqual({
      printed: "submitURL must be specified when uploadToServer is true",
      signal: "SIGABRT",
      dumps: [],
    });
  });

  test.skipIf(isASAN)("covers utility processes", async () => {
    using dir = tempDir(
      "crash",
      files(
        `crashReporter.start({ uploadToServer: false, extra: { a: "1" }, globalExtra: { all: "2" } })`,
        `await once(electron.utilityProcess.fork(path.join(__dirname, "utility.js"), [], { stdio: "ignore" }), "exit");`,
      ),
    );
    const { dumps } = await launch(dir, {});
    const { ofApp, ofProcess, hasStack } = readMinidump(read(dir, dumps[0]));
    expect([dumps.length, ofApp.all, ofProcess.a, ofProcess.process_type, hasStack]).toEqual([
      1,
      "2",
      undefined,
      "utility",
      true,
    ]);
  });

  test.skipIf(isASAN)("a utility process hears that uploads have been turned off", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    using dir = tempDir("crash", {
      ...files(
        `crashReporter.start({ submitURL: process.env.URL })`,
        `const child = electron.utilityProcess.fork(path.join(__dirname, "utility.js"), [], { stdio: "ignore" });
         await once(child, "message");
         crashReporter.setUploadToServer(false);
         child.postMessage(0);
         await once(child, "exit");`,
      ),
      "utility.js": `process.parentPort.on("message", () => process.crash()); process.parentPort.postMessage(0);`,
    });
    expect((await launch(dir, { URL: server.url.href })).dumps).toEqual([expect.stringMatching(/^completed\//)]);
  });

  test("uploads nothing that another program has left in the directory", async () => {
    const names: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async request => (
        names.push(((await request.formData()).get("upload_file_minidump") as File).name),
        new Response()
      ),
    });
    using dir = tempDir(
      "crash",
      files(
        `crashReporter.start({ submitURL: process.env.URL, compress: false })`,
        `if (step === "crash") crash_handler.panic();
         const fs = require("fs"), queued = path.join(app.getPath("crashDumps"), "queued");
         while (fs.readdirSync(queued).length) await Bun.sleep(1);
         fs.renameSync("last.dmp", path.join(queued, "last.dmp"));
         while (fs.readdirSync(queued).length) crashReporter.setUploadToServer(true), await Bun.sleep(1);`,
      ),
    );
    const [dump] = (await launch(dir, { STEP: "crash", URL: server.url.href })).dumps;
    for (const copy of ["data/Crashpad/pending/other.dmp", "last.dmp"])
      await Bun.write(join(String(dir), copy), read(dir, dump));
    expect((await launch(dir, { URL: server.url.href })).dumps).toContain("pending/other.dmp");
    expect(names).toEqual([dump.slice("queued/".length), "last.dmp"]);
  });

  test.each([true, false])("uploads at the next launch, if the app wants that (compress: %p)", async compress => {
    const posts: unknown[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const body = await request.bytes();
        const form = await new Response(compress ? Bun.gunzipSync(body) : body, {
          headers: request.headers,
        }).formData();
        const { upload_file_minidump: file, ...fields } = Object.fromEntries(form) as Record<string, any>;
        const query = Object.fromEntries(new URL(request.url).searchParams);
        posts.push([
          request.method,
          request.headers.get("content-encoding"),
          file.name,
          file.size,
          fields._version,
          fields["a%22b"],
          fields.process_type,
          query.product,
          query.key,
          query.guid === fields.guid,
        ]);
        return new Response("report 1".padEnd(5000));
      },
    });
    using dir = tempDir(
      "crash",
      files(
        `crashReporter.start({ submitURL: process.env.URL, uploadToServer: step !== "look", compress: ${compress}, extra: { 'a"b': "1" } })`,
        `if (step === "crash") crash_handler.panic();
         while (step === "upload" && require("fs").readdirSync(path.join(app.getPath("crashDumps"), "queued")).length) await Bun.sleep(1);
         const { id, date } = crashReporter.getLastCrashReport();
         print([id.trim(), id.length, date.getTime() > 0]);`,
      ),
    );
    const URL_ = server.url.href + "?key=1";
    const { dumps } = await launch(dir, { STEP: "crash", URL: URL_ });
    expect(dumps).toEqual([expect.stringMatching(/^queued\//)]);
    const [name, size] = [dumps[0].slice("queued/".length), read(dir, dumps[0]).length];
    expect(await launch(dir, { STEP: "look", URL: URL_ })).toEqual({ printed: ["", 0, false], signal: null, dumps });
    expect(posts).toEqual([]);
    expect(await launch(dir, { STEP: "upload", URL: URL_ })).toEqual({
      printed: ["report 1", 1024, true],
      signal: null,
      dumps: ["completed/" + name],
    });
    expect(posts).toEqual([
      ["POST", compress ? "gzip" : null, name, size, "1.2.3", "1", "browser", "Electron", "1", true],
    ]);
  });
});

describe.skipIf(!hasLibrary).concurrent("bun:desktop/electron", () => {
  test("inline caches can rely on the prototypes of every page", async () => {
    expect(
      await run(
        `serve({ "/": "<p>" });
         const options = { webPreferences: { ...preload.webPreferences, contextIsolation: false, sandbox: false } };
         for (let i = 0; i < 4; i++) print(await (await open(undefined, options)).executeJavaScript("isLeaf(Element.prototype)"));`,
        { "preload.js": `window.isLeaf = it => require("bun:jsc").jscDescribe(it).includes("Leaf");` },
      ),
    ).toEqual([true, true, true, true]);
  });

  test("the accessors of a window are the same after optimized code has used them", async () => {
    expect(
      await run(
        `serve({ "/": "<p>" });
         print(await (await open()).executeJavaScript(\`{
           const names = ["name", "length", "event", "status", "innerWidth"];
           const describe = () => names.map(it => { const { get, set, ...rest } = Object.getOwnPropertyDescriptor(window, it); return [get.name, set.name, rest]; });
           const order = () => Object.keys(window).filter(it => names.includes(it)).join();
           const before = [describe(), order()];
           let wrong = 0;
           for (let i = 0; i < 3000; i++) {
             if (i === 1000) document.body.append(document.createElement("iframe"));
             if (i === 1500) window.innerWidth = 7;
             if (i === 2000) Object.defineProperty(window, "status", { get: () => "other", set() {} });
             if (i === 2500) delete window.event;
             window.name = status = "n" + i;
             wrong += name !== "n" + i || window.status !== (i < 2000 ? name : "other") || window.length !== +(i >= 1000) || length !== window.length;
             wrong += (window.innerWidth === 7) !== i >= 1500 || window.event !== undefined || "event" in window !== i < 2500;
             if (i === 900) wrong += JSON.stringify([describe(), order()]) !== JSON.stringify(before);
           }
           wrong;
         }\`));`,
        {},
        [],
        {
          BUN_JSC_useConcurrentJIT: "0",
          BUN_JSC_thresholdForJITAfterWarmUp: "10",
          BUN_JSC_thresholdForOptimizeAfterWarmUp: "50",
        },
      ),
    ).toEqual([0]);
  });

  test.each([
    ["is slow to load", `app.once("ready", done);`],
    ["waits for it", `await app.whenReady(); done();`],
  ])("ready comes after a main module that %s", async (_, end) => {
    expect(
      await run("", {
        "package.json": JSON.stringify({ name: "fixture", main: "main.mjs" }),
        "slow.mjs": `for (let i = 0; i < 50; i++) await new Promise(setImmediate); await Bun.file(import.meta.path).text();`,
        "main.mjs": `
          import "./slow.mjs";
          import { app } from "electron";
          const wasReady = app.isReady();
          const done = () => (console.log(JSON.stringify([wasReady, app.isReady()])), app.quit());
          ${end}`,
      }),
    ).toEqual([[false, true]]);
  });

  test.skipIf(isWindows).each(["app.quit", "app.exit", "process.exit"])("relaunched after %s()", async end => {
    expect(
      await run(
        `const { cookies } = session.defaultSession;
        print((await cookies.get({})).length);
        if (process.argv.includes("again")) return;
        app.relaunch({ args: ["again", "--use-mock-keychain"] });
        await cookies.set({ url: "https://a.test/", name: "a", value: "1", expirationDate: Date.now() / 1000 + 60 });
        ${end}();`,
        {},
        ["--use-mock-keychain"],
        { BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      ),
    ).toEqual([0, 1]);
  });

  test("whether the app opens at login is a boolean under both names", async () => {
    using home = tempDir("login", {});
    expect(
      await run(
        `const { openAtLogin, executableWillLaunchAtLogin } = app.getLoginItemSettings();
        print([openAtLogin, executableWillLaunchAtLogin]);`,
        {},
        [],
        { XDG_CONFIG_HOME: String(home) },
      ),
    ).toEqual([[false, false]]);
  });

  test.skipIf(isWindows)("a relaunched app has the variables whose names are numbers or not ASCII", async () => {
    expect(
      await run(
        `if (process.argv.includes("again")) return print([process.env[1], process.env["é"]]);
        Object.assign(process.env, { 1: "a", "é": "b" });
        app.relaunch({ args: ["again"] });
        app.quit();`,
        {},
        [],
        { BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      ),
    ).toEqual([["a", "b"]]);
  });

  test("what is up to the system checks its arguments", async () => {
    expect(
      await run(`
        const { autoUpdater, systemPreferences, ShareMenu } = electron;
        const window = new BrowserWindow();
        for (const call of [
          () => systemPreferences.getColor("nothing"),
          () => systemPreferences.getColor("label link"),
          () => systemPreferences.getMediaAccessStatus("nothing"),
          () => systemPreferences.askForMediaAccess("screen"),
          () => systemPreferences.promptTouchID(""),
          () => window.addTabbedWindow(window),
          () => window.moveAbove("screen:1:0"),
          () => window.moveAbove(window.getMediaSourceId()),
          () => new ShareMenu({ texts: ["a"] }).closePopup(),
          () => (app.setSecureKeyboardEntryEnabled(true), app.isSecureKeyboardEntryEnabled()),
          () => (app.setUserActivity("a", { b: 1 }), app.getCurrentActivityType()),
          () => (app.invalidateCurrentActivity(), app.getCurrentActivityType()),
          () => autoUpdater.getFeedURL(),
        ]) print(await (async () => call())().then(it => it ?? null, error => error.message));`),
    ).toEqual([
      "Unknown color: nothing",
      "Unknown color: label link",
      "Invalid media type",
      "Invalid media type",
      "reason must be non-empty",
      "AddTabbedWindow cannot be called by a window on itself.",
      "Invalid media source id",
      ...[null, null, true, "a", "", ""],
    ]);
  });

  test.skipIf(isMacOS)("there are no updates without a bundle", async () => {
    expect(
      await run(`
        const { autoUpdater } = electron;
        for (const name of ["error", "checking-for-update", "before-quit-for-update"]) autoUpdater.on(name, () => print(name));
        autoUpdater.setFeedURL({ url: "http://127.0.0.1/" });
        autoUpdater.checkForUpdates();
        print(autoUpdater.getFeedURL());
        new BrowserWindow();
        app.on("window-all-closed", () => print("window-all-closed"));
        autoUpdater.quitAndInstall();
        await new Promise(setImmediate);`),
    ).toEqual(["", "before-quit-for-update", "window-all-closed", "before-quit-for-update"]);
  });

  test.each([true, false])("fullscreen and pointer lock are up to the session: %p", async allows => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=/frame></iframe>", "/frame": "" });
        session.defaultSession.setPermissionRequestHandler((_, name, answer, details) => (print([name, details.isMainFrame]), setImmediate(answer, ${allows})));
        const page = await open();
        const outcome = code => "(" + code + ").then(() => 'done', error => error.name)";
        print(await page.executeJavaScript(outcome("document.body.requestPointerLock()"), true));
        print(await page.mainFrame.frames[0].executeJavaScript(outcome("document.body.requestFullscreen()"), true));
        print(await page.executeJavaScript("[document.pointerLockElement?.localName, document.fullscreenElement?.localName]"));
        print(BrowserWindow.fromWebContents(page).isFullScreen());`),
    ).toEqual([
      ["pointerLock", true],
      allows ? "done" : "NotAllowedError",
      ["fullscreen", false],
      allows ? "done" : "TypeError",
      allows ? ["body", "iframe"] : [null, null],
      allows,
    ]);
  });

  test("a frame does not speak for the window", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({
          "/": "<iframe src=/frame sandbox='allow-scripts allow-same-origin'></iframe><iframe src=/frame></iframe>",
          "/frame": "<link rel=icon href=/icon><meta name=theme-color content=red>",
        });
        const seen = [];
        require("electron").dialog.showMessageBoxSync = (_, { message }) => (seen.push(message), 0);
        session.defaultSession.setPermissionRequestHandler((_, name, answer) => (seen.push(name), answer(true)));
        app.on("web-contents-created", (_, it) => {
          for (const name of ["page-favicon-updated", "did-change-theme-color"]) it.on(name, () => seen.push(name));
        });
        const page = await open();
        print(await page.executeJavaScript(\`{
          const [sandboxed, other] = [frames[0], frames[1]], { confirm, Notification } = other;
          const answers = [sandboxed.confirm("sandboxed"), other.confirm("other")];
          document.body.replaceChildren();
          Notification.requestPermission();
          [...answers, confirm("removed")];
        }\`));
        print(seen);`),
    ).toEqual([[false, true, false], ["other"]]);
  });

  test("names of a document are found by code that has not found them before", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { injectedScripts: true });
        serve({ "/": "<img name=early>" });
        const page = await open();
        print(await page.executeJavaScript(\`{
          const read = it => [it.early?.localName, it.late?.localName, typeof it.createElement, "late" in it].join();
          const warm = it => { let last; for (let i = 0; i < 2000; i++) last = read(it); return last; };
          const add = name => document.body.appendChild(Object.assign(document.createElement("form"), { name }));
          const seen = [warm(new DOMParser().parseFromString("<img name=early>", "text/html")), warm(document), warm(Object.create(document, { createElement: {} }))];
          const late = add("late");
          seen.push(warm(document));
          const hides = add("createElement");
          seen.push(warm(document));
          late.remove(), hides.remove();
          seen.push(warm(document));
          seen;
        }\`));`),
    ).toEqual([
      [
        ",,function,false",
        "img,,function,false",
        "img,,undefined,false",
        "img,form,function,true",
        "img,form,object,true",
        "img,,function,false",
      ],
    ]);
  });

  test("the timers of a page", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=/frame></iframe>", "/frame": "" });
        const page = await open();
        print(await page.executeJavaScript(\`new Promise(done => {
          const seen = [setTimeout.length, clearInterval.length, /native code/.test(setTimeout)];
          onerror = message => seen.push(message);
          frames[0].setTimeout(() => seen.push("removed"));
          frames[0].setInterval(() => seen.push("removed"));
          document.querySelector("iframe").remove();
          clearInterval(setTimeout(() => seen.push("cleared")));
          setTimeout(function (...given) { seen.push(this === window, given); }, 0, 1, { a: 2 });
          setTimeout(() => { throw new Error("thrown"); });
          setTimeout({ toString: () => "document.title = 'text'" });
          let left = 8;
          const id = setInterval(() => {
            if (--left > 0) return;
            clearTimeout(id);
            setTimeout(() => done([...seen, left, document.title]), 10);
          });
        })\`));`),
    ).toEqual([[1, 0, true, true, [1, { a: 2 }], "Uncaught Error: thrown", 0, "text"]]);
  });

  test("timers that are set by what other timers resolve are nested", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          const start = performance.now();
          for (let i = 0; i < 16; i++) await new Promise(resolve => setTimeout(resolve));
          return performance.now() - start >= 40;
        })()\`));`),
    ).toEqual([true]);
  });

  test("event handler attributes", async () => {
    expect(
      await run(`
        serve({
          "/": \`<body onerror="1"><form id=form><input id=field name=field onclick="seen.push(field.name, id, URL)"></form>
            <p id=broken onclick="}; seen.push('escaped'); function more() {"></p>
            <svg id=picture onclick="seen.push(evt.type)"></svg>
            <script>seen = []; addEventListener("error", event => seen.push(event.error.name))</script>\`,
        });
        const page = await open();
        print(await page.executeJavaScript(\`
          field.click();
          picture.dispatchEvent(new Event("click"));
          [...seen.splice(0), broken.onclick, ...seen, String(onerror)]\`));`),
    ).toEqual([
      [
        "field",
        "field",
        "app://trusted/",
        "click",
        null,
        "SyntaxError",
        "function onerror(event, source, lineno, colno, error) {\n1\n}",
      ],
    ]);
  });

  test("what a document says about itself", async () => {
    expect(
      await run(`
        serve({ "/": "<title>First</title>" });
        const page = await open();
        const told = ["page-title-updated", "page-favicon-updated", "did-change-theme-color"].map(
          name => new Promise(done => page.once(name, (_, value) => done(value))),
        );
        const key = await page.insertCSS("html { color: rgb(1, 2, 3) }");
        const color = () => page.executeJavaScript("getComputedStyle(document.documentElement).color");
        print(await color());
        await page.removeInsertedCSS(key);
        print(await color());
        await page.executeJavaScript(\`
          document.title = " Second  title ";
          document.head.insertAdjacentHTML("beforeend", "<link rel='shortcut ICON' href=/icon.png><meta name=theme-color content=#123456><meta name=color-scheme content=dark>");\`);
        print(await Promise.all(told));
        print(await color());`),
    ).toEqual([
      "rgb(1, 2, 3)",
      "rgb(0, 0, 0)",
      ["Second title", ["app://trusted/icon.png"], "#123456"],
      "rgb(255, 255, 255)",
    ]);
  });

  test("what a worker inherits checks its receiver", async () => {
    const script = () => {
      const { WorkerGlobalScope, FontFaceSet, fonts } = globalThis as any;
      const failure = (run: () => unknown) => {
        try {
          return run();
        } catch (error: any) {
          return error.name;
        }
      };
      queueMicrotask(function () {
        postMessage([
          arguments.length,
          ["atob", "btoa", "queueMicrotask", "fonts"].map(name => Object.hasOwn(WorkerGlobalScope.prototype, name)),
          [
            atob(" YQ=="),
            btoa("\xff"),
            failure(() => atob("a")),
            failure(() => btoa("Ā")),
            failure(() => (atob as any)()),
          ],
          [
            failure(() => atob.call({}, "")),
            failure(() => queueMicrotask.call({}, () => {})),
            failure(() => queueMicrotask(1 as any)),
          ],
          [
            fonts instanceof FontFaceSet,
            fonts === (self as any).fonts,
            failure(() => WorkerGlobalScope.prototype.fonts),
          ],
        ]);
      });
    };
    const aliases = `[webkitURL === URL, WebKitMutationObserver === MutationObserver, typeof chrome, chrome === chrome]`;
    expect(
      await run(`
        serve({ "/": "", "/worker.js": ${JSON.stringify(`(${script})()`)} });
        const page = await open();
        print(await page.executeJavaScript(\`new Promise(done => (self.worker = new Worker("/worker.js")).onmessage = it => done(it.data))\`));
        print(await page.executeJavaScript("${aliases}"));`),
    ).toEqual([
      [
        0,
        [true, true, true, true],
        ["a", "/w==", "InvalidCharacterError", "InvalidCharacterError", "TypeError"],
        ["TypeError", "TypeError", "TypeError"],
        [true, true, "TypeError"],
      ],
      [true, true, "object", true],
    ]);
  });

  test("an isolated world does not get what a page puts on a prototype", async () => {
    expect(
      await run(`
        serve({ "/": "<script>Element.prototype.planted = Element.prototype.remove; CSS.planted = CSS.escape</script>" });
        const page = await open();
        print(await page.executeJavaScriptInIsolatedWorld(1, [{ code: "[typeof document.body.planted, typeof CSS.planted]" }]));`),
    ).toEqual([["undefined", "undefined"]]);
  });

  test("scheduler, in a page and in a worker", async () => {
    const script = async () => {
      const { scheduler, TaskController, TaskPriorityChangeEvent, TaskSignal } = globalThis as any;
      const failure = (promise: Promise<unknown>) => promise.then(String, error => error.name ?? error);
      const order: unknown[] = [];
      const post = (name: string, options?: object) => scheduler.postTask(() => order.push(name), options);
      const controller = new (class extends TaskController {})({ priority: "background" });
      const { signal } = controller;
      const follower = TaskSignal.any([], { priority: TaskSignal.any([], { priority: signal }) });
      signal.onprioritychange = (event: any) => {
        order.push([event.previousPriority, signal.priority, follower.priority]);
        try {
          controller.setPriority("background");
        } catch (error: any) {
          order.push(error.name);
        }
      };
      follower.addEventListener("prioritychange", () => order.push(follower.priority));
      const posted = [
        post("moved 1", { signal }),
        post("visible"),
        post("blocking", { priority: "user-blocking" }),
        post("stays", { signal, priority: "background" }),
        post("moved 2", { signal: follower }),
      ];
      controller.setPriority("user-blocking");
      await Promise.all(posted);
      await scheduler.postTask(
        async () => {
          const others = [post("same priority", { priority: "background" }), post("higher priority")];
          await scheduler.yield();
          order.push("continued");
          await Promise.all(others);
        },
        { priority: "background" },
      );
      const inherited = failure(
        scheduler.postTask(() => (controller.abort("in the task"), scheduler.yield()), { signal }),
      );
      const late = new AbortController();
      const delayed = failure(post("never", { signal: late.signal, delay: 1 }));
      late.abort();
      return [
        order,
        await inherited,
        await delayed,
        await failure(post("never", { signal })),
        await failure(post("never", { priority: "high" })),
        await failure(post("never", { delay: -1 })),
        await failure(scheduler.postTask(() => null!.toString)),
        await scheduler.postTask(() => "result", { delay: 1 }),
        [
          controller instanceof AbortController,
          signal instanceof AbortSignal,
          signal instanceof TaskSignal,
          String(signal),
        ],
        new TaskPriorityChangeEvent("a", { previousPriority: "background" }).previousPriority,
      ];
    };
    const [inPage, inWorker] = await run(`
      serve({ "/": "", "/worker.js": ${JSON.stringify(`(${script})().then(postMessage)`)} });
      const page = await open();
      print(await page.executeJavaScript(${JSON.stringify(`(${script})()`)}));
      print(await page.executeJavaScript(\`new Promise(done => (self.worker = new Worker("/worker.js")).onmessage = it => done(it.data))\`));`);
    expect(inPage).toEqual([
      [
        ["background", "user-blocking", "background"],
        "NotAllowedError",
        "user-blocking",
        "moved 1",
        "blocking",
        "moved 2",
        "visible",
        "stays",
        "higher priority",
        "continued",
        "same priority",
      ],
      "in the task",
      "AbortError",
      "in the task",
      "TypeError",
      "TypeError",
      "TypeError",
      "result",
      [true, true, true, "[object TaskSignal]"],
      "background",
    ]);
    expect(inWorker).toEqual(inPage);
  });

  test("each step of a rendering update is taken for the page and its frames", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=/frame style='width: 100px'></iframe>", "/frame": "" });
        const page = await open();
        print(await page.executeJavaScript(\`new Promise(done => {
          const order = [];
          const inner = frames[0];
          inner.matchMedia("(width: 200px)").onchange = () => order.push("change");
          inner.onresize = () => order.push("resize");
          document.querySelector("iframe").style.width = "200px";
          order.push(inner.innerWidth);
          inner.requestAnimationFrame(() => order.push("frame"));
          requestAnimationFrame(() => order.push("page"));
          new ResizeObserver(() => done([...order, "observer"])).observe(document.body);
        })\`));`),
    ).toEqual([[200, "resize", "change", "page", "frame", "observer"]]);
  });

  test("a frame scrolls the page around it, and its media queries decide on definitions", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({
          "/": "<iframe src=/frame style='width: 50px; margin: 2000px 0'></iframe>",
          "/frame": "<style>@function --f() { result: 1 } @media (width > 99px) { @function --f() { result: 2 } }</style><p style='order: --f(); margin: 900px 0'>a",
        });
        const page = await open();
        print(await page.executeJavaScript(\`(() => {
          const p = frames[0].document.querySelector("p");
          p.scrollIntoView();
          const before = [scrollY > 1900, frames[0].scrollY > 800, getComputedStyle(p).order];
          document.querySelector("iframe").style.width = "100px";
          return [...before, getComputedStyle(p).order];
        })()\`));`),
    ).toEqual([[true, true, "1", "2"]]);
  });

  test("events cross between the targets of a document and those of the runtime", async () => {
    expect(
      await run(`
        serve({ "/": "<p id=p></p>" });
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          const seen = [], controller = new AbortController(), { signal } = controller;
          signal.addEventListener("x", event => {
            seen.push(event.detail, event.target === signal, event instanceof Event);
            event.preventDefault();
          });
          const ours = new CustomEvent("x", { detail: 7, cancelable: true });
          seen.push(signal instanceof EventTarget, signal.dispatchEvent(ours), ours.defaultPrevented);
          seen.push(EventTarget.prototype.dispatchEvent.call(signal, new Event("y")));
          try { signal.dispatchEvent({}); } catch (error) { seen.push(error.name); }
          const theirs = await new Promise(resolve => (signal.onabort = resolve, controller.abort()));
          document.body.addEventListener("abort", event => seen.push(event === theirs, event.target === p, event.eventPhase), true);
          return [...(seen.push(p.dispatchEvent(theirs)), seen)];
        })()\`));`),
    ).toEqual([[7, true, true, true, false, true, true, "TypeError", true, true, 1, true]]);
  });

  test("an event of the runtime gets what a page has added to Event.prototype", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          Object.assign(Event.prototype, { proxy: new Proxy(() => typeof new Error().stack, {}), constructs: Map });
          const controller = new AbortController();
          const theirs = await new Promise(resolve => (controller.signal.onabort = resolve, controller.abort()));
          document.body.dispatchEvent(theirs);
          return [theirs.proxy(), theirs.proxy.name, theirs.constructs.name, theirs.preventDefault.name];
        })()\`));`),
    ).toEqual([["string", "bound proxy", "bound constructs", "bound preventDefault"]]);
  });

  test("a window of another origin", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted", "app://other"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=app://other/frame></iframe>", "/frame": "<iframe name=inner></iframe><script>onmessage = it => it.source.postMessage([it.data, it.origin], '*')</script>" });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`(async () => {
          const other = frames[0], thrown = run => { try { run(); } catch (error) { return error instanceof DOMException && error.name; } };
          const answer = new Promise(done => (onmessage = it => done([it.data, it.origin, it.source === other])));
          other.postMessage(1, { targetOrigin: "app://other" });
          return [
            Reflect.ownKeys(other).map(String).join(),
            Object.keys(other).join(),
            [other.self === other, other.parent === window, other[0] === other.inner, other.then, other.close === other.close, other.close.name, other.postMessage.length],
            [Object.getPrototypeOf(other), Object.getPrototypeOf(other.location), Object.getPrototypeOf(other.focus) === Function.prototype],
            Object.getOwnPropertyDescriptor(other.location, "href").get,
            [() => other.document, () => other[1], () => other.location.href, () => (other.name = ""), () => delete other.close, () => "x" in other].map(thrown),
            [() => other.postMessage(() => {}, "*"), () => other.postMessage(1, "no origin")].map(thrown),
            await answer,
          ];
        })()\`));`),
    ).toEqual([
      [
        "0,window,self,frames,location,close,closed,focus,blur,length,top,opener,parent,postMessage,then,Symbol(Symbol.toStringTag),Symbol(Symbol.hasInstance),Symbol(Symbol.isConcatSpreadable)",
        "0",
        [true, true, true, null, true, "close", 1],
        [null, null, true],
        null,
        Array(6).fill("SecurityError"),
        ["DataCloneError", "SyntaxError"],
        [[1, "app://trusted"], "app://other", true],
      ],
    ]);
  });

  test.each([{}, ...(isWindows ? [] : [{ BUN_DESKTOP_PAGE_PROCESSES: "1" }])])(
    "a function that ends with a call is on the stack %j",
    async env => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted"], { inFrames: true });
          serve({
            "/": "<iframe src=/frame></iframe>",
            "/frame": "<script>'use strict'; function send() { return parent.postMessage(0, '*'); } function inner() { return new Error().stack; } function outer() { return inner(); }</script>",
          });
          const page = await open();
          print(await page.executeJavaScript("frames[0].outer().includes('outer')"));
          print(await page.executeJavaScript("new Promise(done => { onmessage = it => done(it.source === frames[0]); frames[0].send(); })"));`,
          {},
          [],
          env,
        ),
      ).toEqual([true, true]);
    },
  );

  test("a worker that goes idle finishes the collection that it has begun", async () => {
    expect(
      await run(
        `const worker = new Worker(path.join(__dirname, "worker.js"));
        print(await new Promise(done => (worker.onmessage = it => done(it.data))));`,
        {
          "worker.js": `
            globalThis.registry = new FinalizationRegistry(() => postMessage("finished"));
            onmessage = () => {};
            setImmediate(() => {
              for (let i = 0; i < 300000; i++) globalThis.list = { next: globalThis.list };
              Bun.gc(true);
              for (let i = 0; i < 100; i++) registry.register({}, i);
              globalThis.large = new ArrayBuffer(64 << 20);
            });`,
        },
        [],
        { BUN_GC_TIMER_DISABLE: "1", BUN_JSC_useGenerationalGC: "0" },
      ),
    ).toEqual(["finished"]);
  });

  test.skipIf(isWindows)("what a busy program lets go of is freed between its tasks", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        await open();
        const files = () => require("fs").readdirSync("/dev/fd").length, before = files();
        for (let i = 0; i < 20; i++) Bun.file(path.join(__dirname, "file" + i)).writer();
        const opened = files() - before;
        require("bun:jsc").edenGC();
        let megabytes = 0;
        for (; megabytes < 12 && files() - before > 10; megabytes += 0.4) {
          globalThis.garbage = Array.from({ length: 400 }, () => new Array(126).fill(0));
          await new Promise(done => setTimeout(done, 45));
        }
        print([opened, megabytes < 12]);`),
    ).toEqual([[20, true]]);
  });

  test.each([
    {},
    { BUN_JSC_collectContinuously: "1" },
    { BUN_JSC_slowPathAllocsBetweenGCs: "50" },
    { BUN_JSC_slowPathAllocsBetweenGCs: "50", BUN_JSC_useEdenCollectionsAtSlowPathAllocs: "1" },
  ])("nodes and frames come and go between frames %j", async env => {
    expect(
      await run(
        `app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({ "/": "<ul></ul><div></div>", "/frame": "<p>a</p><script>onload = () => parent.loaded(document.body.firstChild)</script>" });
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          const list = document.querySelector("ul"), kept = [];
          let wrong = 0;
          for (let round = 0; round < 12; round++) {
            kept.push(await new Promise(done => ((loaded = done), (list.nextSibling.innerHTML = "<iframe src=/frame></iframe>"))));
            list.innerHTML = "<li><b>x</b>".repeat(100);
            for (const item of list.children) (item.round = round), item.addEventListener("click", () => wrong--);
            kept.push(list.children[round]);
            self.garbage = Array.from({ length: 3000 }, () => new Array(126).fill(round));
            await new Promise(requestAnimationFrame);
            await new Promise(done => setTimeout(done, 20));
            for (const item of list.children) (wrong += 1 + (item.round !== round)), item.click();
          }
          return [wrong, kept.map(it => it.textContent).join(""), kept.filter(it => it.isConnected).length];
        })()\`));`,
        {},
        [],
        env,
      ),
    ).toEqual([[0, "ax".repeat(12), 13]]);
  });

  test("a window is resized by a page that is going away", async () => {
    expect(
      await run(`
        serve({ "/": "<script>onpagehide = () => resizeTo(200, 210)</script>", "/next": "" });
        const page = await open();
        const updated = once(page, "content-bounds-updated");
        await page.loadURL("app://trusted/next");
        const [, { width, height }] = await updated;
        print([width, height, await page.executeJavaScript("outerWidth")]);`),
    ).toEqual([[200, 210, 200]]);
  });

  test("the global objects", async () => {
    const chain = `(() => { const names = []; for (let it = self; (it = Object.getPrototypeOf(it)); ) names.push(it[Symbol.toStringTag]); return names; })()`;
    expect(
      await run(`
        serve({ "/": "<p id=named><iframe></iframe>", "/worker.js": "postMessage([${chain}, name, String(location), location.search, navigator.language, typeof fetch])" });
        const page = await open();
        print(await page.executeJavaScript(\`${chain}\`));
        print(await page.executeJavaScript(\`new Promise(done => new Worker("/worker.js?a", { name: "w" }).onmessage = it => done(it.data))\`));
        print(await page.executeJavaScript(\`[
          named.localName,
          ["innerWidth", "onload", "navigator", "requestAnimationFrame"].map(name => {
            const { get, value } = Object.getOwnPropertyDescriptor(window, name);
            try { (get ?? value).call({}, () => {}); } catch (error) { return error.message; }
          }),
          (status = 1, status),
          (innerWidth = "replaced", innerWidth),
          navigator.plugins instanceof PluginArray && navigator.mimeTypes.namedItem("a"),
          [frames[0], open("")].map(it => String(it.navigator.locks)),
          navigator === clientInformation && navigator.languages === navigator.languages && Object.isFrozen(navigator.languages),
        ]\`));
        print(await page.executeJavaScript(\`navigator.userAgentData.getHighEntropyValues(["bitness", "platformVersion"]).then(Object.keys)\`));`),
    ).toEqual([
      ["Window", "WindowProperties", "EventTarget", null],
      [
        ["DedicatedWorkerGlobalScope", "WorkerGlobalScope", "EventTarget", null],
        "w",
        "app://trusted/worker.js?a",
        "?a",
        expect.any(String),
        "function",
      ],
      ["p", Array(4).fill("Illegal invocation"), "1", "replaced", null, Array(2).fill("[object LockManager]"), true],
      ["brands", "mobile", "platform", "bitness", "platformVersion"],
    ]);
  });

  test("a page resizes its window", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        const move = "resizeTo(300, 1), resizeBy(1, 2), resizeBy(1, 2), [outerWidth, outerHeight]";
        const asked = [];
        page.on("content-bounds-updated", (_, bounds) => asked.push(bounds));
        print(await page.executeJavaScript(move));
        while (asked.length < 3) await new Promise(setImmediate);
        print(BrowserWindow.fromWebContents(page).getSize());
        page.on("content-bounds-updated", event => event.preventDefault());
        await page.executeJavaScript("resizeBy(5, 5)");
        while (asked.length < 4) await new Promise(setImmediate);
        print(await page.executeJavaScript("[outerWidth, outerHeight]"));`),
    ).toEqual(Array(3).fill([302, 104]));
  });

  test("the timers of a preload script are of its world", async () => {
    expect(
      await run(
        `serve({ "/": "" });
         const seen = once(ipcMain, "seen");
         const page = await open(undefined, preload);
         print((await seen).slice(1));
         print(await page.executeJavaScript("typeof secret"));`,
        {
          "preload.js": `
            setTimeout("globalThis.secret = 1");
            setTimeout(function () {
              require("electron").ipcRenderer.send("seen", this === globalThis, self === globalThis, globalThis.secret);
            });`,
        },
      ),
    ).toEqual([[true, true, 1], "undefined"]);
  });

  test("contentTracing", async () => {
    expect(
      await run(`
        const { contentTracing } = electron;
        using server = Bun.serve({ port: 0, fetch: () => new Response("", { headers: { "content-type": "text/html" } }) });
        app.trustOrigins([server.url.origin]);
        const page = await open(server.url.href);
        print(await contentTracing.stopRecording().catch(error => error.message));
        for (const options of [{}, { included_categories: ["disabled-by-default-v8.*"], excluded_categories: ["*"] }, { categoryFilter: "blink.*,disabled-by-default-v8.cpu_profiler" }, { categoryFilter: "-blink.*" }]) {
          await contentTracing.startRecording(options);
          await page.executeJavaScript(\`(async function busy() {
            performance.mark("a");
            const timed = new Promise(resolve => new PerformanceObserver(resolve).observe({ type: "resource" }));
            await Promise.all([fetch("/c").then(it => it.text()), timed]);
            for (const end = performance.now() + 20; performance.now() < end; );
            performance.measure("b", "a");
          })()\`);
          const { traceEvents } = await Bun.file(await contentTracing.stopRecording()).json();
          const nodes = traceEvents.flatMap(it => it.args.data?.cpuProfile?.nodes ?? []);
          print([traceEvents.filter(it => it.pid === page.getOSProcessId() && it.ph !== "M" && !/paint|visib/.test(it.args.entryType)).map(it => it.ph + " " + path.basename(it.name)).join(), nodes.some(it => it.callFrame.functionName.includes("busy") && it.parent)]);
        }`),
    ).toEqual([
      "Failed to stop tracing (was a trace in progress?)",
      ["I a,b c,e c,b b,e b", false],
      ["P Profile,P ProfileChunk", true],
      ["I a,b b,e b,P Profile,P ProfileChunk", true],
      ["b c,e c", false],
    ]);
  });

  test("empty ArrayBuffers from the network are collected", async () => {
    expect(
      await run(`
        using server = Bun.serve({
          port: 0,
          fetch: (request, server) => server.upgrade(request) || new Response("", { headers: { "content-type": "text/html" } }),
          websocket: { open: socket => socket.send(new Uint8Array()), message() {} },
        });
        app.trustOrigins([server.url.origin]);
        const page = await open(server.url.href);
        print(await page.executeJavaScript(\`Promise.all([
          ...["", null, new Blob([]), new Uint8Array()].map(it => new Response(it).arrayBuffer()),
          fetch("/").then(it => it.arrayBuffer()),
          new Promise(resolve => {
            const request = Object.assign(new XMLHttpRequest(), { responseType: "arraybuffer", onload: () => resolve(request.response) });
            request.open("GET", "/");
            request.send();
          }),
          new Promise(resolve => Object.assign(new WebSocket(location.href), { binaryType: "arraybuffer", onmessage: event => resolve(event.data) })),
        ]).then(all => all.map(it => it.byteLength + +it.detached))\`));
        await page.loadURL("about:blank");
        Bun.gc(true);`),
    ).toEqual([[0, 0, 0, 0, 0, 0, 0]]);
  });

  test("netLog", async () => {
    expect(
      await run(`
        const { netLog } = electron;
        using server = Bun.serve({ port: 0, fetch: () => new Response("", { headers: { "set-cookie": "a=secret" } }) });
        const file = path.join(__dirname, "log.json");
        using rude = Bun.listen({ port: 0, hostname: "127.0.0.1", socket: { data: socket => socket.end() } });
        for (const captureMode of ["default", "includeSensitive"]) {
          await netLog.startLogging(file, { captureMode });
          print(netLog.currentlyLogging);
          await net.fetch(server.url + "a");
          await net.fetch("http://127.0.0.1:" + rude.port).catch(() => {});
          await netLog.stopLogging();
          const { constants, events } = await Bun.file(file).json();
          print([constants.netError.ERR_EMPTY_RESPONSE, events.filter(it => it.type === 2).map(it => it.params.method ?? it.params.net_error ?? 0), events.flatMap(it => it.params.headers ?? []).filter(it => /^HTTP|cookie/i.test(it))]);
        }
        print(session.defaultSession.netLog.currentlyLogging);
        for (const fail of [() => netLog.stopLogging(), () => netLog.startLogging(""), () => netLog.startLogging(file, { captureMode: "a" }), () => netLog.startLogging(file + "/a")])
          print(await (async () => fail())().catch(error => error.message));`),
    ).toEqual([
      true,
      [-324, ["GET", 0, "GET", -324], ["HTTP/1.1 200", "set-cookie: [8 bytes were stripped]"]],
      true,
      [-324, ["GET", 0, "GET", -324], ["HTTP/1.1 200", "set-cookie: a=secret"]],
      false,
      "No net log in progress",
      "The first parameter must be a valid string",
      "Invalid value for captureMode",
      "Failed to create file",
    ]);
  });

  test("TouchBar", async () => {
    expect(
      await run(`
        const { TouchBar } = electron;
        const { TouchBarButton, TouchBarGroup, TouchBarOtherItemsProxy, TouchBarScrubber } = TouchBar;
        const button = new TouchBarButton({ label: "a" });
        button.on("change", (...about) => print(about));
        button.label = "b";
        print([button.label, button.enabled, new TouchBarScrubber({ items: [] }).mode]);
        const bar = new TouchBar({ items: [new TouchBarGroup({ items: new TouchBar({ items: [button] }) })], escapeItem: button });
        print(bar.escapeItem === button);
        for (const it of [bar, [button], null]) new BrowserWindow().setTouchBar(it);
        for (const fail of [() => new TouchBar(), () => new TouchBar([1]), () => new TouchBar([button, button]), () => new TouchBar([new TouchBarOtherItemsProxy(), new TouchBarOtherItemsProxy()]), () => (bar.escapeItem = {})])
          try { fail(); } catch (error) { print(error.message); }`),
    ).toEqual([
      ["1", "button"],
      ["b", true, "free"],
      true,
      "Must specify options object as first argument",
      "Each item must be an instance of TouchBarItem",
      "Cannot add a single instance of TouchBarItem multiple times in a TouchBar",
      "Must only have one OtherItemsProxy per TouchBar",
      "Escape item must be an instance of TouchBarItem",
    ]);
  });

  test("savePage", async () => {
    expect(
      await run(`
        serve({ "/": "<!doctype html><title>é</title><script>document.title += 1</script>" });
        const page = await open(), file = path.join(__dirname, "saved.html");
        await page.savePage(file, "HTMLOnly");
        print(await Bun.file(file).text());`),
    ).toEqual(["<!doctype html><title>é</title><script>document.title += 1</script>"]);
  });

  test("a window is disabled while it has a modal window", async () => {
    expect(
      await run(`
        const parent = new BrowserWindow(), child = new BrowserWindow({ parent, modal: true, show: false });
        for (const step of ["isVisible", "show", "hide", "show", "destroy"]) child[step](), print(parent.isEnabled());`),
    ).toEqual([true, false, true, false, true]);
  });

  const hasX11 = isLinux && !!process.env.DISPLAY && ["xdotool", "xprop", "xwininfo"].every(it => Bun.which(it));
  test.skipIf(!hasX11)("what the X server is told of a window", async () => {
    expect(
      await run(
        `
        const { ImageView, nativeImage } = electron;
        const ask = (...command) => require("child_process").execFileSync(command[0], command.slice(1), { encoding: "utf8" });
        const until = async condition => { while (!(await condition())) await new Promise(setImmediate); };
        const red = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 });
        serve({ "/": "<script>seen = []; onmousedown = e => seen.push(e.button)</script>" });
        const page = await open(), window = BrowserWindow.fromWebContents(page), other = new BrowserWindow({ show: false });
        const [id, otherId] = [window, other].map(it => "0x" + it.getNativeWindowHandle().readUInt32LE().toString(16));
        window.setIcon(red);
        await until(() => ask("xprop", "-id", id, "-f", "_NET_WM_ICON", "32c", "_NET_WM_ICON").includes("= 1, 1, 4294901760"));
        window.setShape([{ x: 0, y: 0, width: 50, height: 60 }, { x: 70, y: 0, width: 30, height: 10 }]);
        await until(() => ask("xwininfo", "-id", id, "-shape").includes("Window shape extents:  100x60+0+0"));
        window.setShape([]);
        await until(() => ask("xwininfo", "-id", id, "-shape").includes("No window shape defined"));
        other.setParentWindow(window);
        await until(() => ask("xprop", "-id", otherId, "WM_TRANSIENT_FOR").includes(id));
        other.setParentWindow(null);
        await until(() => !ask("xprop", "-id", otherId, "WM_TRANSIENT_FOR").includes(id));
        print("done");`,
        {},
        [],
        { BUN_DESKTOP_HEADLESS: undefined },
      ),
    ).toEqual(["done"]);
  });

  test.skipIf(!isMacOS)("a window that can be seen through is opaque while a color fills it", async () => {
    expect(
      await run(
        `
        const { dlopen } = require("bun:ffi");
        const { sel_registerName, objc_msgSend } = dlopen("/usr/lib/libobjc.A.dylib", {
          sel_registerName: { args: ["cstring"], returns: "u64" },
          objc_msgSend: { args: ["u64", "u64"], returns: "u64" },
        }).symbols;
        const ask = (object, name) => objc_msgSend(object, sel_registerName(Buffer.from(name + "\\0")));
        const window = new BrowserWindow({ show: false, vibrancy: "sidebar", backgroundColor: "#ffffff" });
        const native = ask(window.getNativeWindowHandle().readBigUInt64LE(), "window");
        const after = async change => (change(), await window.capturePage(), Number(ask(native, "isOpaque") & 1n));
        print([
          await after(() => {}),
          await after(() => window.setVibrancy(null)),
          await after(() => window.setBackgroundColor("#00000000")),
          await after(() => window.setBackgroundColor("#ffffff")),
        ]);`,
        {},
        ["--use-mock-keychain"],
        { BUN_DESKTOP_HEADLESS: undefined },
      ),
    ).toEqual([[0, 1, 0, 1]]);
  });

  test.skipIf(!isLinux)("app.getApplicationInfoForProtocol()", async () => {
    expect(
      await run(
        `process.env.XDG_DATA_HOME = process.env.XDG_CONFIG_HOME = __dirname;
        const { name, path: file } = await app.getApplicationInfoForProtocol("demo://a");
        print([name, path.basename(file), await app.getApplicationInfoForProtocol("nobody://a").catch(error => error.message)]);`,
        {
          "mimeapps.list": "[Default Applications]\nx-scheme-handler/demo=demo.desktop\n",
          "applications/demo.desktop": "[Desktop Entry]\nName=Demo\nExec=env %u\n",
        },
      ),
    ).toEqual([["Demo", "env", expect.any(String)]]);
  });

  describe("scripts that run while the tree changes", () => {
    const evaluate = async (html: string, script: string, env = {}) =>
      (
        await run(
          `app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
          serve({ "/": ${JSON.stringify(html)} });
          const page = await open();
          page.on("console-message", () => Bun.gc(true));
          print(await page.executeJavaScript(${JSON.stringify(`{ const $ = id => document.getElementById(id); ${script} }`)}));`,
          {},
          [],
          env,
        )
      )[0];
    const frame = "<div id=a><p id=p><iframe id=f></iframe></p></div><div id=b><i id=i></i></div><div id=c></div>";
    const shape = `[a, b, c].map(it => [Array.from(it.children, it => it.id).join(), it.querySelectorAll("*").length].join())`;

    test.each([
      ["move the node", "c.append(p)", "b.append(p)", [",0", "i,1", "p,2"]],
      [
        "move the node out of the document",
        "document.createElement('q').append(p)",
        "b.append(p)",
        [",0", "i,1", ",0"],
      ],
      ["move the reference node", "c.append(i)", "b.insertBefore(p, i)", [",0", ",0", "i,1"]],
      ["move the new parent into the node", "p.append(b)", "b.append(p)", [",0", "i,1", ",0"]],
      ["move the old parent into the node", "p.append(a)", "p.remove()", [",0", "i,1", ",0"]],
      ["remove the old parent", "a.remove()", "b.append(p)", [",0", "i,p,3", ",0"]],
      ["change the node", "p.append(i)", "b.append(p)", [",0", "p,3", ",0"]],
    ])("%s", async (_, inside, outside, expected) => {
      expect(
        await evaluate(
          frame,
          `const [a, b, c, p, i] = Array.from("abcpi", $);
          [a, p].forEach(it => new MutationObserver(() => {}).observe(it, { childList: true, subtree: true }));
          $("f").contentWindow.addEventListener("pagehide", () => ${inside});
          ${outside};
          document.body.offsetHeight;
          ${shape}`,
        ),
      ).toEqual(expected);
    });

    test("do not run in moveBefore", async () => {
      expect(
        await evaluate(
          "<script id=s type=none>document.title = 'ran'<\/script><div id=a></div>",
          `const s = $("s").cloneNode(), b = document.createElement("b");
          s.append("document.title = 'ran'", b);
          document.body.append(s);
          s.removeAttribute("type");
          $("a").moveBefore(b, null);
          document.title`,
        ),
      ).toBe("");
    });

    test("a live collection whose root has been in another window", async () => {
      expect(
        await evaluate(
          "<iframe id=f></iframe>",
          `const root = document.createElement("div");
          root.innerHTML = "<b></b>";
          const all = root.getElementsByTagName("b"), before = all.length;
          $("f").contentDocument.adoptNode(root).textContent = "";
          document.adoptNode(root);
          [before, all.length]`,
        ),
      ).toEqual([1, 0]);
    });

    test("members that are called on something else throw", async () => {
      expect(
        await evaluate(
          "",
          `const thrown = new Set();
          const receivers = [document, new Text(), new Event("x"), {}, new Range(), new DocumentFragment()];
          receivers.push(document.createElement("q"), document.createAttribute("a"));
          for (const name of Object.getOwnPropertyNames(self).filter(it => /^([A-Z].*Element|Node|ShadowRoot)$/.test(it)))
            for (const it of Object.values(Object.getOwnPropertyDescriptors(self[name]?.prototype ?? {})))
              for (const member of [it.get, it.set, it.value].filter(it => typeof it === "function"))
                for (const receiver of receivers)
                  try { member.call(receiver, "")?.catch?.(() => {}) } catch (error) { thrown.add(error instanceof Error) };
          [...thrown]`,
        ),
      ).toEqual([true]);
    });

    test("documents are made when the stack is full", async () => {
      expect(
        await evaluate(
          "",
          `let left = 200;
          const make = () => [document.cloneNode(), new DOMParser().parseFromString("<template>", "text/html")];
          (function deeper() { try { deeper() } catch {} if (left-- > 0) try { make() } catch {} })();
          make().length`,
        ),
      ).toBe(2);
    });
  });

  test("a match of find may end at a line break", async () => {
    expect(
      await run(`
        serve({ "/": "<p>abc<br>def</p>" });
        const page = await open();
        print(await page.executeJavaScript("[find('c '), String(getSelection())]"));`),
    ).toEqual([[true, "c"]]);
  });

  test("typing goes to the focused control when something else is selected", async () => {
    expect(
      await run(`
        serve({ "/": "<input type=number value=12><p>some text" });
        const page = await open();
        await page.executeJavaScript("document.body.firstChild.focus(); getSelection().setBaseAndExtent(document.body.lastChild.firstChild, 5, document.body.lastChild.firstChild, 8)");
        await page.insertText("3");
        print(await page.executeJavaScript("document.body.firstChild.value.length"));`),
    ).toEqual([3]);
  });

  test("the caret moves over a line break in isolated text", async () => {
    expect(
      await run(`
        serve({ "/": "<div style='white-space: pre'><bdi>\\nabc</bdi></div>" });
        const page = await open();
        print(await page.executeJavaScript(\`
          getSelection().collapse(document.querySelector("bdi").firstChild, 0);
          getSelection().modify("move", "forward", "character");
          getSelection().focusOffset\`));`),
    ).toEqual([1]);
  });

  test("a source starts with many audio nodes behind it", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        print(await (await open()).executeJavaScript(\`
          const context = new AudioContext(), source = context.createOscillator();
          let last = source;
          for (let i = 0; i < 50000; i++) last = last.connect(context.createGain());
          source.start();
          context.close();
          last.numberOfInputs\`));`),
    ).toEqual([1]);
  });

  test("a database opens after many requests of a removed frame", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=/frame></iframe>", "/frame": "" });
        print(await (await open()).executeJavaScript(\`new Promise(done => {
          indexedDB.open("db", 1).onsuccess = ({ target: { result } }) => {
            indexedDB.open("db", 2).onblocked = () => {
              document.querySelector("iframe").remove();
              result.close();
              indexedDB.open("db").onsuccess = event => done(event.target.result.version);
            };
            for (let i = 0; i < 100000; i++) frames[0].indexedDB.open("db");
          };
        })\`));`),
    ).toEqual([2]);
  });

  test("a long key is not repeated without end in an index", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        print(await (await open()).executeJavaScript(\`new Promise(done => {
          const request = indexedDB.open("db");
          request.onupgradeneeded = () => request.result.createObjectStore("a").createIndex("b", "b", { multiEntry: true });
          request.onsuccess = async () => {
            const put = length => new Promise(done => {
              const transaction = request.result.transaction("a", "readwrite");
              const value = { b: Array.from({ length }, (_, it) => it) };
              transaction.objectStore("a").put(value, "a".repeat(1 << 20)).onsuccess = () => transaction.abort();
              transaction.oncomplete = transaction.onabort = () => done(transaction.error?.name);
            });
            done([await put(2500), await put(1)]);
          };
        })\`));`),
    ).toEqual([["QuotaExceededError", null]]);
  });

  test("a key path that has been stored is no string", async () => {
    expect(
      await run(`
        const { Database } = require("bun:sqlite"), other = session.fromPartition("persist:other");
        const put = \`new Promise(done => {
          const request = indexedDB.open("db");
          request.onupgradeneeded = () => request.result.createObjectStore("a").createIndex("b", "z", { multiEntry: true });
          request.onsuccess = () => request.result.transaction("a", "readwrite").objectStore("a").put({ z: [1] }, 1).onsuccess = event => done(event.type);
        })\`;
        serve({ "/": "" });
        print(await (await open()).executeJavaScript(put));
        const copy = path.join(other.storagePath, "Web Storage.sqlite");
        require("fs").mkdirSync(other.storagePath, { recursive: true });
        new Database(path.join(app.getPath("userData"), "Web Storage.sqlite")).run("VACUUM INTO ?", [copy]);
        const all = new Database(copy), { stores } = all.query("SELECT stores FROM databases").get();
        stores.set([0x40, 2, 0], Buffer.from(stores).indexOf("0{\\0"));
        all.run("UPDATE databases SET stores = ?", [stores]);
        all.close();
        other.protocol.handle("app", () => new Response("", { headers: { "content-type": "text/html" } }));
        print(await (await open(undefined, { webPreferences: { session: other } })).executeJavaScript(put));`),
    ).toEqual(["success", "success"]);
  });

  test("workers of workers, and shared workers", async () => {
    expect(
      await run(`
        serve(
          {
            "/": "",
            "/outer.js": \`
              const flag = new Int32Array(new SharedArrayBuffer(8));
              const inner = new Worker("/inner.js");
              inner.onmessage = () => {
                inner.postMessage(flag);
                Atomics.wait(flag, 0, 0);
                postMessage(flag[1]);
                inner.onerror = event => postMessage([event.message, event.lineno]);
              };\`,
            "/inner.js": \`
              onmessage = ({ data }) => {
                data[1] = navigator.onLine ? 7 : 8;
                Atomics.store(data, 0, 1);
                Atomics.notify(data, 0);
                throw new Error("inner");
              };
              postMessage(0);\`,
            "/shared.js": \`
              let count = 0;
              onconnect = ({ ports: [port] }) => {
                port.onmessage = () => (close(), port.postMessage("closed"));
                fetch("/asked").finally(() => port.postMessage(++count));
              };\`,
          },
          { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" },
        );
        process.on("worker", () => print("the app sees a thread"));
        const page = await open();
        session.defaultSession.webRequest.onBeforeRequest({ urls: ["app://trusted/asked"] }, (details, next) => (print(details.webContentsId === page.id), next({})));
        print(await page.executeJavaScript(\`new Promise(done => {
          const seen = [], worker = new Worker("/outer.js");
          worker.onmessage = ({ data }) => seen.push(data);
          worker.onerror = event => (event.preventDefault(), done([...seen, event.message]));
        })\`));
        print(await page.executeJavaScript(\`(async () => {
          const next = port => new Promise(done => port.onmessage = ({ data }) => done(data));
          const first = new SharedWorker("/shared.js").port, seen = [await next(first), await next(new SharedWorker("/shared.js").port)];
          seen.push(await new Promise(done => new SharedWorker("/shared.js", { type: "module" }).onerror = ({ type }) => done(type)));
          first.postMessage(0);
          return [...seen, await next(first), await next(new SharedWorker("/shared.js").port)];
        })()\`));`),
    ).toEqual([
      [7, ["Uncaught Error: inner", 6], "Uncaught Error: inner"],
      true,
      true,
      true,
      [1, 2, "error", "closed", 1],
    ]);
  });

  test("errors while a worker starts", async () => {
    expect(
      await run(`
        serve({
          "/": "",
          "/parse.js": "1 +;",
          "/eval.js": "onconnect = event => event.ports[0].postMessage('runs'); eval('1 +;')",
          "/late.js": \`
            const rejected = Promise.reject(), { port1, port2 } = new MessageChannel();
            onrejectionhandled = event => postMessage(event.type);
            port1.onmessage = ({ data }) => data ? port2.postMessage(0) : rejected.catch(() => {});
            port2.postMessage(1);\`,
        });
        const page = await open();
        print(await page.executeJavaScript(\`Promise.all([new SharedWorker("/parse.js"), new SharedWorker("/eval.js"), new Worker("/late.js")].map(it => new Promise(done => {
          it.onerror = event => done(event.type);
          (it.port ?? it).onmessage = event => done(event.data);
        })))\`));`),
    ).toEqual([["error", "runs", "rejectionhandled"]]);
  });

  test("what is logged for a worker without a place in a script", async () => {
    expect(
      await run(`
        serve({ "/": "", "/worker.js": "fetch('app://other/').catch(() => {}); Promise.reject(1)" }, { "content-security-policy": "connect-src 'none'" });
        const page = await open(), seen = [];
        const logged = new Promise(done => page.on("console-message", ({ level, lineNumber }) => seen.push([level, typeof lineNumber]) === 2 && done()));
        await page.executeJavaScript("void new Worker('/worker.js')");
        await logged;
        print(seen);`),
    ).toEqual([
      [
        ["error", "number"],
        ["error", "number"],
      ],
    ]);
  });

  test("a page that replaces `origin` keeps its origin", async () => {
    expect(
      await run(`
        protocol.handle("https", () => new Response("", { headers: { "content-type": "text/html" } }));
        app.trustOrigins(["https://a.test"]);
        const page = await open("https://a.test/");
        print(await page.executeJavaScript(\`
          origin = "https://b.test";
          ["https://a.test/%s", "https://b.test/%s"].map(url => {
            try { navigator.registerProtocolHandler("web+a", url); } catch (error) { return error.name; }
          })\`));`),
    ).toEqual([[null, "SecurityError"]]);
  });

  test("keys of nested arrays", async () => {
    expect(
      await run(`
        serve({
          "/": "",
          "/worker.js": \`
            let shared = [new Uint8Array(4096).fill(2)], nested = [], thrown;
            for (let i = 0; i < 40; i++) shared = [shared, shared];
            for (let i = 0; i < 1999; i++) nested = [nested];
            try { IDBKeyRange.only(shared); } catch (error) { thrown = error.name; }
            const range = IDBKeyRange.only(nested);
            let level = 0, failures = 0, lower;
            (function descend() {
              try { descend(); } catch {}
              if (++level >= 64 && !(level & (level - 1))) try { lower ??= range.lower; } catch { failures++; }
            })();
            lower ??= range.lower;
            postMessage([thrown, failures > 0, Array.isArray(lower)]);\`,
        });
        print(await (await open()).executeJavaScript(\`new Promise(done => new Worker("/worker.js").onmessage = it => done(it.data))\`));`),
    ).toEqual([["DataError", true, true]]);
  });

  test("a worker ends with responses that it has not read", async () => {
    expect(
      await run(`
        serve({
          "/": "",
          "/large": Buffer.alloc(2 << 20, "a").toString(),
          "/worker.js": "Promise.all(Array.from({ length: 20 }, () => fetch('/large', new AbortController()))).then(it => postMessage((self.kept = it)[0].status))",
        });
        print(await (await open()).executeJavaScript(\`(async () => {
          const all = new Set();
          for (let i = 0; i < 3; i++) {
            const worker = new Worker("/worker.js");
            all.add(await new Promise(done => (worker.onmessage = it => done(it.data))));
            worker.terminate();
          }
          return [...all];
        })()\`));`),
    ).toEqual([[200]]);
  });

  test("a request is aborted while its response is parsed", async () => {
    expect(
      await run(`
        protocol.handle("app", ({ url }) => new Response("<a xmlns='http://www.w3.org/1999/xhtml'><form><input/><iframe/><style/><script/><img/></form></a>", { headers: { "content-type": url.endsWith(".xml") ? "text/xml" : "text/plain" } }));
        print(await (await open()).executeJavaScript(\`new Promise(done => {
          const request = new XMLHttpRequest(), iterate = Array.prototype[Symbol.iterator];
          request.onload = () => {
            Array.prototype[Symbol.iterator] = function () { request.abort(); return iterate.call(this); };
            const { responseXML } = request;
            Array.prototype[Symbol.iterator] = iterate;
            done(responseXML.documentElement.localName);
          };
          request.open("GET", "/a.xml");
          request.send();
        })\`));`),
    ).toEqual(["a"]);
  });

  test("the app outlives an observable that is subscribed to without end", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open(), reported = once(page, "console-message");
        print(await page.executeJavaScript(\`
          const failing = () => new Observable(subscriber => subscriber.error(1)).catch(failing);
          onerror = () => {};
          failing().subscribe();
          "returned"\`));
        print((await reported)[0].message);`),
    ).toEqual(["returned", "Uncaught RangeError: Maximum call stack size exceeded."]);
  });

  test.each([
    "<style>p::first-letter { initial-letter: 99999999 }</style><p>abc",
    "<p style='width: 3.3e7px; text-wrap: balance'>" +
      "<b style='display: inline-block; width: 1.23e7px'></b> ".repeat(3),
    "<input style='font-size-adjust: 3e38' value=a>",
    "<p style='display: flex'><img srcset='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7 1e-40x'>",
  ])("a page with very large lengths is laid out: %s", async html => {
    expect(
      await run(`
        serve({ "/": ${JSON.stringify(html)} });
        print(await (await open()).executeJavaScript("document.body.offsetHeight > 0"));`),
    ).toEqual([true]);
  });

  test("a page loads with an embed that has nothing to show", async () => {
    expect(
      await run(`
        serve({ "/": "<embed src='https://example.invalid/a'>" });
        print(await (await open()).executeJavaScript("document.readyState"));`),
    ).toEqual(["complete"]);
  });

  test("the csp attribute of a frame does not allow inline scripts that its document did not come with", async () => {
    expect(
      await run(
        `app.trustOrigins([], { inFrames: true });
        const page = await open(require("url").pathToFileURL(__dirname + "/outer.html").href);
        print(await page.executeJavaScript("frames[0].document.title"));`,
        {
          "outer.html": `<iframe csp="script-src 'unsafe-inline' file:" src="inner.html"></iframe>`,
          "inner.html": `<title>kept</title><body><script src="inner.js"></script>`,
          "inner.js": `document.body.innerHTML = "<b onclick='document.title = 1'></b>"; document.body.firstChild.click();`,
        },
      ),
    ).toEqual(["kept"]);
  });

  test("the app outlives errors that nothing handles", async () => {
    expect(
      await run(`
        const contents = await open("about:blank");
        Promise.reject(new Error("rejected"));
        print((await once(process, "warning"))[0].name);
        electron.dialog.showErrorBox = (title, content) => process.emit("shown", content);
        setImmediate(() => { throw new Error("thrown"); });
        print((await once(process, "shown"))[0].split("\\n").slice(0, 2));
        print(await contents.executeJavaScript("1 + 1"));`),
    ).toEqual(["UnhandledPromiseRejectionWarning", ["Uncaught Exception:", "Error: thrown"], 2]);
  });

  test("zoom levels are kept", async () => {
    expect(
      await run(
        `serve({ "/": "" });
        print((await open()).getZoomLevel());`,
        { "data/Zoom Levels": JSON.stringify({ trusted: 2 }) },
      ),
    ).toEqual([2]);
  });

  test("the main process", async () => {
    expect(
      await run(
        `print([process.type, typeof process.versions.electron, app.name, app.getVersion(), app.isPackaged, app.isReady()]);
         print([app.commandLine.getSwitchValue("flag"), app.commandLine.hasSwitch("other")]);
         print([require("electron/main").app === app, (await import("electron")).app === app]);
         print(require("original-fs").readFileSync === require("fs").readFileSync);`,
        {},
        ["--flag=value"],
      ),
    ).toEqual([["browser", "string", "Fixture", "1.2.3", false, true], ["value", false], [true, true], true]);
  });

  test("a page has the globals of a browser", async () => {
    expect(
      await run(`
        serve({ "/": "<!doctype html><title>Hello</title><script>var declared = 1</script>" });
        const page = await open();
        print(await page.executeJavaScript(\`[
          typeof process, typeof Bun, typeof require, typeof Buffer, typeof global, typeof setImmediate,
          window === globalThis, window.declared, location.origin, new URL("/a", location).origin, isSecureContext,
          typeof setTimeout(() => {}), navigator.userAgent.includes("Electron/"),
        ]\`));
        print([page.getTitle(), page.getURL(), page.mainFrame.origin]);
        print(await page.executeJavaScript("Array") .catch(error => error.name));
        print(await page.executeJavaScript("throw 1").catch(error => error.message.slice(0, 24)));`),
    ).toEqual([
      [...Array(6).fill("undefined"), true, 1, "app://trusted", "app://trusted", true, "number", true],
      ["Hello", "app://trusted/", "app://trusted"],
      "DataCloneError",
      "Script failed to execute",
    ]);
  });

  test("the history forgets its oldest entries", async () => {
    expect(
      await run(`
        serve({ "/": "a" });
        const page = new BrowserWindow().webContents;
        await page.loadURL("app://trusted/");
        await page.executeJavaScript(\`new Promise(resolve => {
          navigation.currentEntry.ondispose = () => resolve();
          for (let i = 1; i <= 60; i++) history.pushState(i, "", "/" + i);
        })\`);
        print(await page.executeJavaScript("[history.length, navigation.entries().length, navigation.currentEntry.index, navigation.entries()[0].url]"));
        page.navigationHistory.goBack();
        print(await page.executeJavaScript("new Promise(resolve => history.state === 59 ? resolve(59) : (onpopstate = event => resolve(event.state)))"));
        print([page.navigationHistory.length(), page.navigationHistory.getActiveIndex()]);`),
    ).toEqual([[50, 50, 49, "app://trusted/11"], 59, [50, 48]]);
  });

  test("a page cannot stop what the app loads by going somewhere itself", async () => {
    expect(
      await run(`
        const asked = Promise.withResolvers(), answer = Promise.withResolvers();
        serve({ "/": "a", "/b": "b", "/c": "c", "/slow": () => (asked.resolve(), answer.promise) });
        const page = new BrowserWindow().webContents;
        await page.loadURL("app://trusted/");
        await page.loadURL("app://trusted/b");
        const loading = page.loadURL("app://trusted/slow");
        await asked.promise;
        await page.mainFrame.executeJavaScript("history.back(), (location.href = '/c'), new Promise(resolve => setTimeout(resolve))");
        answer.resolve(new Response("slow", { headers: { "content-type": "text/html" } }));
        await loading;
        print(page.getURL());`),
    ).toEqual(["app://trusted/slow"]);
  });

  test("a traversal that the top window refuses fails in the frame that asked for it", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=/b></iframe>", "/b": "b" });
        const page = new BrowserWindow().webContents;
        await page.loadURL("app://trusted/");
        print(await page.executeJavaScript(\`(async () => {
          const inner = frames[0].navigation;
          await inner.navigate("#1").finished;
          await navigation.navigate("#2").finished;
          navigation.onnavigate = event => event.preventDefault();
          const { committed, finished } = inner.traverseTo(inner.entries()[0].key);
          const failures = (await Promise.allSettled([committed, finished])).map(it => it.reason.name);
          return [failures, location.hash, frames[0].location.hash];
        })()\`));`),
    ).toEqual([[["AbortError", "AbortError"], "#2", "#1"]]);
  });

  test("a page cannot add to what its host tells it", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted", "app://other"], { inFrames: true, injectedScripts: true });
        serve({
          "/": "<iframe src=app://other/frame></iframe>",
          "/frame": \`<script>
            const read = [];
            for (const name of ["isByUser", "download", "srcdoc", "isQuiet", "leaves"]) Object.defineProperty(Object.prototype, name, { get: () => void read.push(name) });
            navigation.onnavigate = event => setTimeout(() => parent.postMessage([event.userInitiated, read], "*"));
          </script>\`,
        });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`new Promise(done => {
          onmessage = event => done(event.data);
          frames[0].focus();
          frames[0].location = "app://other/frame#a";
        })\`));`),
    ).toEqual([[false, []]]);
  });

  test("a link to a fragment replaces what a frame was to load lazily", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({
          "/": \`<iframe name=a src=/b loading=lazy hidden></iframe><a href=about:blank#b target=a></a><script>
            const frame = document.querySelector("iframe");
            const loaded = new Promise(done => (frame.onload = () => done(frame.contentWindow.location.href)));
            document.querySelector("a").click();
            frame.hidden = !frame.contentWindow.location;
          </script>\`,
          "/b": "b",
        });
        print(await (await open("app://trusted/")).executeJavaScript("loaded"));`),
    ).toEqual(["about:blank#b"]);
  });

  test("controls have their state again after going back, but for secrets", async () => {
    expect(
      await run(`
        serve({ "/": "<input><input type=password><input autocomplete=off><input type=checkbox><textarea></textarea><select><option>a<option>b</select>", "/b": "b" });
        const page = await open("app://trusted/");
        const state = () => page.executeJavaScript("[...document.body.children].map(it => (it.type === 'checkbox' ? it.checked : it.value))");
        await page.executeJavaScript("for (const it of document.body.children) it.type === 'checkbox' ? it.click() : (it.value = 'b')");
        await page.loadURL("app://trusted/b");
        page.navigationHistory.goBack();
        await once(page, "did-finish-load");
        print(await state());
        page.reload();
        await once(page, "did-finish-load");
        print(await state());`),
    ).toEqual([
      ["b", "", "", true, "b", "b"],
      ["", "", "", false, "", "a"],
    ]);
  });

  test("a frame in a sandbox does not send the page around it through the history", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe sandbox=allow-scripts src=/b></iframe>", "/b": "<script>onmessage = () => (history.back(), setTimeout(() => setTimeout(() => parent.postMessage('', '*'))))</script>" });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`new Promise(done => {
          history.pushState(null, "", "#a");
          onmessage = () => done(location.hash);
          frames[0].postMessage("", "*");
        })\`));`),
    ).toEqual(["#a"]);
  });

  test("a page is parsed while it arrives", async () => {
    expect(
      await run(`
        const rest = Promise.withResolvers();
        const bytes = Buffer.from("<meta charset=utf-8><p>a</p><script>fetch('/go', { method: 'post', body: document.readyState })</script><p>é</p>");
        const at = bytes.indexOf("é") + 1;
        async function* body() {
          yield bytes.subarray(0, at);
          print(await rest.promise);
          yield bytes.subarray(at);
        }
        const server = Bun.serve({
          port: 0,
          fetch: async request =>
            request.method === "POST" ? (rest.resolve(await request.text()), new Response()) : new Response(body(), { headers: { "content-type": "text/html" } }),
        });
        app.trustOrigins([server.url.origin], { injectedScripts: true });
        const page = await open(server.url.href);
        print(await page.executeJavaScript("[document.readyState, ...[...document.querySelectorAll('p')].map(it => it.textContent)]"));`),
    ).toEqual(["loading", ["complete", "a", "é"]]);
  });

  test("a page that says late how it is encoded is shown before it does", async () => {
    expect(
      await run(`
        const rest = Promise.withResolvers();
        async function* body() {
          yield "<script>fetch('/go', { method: 'post', body: document.characterSet })</script>";
          print(await rest.promise);
          yield "<title>é";
          yield "</title><meta charset=utf-8><p>ü";
        }
        const server = Bun.serve({
          port: 0,
          fetch: async request =>
            request.method === "POST" ? (rest.resolve(await request.text()), new Response()) : new Response(body(), { headers: { "content-type": "text/html" } }),
        });
        app.trustOrigins([server.url.origin], { injectedScripts: true });
        const page = await open(server.url.href);
        print(await page.executeJavaScript("[document.characterSet, document.title, document.body.textContent]"));`),
    ).toEqual(["windows-1252", ["UTF-8", "é", "ü"]]);
  });

  const inPieces = `
    const servePieces = (pieces, type = "text/html; charset=utf-8") => {
      let next = Promise.withResolvers();
      async function* body() {
        for (const it of pieces) {
          yield Buffer.from(it, "latin1");
          if (!it.includes("/next")) continue;
          await next.promise;
          next = Promise.withResolvers();
        }
      }
      const server = Bun.serve({
        port: 0,
        routes: { "/": () => new Response(body(), { headers: { "content-type": type } }), "/next": () => (next.resolve(), new Response()) },
      });
      app.trustOrigins([server.url.origin]);
      return server.url.href;
    };`;

  test.each([
    ["\\xff\\xfea", "utf-8", "\ufffd\ufffda"],
    ["\\xef\\xbb\\xbfa", "windows-1252", "ï»¿a"],
  ])("a byte order mark in the middle of a page that is arriving is text: %s", async (bytes, encoding, title) => {
    expect(
      await run(`${inPieces}
        const page = await open(servePieces(["<img src=/next><title>", "${bytes}</title><meta charset=${encoding}><p>b"], "text/html"));
        print(await page.executeJavaScript("[document.title, document.body.textContent]"));`),
    ).toEqual([[title, "\ufffd\ufffdab".replace("\ufffd\ufffda", title)]]);
  });

  test("what is in quotes that are not closed yet does not say how a page is encoded", async () => {
    expect(
      await run(`${inPieces}
        const page = await open(servePieces(["<link rel=stylesheet href=/next><link title='a > <meta charset=gbk>", "'><meta charset=utf-8>"], "text/html"));
        print(await page.executeJavaScript("document.characterSet"));`),
    ).toEqual(["UTF-8"]);
  });

  test.each(["", "\\uffff"])("the start of a script that is arriving cannot be run: %j", async end => {
    expect(
      await run(`${inPieces}
        const { webContents: page } = new BrowserWindow();
        const inject = \`document.head.append(document.createRange().createContextualFragment("<script>ran = 1;//${end}<\\\\/script>")), typeof ran\`;
        page.loadURL(servePieces(["<script>console.log('/next'.length)</script><script>ran = 1;//"])).catch(() => {});
        await once(page, "console-message");
        print(await page.mainFrame.executeJavaScript(inject));
        page.stop();
        print(await page.executeJavaScript(inject));`),
    ).toEqual(["undefined", "undefined"]);
  });

  test("the scripts of a page are known in whatever pieces it arrives", async () => {
    expect(
      await run(`${inPieces}
        const next = "<script>fetch('/next')</script>";
        const page = await open(servePieces([
          "<script>ran = []</script><form><table><b>" + next + "<scr",
          "ipt>ran.push(1)</script></form><template><a href='javascript:ran.push(6)'></a><p>" + "</template><img src=/none onerror='ran.push(2)'>" + next + "<svg><script>ran.",
          "push(3)</script></svg></table>" + next + "<body onload='ran.",
          "push(4)'><div><template shadowrootmode=open><script>ran.push(5)</script></template></div>",
        ]));
        await page.executeJavaScript("document.body.appendChild(document.querySelector('template').content.firstChild).click()");
        while ((await page.executeJavaScript("ran.length")) < 6) await new Promise(setImmediate);
        print(await page.executeJavaScript("ran.sort()"));`),
    ).toEqual([[1, 2, 3, 4, 5, 6]]);
  });

  test("a page that arrives in many pieces is not looked through again for each", async () => {
    expect(
      await run(`${inPieces}
        const pieces = Array.from({ length: 300 }, (_, it) => "<div hidden>" + "<b>a</b>".repeat(500) + "</div><script>last = " + it + ", fetch('/next')</script>");
        const head = Array(300).fill("<link>".repeat(1500) + "<script>fetch('/next')</script>");
        for (const it of [pieces, [...head, ...pieces.slice(-1)]]) print(await (await open(servePieces(it, "text/html"))).executeJavaScript("last"));`),
    ).toEqual([299, 299]);
  });

  test("a page that has been scrolled does not go back to the fragment when it has loaded", async () => {
    expect(
      await run(`
        const page = at => '<div style="height: 3000px"></div><p id=a style="height: 3000px"></p><script>scrollTo(0, ' + at + ")</script>";
        serve({ "/moved": page(10), "/stayed": page(0) });
        for (const path of ["/moved", "/stayed"]) print(await (await open("app://trusted" + path + "#a")).executeJavaScript("scrollY > 2000"));`),
    ).toEqual([false, true]);
  });

  test("a page that is left while it arrives gets no more of itself", async () => {
    expect(
      await run(`
        const left = Promise.withResolvers();
        const body = new ReadableStream({
          type: "bytes",
          start: it => it.enqueue(Buffer.from("<meta charset=utf-8><script>location = '/b'</script>")),
          cancel: () => left.resolve("cancelled"),
        });
        const server = Bun.serve({ port: 0, fetch: request => new Response(request.url.endsWith("/b") ? "b" : body, { headers: { "content-type": "text/html" } }) });
        app.trustOrigins([server.url.origin], { injectedScripts: true });
        const { webContents: page } = new BrowserWindow();
        page.loadURL(server.url.href).catch(() => {});
        print(await left.promise);
        while (page.isLoading()) await once(page, "did-stop-loading");
        print(await page.executeJavaScript("document.body.textContent"));`),
    ).toEqual(["cancelled", "b"]);
  });

  test("a script copies only when the user has just done something", async () => {
    expect(
      await run(`
        serve({ "/": "<input value=a>" });
        const page = await open("app://trusted/");
        const copy = "document.body.firstChild.select(), document.execCommand('copy')";
        print([await page.executeJavaScript(copy), await page.executeJavaScript(copy, true)]);`),
    ).toEqual([[false, true]]);
  });

  test("window.stop() ends what is being fetched", async () => {
    expect(
      await run(`
        serve({ "/": "", "/never": () => new Promise(() => {}) });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`new Promise(done => {
          const request = new XMLHttpRequest();
          request.onabort = () => done(request.readyState);
          request.open("GET", "/never");
          request.send();
          stop();
        })\`));`),
    ).toEqual([4]);
  });

  test("the root element keeps its size in fullscreen", async () => {
    expect(
      await run(`
        serve({ "/": "<body style=margin:0>" });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`document.documentElement.requestFullscreen().then(() => document.documentElement.offsetWidth === innerWidth)\`, true));`),
    ).toEqual([true]);
  });

  test("what a context menu is about", async () => {
    expect(
      await run(`
        serve({ "/": "<body style=margin:0><a href=/b title=t style='display:block;height:40px'>link</a><input value=word style='height:40px'>" });
        const page = new BrowserWindow().webContents;
        await page.loadURL("app://trusted/");
        for (const y of [20, 60]) {
          if (y === 60) await page.executeJavaScript("document.querySelector('input').select()");
          const shown = new Promise(resolve => page.once("context-menu", (_, params) => resolve(params)));
          for (const type of ["mouseDown", "mouseUp"]) page.sendInputEvent({ type, x: 10, y, button: "right", clickCount: 1 });
          const { linkURL, linkText, titleText, isEditable, formControlType, editFlags, pageURL } = await shown;
          print([linkURL, linkText, titleText, isEditable, formControlType, editFlags.canCopy, pageURL]);
        }`),
    ).toEqual([
      ["app://trusted/b", "link", "t", false, "none", false, "app://trusted/"],
      ["", "", "", true, "input-text", true, "app://trusted/"],
    ]);
  });

  test("a request that is canceled while its body arrives is reported", async () => {
    expect(
      await run(`
        serve({ "/": "a", "/endless": () => new Response(new ReadableStream({ start: it => it.enqueue(new Uint8Array(1)) })) });
        const page = new BrowserWindow().webContents;
        await page.loadURL("app://trusted/");
        const reported = new Promise(resolve => page.session.webRequest.onErrorOccurred(resolve));
        await page.executeJavaScript("fetch('/endless').then(it => it.body.cancel())");
        const { url, error } = await reported;
        print([url, error]);`),
    ).toEqual([["app://trusted/endless", "net::ERR_ABORTED"]]);
  });

  test("navigation events and history", async () => {
    expect(
      await run(`
        serve({ "/": "<a href=/b>b</a>", "/b": "b", "/r": () => Response.redirect("app://trusted/b", 302) });
        const window = new BrowserWindow();
        const page = window.webContents;
        let events = [];
        for (const name of ["did-start-loading", "did-start-navigation", "will-navigate", "will-redirect", "did-navigate",
          "did-navigate-in-page", "dom-ready", "did-finish-load", "did-stop-loading", "did-fail-load"]) {
          page.on(name, () => events.push(name));
        }
        const flush = async () => (await once(page, "did-stop-loading"), print(events.splice(0)));
        await page.loadURL("app://trusted/");
        await flush();
        page.once("will-navigate", event => event.preventDefault());
        page.executeJavaScript("document.querySelector('a').click()");
        await flush();
        page.executeJavaScript("history.pushState({ n: 1 }, '', '/pushed')");
        await flush();
        await page.loadURL("app://trusted/r");
        await flush();
        print(page.navigationHistory.getAllEntries().map(entry => entry.url));
        page.navigationHistory.goToIndex(0);
        await once(page, "did-finish-load");
        print([page.getURL(), page.navigationHistory.canGoBack(), page.navigationHistory.canGoForward()]);`),
    ).toEqual([
      ["did-start-loading", "did-start-navigation", "did-navigate", "dom-ready", "did-finish-load", "did-stop-loading"],
      ["did-start-loading", "did-start-navigation", "will-navigate", "did-stop-loading"],
      ["did-start-loading", "did-start-navigation", "did-navigate-in-page", "did-stop-loading"],
      [
        "did-start-loading",
        "did-start-navigation",
        "will-redirect",
        "did-navigate",
        "dom-ready",
        "did-finish-load",
        "did-stop-loading",
      ],
      ["app://trusted/", "app://trusted/pushed", "app://trusted/b"],
      ["app://trusted/", false, true],
    ]);
  });

  describe("what a webContents says about loading", () => {
    const record = `
      const never = () => new Promise(() => {});
      serve({
        "/": "<title>home</title>",
        "/next": "<title>next</title>",
        "/frame": "<iframe src=/next></iframe>",
        "/stay": "<script>onbeforeunload = event => event.preventDefault()</script>",
        "/slow": "<img src=/never>",
        "/slow-frame": "<iframe src=/slow></iframe>",
        "/never": never,
        "/nothing": () => new Response(null, { status: 204 }),
        "/denied": () => new Response("", { headers: { "content-type": "text/html", "x-frame-options": "deny" } }),
      });
      session.defaultSession.webRequest.onBeforeRequest((details, done) => done({ cancel: details.url.endsWith("/blocked") }));
      const short = it => (typeof it === "string" ? it.replace("app://trusted", "") : it);
      const told = {
        "did-start-loading": 0, "did-stop-loading": 0, "frame-created": 0, "dom-ready": 0, "did-finish-load": 0, "will-prevent-unload": 0,
        "did-start-navigation": 3, "will-frame-navigate": 1, "will-navigate": 1, "did-frame-navigate": 4, "did-navigate": 3,
        "did-navigate-in-page": 2, "did-frame-finish-load": 1, "did-fail-provisional-load": 4, "did-fail-load": 4, "page-title-updated": 2,
      };
      const page = new BrowserWindow().webContents;
      const load = path => page.loadURL("app://trusted" + path).then(() => "loaded", error => error.code + " " + error.errno);
      const stopped = () => once(page, "did-stop-loading");
      const start = async path => {
        if (path) await Promise.all([load(path), stopped()]);
        for (const [name, count] of Object.entries(told)) {
          page.on(name, (_, ...about) => print([name, ...about.slice(0, count).map(short)].join(" ")));
        }
      };
      const js = (code, isGesture = false) => page.mainFrame.executeJavaScript(code, isGesture);
      const addFrame = attributes => js("void document.body.append(Object.assign(document.createElement('iframe'), " + JSON.stringify(attributes) + "))");
      const where = async () => print([page.getURL(), page.mainFrame.url, await js("location.href"), page.getTitle(), page.navigationHistory.length()].map(short).join(" "));
    `;
    const complete = ["dom-ready", "did-frame-finish-load true", "did-finish-load"];
    const blocked = [
      "did-fail-provisional-load -20 ERR_BLOCKED_BY_CLIENT /blocked true",
      "did-fail-load -20 ERR_BLOCKED_BY_CLIENT /blocked true",
      ...complete,
    ];
    const next = ["did-frame-navigate /next 200 OK true", "did-navigate /next 200 OK", "page-title-updated next true"];

    test.each<[string, string, unknown[]]>([
      [
        "the first document",
        `await start(); print(await load("/next")); print([page.isLoading(), page.isLoadingMainFrame()]); await stopped();`,
        [
          "frame-created",
          "did-start-loading",
          "did-start-navigation /next false true",
          ...next,
          ...complete,
          "loaded",
          [true, true],
          "did-stop-loading",
        ],
      ],
      [
        "a navigation by a script",
        `await start("/"); js("void (location = '/next')"); await stopped();`,
        [
          "did-start-loading",
          "did-start-navigation /next false true",
          "will-frame-navigate /next",
          "will-navigate /next",
          ...next,
          ...complete,
          "did-stop-loading",
        ],
      ],
      [
        "history.back() that is prevented",
        `await load("/"); await start("/next");
         page.once("will-navigate", event => event.preventDefault());
         js("history.back()"); await stopped(); await where();`,
        [
          "did-start-loading",
          "did-start-navigation / false true",
          "will-frame-navigate /",
          "will-navigate /",
          "did-stop-loading",
          "/next /next /next next 2",
        ],
      ],
      [
        "an error page",
        `await start("/"); print(await load("/blocked")); await stopped(); await where();
         page.reload(); await stopped();
         page.navigationHistory.goToIndex(0); await stopped(); await where();`,
        [
          "did-start-loading",
          "did-start-navigation /blocked false true",
          ...blocked,
          "ERR_BLOCKED_BY_CLIENT -20",
          "did-stop-loading",
          "/blocked /blocked chrome-error://chromewebdata/ /blocked 2",
          "did-start-loading",
          "did-start-navigation /blocked false true",
          ...blocked,
          "did-stop-loading",
          "did-start-loading",
          "did-start-navigation / false true",
          "did-frame-navigate / 200 OK true",
          "did-navigate / 200 OK",
          "page-title-updated home true",
          ...complete,
          "did-stop-loading",
          "/ / / home 2",
        ],
      ],
      [
        "a response without a document",
        `await start("/"); print(await load("/nothing"));`,
        ["did-start-loading", "did-start-navigation /nothing false true", "did-stop-loading", "ERR_FAILED -2"],
      ],
      [
        "a load that another one replaces",
        `await start("/"); const first = load("/never"); print([await load("/next"), await first]); await stopped();`,
        [
          "did-start-loading",
          "did-start-navigation /never false true",
          "did-start-navigation /next false true",
          ...next,
          ...complete,
          ["loaded", "ERR_ABORTED -3"],
          "did-stop-loading",
        ],
      ],
      [
        "stop() while the document waits for an image",
        `const loading = load("/slow"); await once(page, "dom-ready"); await start();
         await js("window.failed = new Promise(resolve => (onload = document.images[0].onerror = resolve)); 0");
         page.stop(); await stopped(); print(await loading);
         print(await js("failed.then(event => [document.readyState, event.type])"));`,
        ["did-fail-load -3  /slow true", "did-stop-loading", " -3", ["complete", "error"]],
      ],
      [
        "stop() while it waits for a frame",
        `const loading = load("/slow-frame");
         await new Promise(resolve => page.on("frame-created", (_, { frame }) => frame.parent && frame.once("dom-ready", resolve)));
         await start(); page.stop(); print(await loading); await stopped();`,
        [
          "did-fail-load -3  /slow false",
          "did-frame-finish-load true",
          "did-finish-load",
          "loaded",
          "did-stop-loading",
        ],
      ],
      [
        "a reload",
        `await start("/"); page.reload(); await stopped();`,
        [
          "did-start-loading",
          "did-start-navigation / false true",
          "did-frame-navigate / 200 OK true",
          "did-navigate / 200 OK",
          ...complete,
          "did-stop-loading",
        ],
      ],
      [
        "about:blank",
        `await start("/"); js("void (location = 'about:blank')"); await stopped();`,
        [
          "did-start-loading",
          "did-start-navigation about:blank false true",
          "did-frame-navigate about:blank -1  true",
          "did-navigate about:blank -1 ",
          ...complete,
          "did-stop-loading",
        ],
      ],
      [
        "document.open()",
        `await start("/"); js("document.open(); document.write('<title>new</title>'); document.close()");
         await once(page, "dom-ready"); print(await page.executeJavaScript("document.title"));`,
        ["page-title-updated  true", "page-title-updated new true", "dom-ready", "new"],
      ],
      [
        "titles",
        `await start("/"); await js("document.title = 'a'; document.title = 'a'; document.title = ''; document.title = 'b'");
         while (page.getTitle() !== "b") await once(page, "page-title-updated");
         await js("0");`,
        ["page-title-updated a true", "page-title-updated  true", "page-title-updated b true"],
      ],
      [
        "an empty frame",
        `await start("/"); addFrame({}); await stopped();`,
        [
          "frame-created",
          "did-start-loading",
          "did-start-navigation about:blank false false",
          "did-frame-navigate about:blank -1  false",
          "did-frame-finish-load false",
          "did-stop-loading",
        ],
      ],
      [
        "a frame that refuses to be one",
        `await start("/"); addFrame({ src: "/denied" }); await stopped();`,
        [
          "frame-created",
          "did-start-loading",
          "did-start-navigation /denied false false",
          "will-frame-navigate /denied",
          "did-fail-provisional-load -27 ERR_BLOCKED_BY_RESPONSE /denied false",
          "did-fail-load -27 ERR_BLOCKED_BY_RESPONSE /denied false",
          "did-frame-finish-load false",
          "did-stop-loading",
        ],
      ],
      [
        "a frame that is removed while it loads",
        `await start("/"); addFrame({ src: "/never" }); await once(page, "will-frame-navigate");
         print([page.isLoading(), page.isLoadingMainFrame()]);
         js("document.querySelector('iframe').remove()"); await stopped();`,
        [
          "frame-created",
          "did-start-loading",
          "did-start-navigation /never false false",
          "will-frame-navigate /never",
          [true, false],
          "did-stop-loading",
        ],
      ],
      [
        "beforeunload after the user has done something",
        `await start("/stay"); await js("0", true); print(await load("/next")); await stopped(); await where();
         await js("onbeforeunload = null");`,
        [
          "did-start-loading",
          "will-prevent-unload",
          "did-fail-load -3 ERR_ABORTED /next true",
          "ERR_ABORTED -3",
          "did-stop-loading",
          "/stay /stay /stay /stay 1",
        ],
      ],
      [
        "beforeunload before that",
        `await start("/stay"); await Promise.all([load("/next"), stopped()]);`,
        ["did-start-loading", "did-start-navigation /next false true", ...next, ...complete, "did-stop-loading"],
      ],
    ])("%s", async (_, main, expected) => {
      expect(await run(`app.trustOrigins(["app://trusted"], { inFrames: true }); ${record} ${main}`)).toEqual(expected);
    });
  });

  test("a frame is the same object from document to document", async () => {
    expect(
      await run(
        `serve({ "/": "<script>onpagehide = () => api.say('gone')</script>", "/next": "" });
         const page = await open("app://trusted/", preload);
         const frame = page.mainFrame, { routingId, frameTreeNodeId, ipc } = frame;
         const [[first]] = await Promise.all([once(ipc, "say"), page.executeJavaScript("api.say('here')")]);
         print(first.senderFrame === frame);
         ipc.once("say", event => print(event.senderFrame.url));
         await Promise.all([page.loadURL("app://trusted/next"), once(frame, "dom-ready"), once(ipcMain, "say")]);
         print([page.mainFrame === frame, frame.url, frame.detached, frame.ipc === ipc]);
         print([frame.routingId === routingId, frame.frameTreeNodeId === frameTreeNodeId, first.senderFrame]);`,
        {
          "preload.js": `const { contextBridge, ipcRenderer } = require("electron");
            contextBridge.exposeInMainWorld("api", { say: text => ipcRenderer.send("say", text) });`,
        },
      ),
    ).toEqual([true, "app://trusted/", [true, "app://trusted/next", false, true], [false, true, null]]);
  });

  test("an origin that is not trusted does not run in the process", async () => {
    expect(
      await run(`
        app.setWebEngine(null);
        serve({ "/": "<script>api.ran()</script>", "/r": () => Response.redirect("app://other/", 302) });
        for (const url of ["app://other/", "app://trusted/r", "file:///etc/hosts", "data:text/html,a"]) {
          print(await open(url).catch(error => error.code));
        }`),
    ).toEqual(Array(4).fill("ERR_BLOCKED_BY_CLIENT"));
  });

  test("ipc and contextBridge", async () => {
    expect(
      await run(
        `serve({ "/": "" });
         ipcMain.handle("add", (event, a, b) => ({ sum: a + b, origin: event.senderFrame.origin, date: new Date(0) }));
         ipcMain.handle("fail", () => { throw new RangeError("no"); });
         ipcMain.on("sync", (event, value) => { event.returnValue = [value]; });
         ipcMain.on("ping", (event, value) => event.reply("pong", value + 1));
         console.error = () => {};
         const page = await open(undefined, preload);
         page.ipc.handle("own", () => "own");
         print(await page.executeJavaScript(\`(async () => {
           const added = await api.invoke("add", 1, 2);
           return [
             added.sum, added.origin, added.date instanceof Date, Object.getPrototypeOf(added) === Object.prototype,
             await api.invoke("fail").catch(error => [error instanceof Error, error.message]),
             await api.invoke("missing").catch(error => error.message),
             await api.invoke("own"),
             api.sync(1), await new Promise(resolve => api.ping(1, resolve)),
             Object.isFrozen(api), typeof secret, api.seesPageVariable(), api.title(), fromMainWorld, api.type,
           ];
         })()\`));`,
        {
          "preload.js": `
            const { contextBridge, ipcRenderer } = require("electron");
            globalThis.secret = 1;
            contextBridge.executeInMainWorld({ func: value => { window.fromMainWorld = value; }, args: [7] });
            contextBridge.exposeInMainWorld("api", {
              invoke: (...args) => ipcRenderer.invoke(...args),
              sync: value => ipcRenderer.sendSync("sync", value),
              ping(value, callback) {
                ipcRenderer.once("pong", (_, answer) => callback(answer));
                ipcRenderer.send("ping", value);
              },
              seesPageVariable: () => "fromMainWorld" in window,
              title: () => document.URL,
              type: process.type,
            });`,
        },
      ),
    ).toEqual([
      [
        3,
        "app://trusted",
        true,
        true,
        [true, "Error invoking remote method 'fail': RangeError: no"],
        "Error invoking remote method 'missing': Error: No handler registered for 'missing'",
        "own",
        [1],
        2,
        true,
        "undefined",
        false,
        "app://trusted/",
        7,
        "renderer",
      ],
    ]);
  });

  test("sendSync waits for an answer that comes later, and the page does nothing meanwhile", async () => {
    expect(
      await run(
        `serve({ "/": "" });
         ipcMain.on("job", async event => { event.returnValue = await Promise.resolve("job"); });
         ipcMain.on("timer", event => { setTimeout(() => { event.returnValue = "timer"; }, 1); });
         const page = await open(undefined, preload);
         print(await page.executeJavaScript(\`(async () => {
           const order = [];
           queueMicrotask(() => order.push("microtask"));
           order.push(sync("job"), sync("timer"));
           await 0;
           try { sync("nobody"); } catch { order.push("threw"); }
           return order;
         })()\`));`,
        {
          "preload.js": `
            const { contextBridge, ipcRenderer } = require("electron");
            contextBridge.exposeInMainWorld("sync", channel => ipcRenderer.sendSync(channel));`,
        },
      ),
    ).toEqual([["job", "timer", "microtask", "threw"]]);
  });

  test.each([false, true])(
    "a page that replaces the built-ins gets nothing of the app (frames: %p)",
    async inFrames => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted"], { inFrames: ${inFrames} });
         serve({ "/": "<body><script src=/spy.js></script>", "/spy.js": require("fs").readFileSync(path.join(__dirname, "spy.js")), "/frame": "" });
         const page = await open();
         page.debugger.attach();
         await page.debugger.sendCommand("Runtime.enable");
         const forged = Buffer.from(require("bun:jsc").serialize(Bun.file(__filename))).toString("base64");
         print(await page.executeJavaScript(\`look(\${JSON.stringify(__filename)}, "\${forged}", ${inFrames})\`));`,
          {
            "spy.js": `
            const { apply, construct, defineProperty, getOwnPropertyDescriptor, getPrototypeOf, ownKeys } = Reflect;
            const seen = new Set();
            const { add } = Set.prototype;
            let isBusy = false;
            const note = value => void (Object(value) === value && apply(add, seen, [value]));
            const spy = real =>
              real &&
              function () {
                if (isBusy) return apply(real, this, arguments);
                note(this);
                for (let i = 0; i < arguments.length; i++) note(arguments[i]);
                const result = new.target ? construct(real, arguments, new.target) : apply(real, this, arguments);
                note(result);
                return result;
              };
            const iterators = [[], new Map(), new Set()].map(it => getPrototypeOf(it.keys()));
            const classes = [Object, Function, Array, String, Map, Set, WeakMap, WeakSet, WeakRef, Promise, RegExp, getPrototypeOf(Uint8Array)];
            for (const holder of [...classes, ...classes.map(it => it.prototype), ...iterators, Reflect, JSON]) {
              for (const key of ownKeys(holder)) {
                const { value, get, set, configurable } = getOwnPropertyDescriptor(holder, key);
                if (!configurable || key === "constructor" || key === "caller" || key === "arguments") continue;
                if (typeof value === "function") defineProperty(holder, key, { value: spy(value) });
                else if (get) defineProperty(holder, key, { get: spy(get), set: spy(set) });
              }
            }
            for (const key of ["then", "toJSON", "page", "host", "doc", "env", "signal", "origin"]) {
              defineProperty(Object.prototype, key, {
                get() {
                  note(this);
                },
                set(value) {
                  note(this), note(value);
                  defineProperty(this, key, { value, writable: true, enumerable: true, configurable: true });
                },
              });
            }
            Error.prepareStackTrace = (_, sites) => sites.forEach(it => (note(it.getFunction()), note(it.getThis())));

            const attempt = run => { try { return note(run()), "works"; } catch (error) { return note(error), "refused"; } };
            const isOfApp = new Map();
            function walk() {
              let found = 0;
              for (const value of seen) {
                try {
                  let root = value;
                  while (getPrototypeOf(root)) root = getPrototypeOf(root);
                  if (!isOfApp.has(root)) isOfApp.set(root, attempt(() => root.constructor.constructor("process")()) === "works");
                  if (isOfApp.get(root) && ++found) continue;
                  note(getPrototypeOf(value));
                  if (value instanceof WeakRef) note(value.deref());
                  if (value instanceof Map || value instanceof Set) value.forEach((a, b) => (note(a), note(b)));
                  for (const key of [...ownKeys(value), "doc", "page"]) attempt(() => value[key]);
                } catch {}
              }
              return found;
            }
            async function look(file, forged, hasFrames) {
              const event = (target, type) => new Promise(resolve => target.addEventListener(type, resolve));
              const frame = src => document.body.appendChild(Object.assign(document.createElement("iframe"), src && { src }));
              const uses = [
                () => hasFrames && event(frame("/frame"), "load"),
                () => frame(),
                () => open("").close(),
                () => history.pushState({}, "", "#a"),
                () => navigation.entries(),
                () => fetch("/").then(it => it.body.getReader().read()),
                () => fetch("/", { method: "POST", duplex: "half", body: new Blob(["a"]).stream() }),
                () => fetch("none://"),
                () => event(new Worker("/none"), "error"),
                () => import("/none"),
                () => (postMessage(new Map(), "*", [new MessageChannel().port1]), event(window, "message")),
                () => navigator.locks.request("a", it => it),
                () => navigator.permissions.query({ name: "camera" }),
                () => navigator.clipboard.readText(),
                () => caches.open("a").then(it => it.add("/")),
                () => console.log({}),
                () => (setTimeout(() => { throw {}; }), event(window, "error")),
              ];
              for (const use of uses) note(await Promise.try(use).catch(error => error));
              isBusy = true;
              walk();
              const hosts = [...seen].filter(it => Object.hasOwn(it, "fileFromPath"));
              const results = hosts.flatMap(host => [
                attempt(() => host.fileFromPath(file)),
                attempt(() => host.deserialize(Uint8Array.fromBase64(forged))),
              ]);
              const hostile = function () { note(this), note(hostile.caller), [...arguments].forEach(note), new Error().stack; };
              for (const name of ["isSameSite", "allowsBase", "fetchResource", "permission", "traverseTo", "titleChanged"]) {
                for (const it of [undefined, hostile, { toString: hostile, then: hostile }, new Proxy({}, new Proxy({}, { get: () => hostile }))]) {
                  attempt(() => hosts[0][name](it, it, it)?.catch?.(note));
                }
              }
              await fetch("/");
              return [results.includes("works"), walk()];
            }`,
          },
        ),
      ).toEqual([[false, 0]]);
    },
  );

  test("a preload script shares the document with the page, and no object", async () => {
    expect(
      await run(
        `serve({ "/": \`<p id=a class="x y" data-k=v>text</p><select><option>1<option>2</select><script>
           const got = [];
           const p = document.getElementById("a");
           got.push(p.mine, "mine" in Element.prototype, typeof p.getAttribute("id"));
           p.theirs = 1;
           for (const [object, name] of [
             [Element.prototype, "getAttribute"], [Node.prototype, "appendChild"], [EventTarget.prototype, "addEventListener"],
             [Document.prototype, "createElement"], [HTMLElement.prototype, "click"], [History.prototype, "replaceState"],
             [Headers.prototype, "get"], [window, "getComputedStyle"], [window, "Event"],
           ]) object[name] = () => "patched";
           Object.defineProperty(Node.prototype, "textContent", { get: () => "patched" });
           const isMine = value => value instanceof Object;
           p.onping = null;
           document.documentElement.onclick = function listener(event) {
             Error.prepareStackTrace = (_, sites) => sites.map(it => it.getFunction()).filter(Boolean);
             got.push(isMine(event), listener.caller, new Error().stack.every(isMine));
             Error.prepareStackTrace = undefined;
           };
           onmessage = event => got.push(isMine(event.data), isMine(event.data.list));
           ontoggle = event => got.push(isMine(event.detail), typeof event.detail.run, event.detail.node === p, isMine(event.detail.error));
           got.push(onoffline);
           onoffline = () => void got.push("offline");
           onerror = () => void got.push("error event");
           dispatchEvent(new CustomEvent("from-page", { detail: { run() {}, get trap() { got.push("trap"); }, node: p, list: [1] } }));
         </script>\` });
         console.error = () => {};
         const page = await open(undefined, preload);
         print(await page.executeJavaScript("api.look()"));
         print(await page.executeJavaScript("[got, api.same(p) === p, api.idOf(p), api.find() === p, p.className, localStorage.key(0)]"));`,
        {
          "preload.js": `
            Element.prototype.mine = 1;
            new MutationObserver(() => { const p = document.getElementById("a"); if (p) p.mine = 2; }).observe(document, { childList: true, subtree: true });
            let detail, handled = 0;
            onoffline = () => void handled++;
            addEventListener("from-page", event => (detail = [event.detail === event.detail, event.detail, event.isTrusted]));
            const isMine = value => value instanceof Object;
            async function look() {
              const p = document.getElementById("a");
              const seen = { expandos: [p.mine, p.theirs, Object.keys(p)] };
              history.replaceState({ a: 1 }, "");
              seen.members = [p.getAttribute("id"), p.textContent, document.body.appendChild(document.createElement("i")).localName,
                getComputedStyle(p).display, new Event("e").type, new Headers({ a: "b" }).get("a"), history.state.a];
              seen.identity = [p === document.querySelector("p"), p.ownerDocument === document, document.defaultView === window,
                p instanceof HTMLParagraphElement, p instanceof Node, p.constructor === HTMLParagraphElement,
                Object.getPrototypeOf(HTMLElement) === Element, Object.prototype.toString.call(p), customElements];
              seen.mine = [p, p.getAttribute, Node, p.classList, p.getBoundingClientRect(), p.getAttributeNames(), location, navigator,
                location.assign, p.style, fetch, p.animate([], 1).finished, new Headers().entries().next()].every(isMine);
              seen.detail = [detail[0], detail[1].run, "trap" in detail[1], detail[1].node === p, isMine(detail[1].list), detail[2]];
              const all = document.querySelectorAll("p, select");
              p.dataset.n = "1";
              p.classList.add("z");
              localStorage.stored = "1";
              seen.exotic = [all.length, all[0] === p, [...all].map(it => it.localName), Object.keys(all), all[1][1].text, { ...p.dataset },
                [...p.classList], localStorage.getItem("stored"), document.body.children.a === p];
              let calls = 0;
              const [listener, object] = [function (event) { calls += this === p && event.target === p; }, { handleEvent() { calls += this === object; } }];
              for (const it of [listener, listener, object]) p.addEventListener("x", it);
              p.dispatchEvent(new Event("x"));
              for (const it of [listener, object]) p.removeEventListener("x", it);
              const aborter = new AbortController();
              p.addEventListener("x", listener, { signal: aborter.signal });
              aborter.abort();
              p.dispatchEvent(new Event("x"));
              class Own extends EventTarget { field = 1; }
              const own = new Own(), sent = {};
              own.addEventListener("y", event => (calls += event.target === own && event.detail === sent));
              own.dispatchEvent(new CustomEvent("y", { detail: sent }));
              p.addEventListener("z", null, Object.defineProperty({}, "passive", { get: () => void calls++ }));
              dispatchEvent(new Event("offline"));
              seen.calls = [calls, handled, window.a === p, NodeFilter.SHOW_TEXT, typeof document.all];
              const thrown = run => { try { run(); } catch (error) { return error; } };
              const marker = {};
              seen.errors = [thrown(() => p.appendChild(document)) instanceof DOMException, thrown(() => p.appendChild(1)) instanceof TypeError,
                thrown(() => Node.prototype.cloneNode.call({})) instanceof TypeError,
                thrown(() => document.createTreeWalker(document, -1, () => { throw marker; }).nextNode()) === marker,
                await fetch("http://[").catch(error => error instanceof TypeError)];
              seen.timer = await new Promise(resolve => setTimeout(value => resolve(value === marker), 0, marker));
              seen.file = [new File(["ab"], "n") instanceof File, await new Response(new Blob(["ab"])).text(), structuredClone(new DOMRect(1, 2)) instanceof DOMRect,
                await new Response(new Response("cd").body.pipeThrough(new TextDecoderStream()).pipeThrough(new TextEncoderStream())).text()];
              (function sloppy() { p.click(); })();
              dispatchEvent(new CustomEvent("toggle", { detail: { run() {}, node: p, error: new Error("e") } }));
              reportError(new Error("of the preload script"));
              postMessage({ list: [] }, "*");
              await new Promise(resolve => addEventListener("message", resolve));
              return seen;
            }
            require("electron").contextBridge.exposeInMainWorld("api", {
              look,
              same: value => value,
              idOf: node => node.getAttribute("id"),
              find: () => document.getElementById("a"),
            });`,
        },
      ),
    ).toEqual([
      {
        expandos: [2, null, ["mine"]],
        members: ["a", "text", "i", "block", "e", "b", 1],
        identity: [true, true, true, true, true, true, true, "[object HTMLParagraphElement]", null],
        mine: true,
        detail: [true, null, false, true, true, false],
        exotic: [2, true, ["p", "select"], ["0", "1"], "2", { k: "v", n: "1" }, ["x", "y", "z"], "1", true],
        calls: [4, 1, true, 4, "undefined"],
        errors: [true, true, true, true, true],
        timer: true,
        file: [true, "ab", true, "cd"],
      },
      [
        [null, false, "string", null, "offline", true, null, true, true, "object", true, true, true, true],
        true,
        "a",
        true,
        "x y z",
        "stored",
      ],
    ]);
  });

  test("what a page sends while it is unloaded has a senderFrame", async () => {
    expect(
      await run(
        `serve({ "/": "", "/next": "" });
         const seen = new Promise(resolve => ipcMain.handle("last", async event => {
           const { url, detached } = event.senderFrame;
           await 0;
           resolve([url, detached, event.senderFrame]);
         }));
         const page = await open(undefined, preload);
         await page.loadURL("app://trusted/next");
         print(await seen);`,
        { "preload.js": `addEventListener("pagehide", () => require("electron").ipcRenderer.invoke("last"));` },
      ),
    ).toEqual([["app://trusted/", true, null]]);
  });

  test.each([
    `Node.prototype[Symbol.unscopables] = new Proxy({}, {}); send(document.body)`,
    `Object.setPrototypeOf(Object.getPrototypeOf(iterator), struct()); send(iterator)`,
    `send(new Proxy({}, struct()))`,
    `send({ constructor: struct(), map: [].map })`,
    `let last = Object.getPrototypeOf(iterator);
     for (let i = 0; i < ${isDebug ? 40000 : 300000}; i++) Object.setPrototypeOf(last, (last = {}));
     send(iterator)`,
  ])("a preload script lists the members of what the page sends: %s", async script => {
    // (type $0 (struct)) (func (export "f") (result (ref null $0)) struct.new_default $0)
    const module = [
      0, 97, 115, 109, 1, 0, 0, 0, 1, 8, 2, 95, 0, 96, 0, 1, 99, 0, 3, 2, 1, 1, 7, 5, 1, 1, 102, 0, 0, 10, 7, 1, 5, 0,
      251, 1, 0, 11,
    ];
    expect(
      await run(
        `serve({ "/": "" });
         print(await (await open(undefined, preload)).executeJavaScript(${JSON.stringify(`
           const send = detail => dispatchEvent(new CustomEvent("sent", { detail })), iterator = ""[Symbol.iterator]();
           const struct = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.of(${module}))).exports.f;
           ${script};
           document.title`)}));`,
        {
          "preload.js": `addEventListener("sent", event => { for (const name in event.detail); document.title = "listed"; });`,
        },
      ),
    ).toEqual(["listed"]);
  });

  test("the page gets nothing of what a preload script and the platform hand to each other", async () => {
    const object = "[object Object]";
    const steps = [
      ["console.log(secret)", object],
      ["console.count('a')", "a: 1"],
      ["throw secret", `Uncaught ${object}`],
      ["throw () => 1", "Uncaught () => 1"],
      ["throw new RangeError('a')", "Uncaught RangeError: a"],
      ["throw { get a() { throw secret; } }", `Uncaught ${object}`],
      ["return Object.defineProperty([], 0, { enumerable: true, get() { throw secret; } })", `Uncaught ${object}`],
      ["list[0] = secret, (opener = secret), say(1)", "1"],
      ["requestAnimationFrame(() => { throw secret; })", `Uncaught ${object}`],
      ["setTimeout(() => { throw secret; })", `Uncaught ${object}`],
      [
        "addEventListener('a', { handleEvent() { throw secret; } }), dispatchEvent(new Event('a'))",
        `Uncaught ${object}`,
      ],
      ["say(addEventListener('b', () => {}, { capture: true, ...secret }))", "undefined"],
      ["say(title(secret))", object],
      ["say(title([secret, 1]))", `${object},1`],
      ["say(title(() => 1))", "() => 1"],
      ["say(title(new Error('a')))", "Error: a"],
      ["say(title(/a/))", "/a/"],
      ["say(title(new String('a')))", "a"],
      ["say(title(new Uint8Array(2)))", "0,0"],
      ["say(title(Object.assign(new Date(0), { toString: () => 'a' })))", "a"],
      ["say(new DOMMatrix(new Float32Array([1, 2, 3, 4, 5, 6])))", "matrix(1, 2, 3, 4, 5, 6)"],
      ["say(new KeyframeEffect(null, new Set([{ top: '1px', ...secret }])).getKeyframes()[0].top)", "1px"],
      ["say(new KeyframeEffect(null, [{ top: '2px', ...secret }].values()).getKeyframes()[0].top)", "2px"],
      ["say(document.createTreeWalker(document, -1, { acceptNode: () => secret }).nextNode())", "null"],
      ...[
        "[['a', 'b']]",
        "{ a: 'b' }",
        "new Map([['a', 'b']])",
        "new Headers({ a: 'b' })",
        "new URLSearchParams('a=b')",
      ].map(headers => [`say(new Request('/', { headers: ${headers}, ...secret }).headers.get('a'))`, "b"]),
      ...["secret", "async () => secret", "new Blob", "new Uint8Array", "new Error", "Promise.resolve(secret)"].map(
        result => [
          `const it = ${result}; navigator.locks.request('a', () => it).then(async got => say(got === (await it)))`,
          "true",
        ],
      ),
      ["navigator.locks.request('a', () => { throw secret; }).catch(it => say(it === secret))", "true"],
      ["scheduler.postTask(() => ({ ...secret, then: () => say(1) }))", "1"],
      ["fetch('data:,1').then(say)", "[object Response]"],
      ["new Response('{}').json().then(say)", object],
      ["new Response('a').blob().then(say)", "[object Blob]"],
      ["navigator.locks.request('a', () => new File([], 'a')).then(say)", "[object File]"],
      ["new Response('a').arrayBuffer().then(say)", "[object ArrayBuffer]"],
      ["new Response('a').body.getReader().read().then(it => say(it.value))", "97"],
      ["new Response('a').body.values().next().then(it => say(it.value))", "97"],
      ["new Response(new Blob(['a']).stream()).text().then(say)", "a"],
      ["fetch('/', { signal: AbortSignal.abort(secret) }).catch(it => say(it === secret))", "true"],
      ["const it = new AbortController(); give(new Request('/', it)), it.abort(secret), say(1)", "1"],
      ["const it = new AbortController(); give(AbortSignal.any([it.signal])), it.abort(secret), say(1)", "1"],
      ["give(AbortSignal.abort(secret)), say(1)", "1"],
      ["give(Promise.resolve(secret)), say(1)", "1"],
      ["give(document.createTreeWalker(document, -1, ipcRenderer.send)), say(1)", "1"],
      ["const it = { handleEvent() {} }; addEventListener('c', it), give(it), say(1)", "1"],
      ["document.startViewTransition(() => { throw secret; }).finished.catch(it => say(it === secret))", "true"],
      ["callBack('promise').then(say)", "1"],
      [
        "const { port1, port2 } = new MessageChannel(); port1.onmessage = it => (callBack(), say(event === it)); port2.postMessage(1)",
        "true",
      ],
    ];
    const spy = `
      const got = [], define = Object.defineProperty, then = Promise.prototype.then;
      let isBusy = false, step;
      const note = (it, how) => {
        if (isBusy || Object(it) !== it || it === self) return;
        got[got.length] = step + " " + how;
      };
      const look = (it, depth = 2) => {
        if (typeof it === "function" || (Object(it) === it && Object.getPrototypeOf(it)?.constructor?.constructor("return self.ofPreload")())) got[got.length] = step + " given";
        else if (depth && Object(it) === it) for (const key of ["ipc", "send", "handleEvent", "filter", "reason", "signal"]) look(it[key], depth - 1);
      };
      const quietly = steps => (...given) => {
        isBusy = true;
        try { steps(...given); } finally { isBusy = false; }
      };
      addEventListener("given", quietly(({ detail }) => {
        look(detail);
        if (detail instanceof Promise) then.call(detail, quietly(look));
        (detail.signal ?? detail).addEventListener?.("abort", quietly(() => look(detail)));
      }));
      api.listen(what => (what ? Promise.resolve(1) : note(self.event, "event")));
      Promise.prototype.then = function (...given) {
        note(this, "patched");
        return then.apply(this, given);
      };
      dispatchEvent(new CustomEvent("list", { detail: new Proxy([], { set: quietly((list, index, it) => (look(it), queueMicrotask(quietly(() => look(opener))))) }) }));
      onerror = (...given) => note(given[4], "error");
      onunhandledrejection = quietly(event => (look(event.reason), event.preventDefault()));
      define(Promise.prototype, "constructor", { get() { note(this, "constructor"); return Promise; } });
      const names = [..."then constructor toString valueOf join next return name message stack once keepalive offset size type".split(" "), Symbol.toPrimitive, Symbol.iterator, Symbol.toStringTag];
      const classes = [Object, Array, Map, Set, Date, RegExp, Error, RangeError, Function, String, Iterator, Object.getPrototypeOf(Uint8Array), ArrayBuffer, URLSearchParams, Headers, Response, Blob, File];
      for (const holder of [...classes.map(it => it.prototype), ...[[], new Map(), new Set()].map(it => Object.getPrototypeOf(it.values()))]) {
        quietly(() => {
          for (const name of names) {
            const { value, get, configurable } = Object.getOwnPropertyDescriptor(holder, name) ?? { configurable: holder === Object.prototype || (name === "then" && holder !== Function.prototype) };
            if (get || !configurable) continue;
            const set = function (value) { define(this, name, { __proto__: null, value, writable: true, configurable: true, enumerable: true }); };
            define(holder, name, { __proto__: null, configurable, set, get() { note(this, name.description ?? name); return value; } });
          }
        })();
      }`;
    expect(
      await run(
        `serve({ "/": ${JSON.stringify(`<body><script>${spy}</script>`)} });
         const page = await open(undefined, preload), logged = [];
         for (let step = 0; step < ${steps.length}; step++) {
           const [[{ message }]] = await Promise.all([once(page, "console-message"), page.executeJavaScript("step = " + step + ", dispatchEvent(new Event(step))")]);
           logged.push(message);
         }
         print([await page.executeJavaScript("isBusy = true, got.join()"), logged]);`,
        {
          "preload.js": `const { contextBridge, ipcRenderer } = require("electron"), secret = { ipc: ipcRenderer };
            let callBack, list;
            addEventListener("list", event => (list = event.detail));
            self.ofPreload = true;
            contextBridge.exposeInMainWorld("api", { listen: it => void (callBack = it) });
            const say = it => console.log(String(it)), title = it => ((document.title = it), document.title);
            const give = detail => dispatchEvent(new CustomEvent("given", { detail }));
            ${steps.map(([step], index) => `addEventListener("${index}", () => { ${step} });`).join("\n")}`,
        },
      ),
    ).toEqual([["", steps.map(it => it[1])]]);
  });

  test("a preload script does not see what the page did to its globals", async () => {
    expect(
      await run(
        `serve({ "/": "<!doctype html><script>delete CompressionStream; fetch = Blob = HTMLDivElement = XMLHttpRequest = 1</script>" });
         const page = await open(undefined, preload);
         print(await page.executeJavaScript("[look(), ['Bun', 'process', 'Buffer', 'CompressionStream'].filter(name => name in self || Reflect.ownKeys(self).includes(name))]"));`,
        {
          "preload.js": `require("electron").contextBridge.exposeInMainWorld("look", () => {
            let events = 0;
            window.addEventListener("x", () => events++);
            onresize = () => events++;
            dispatchEvent(new Event("x"));
            dispatchEvent(new Event("resize"));
            return [events, typeof fetch, typeof Blob, typeof HTMLDivElement, typeof XMLHttpRequest, top === globalThis];
          });`,
        },
      ),
    ).toEqual([[[2, "function", "function", "function", "function", true], []]]);
  });

  test("executeJavaScript rejects with what a getter of the result throws", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        for (const thrown of ["new Error('a')", "{}"])
          print(await page.executeJavaScript("({ get it() { throw " + thrown + " } })").then(() => "resolved", it => it.message ?? "rejected"));`),
    ).toEqual(["a", "rejected"]);
  });

  test("executeJavaScript waits for the first document", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const window = new BrowserWindow();
        const href = window.webContents.executeJavaScript("location.href");
        await window.loadURL("app://trusted/");
        print(await href);`),
    ).toEqual(["app://trusted/"]);
  });

  test("messages keep their order, and are copied when they are sent", async () => {
    expect(
      await run(
        `serve({ "/": "" });
         const seen = [];
         ipcMain.on("a", (_, value) => seen.push(value));
         ipcMain.handle("b", (_, value) => void seen.push(value));
         const page = await open(undefined, preload);
         await once(ipcMain, "end");
         print(seen);`,
        {
          "preload.js": `
            const { ipcRenderer } = require("electron");
            addEventListener("load", () => setTimeout(() => {
              const value = { n: 1 };
              ipcRenderer.send("a", value);
              value.n = 2;
              ipcRenderer.invoke("b", value);
              value.n = 3;
              ipcRenderer.send("a", value);
              ipcRenderer.send("end");
            }));`,
        },
      ),
    ).toEqual([[{ n: 1 }, { n: 2 }, { n: 3 }]]);
  });

  test("location.reload() can be prevented", async () => {
    expect(
      await run(
        `serve({ "/": "" });
         const page = await open();
         page.once("will-navigate", event => event.preventDefault());
         const asked = once(page, "will-navigate");
         await page.executeJavaScript("globalThis.kept = 1; location.reload()");
         await asked;
         print([page.isLoading(), await page.executeJavaScript("globalThis.kept")]);
         page.executeJavaScript("location.reload()");
         await once(page, "did-finish-load");
         print(await page.executeJavaScript("typeof kept"));`,
      ),
    ).toEqual([[false, 1], "undefined"]);
  });

  test("message ports reach pages and utility processes", async () => {
    expect(
      await run(
        `serve({ "/": "" });
         const page = await open(undefined, preload);
         const child = electron.utilityProcess.fork(path.join(__dirname, "utility.js"), ["argument"]);
         print((await once(child, "message"))[0]);
         const { port1, port2 } = new electron.MessageChannelMain();
         child.postMessage("port", [port1]);
         page.postMessage("port", null, [port2]);
         print((await once(ipcMain, "answer"))[1]);
         child.kill();
         await once(child, "exit");`,
        {
          "preload.js": `
            const { ipcRenderer } = require("electron");
            ipcRenderer.on("port", ({ ports: [port] }) => {
              port.onmessage = event => ipcRenderer.send("answer", event.data);
              port.postMessage(20);
            });`,
          "utility.js": `
            process.parentPort.on("message", ({ ports: [port] }) => {
              port.on("message", ({ data }) => port.postMessage(data + 1));
              port.start();
            });
            process.parentPort.postMessage([process.type, process.argv.at(-1)]);`,
        },
      ),
    ).toEqual([["utility", "argument"], 21]);
  });

  test("ports of the main process", async () => {
    expect(
      await run(
        `const [outer, inner] = [new electron.MessageChannelMain(), new electron.MessageChannelMain()];
         const refusal = ports => { try { outer.port1.postMessage(0, ports); } catch (error) { return error.message; } };
         print([[outer.port1], [inner.port1, inner.port1], [{}]].map(refusal));
         inner.port2.postMessage("early");
         outer.port1.postMessage("outer", [inner.port1]);
         print(refusal([inner.port1]));
         outer.port2.start();
         const [{ data, ports: [moved] }] = await once(outer.port2, "message");
         moved.start();
         print([data, (await once(moved, "message"))[0].data]);
         inner.port2.close();
         print(await once(moved, "close"));`,
      ),
    ).toEqual([
      [
        "Port at index 0 contains the source port.",
        "Port at index 1 is a duplicate.",
        "Port at index 0 is not a valid port",
      ],
      "Port at index 0 is already neutered.",
      ["outer", "early"],
      [],
    ]);
  });

  test("ports and streams go from a page to its worker, which answers while it closes", async () => {
    expect(
      await run(
        `serve({ "/": "", "/worker.js": "onmessage = async ({ data: { port, stream } }) => { const text = await new Response(stream).text(); close(); port.postMessage(text); }" });
         const page = await open();
         print(await page.executeJavaScript(\`new Promise(done => {
           const { port1, port2 } = new MessageChannel();
           const stream = new Response("text").body;
           port1.onmessage = event => done([event.data, event.isTrusted, locked]);
           new Worker("/worker.js").postMessage({ port: port2, stream }, [port2, stream]);
           const { locked } = stream;
         })\`));`,
      ),
    ).toEqual([["text", true, true]]);
  });

  test("net.WebSocket", async () => {
    expect(
      await run(
        `const { net, session } = electron;
         const server = Bun.serve({
           port: 0,
           hostname: "127.0.0.1",
           tls: require("./tls.json"),
           fetch(request, server) {
             const data = ["origin", "cookie", "x-a", "user-agent"].map(it => request.headers.get(it));
             if (request.url.endsWith("/no")) return new Response("", { status: 403 });
             server.upgrade(request, { data, headers: { "set-cookie": "b=2", "sec-websocket-protocol": "one" } });
           },
           websocket: { open: it => it.send(JSON.stringify(it.data)), message: (it, data) => it.send(data) },
         });
         const url = "wss://127.0.0.1:" + server.port + "/";
         const ses = session.fromPartition("sockets");
         const ended = (url, options) => new Promise(done => {
           const seen = [];
           Object.assign(new net.WebSocket(url, options), { onerror: e => seen.push(e.type), onclose: e => done([...seen, e.code, e.reason, e.wasClean]) });
         });
         print(await ended(url, { session: ses }));
         ses.setCertificateVerifyProc((_, answer) => setImmediate(answer, 0));
         await ses.closeAllConnections();
         print(await ended(url + "no", { partition: "sockets" }));
         ses.webRequest.onBeforeRequest((_, answer) => answer({ cancel: true }));
         ses.setUserAgent("agent");
         await ses.cookies.set({ url: url.replace("ws", "http"), name: "a", value: "1" });
         for (const options of [{}, { useSessionCookies: true, origin: "https://a.test", headers: { "X-A": "1" } }]) {
           class Socket extends net.WebSocket {}
           const socket = new Socket(url, { session: ses, protocols: ["one", "two"], ...options });
           const next = () => once(socket, "message").then(([it]) => it);
           print([socket instanceof EventTarget, socket instanceof Socket, socket.readyState, socket.binaryType]);
           print([JSON.parse((await next()).data.replace(server.port, "port")), socket.readyState, socket.protocol]);
           for (const type of ["nodebuffer", "arraybuffer", "blob", "unknown"]) {
             socket.binaryType = type;
             socket.send(new Blob(["x"]));
             Bun.gc(true);
             const event = await next();
             print([event instanceof MessageEvent, event.data.constructor.name]);
           }
           socket.close(3001, "bye");
           const [{ code, reason, wasClean }] = await once(socket, "close");
           print([code, reason, wasClean, socket.readyState, (await ses.cookies.get({})).map(it => it.name)]);
         }
         for (const make of [() => new net.WebSocket("nope"), () => new net.WebSocket(url, ["a", "a"]), () => new net.WebSocket(url, { headers: { a: "\\n" } }), () => new net.WebSocket(url).send(""), () => new net.WebSocket(url).close(1)])
           try { make(); } catch (error) { print(error.name); }
         server.stop(true);`,
        { "tls.json": JSON.stringify(tls) },
      ),
    ).toEqual([
      ["error", 1006, "Error in connection establishment: net::ERR_CERT_AUTHORITY_INVALID", false],
      ["error", 1006, "Error during WebSocket handshake: Unexpected response code: 403 (net::ERR_FAILED)", false],
      ...[
        [["https://127.0.0.1:port", null, null, "agent"], ["a"]],
        [
          ["https://a.test", "a=1", "1", "agent"],
          ["a", "b"],
        ],
      ].flatMap(([headers, cookies]) => [
        [true, true, 0, "nodebuffer"],
        [headers, 1, "one"],
        ...["Buffer", "ArrayBuffer", "Blob", "Blob"].map(it => [true, it]),
        [3001, "bye", true, 3, cookies],
      ]),
      ...["SyntaxError", "SyntaxError", "TypeError", "InvalidStateError", "InvalidAccessError"],
    ]);
  });

  test("net.request: headers, progress, the order of events and what it refuses", async () => {
    expect(
      await run(`
        const { net } = electron;
        const server = Bun.serve({ port: 0, fetch: async request => new Response(request.headers.get("x-a") + (await request.text())) });
        const request = net.request({ url: server.url.href, method: "post" });
        const events = [];
        for (const name of ["finish", "close", "response"]) request.on(name, () => events.push(name));
        request.setHeader("X-A", [1, 2]);
        print([request.constructor.name, request.getHeader("x-a"), request.getUploadProgress()]);
        request.end("body");
        const [response] = await once(request, "response");
        print([response.constructor.name, request.getUploadProgress(), String(Buffer.concat(await response.toArray())), events]);
        const refused = net.request("http://127.0.0.1:1/");
        refused.end();
        print((await once(refused, "response").catch(error => error)).message);
        const url = "http://a.test/";
        for (const make of [
          () => net.request({ url: "nope" }),
          () => net.request({ url, headers: 1 }),
          () => net.request({ protocol: "ftp:", host: "a" }),
          () => net.request({ url, session: {} }),
          () => net.request({ url, partition: 1 }),
          () => net.request(url).setHeader("a b", "1"),
          () => net.request(url).setHeader("a", "1\\n"),
          () => net.request(url).setHeader(1, "1"),
          () => net.request(url).getHeader(),
        ])
          try { make(); } catch (error) { print(error.name + ": " + error.message); }
        server.stop(true);`),
    ).toEqual([
      ["ClientRequest", [1, 2], { active: false, started: false, current: 0, total: 0 }],
      [
        "IncomingMessage",
        { active: true, started: true, current: 4, total: 4 },
        "1,2body",
        ["finish", "close", "response"],
      ],
      "net::ERR_UNSAFE_PORT",
      "TypeError: Invalid URL",
      "TypeError: headers must be an object",
      "Error: ClientRequest only supports http: and https: protocols",
      "TypeError: `session` should be an instance of the Session class",
      "TypeError: `partition` should be a string",
      "Error: Invalid header name: 'a b'",
      "Error: Invalid value for header 'a': '1\n'",
      "TypeError: `name` should be a string in setHeader(name, value)",
      "Error: `name` is required for getHeader(name)",
    ]);
  });

  test("sessions that are opened after a window without one has loaded something", async () => {
    expect(
      await run(`
        const { document } = new (require("bun:desktop").Window)();
        const image = Object.assign(document.createElement("img"), { src: "data:,a" });
        await new Promise(done => (image.onerror = done));
        serve({ "/": "<title>served</title>" });
        print([await electron.session.defaultSession.cookies.get({}), (await open()).getTitle()]);
        print(await electron.session.fromPartition("other").cookies.get({}));`),
    ).toEqual([[[], "served"], []]);
  });

  test("where partitions are stored, and what a session refuses", async () => {
    expect(
      await run(`
        const { session } = electron;
        const ses = session.defaultSession;
        const where = name => path.relative(app.getPath("sessionData"), session.fromPartition(name).storagePath).replaceAll(path.sep, "/");
        print(["persist:A b", "persist:a@b.c+d:e", "persist:../../x", "persist:"].map(where));
        print([ses.constructor.name, session.fromPartition("persist:") === ses, await ses.resolveProxy("nope"), await ses.cookies.get({ url: "nope" })]);
        ses.registerPreloadScript({ type: "frame", id: "i", filePath: __filename });
        for (const make of [
          () => session.fromPath("a"),
          () => ses.registerPreloadScript({ type: "frame", id: "i", filePath: __filename }),
          () => ses.unregisterPreloadScript("j"),
          () => ses.setPermissionRequestHandler(1),
          () => ses.clearData({ origins: [], excludeOrigins: [] }),
          () => ses.cookies.set({}),
          () => ses.cookies.set({ url: "http://a.test", sameSite: "x" }),
          () => ses.webRequest.onCompleted({}, () => {}),
          () => ses.setCodeCachePath("a"),
        ])
          try { await make(); } catch (error) { print(error.name + ": " + error.message); }`),
    ).toEqual([
      ["Partitions/a%20b", "Partitions/a@b.c+d%3Ae", "Partitions/_/_/x", ""],
      ["Session", true, "DIRECT", []],
      "TypeError: An absolute path was not provided",
      "Error: Cannot register preload script with existing ID 'i'",
      "Error: Cannot unregister preload script with non-existing ID 'j'",
      "TypeError: Must pass null or function",
      "TypeError: Cannot provide both 'origins' and 'excludeOrigins'",
      "Error: Missing required option 'url'",
      "Error: Failed to convert 'x' to an appropriate cookie same site value",
      "TypeError: Parameter 'filter' must have property 'urls'.",
      "TypeError: Absolute path must be provided to store code cache.",
    ]);
  });

  test("protocol.registerSource, and how handlers fail", async () => {
    expect(
      await run(
        `const { net } = electron;
         const get = url => net.fetch(url).then(async it => [it.headers.get("x-a"), await it.text()], error => error.message);
         const directory = (root, more) => ({ type: "directory", root: path.join(__dirname, root), ...more });
         protocol.registerSource("app", { routes: [{ source: directory("root", { headers: { "x-a": "1" } }) }, { match: { host: "b", path: "/p" }, source: directory("root/sub") }] });
         for (const url of ["app://a/", "app://a/sub/file", "app://b/p/file", "app://b/pp/file", "app://a/..%2Fsecret", "app://a/none"]) print(await get(url));
         for (const routes of [[{ source: directory("root") }], [], [{}], [{ source: { type: "directory", root: "a" } }]])
           try { protocol.registerSource("app", { routes }); } catch (error) { print(error.message); }
         protocol.unhandle("app");
         for (const handler of [() => { throw new Error("thrown"); }, () => {}]) {
           protocol.handle("app", handler);
           print(await get("app://a/"));
           protocol.unhandle("app");
         }
         for (const [kind, answer] of [["String", { error: -10 }], ["Buffer", "text"], ["File", { path: path.join(__dirname, "secret"), headers: { "x-a": "2" } }]]) {
           protocol["register" + kind + "Protocol"]("app", (_, callback) => callback(answer));
           print(await get("app://a/"));
           protocol.unregisterProtocol("app");
         }`,
        { "root/index.html": "index", "root/sub/file": "file", "secret": "secret" },
      ),
    ).toEqual([
      ["1", "index"],
      ["1", "file"],
      [null, "file"],
      ...Array(3).fill("net::ERR_FILE_NOT_FOUND"),
      "Scheme app is already handled",
      "'routes' must be a non-empty array",
      "Each route needs a 'source'",
      "'source.root' must be an absolute path",
      ...Array(2).fill("net::ERR_UNEXPECTED"),
      "net::ERR_ACCESS_DENIED",
      "net::ERR_NOT_IMPLEMENTED",
      ["2", "secret"],
    ]);
  });

  test("the directories for data are there", async () => {
    const usual = `
      const { app } = require("electron");
      app.setPath("appData", __dirname + "/config");
      console.log(require("fs").existsSync(app.getPath("userData")));
      app.exit(0);`;
    expect([
      await run(`print(["userData", "sessionData"].map(it => require("fs").statSync(app.getPath(it)).isDirectory()));`),
      await run("", { "main.js": usual }),
    ]).toEqual([[[true, true]], [true]]);
  });

  test("a download makes the directory that it goes to", async () => {
    expect(
      await run(
        `const server = Bun.serve({ port: 0, fetch: () => new Response("text") });
         const file = path.join(__dirname, "not", "yet", "file");
         const announced = new Promise(resolve => session.defaultSession.once("will-download", (_, item) => (item.setSavePath(file), resolve(once(item, "done")))));
         session.defaultSession.downloadURL(server.url.href);
         print([(await announced)[1], require("fs").readFileSync(file, "utf8")]);
         server.stop(true);`,
      ),
    ).toEqual([["completed", "text"]]);
  });

  test("an interrupted download goes on where it has stopped", async () => {
    expect(
      await run(
        `const ranges = [];
         const server = Bun.serve({
           port: 0,
           fetch: request => (ranges.push(request.headers.get("range")), new Response("456789", { status: 206, headers: { "content-range": "bytes 4-9/10", etag: '"e"' } })),
         });
         const file = path.join(__dirname, "part");
         const announced = once(electron.session.defaultSession, "will-download");
         electron.session.defaultSession.createInterruptedDownload({ path: file, urlChain: [server.url.href], offset: 4, length: 10, eTag: '"e"' });
         const [, item] = await announced;
         print([item.getState(), item.canResume(), item.getPercentComplete(), item.hasUserGesture()]);
         item.resume();
         print([(await once(item, "done"))[1], require("fs").readFileSync(file, "utf8"), ranges]);
         server.stop(true);`,
        { "part": "0123" },
      ),
    ).toEqual([
      ["interrupted", true, 40, false],
      ["completed", "0123456789", ["bytes=4-"]],
    ]);
  });

  test("net of a utility process", async () => {
    expect(
      await run(
        `const { tls } = require("./tls.json");
         electron.app.commandLine.appendSwitch("ignore-certificate-errors");
         const server = Bun.serve({
           port: 0,
           tls,
           fetch: request => (request.url.endsWith("/away") ? Response.redirect("/") : request.text().then(text => new Response(text))),
         });
         const child = electron.utilityProcess.fork(path.join(__dirname, "utility.js"), [server.url.href]);
         print((await once(child, "message"))[0]);
         child.kill();
         await once(child, "exit");
         server.stop(true);`,
        {
          "tls.json": JSON.stringify({ tls }),
          "utility.js": `
            const { net } = require("electron");
            const url = process.argv.at(-1);
            Promise.all([
              net.fetch(url, { method: "POST", body: "body" }).then(response => response.text()),
              net.fetch(url + "away", { redirect: "error" }).catch(error => error.message),
              net.fetch(url + "away", { redirect: "manual" }).catch(error => error.message),
              new Promise(done => net.request(url).on("response", response => done(response.statusCode)).end()),
              net.resolveHost("localhost").then(it => it.endpoints.length > 0),
            ]).then(results => process.parentPort.postMessage(results));`,
        },
      ),
    ).toEqual([
      ["body", "Attempted to redirect, but redirect policy was 'error'", "Redirect was cancelled", 200, true],
    ]);
  });

  test("modules, import maps and uncaught errors", async () => {
    expect(
      await run(`
        serve({
          "/": \`<script type=importmap>{"imports":{"name":"/lib/b.js"}}</script>
            <script>
              seen = [];
              addEventListener("error", event => seen.push(event.message));
              addEventListener("unhandledrejection", event => seen.push(event.reason));
            </script>
            <script>missing()</script>
            <script type=module src=/a.js></script>\`,
          "/a.js": "import b from 'name'; import c from './c.json' with { type: 'json' }; window.result = [b, c, import.meta.url];",
          "/lib/b.js": "export default import.meta.url",
          "/c.json": "[1]",
        });
        const page = await open();
        print(await page.executeJavaScript("result"));
        print(await page.executeJavaScript("import('/none.js').catch(error => error.message)"));
        print(await page.executeJavaScript(\`new Promise(resolve => {
          addEventListener("unhandledrejection", () => resolve(seen.map(it => it.split(":")[0])));
          Promise.reject("rejected");
        })\`));`),
    ).toEqual([
      ["app://trusted/lib/b.js", [1], "app://trusted/a.js"],
      "Failed to fetch dynamically imported module: app://trusted/none.js",
      ["Uncaught ReferenceError", "rejected"],
    ]);
  });

  test("Content Security Policy", async () => {
    expect(
      await run(`
        serve(
          { "/": "<script>window.a = 1</script><script nonce=n>window.b = 1</script><script src=/c.js></script>", "/c.js": "window.c = 1" },
          { "content-security-policy": "default-src 'none'; script-src 'self' 'nonce-n'" },
        );
        const page = await open();
        print(await page.executeJavaScript(\`(async () => [
          window.a ?? null, window.b, window.c,
          await fetch("/c.js").then(() => "fetched", error => error.name),
          await Promise.try(() => eval("1")).catch(error => error.name),
        ])()\`));`),
    ).toEqual([[null, 1, 1, "TypeError", "EvalError"]]);
  });

  test.each([
    ["a script with duplicate attributes", "<script src=/other.js a a=<script nonce=n></script>"],
    [
      "the module that is at the base URL of an inline script",
      "<base href=/other.js><script nonce=n>0</script><link rel=modulepreload href=/other.js><script type=module src=/other.js></script>",
    ],
  ])("a nonce is not for %s", async (_, markup) => {
    expect(
      await run(`
        serve(
          {
            "/": ${JSON.stringify(markup)} + "<script nonce=n>window.imported = import('/mine.js')</script>",
            "/other.js": "window.other = 1",
            "/mine.js": "export default 1",
          },
          { "content-security-policy": "script-src 'nonce-n'" },
        );
        const page = await open();
        print(await page.executeJavaScript("imported.then(it => [it.default, window.other ?? null])"));`),
    ).toEqual([[1, null]]);
  });

  test("the referrer is where a style sheet or a script came from, not a base URL", async () => {
    expect(
      await run(`
        const seen = {};
        const { promise, resolve } = Promise.withResolvers();
        const note = request => {
          seen[new URL(request.url).search] = request.referrer;
          if (Object.keys(seen).length === 5) resolve();
          return new Response("", { headers: { "content-type": "text/javascript" } });
        };
        const rule = name => \`.\${name} { background: url("app://trusted/note?\${name}" referrer-policy(unsafe-url)) }\`;
        serve({
          "/": \`<base href=/base><link rel=stylesheet href=/linked.css><style>\${rule("inline")}</style>
            <script src=/external.js></script><script>import("/note?inline-script")</script>\`,
          "/linked.css": rule("linked"),
          "/external.js": 'import("/note?external-script")',
          "/note": note,
        });
        const page = await open();
        await page.executeJavaScript(\`
          const sheet = new CSSStyleSheet({ baseURL: "app://trusted/given" });
          sheet.replaceSync(\${JSON.stringify(rule("constructed"))});
          document.adoptedStyleSheets = [sheet];
          document.querySelector("base").remove();
          document.body.innerHTML = "<p class=linked>a<p class=inline>a<p class=constructed>a";\`);
        await promise;
        print(seen);`),
    ).toEqual([
      {
        "?linked": "app://trusted/linked.css",
        "?inline": "app://trusted/",
        "?constructed": "app://trusted/",
        "?external-script": "app://trusted/external.js",
        "?inline-script": "app://trusted/",
      },
    ]);
  });

  test("the document of a frame that is removed with deferred scripts left is collected", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        let arrived;
        serve({
          "/": "<body>",
          "/frame": "<script defer src=/a.js></script><script src=/never.js></script>",
          "/a.js": "",
          "/never.js": () => new Promise(() => arrived()),
        });
        const page = await open();
        await page.executeJavaScript("window.all = []; 0");
        for (let i = 0; i < 20; i++) {
          const requested = new Promise(done => (arrived = done));
          await page.executeJavaScript('document.body.innerHTML = "<iframe src=/frame></iframe>"; 0');
          await requested;
          await page.executeJavaScript("all.push(new WeakRef(frames[0].document)); document.body.replaceChildren()");
        }
        let left = 20;
        for (let i = 0; i < 50 && left > 10; i++) {
          await collectGarbage(page);
          left = await page.executeJavaScript("all.filter(it => it.deref()).length");
        }
        print(left <= 10);`),
    ).toEqual([true]);
  });

  describe.skipIf(isWindows)("pages in processes of their own", () => {
    const apart = { BUN_DESKTOP_PAGE_PROCESSES: "1", BUN_DESKTOP_THREADS: "2" };

    test("scripts, messages, requests and pixels", async () => {
      expect(
        await run(
          `serve({ "/": "<body style='background:#00f'><script src=/a.js></script>", "/a.js": "document.title = 'a'", "/b": "b" });
          ipcMain.handle("twice", (event, value) => [event.senderFrame.url, value * 2]);
          const page = await open("app://trusted/", preload);
          print([page.getOSProcessId() !== process.pid, page.getTitle()]);
          print(await page.executeJavaScript("Promise.all([twice(2), fetch('/b').then(it => it.text())])"));
          print(await page.executeJavaScript("'" + Buffer.alloc(2 << 20, "a") + "'.length"));
          print([...(await page.capturePage()).toBitmap().subarray(0, 4)]);`,
          {
            "preload.js": `const { contextBridge, ipcRenderer } = require("electron");
              contextBridge.exposeInMainWorld("twice", it => ipcRenderer.invoke("twice", it));`,
          },
          [],
          apart,
        ),
      ).toEqual([[true, "a"], [["app://trusted/", 4], "b"], 2 << 20, [255, 0, 0, 255]]);
    });

    test("a frame that may not go back does not change where the page goes back to", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted"], { inFrames: true });
          serve({ "/": "", "/frame": "<script>history.go(-2); console.log('asked'); for (;;);</script>" });
          const page = await open(), asked = once(page, "console-message");
          await page.executeJavaScript(\`
            history.pushState(null, "", "#a");
            history.pushState(null, "", "#b");
            document.body.append(Object.assign(document.createElement("iframe"), { sandbox: "allow-scripts", src: "/frame" }))\`);
          await asked;
          print(await page.executeJavaScript("new Promise(done => { onpopstate = () => done(location.hash); history.back(); })"));`,
          {},
          [],
          apart,
        ),
      ).toEqual(["#a"]);
    });

    test("the app outlives the process", async () => {
      expect(
        await run(
          `serve({ "/": "<title>a</title>" });
          const page = await open(), other = await open(), first = page.getOSProcessId();
          process.kill(first, "SIGKILL");
          print([(await once(page, "render-process-gone"))[1].reason, page.isCrashed(), other.isCrashed()]);
          page.reload();
          await once(page, "did-finish-load");
          print([await page.executeJavaScript("document.title"), page.getOSProcessId() !== first]);`,
          {},
          [],
          apart,
        ),
      ).toEqual([
        ["killed", true, false],
        ["a", true],
      ]);
    });

    test.skipIf(!isLinux)("the process does not get the environment", async () => {
      expect(
        await run(
          `serve({ "/": "" });
          const page = await open();
          print(require("fs").readFileSync("/proc/" + page.getOSProcessId() + "/environ", "latin1").includes("SECRET"));`,
          {},
          [],
          { ...apart, SECRET: "1" },
        ),
      ).toEqual([false]);
    });

    test.skipIf(!isLinux).each([
      [[], [], ["NoNewPrivs:\t1", "Seccomp:\t2"]],
      [
        ["--no-sandbox"],
        "read stat list write remove connect listen datagram spawn signal input".split(" "),
        expect.anything(),
      ],
    ])("the process cannot get at files, the network or other processes (%j)", async (args, succeeded, status) => {
      expect(
        await run(
          `serve({ "/": "" });
          const server = require("net").createServer().listen(0, "127.0.0.1");
          await once(server, "listening");
          const args = [__filename, String(server.address().port), String(process.pid)];
          const page = await open(undefined, { webPreferences: { ...preload.webPreferences, sandbox: false, additionalArguments: args } });
          print(await page.executeJavaScript("attempt()"));
          const fs = require("fs"), about = "/proc/" + page.getOSProcessId();
          print(fs.readFileSync(about + "/status", "latin1").match(/^(NoNewPrivs|Seccomp):.*/gm));
          print(fs.readdirSync(about + "/fd").map(it => fs.readlinkSync(about + "/fd/" + it)).filter(it => !/^(socket|pipe|anon_inode):|^\\/dev\\/null$/.test(it)));
          server.close();`,
          {
            "preload.js": `const fs = require("fs"), [file, port, parent] = process.argv.slice(-3);
              const attempts = {
                read: () => fs.readFileSync(file),
                stat: () => fs.statSync(file),
                list: () => fs.readdirSync("/"),
                write: () => fs.writeFileSync(file + ".new", ""),
                remove: () => fs.unlinkSync(file),
                connect: () => new Promise((done, fail) => require("net").connect(+port, "127.0.0.1", done).on("error", fail)),
                listen: () => new Promise((done, fail) => require("net").createServer().on("error", fail).listen(0, done)),
                datagram: () => new Promise((done, fail) => require("dgram").createSocket("udp4").on("error", fail).bind(0, done)),
                spawn: () => require("child_process").execFileSync(process.execPath, ["--version"]),
                signal: () => process.kill(+parent, 0),
                input: () => fs.readSync(0, Buffer.alloc(1)),
              };
              require("electron").contextBridge.exposeInMainWorld("attempt", async () => {
                const succeeded = [];
                for (const name in attempts) await Promise.try(attempts[name]).then(() => succeeded.push(name), () => {});
                return succeeded;
              });`,
          },
          args,
          { BUN_DESKTOP_PAGE_PROCESSES: "node" },
        ),
      ).toEqual([succeeded, status, []]);
    });

    test("a page cannot make the app open a file for it", async () => {
      expect(
        await run(
          `serve({ "/": "" });
          const page = await open(undefined, { webPreferences: { ...preload.webPreferences, sandbox: false } });
          const { port1, port2 } = new electron.MessageChannelMain();
          const { promise, resolve } = Promise.withResolvers();
          port1.on("message", ({ data }) => (data === "end" ? resolve() : print(data && data.size)));
          port1.start();
          page.postMessage("a", __filename, [port2]);
          await promise;`,
          {
            "preload.js": `const { file } = require("bun");
              require("electron").ipcRenderer.on("a", ({ ports }, path) => {
                for (const it of [new Blob(["ab"]), file(path), file(1), [file(path)], "end"]) ports[0].postMessage(it);
              });`,
          },
          [],
          { BUN_DESKTOP_PAGE_PROCESSES: "node" },
        ),
      ).toEqual([2, null, null, null]);
    });

    test("a file that a page was given is read-only when it comes back", async () => {
      expect(
        await run(
          `serve({ "/": "<input type=file>" });
          const page = await open(undefined, preload);
          page.debugger.attach();
          const { result } = await page.debugger.sendCommand("Runtime.evaluate", { expression: "document.querySelector('input')" });
          await page.debugger.sendCommand("DOM.setFileInputFiles", { objectId: result.objectId, files: [__dirname + "/a.txt"] });
          const { port1, port2 } = new electron.MessageChannelMain();
          port1.start();
          page.postMessage("a", null, [port2]);
          const [{ data }] = await once(port1, "message");
          const changes = [() => Bun.write(data, ""), () => data.write(""), () => data.writer(), () => data.unlink(), () => data.slice(1).write("")];
          print([data.name, (await Promise.allSettled(changes.map(it => Promise.try(it)))).filter(it => it.status === "fulfilled"), await data.text()]);`,
          {
            "a.txt": "abc",
            "preload.js": `require("electron").ipcRenderer.on("a", ({ ports }) => ports[0].postMessage(document.querySelector("input").files[0]));`,
          },
          [],
          apart,
        ),
      ).toEqual([["a.txt", [], "abc"]]);
    });

    test("frames of another site get bitmaps, and lose their activation together", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted", "app://other"], { inFrames: true });
          serve({ "/": "<iframe src=app://other/a></iframe><iframe src=app://other/a></iframe>", "/a": "" });
          const page = await open(), [one, other] = page.mainFrame.frames;
          page.setWindowOpenHandler(() => ({ action: "deny" }));
          const heard = one.executeJavaScript(\`new Promise(done => (onmessage = ({ data }) => {
            const context = new OffscreenCanvas(2, 1).getContext("2d");
            context.drawImage(data, 0, 0);
            done([data.width, data.height, ...context.getImageData(1, 0, 1, 1).data]);
          }))\`);
          await one.executeJavaScript("0");
          await page.executeJavaScript("createImageBitmap(new ImageData(new Uint8ClampedArray([0, 0, 0, 0, 1, 2, 3, 255]), 2)).then(it => frames[0].postMessage(it, '*', [it]))");
          print(await heard);
          print(await one.executeJavaScript("navigator.userActivation.isActive", true));
          await other.executeJavaScript("void open('/a')", true);
          print(await one.executeJavaScript("navigator.userActivation.isActive"));`,
          {},
          [],
          apart,
        ),
      ).toEqual([[2, 1, 1, 2, 3, 255], true, false]);
    });

    test("frames of another site take the focus at once, and know whether they are seen", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted", "app://other"], { inFrames: true });
          const watch = "new Promise(done => new IntersectionObserver(all => done(all[0].isIntersecting)).observe(document.body))";
          serve({
            "/": "<iframe src=app://other/a></iframe><div style='height: 5000px'></div><iframe src=app://other/a></iframe>",
            "/a": "<body><input><script>first = " + watch + "</script>",
          });
          const page = await open(), [above, below] = page.mainFrame.frames;
          page.debugger.attach();
          await page.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
          print(await above.executeJavaScript("seen = []; onfocus = () => seen.push('focus'); document.querySelector('input').focus(); seen.concat(document.hasFocus())"));
          print([await below.executeJavaScript("first"), await below.executeJavaScript(watch), await above.executeJavaScript(watch)]);
          const left = above.executeJavaScript("new Promise(done => new IntersectionObserver(all => all.at(-1).isIntersecting || done('left')).observe(document.body))");
          await above.executeJavaScript(watch);
          await page.executeJavaScript("scrollTo(0, 1000)");
          print(await left);`,
          {},
          [],
          apart,
        ),
      ).toEqual([["focus", true], [false, false, true], "left"]);
    });

    test("nothing runs in a page that has been unloaded", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted", "app://other"], { inFrames: true });
          serve({ "/": "<iframe src=app://other/a></iframe>", "/a": "" });
          ipcMain.on("seen", (event, it) => print(it));
          const page = await open(undefined, { webPreferences: { ...preload.webPreferences, nodeIntegrationInSubFrames: true } });
          const pid = page.mainFrame.frames[0].osProcessId;
          await page.executeJavaScript("document.querySelector('iframe').remove()");
          while (app.getAppMetrics().some(it => it.pid === pid)) await new Promise(setImmediate);`,
          {
            "preload.js": `addEventListener("pagehide", () => {
              const { ipcRenderer } = require("electron");
              ipcRenderer.send("seen", "hidden");
              setTimeout(() => ipcRenderer.send("seen", "late"));
              for (const end = performance.now() + 5; performance.now() < end; );
            });`,
          },
          [],
          apart,
        ),
      ).toEqual(["hidden", "hidden"]);
    });

    test("an upload is read before the app asks for it", async () => {
      expect(
        await run(
          `serve({ "/": "" });
          const page = await open(), { promise, resolve } = Promise.withResolvers();
          page.on("console-message", resolve);
          page.session.webRequest.onBeforeRequest((details, go) => promise.then(() => go({})));
          print(await page.executeJavaScript(\`fetch("https://127.0.0.1:1/", {
            method: "POST", duplex: "half", body: new ReadableStream({ pull: it => (console.log("read"), it.close()) }, { highWaterMark: 0 }),
          }).catch(it => it.name)\`));`,
          {},
          [],
          apart,
        ),
      ).toEqual(["TypeError"]);
    });

    test("cursors see what is written in front of them, and transactions start in order", async () => {
      expect(
        await run(
          `serve({ "/": "" });
          print(await (await open()).executeJavaScript(\`new Promise(done => {
            const request = indexedDB.open("a"), seen = [], ended = [];
            request.onupgradeneeded = () => request.result.createObjectStore("a").createIndex("b", "b");
            request.onsuccess = () => {
              const store = request.result.transaction("a", "readwrite").objectStore("a");
              for (let key = 0; key < 40; key += 2) store.put({ b: -key }, key);
              store.openCursor().onsuccess = ({ target: { result } }) => {
                if (!result) return store.index("b").openCursor().onsuccess = ({ target: { result } }) => result && (seen.push(result.value.b), result.advance(7));
                seen.push(result.key + ":" + result.value.b);
                if (result.key === 10) store.put({ b: 1 }, 11), store.delete(12), store.put({ b: 2 }, 14);
                result.key === 16 ? result.continue(33) : result.continue();
              };
              for (let it = 0; it < 30; it++) request.result.transaction("a").oncomplete = () => ended.push(it) === 30 && done([seen.join(), ended.every((it, at) => it === at)]);
            };
          })\`));`,
          {},
          [],
          apart,
        ),
      ).toEqual([["0:0,2:-2,4:-4,6:-6,8:-8,10:-10,11:1,14:2,16:-16,34:-34,36:-36,38:-38,-38,-24,-6", true]]);
    });

    test("a page only passes on to a frame what the user has pressed and released", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted", "app://other"], { inFrames: true });
          serve({
            "/": "<body style=margin:0><iframe src=app://other/a></iframe>",
            "/a": "<script>var all = []; for (const it of ['move', 'down', 'up']) addEventListener('pointer' + it, event => all.push(event.pointerType + it + event.button));</script>",
          });
          const page = await open(undefined, { webPreferences: { ...preload.webPreferences, sandbox: false } });
          const [frame] = page.mainFrame.frames, heard = last => frame.executeJavaScript(\`new Promise(function look(done) { all.includes("\${last}") ? done(all.splice(0)) : setTimeout(look, 1, done); })\`);
          print(frame.osProcessId !== page.getOSProcessId());
          page.send("forge");
          print(await heard("mousemove-1"));
          for (const type of ["mouseDown", "mouseUp"]) page.sendInputEvent({ type, x: 20, y: 20, button: "left", clickCount: 1 });
          print(await heard("mouseup0"));`,
          {
            "preload.js": `const { decodesMessage } = require("bun:internal-for-testing").desktopInternals;
              const of = (Type, ...numbers) => [...new Uint8Array(Type.from(numbers).buffer)];
              const place = [...of(Float64Array, 9, 9, 9, 9), ...of(Uint32Array, 0)];
              const mouse = (action, button) => [...of(Uint16Array, 0, action), ...place, ...of(Int16Array, button, 0), ...of(Int32Array, 1)];
              const finger = [...of(Int32Array, 1), ...place, ...of(Float64Array, 1, 1), 0, ...of(Float64Array, 0), ...of(Int32Array, 0, 0, 0)];
              const touch = phase => [...of(Uint16Array, 2, phase), ...of(Uint32Array, 1), ...finger, ...of(Uint32Array, 0)];
              const ask = (kind, frame, about, input) => [...of(Uint16Array, kind), ...of(Uint32Array, frame), ...of(Uint16Array, about), ...input];
              const upTo = length => Array.from({ length }, (_, it) => it);
              const inputs = [mouse(1, 1), mouse(2, 1), mouse(2, 0), touch(0), touch(2), mouse(0, -1)];
              const kinds = upTo(300).flatMap(kind => upTo(32).map(about => [kind, about])).filter(([kind, about]) =>
                inputs.every(it => decodesMessage("question", new Uint8Array(ask(kind, 0, about, it)))));
              require("electron").ipcRenderer.on("forge", () => {
                for (const input of inputs) for (const [kind, about] of kinds) for (const page of upTo(8)) for (const frame of upTo(4))
                  decodesMessage("forged", new Uint8Array([page, ...ask(kind, frame, about, input)]));
              });`,
          },
          [],
          { BUN_DESKTOP_PAGE_PROCESSES: "node" },
        ),
      ).toEqual([true, ["mousemove-1"], ["mousedown0", "mouseup0"]]);
    });

    test("a page that does not return does not hold up other windows", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted", "app://other"], { inFrames: true });
          serve({ "/": "", "/a": "" });
          const page = await open(), created = once(page, "did-create-window");
          await page.executeJavaScript("void (self.popup = open('app://other/'))", true);
          const [{ webContents }] = await created;
          await once(webContents, "did-finish-load");
          page.executeJavaScript("popup.location = 'app://other/a'; for (;;);").catch(() => {});
          await once(webContents, "did-finish-load");
          print(webContents.getURL());
          page.forcefullyCrashRenderer();`,
          {},
          [],
          apart,
        ),
      ).toEqual(["app://other/a"]);
    });

    test("storage is shared", async () => {
      expect(
        await run(
          `using server = Bun.serve({ port: 0, fetch: () => new Response("", { headers: { "content-type": "text/html" } }) });
          app.trustOrigins([server.url.origin]);
          const [one, other] = [await open(server.url.href), await open(server.url.href)];
          print(one.getOSProcessId() !== other.getOSProcessId());
          const database = \`new Promise(done => {
            const request = indexedDB.open("a");
            request.onupgradeneeded = () => request.result.createObjectStore("a");
            request.onsuccess = () => done(request.result.transaction("a", "readwrite"));
          })\`;
          const heard = other.executeJavaScript(\`Promise.all([
            new Promise(done => (onstorage = event => done([event.key, event.newValue, localStorage.a])), localStorage.length),
            new Promise(done => ((self.channel = new BroadcastChannel("a")).onmessage = event => done(event.data))),
          ])\`);
          await other.executeJavaScript("0");
          await one.executeJavaScript(\`(async () => {
            localStorage.a = "1";
            new BroadcastChannel("a").postMessage(2);
            const transaction = await \${database};
            transaction.objectStore("a").put(new Blob(["3"]), 1);
            await new Promise(done => (transaction.oncomplete = done));
            await (await caches.open("a")).put("/a", new Response("4"));
            const file = await (await (await navigator.storage.getDirectory()).getFileHandle("a", { create: true })).createWritable();
            await file.write("5");
            await file.close();
            await new Promise(done => navigator.locks.request("a", () => (done(), new Promise(() => {}))));
          })()\`);
          print(await heard);
          const url = await one.executeJavaScript("URL.createObjectURL(new Blob(['6'], { type: 'text/plain' }))");
          print(await other.executeJavaScript(\`fetch("\${url}").then(it => it.text())\`));
          print(await other.executeJavaScript(\`(async () => {
            const request = (await \${database}).objectStore("a").get(1);
            await new Promise(done => (request.onsuccess = done));
            return [
              await request.result.text(),
              await (await caches.match("/a")).text(),
              await (await (await (await navigator.storage.getDirectory()).getFileHandle("a")).getFile()).text(),
              await navigator.locks.request("a", { ifAvailable: true }, lock => lock),
            ];
          })()\`));
          const granted = other.executeJavaScript("navigator.locks.request('a', lock => lock.name)");
          one.forcefullyCrashRenderer();
          print(await granted);`,
          {},
          [],
          apart,
        ),
      ).toEqual([true, [["a", "1", "1"], 2], "6", ["3", "4", "5", null], "a"]);
    });

    test("document.cookie follows what happens elsewhere", async () => {
      expect(
        await run(
          `using server = Bun.serve({ port: 0, fetch: ({ url }) => new Response("", { headers: { "content-type": "text/html", ...(url.endsWith("/set") && { "set-cookie": "b=2" }) } }) });
          app.trustOrigins([server.url.origin]);
          const [one, other] = [await open(server.url.href), await open(server.url.href)], read = () => one.executeJavaScript("document.cookie").then(print);
          await read();
          print(await one.executeJavaScript("document.cookie = 'a=1', document.cookie"));
          print(await one.executeJavaScript("fetch('/set').then(() => document.cookie)"));
          await other.executeJavaScript("document.cookie = 'c=3'");
          await read();
          await session.defaultSession.cookies.remove(server.url.href, "a");
          await read();
          await session.defaultSession.cookies.set({ url: server.url.href, name: "d", value: "4", expirationDate: Date.now() / 1000 + 0.3 });
          await read();
          print(await one.executeJavaScript("for (; document.cookie.includes('d'); ); document.cookie"));`,
          {},
          [],
          apart,
        ),
      ).toEqual(["", "a=1", "a=1; b=2", "a=1; b=2; c=3", "b=2; c=3", "b=2; c=3; d=4", "b=2; c=3"]);
    });

    test("the app waits for the end of the script that has asked for a navigation", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted"], { inFrames: true });
          const asked = [];
          serve({ "/": "<body>", "/a": () => (asked.push("a"), new Response("a")), "/b": "b" });
          const page = await open(), wait = "for (const end = performance.now() + 50; performance.now() < end; );";
          print(await page.executeJavaScript(\`var frame = document.body.appendChild(Object.assign(document.createElement("iframe"), { src: "/b" })); \${wait} frame.contentDocument.URL\`));
          print(await page.executeJavaScript(\`location = "/a"; \${wait} stop(); new Promise(done => setTimeout(done, 20, location.pathname))\`));
          print(asked);`,
          {},
          [],
          apart,
        ),
      ).toEqual(["about:blank", "/", []]);
    });

    test("a process that has been stopped ends with its window", async () => {
      expect(
        await run(
          `serve({ "/": "" });
          const page = await open(), pid = page.getOSProcessId(), exists = () => { try { return process.kill(pid, 0); } catch { return false; } };
          app.on("window-all-closed", () => {});
          process.kill(pid, "SIGSTOP");
          BrowserWindow.fromWebContents(page).destroy();
          while (exists()) await new Promise(done => setTimeout(done, 10));
          print("ended");`,
          {},
          [],
          apart,
        ),
      ).toEqual(["ended"]);
    });

    test("the next page arrives although the process of the last one has ended", async () => {
      expect(
        await run(
          `serve({ "/": "", "/a": () => once(page, "render-process-gone").then(() => new Response("a")) });
          const page = await open(), loaded = page.loadURL("app://trusted/a");
          process.kill(page.getOSProcessId(), "SIGKILL");
          await loaded;
          print([page.isCrashed(), await page.executeJavaScript("document.body.textContent")]);`,
          {},
          [],
          apart,
        ),
      ).toEqual([[false, "a"]]);
    });

    test("forcefullyCrashRenderer() ends a page that does not return", async () => {
      expect(
        await run(
          `serve({ "/": "<title>a</title>" });
          const page = await open();
          page.executeJavaScript("for (;;);").catch(() => {});
          page.once("render-process-gone", (event, details) => print(details));
          page.forcefullyCrashRenderer();
          await page.loadURL("app://trusted/");
          print(await page.executeJavaScript("document.title"));`,
          {},
          [],
          apart,
        ),
      ).toEqual([{ reason: "killed", exitCode: 2 }, "a"]);
    });

    test("the debugger follows the page to another process", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://other"]);
          serve({ "/": "<script>console.log(early, location.host)</script>" });
          const page = new BrowserWindow().webContents, send = (method, params) => page.debugger.sendCommand(method, params);
          page.debugger.attach();
          page.debugger.on("message", (event, method, { args }) => method === "Runtime.consoleAPICalled" && print(args.map(it => it.value)));
          await send("Runtime.enable");
          await send("Page.addScriptToEvaluateOnNewDocument", { source: "early = 1" });
          await page.loadURL("app://trusted/");
          const first = page.getOSProcessId(), { objectId } = (await send("Runtime.evaluate", { expression: "document" })).result;
          print((await send("DOM.describeNode", { objectId })).node.nodeName);
          await page.loadURL("app://other/");
          print(first !== page.getOSProcessId());
          await send("Runtime.evaluate", { expression: "document" });
          print(await send("DOM.describeNode", { objectId }).catch(it => it.message));`,
          {},
          [],
          apart,
        ),
      ).toEqual([[1, "trusted"], "#document", [1, "other"], true, "Could not find object with given id"]);
    });

    test("only the parent can make one", async () => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "--bun-desktop-child=page", "a"], env: bunEnv, stderr: "pipe" });
      expect(await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])).toEqual(["", "", 1]);
    });
  });

  const runAsAsked = (main: string, files?: Record<string, string>, args?: string[]) =>
    run(main, files, args, { BUN_DESKTOP_PAGE_PROCESSES: "asked" });

  describe.skipIf(!isLinux)('app.setWebEngine({ type: "bun" })', () => {
    const run = runAsAsked;
    const start = `app.setWebEngine({ type: "bun" });
      const where = frame => (frame.osProcessId === process.pid ? "app" : frame.osProcessId);
      const shape = frames => frames.map(where).map((it, _, all) => (it === "app" ? it : all.indexOf(it)));
      const until = async condition => { while (!(await condition())) await new Promise(setImmediate); };
      const click = (page, x, y) => ["mouseMove", "mouseDown", "mouseUp"].forEach(type => page.sendInputEvent({ type, x, y, button: "left", clickCount: 1 }));
      const pixel = async (page, x, y) => [...(await page.capturePage({ x, y, width: 1, height: 1 })).toBitmap().subarray(0, 3)].join();`;

    test("a window goes where its page belongs", async () => {
      expect(
        await run(
          `${start}
          serve({ "/": "<script src=app://third/a.js></script><script>eval('document.title += 1')</script>", "/a.js": "document.title = 'a'" });
          const page = await open(), seen = [];
          for (const host of ["trusted", "other", "other", "third", "trusted"]) {
            await page.loadURL("app://" + host + "/");
            seen.push([page.getOSProcessId(), page.getTitle()]);
          }
          print(shape(seen.map(it => ({ osProcessId: it[0] }))));
          print(seen.map(it => it[1]));
          await until(() => app.getAppMetrics().filter(it => it.type === "Tab").length <= 1);`,
        ),
      ).toEqual([
        ["app", 1, 1, 3, "app"],
        ["1", "a1", "a1", "a1", "1"],
      ]);
    });

    test("each site of a page has a process", async () => {
      expect(
        await run(
          `${start}
          app.trustOrigins([], { inFrames: ["app://trusted/own"] });
          serve({
            "/": "<iframe src=/own></iframe><iframe src=app://other/a></iframe><iframe sandbox=allow-scripts srcdoc=a></iframe><iframe></iframe>",
            "/a": "<iframe src=app://third/b></iframe><iframe src=/own></iframe><iframe src=app://trusted/own></iframe><iframe srcdoc=a></iframe><iframe sandbox src=/own></iframe>",
            "/b": "<iframe src=app://other/own></iframe>",
            "/own": "",
          });
          const page = await open(), all = page.mainFrame.framesInSubtree;
          all.sort((a, b) => a.url.localeCompare(b.url) || a.parent?.url.localeCompare(b.parent?.url) || a.frameTreeNodeId - b.frameTreeNodeId);
          print(shape(all).map((it, at) => all[at].url + " " + it));
          print(await page.executeJavaScript("[frames[1].length, frames[1][0].length, frames[1][0][0].top === top, frames[1][0].parent === frames[1]]"));
          print(await page.mainFrame.frames[1].executeJavaScript("[frames[0][0].location.href, frames[0][0].top === parent, parent.length, [...location.ancestorOrigins]]"));
          print(await page.mainFrame.frames[1].frames[2].executeJavaScript("try { top.document.URL } catch (error) { error.name }"));`,
        ),
      ).toEqual([
        [
          " app",
          "about:srcdoc 1",
          "about:srcdoc 2",
          "app://other/a 1",
          "app://other/own 1",
          "app://other/own 5",
          "app://other/own 1",
          "app://third/b 7",
          "app://trusted/ app",
          "app://trusted/own 9",
          "app://trusted/own app",
        ],
        [5, 1, true, true],
        ["app://other/own", true, 4, ["app://trusted"]],
        "SecurityError",
      ]);
    });

    test("messages between windows", async () => {
      expect(
        await run(
          `${start}
          serve({
            "/": "<iframe src=app://other/echo></iframe><iframe src=app://third/echo></iframe>",
            "/echo": \`<script>onmessage = ({ data, origin, source, ports }) => {
              if (data === "sibling") parent[1].postMessage("from sibling", "app://third");
              else if (data === "from sibling") top.postMessage([data, origin, source === parent[0]], "*");
              else if (ports.length) ports[0].postMessage(data.byteLength);
              else source.postMessage([data, origin], origin);
            }</script>\`,
          });
          const page = await open();
          page.setWindowOpenHandler(() => ({ action: "allow" }));
          print(await page.executeJavaScript(\`(async () => {
            const next = (target = window) => new Promise(done => (target.onmessage = done)), all = [];
            frames[0].postMessage("lost", "app://third");
            frames[0].postMessage(new Map([[1, new Blob(["a"])]]), "app://other");
            let event = await next();
            all.push([await event.data[0].get(1).text(), event.data[1], event.origin, event.source === frames[0]]);
            frames[0].postMessage("sibling", "*");
            all.push((await next()).data);
            const { port1, port2 } = new MessageChannel(), buffer = new ArrayBuffer(3);
            frames[1].postMessage(buffer, "*", [buffer, port2]);
            all.push((await next(port1)).data);
            const popup = open("app://other/echo"), again = setInterval(() => popup.postMessage("popup", "app://other"), 10);
            event = await next();
            clearInterval(again);
            all.push([event.data, event.source === popup]);
            popup.close();
            all.push(popup.closed);
            return all;
          })()\`, true));`,
        ),
      ).toEqual([
        [
          ["a", "app://trusted", "app://other", true],
          ["from sibling", "app://other", true],
          3,
          [["popup", "app://trusted"], true],
          true,
        ],
      ]);
    });

    test("a frame is painted, and gets the mouse, the keys and the focus", async () => {
      expect(
        await run(
          `${start}
          serve({
            "/": \`<body style="margin:0;height:2000px"><input id=before style="height:20px;display:block;box-sizing:border-box">
              <iframe src=app://other/a style="border:0;display:block" width=200 height=100></iframe><input id=after>
              <script>onkeydown = event => (self.keys = (self.keys ?? "") + event.key)</script>\`,
            "/a": "<body style='margin:0;background:#00f'><input style='height:20px;display:block'>",
          });
          const page = await open(), [frame] = page.mainFrame.frames;
          const press = keyCode => ["keyDown", "char", "keyUp"].forEach(type => page.sendInputEvent({ type, keyCode }));
          page.debugger.attach();
          await page.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
          await until(async () => (await pixel(page, 100, 100)) === "255,0,0");
          print(await frame.executeJavaScript("[innerWidth, innerHeight]"));
          click(page, 10, 30);
          await until(() => frame.executeJavaScript("document.hasFocus() && document.activeElement.localName === 'input'"));
          press("a");
          page.insertText("b");
          await until(() => frame.executeJavaScript("document.activeElement.value === 'ab'"));
          print([page.focusedFrame.url, await page.executeJavaScript("[document.activeElement.localName, navigator.userActivation.hasBeenActive]")]);
          press("Tab");
          await until(() => page.executeJavaScript("document.activeElement === after"));
          press("c");
          print(await page.executeJavaScript("[after.value, keys]"));
          await frame.executeJavaScript("document.querySelector('input').focus(); document.body.style.background = '#0f0'");
          await until(() => page.executeJavaScript("document.activeElement.localName === 'iframe'"));
          await until(async () => (await pixel(page, 100, 100)) === "0,255,0");
          await page.executeJavaScript("document.querySelector('iframe').width = 150");
          await until(() => frame.executeJavaScript("innerWidth === 150"));
          await frame.executeJavaScript("new IntersectionObserver(all => (self.isSeen = all.at(-1).isIntersecting)).observe(document.body)");
          await until(() => frame.executeJavaScript("self.isSeen"));
          page.sendInputEvent({ type: "mouseWheel", x: 50, y: 80, deltaX: 0, deltaY: -10 });
          await until(() => page.executeJavaScript("scrollY > 0"));
          print("scrolled");`,
        ),
      ).toEqual([[200, 100], ["app://other/a", ["iframe", true]], ["c", "c"], "scrolled"]);
    });

    test("a frame navigates between processes", async () => {
      expect(
        await run(
          `${start}
          app.trustOrigins([], { inFrames: ["app://trusted/*"] });
          serve({ "/": "<iframe></iframe>", "/a": "a" });
          const page = await open();
          for (const step of ["frame.src = 'app://other/a'", "frame.src = '/a'", "frames[0].location = 'app://third/a'", "frames[0].location.replace('app://other/a')"]) {
            const seen = await page.executeJavaScript(\`new Promise(done => {
              const frame = document.querySelector("iframe"), before = frame.contentWindow;
              frame.onload = () => done([frame.contentWindow === before, frame.contentDocument?.body.textContent ?? null]);
              \${step};
            })\`);
            print([page.mainFrame.frames[0].url, where(page.mainFrame.frames[0]) === "app", ...seen]);
          }`,
        ),
      ).toEqual([
        ["app://other/a", false, true, null],
        ["app://trusted/a", true, true, "a"],
        ["app://third/a", false, true, null],
        ["app://other/a", false, true, null],
      ]);
    });

    test("a frame of the same origin that is not trusted cannot run scripts in the app", async () => {
      expect(
        await run(
          `${start}
          app.trustOrigins([], { injectedScripts: true });
          serve({ "/": "<title>a</title><iframe srcdoc=a></iframe>" });
          const page = await open(), [frame] = page.mainFrame.frames;
          print(await frame.executeJavaScript(\`const all = [origin];
            for (const attempt of [() => (parent.location = "javascript:document.title = 'b'"), () => open("javascript:document.title = 'c'", "_top"), () => parent.document])
              try { attempt(); all.push("returned"); } catch (error) { all.push(error.name); }
            new Promise(done => { onmessage = () => done(all); postMessage("", "*"); })\`, true));
          print(await page.executeJavaScript("document.title"));`,
        ),
      ).toEqual([["app://trusted", "returned", "returned", "SecurityError"], "a"]);
    });

    test.each([
      [`open("javascript:document.title = typeof Bun", "_blank", "noopener")`, false],
      [`open("about:blank", "_blank", "noopener")`, false],
      [`open("app://trusted/")`, true],
      [`open("app://other/redirect", "_blank", "noopener")`, true],
    ])("what a page that is not trusted opens is not in the app: %s", async (script, loads) => {
      expect(
        await run(
          `${start}
          serve({ "/": "", "/redirect": () => Response.redirect("app://trusted/") });
          const page = await open("app://other/"), created = once(page, "did-create-window");
          await page.executeJavaScript(${JSON.stringify("void " + script)}, true);
          const [{ webContents }] = await created;
          if (${loads}) await until(() => webContents.getURL() === "app://trusted/" && !webContents.isLoading());
          print([await webContents.mainFrame.executeJavaScript("document.title"), webContents.getOSProcessId() === process.pid]);`,
        ),
      ).toEqual([["", false]]);
    });

    test("a page that is not trusted only leads back to the app in a window that has come from there", async () => {
      expect(
        await run(
          `${start}
          serve({ "/": "" });
          for (const first of ["trusted", "third"]) {
            const page = await open("app://" + first + "/");
            await page.loadURL("app://other/");
            page.executeJavaScript("location = 'app://trusted/'");
            await once(page, "did-finish-load");
            print([page.getURL(), page.getOSProcessId() === process.pid]);
          }`,
        ),
      ).toEqual([
        ["app://trusted/", true],
        ["app://trusted/", false],
      ]);
    });

    test("a page that is not trusted does not have the storage of the trusted pages of its origin", async () => {
      expect(
        await run(
          `${start}
          app.trustOrigins([], { except: ["app://trusted/except"] });
          serve({ "/": "<iframe srcdoc=a></iframe>", "/except": "" });
          const page = await open(), other = await open("app://trusted/except");
          await page.executeJavaScript("localStorage.a = 1; caches.open('a').then(() => {})");
          for (const it of [page.mainFrame, page.mainFrame.frames[0], other.mainFrame])
            print(await it.executeJavaScript("caches.keys().then(it => [origin, localStorage.a ?? null, ...it])"));`,
        ),
      ).toEqual([
        ["app://trusted", "1", "a"],
        ["app://trusted", null],
        ["app://trusted", null],
      ]);
    });

    test("a page with frames of many sites leaves processes for others", async () => {
      expect(
        await run(
          `${start}
          serve({ "/": Array.from({ length: 60 }, (_, it) => "<iframe src=app://site" + it + "/a></iframe>").join(""), "/a": "a" });
          const page = await open("app://other/");
          print(new Set(page.mainFrame.framesInSubtree.map(it => it.osProcessId).filter(it => it && it !== process.pid)).size);
          print(await (await open("app://third/a")).executeJavaScript("document.body.textContent"));`,
        ),
      ).toEqual([48, "a"]);
    });

    test("a blob is shown in a process for its origin", async () => {
      expect(
        await run(
          `${start}
          serve({ "/": "<iframe src=app://other/a></iframe><iframe src=app://third/a></iframe>", "/a": "" });
          const page = await open(), [one, other] = page.mainFrame.frames;
          const url = await one.executeJavaScript("URL.createObjectURL(new Blob(['a'], { type: 'text/html' }))");
          const loaded = once(page, "did-frame-finish-load");
          other.executeJavaScript(\`location = "\${url}"\`);
          await loaded;
          print([shape(page.mainFrame.frames), await page.mainFrame.frames[1].executeJavaScript("[origin, document.body.textContent]")]);`,
        ),
      ).toEqual([
        [
          [0, 0],
          ["app://other", "a"],
        ],
      ]);
    });

    test("a page outlives the process of its frame, and not the other way round", async () => {
      expect(
        await run(
          `${start}
          serve({ "/": "<iframe src=app://third/a></iframe>", "/a": "" });
          const page = await open("app://other/"), tabs = () => app.getAppMetrics().filter(it => it.type === "Tab").map(it => it.pid);
          page.on("render-process-gone", (event, { reason }) => print(reason));
          let pid = page.mainFrame.frames[0].osProcessId;
          process.kill(pid, "SIGKILL");
          await until(() => !tabs().includes(pid));
          print(await page.executeJavaScript(\`new Promise(done => Object.assign(document.querySelector("iframe"), { onload: () => done("again"), src: "app://third/a?b" }))\`));
          pid = page.mainFrame.frames[0].osProcessId;
          page.forcefullyCrashRenderer();
          await until(() => !tabs().includes(pid));
          print(page.mainFrame.frames.length);`,
        ),
      ).toEqual(["again", "killed", 0]);
    });

    test("a frame is asked before the page is left", async () => {
      expect(
        await run(
          `${start}
          serve({ "/": "<iframe src=app://other/a></iframe>", "/a": "<script>onbeforeunload = event => event.preventDefault()</script>" });
          const page = await open();
          page.once("will-prevent-unload", () => (print("asked"), page.destroy()));
          page.close({ waitForBeforeUnload: true });`,
        ),
      ).toEqual(["asked"]);
    });

    test("a page that is not trusted has a preload without Node.js and without the environment", async () => {
      expect(
        await run(
          `${start}
          serve({ "/": "" });
          const options = { webPreferences: { ...preload.webPreferences, sandbox: false, nodeIntegration: true, contextIsolation: false } };
          ipcMain.once("a", (event, ...all) => print(all));
          print(await (await open("app://other/", options)).executeJavaScript("[typeof require, typeof process, typeof inPreload]"));`,
          {
            "preload.js": `globalThis.inPreload = 1;
              let fs;
              try { fs = typeof require("fs"); } catch { fs = "none"; }
              require("electron").ipcRenderer.send("a", fs, process.sandboxed, Object.keys(process.env));`,
          },
        ),
      ).toEqual([
        ["none", true, []],
        ["undefined", "undefined", "undefined"],
      ]);
    });
  });

  describe.skipIf(!isLinux)("webPreferences.sandbox", () => {
    const run = runAsAsked;

    test.each([
      [[], [true, true, false, false, true]],
      [["--enable-sandbox"], [false, false, false, false, false]],
    ])("decides which pages are in the process of the app (%j)", async (args, expected) => {
      expect(
        await run(
          `serve({ "/": "" });
          const all = [{}, { sandbox: false }, { sandbox: true }, { sandbox: true, nodeIntegration: true }, {}];
          for (const webPreferences of all) print((await open(undefined, { webPreferences })).getOSProcessId() === process.pid);`,
          {},
          args,
        ),
      ).toEqual(expected);
    });

    test("holds for the frames and the windows of a page", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted"], { inFrames: true });
          serve({ "/": "<iframe src=/a></iframe>", "/a": "a" });
          const page = await open(undefined, { webPreferences: { sandbox: true } });
          print(page.mainFrame.framesInSubtree.map(it => it.osProcessId === page.getOSProcessId()));
          for (const url of ["", "/a"]) {
            const created = once(page, "did-create-window");
            await page.executeJavaScript("void open('" + url + "')", true);
            const [{ webContents }] = await created;
            if (url) await once(webContents, "did-finish-load");
            print([webContents.getOSProcessId() === page.getOSProcessId(), webContents.getOSProcessId() === process.pid]);
          }`,
        ),
      ).toEqual([
        [true, true],
        [true, false],
        [true, false],
      ]);
    });

    test("does not separate windows that share objects", async () => {
      expect(
        await run(
          `app.trustOrigins(["app://other"], { inFrames: true });
          serve({ "/": "a" });
          const page = await open();
          page.setWindowOpenHandler(() => ({ action: "allow", overrideBrowserWindowOptions: { webPreferences: { sandbox: true } } }));
          for (const host of ["trusted", "other"]) {
            const created = once(page, "did-create-window");
            await page.executeJavaScript("void (self.popup = open('app://" + host + "/'))", true);
            const [{ webContents }] = await created;
            await once(webContents, "did-finish-load");
            print([webContents.getOSProcessId() === process.pid, await page.executeJavaScript("try { popup.document.body.textContent } catch (error) { error.name }")]);
          }`,
        ),
      ).toEqual([
        [true, "a"],
        [false, "SecurityError"],
      ]);
    });

    test.each([
      ["crash", true, "crashed"],
      ["crash", undefined, "crashed"],
      ["hang", true, "killed"],
    ])("the app outlives process.%s() in a preload script (sandbox: %p)", async (method, sandbox, reason) => {
      expect(
        await run(
          `serve({ "/": "<title>a</title>" });
          const page = await open(undefined, { webPreferences: { ...preload.webPreferences, sandbox: ${sandbox} } });
          const gone = once(app, "render-process-gone");
          page.send("end");
          ${method === "hang" ? `await once(ipcMain, "ends"); page.forcefullyCrashRenderer();` : ""}
          print((await gone)[2].reason);
          await page.loadURL("app://trusted/");
          print(await page.executeJavaScript("document.title"));`,
          {
            "preload.js": `const { ipcRenderer } = require("electron");
              ipcRenderer.on("end", () => (ipcRenderer.send("ends"), process.${method}()));`,
          },
        ),
      ).toEqual([reason, "a"]);
    });
  });

  test("--enable-sandbox does not start an app without one", async () => {
    const started = run(`print("started")`, {}, ["--enable-sandbox"], { BUN_DESKTOP_PAGE_PROCESSES: "" });
    expect(await started.catch(it => it.message)).toContain("--enable-sandbox is not supported");
  });

  test.skipIf(!isLinux)("app.enableSandbox()", async () => {
    expect(
      await runAsAsked(
        `app.setWebEngine({ type: "bun" });
        serve({ "/": "<iframe src=/a></iframe><iframe src=app://other/a></iframe>", "/a": "a" });
        const page = await open(undefined, { webPreferences: { nodeIntegration: true, sandbox: false } });
        print(new Set([process.pid, ...page.mainFrame.framesInSubtree.map(it => it.osProcessId)]).size);
        print(await page.executeJavaScript("[typeof require, frames[0].document.body.textContent]"));
        try { app.enableSandbox(); } catch (error) { print(error.message); }`,
        {
          "early.js": `require("electron").app.enableSandbox();`,
          "bunfig.toml": `preload = ["bun:desktop/electron", "./early.js"]`,
        },
      ),
    ).toEqual([3, ["undefined", "a"], "app.enableSandbox() can only be called before app is ready"]);
  });

  describe("realms and documents are collected", () => {
    const leave = {
      navigating: `for (let i = 0; i < count; i++) await page.loadURL("app://trusted/page?" + i); await page.loadURL("app://trusted/");`,
      reloading: `await page.loadURL("app://trusted/page");
        for (let i = 0; i < count; i++) { const loaded = once(page, "did-finish-load"); page.reload(); await loaded; }`,
      "removing frames": `await page.executeJavaScript(\`(async () => {
        for (let i = 0; i < \${count}; i++) {
          const frame = document.createElement("iframe");
          await new Promise(done => { frame.onload = done; frame.src = "/page"; document.body.append(frame); });
          frame.remove();
        }
      })()\`);`,
      "closing windows": `for (let i = 0; i < count; i++) BrowserWindow.fromWebContents(await open("app://trusted/page", preload)).destroy();`,
      "closing popups": `page.setWindowOpenHandler(() => ({ action: "allow" }));
        await page.executeJavaScript(\`(async () => {
          for (let i = 0; i < \${count}; i++) {
            const popup = open("/page");
            await new Promise(done => (onmessage = done));
            popup.close();
          }
        })()\`, true);`,
    };
    const busy = `
      const never = () => new Promise(() => document);
      setInterval(never, 1e6);
      requestIdleCallback(never, { timeout: 1e6 });
      (function again() { requestAnimationFrame(again); })();
      scheduler.postTask(never, { delay: 1e6 });
      AbortSignal.timeout(1e6).onabort = never;
      fetch("/never").then(never);
      import("/never").then(never);
      new Response(new ReadableStream({ pull: never })).text().then(never);
      new EventSource("/never").onmessage = new BroadcastChannel("a").onmessage = new MessageChannel().port1.onmessage = never;
      navigator.locks.request("a", never);
      new Worker("/worker.js").onmessage = never;
      document.body.animate({ opacity: [0, 1] }, 1e6).onfinish = matchMedia("print").onchange = never;
      new ResizeObserver(never).observe(document.body);
      new IntersectionObserver(never).observe(document.body);
      new MutationObserver(never).observe(document, { childList: true });
      document.body.append(Object.assign(document.createElement("video"), { src: "/never" }), document.createElement("iframe"));
      document.startViewTransition(never);
      opener?.postMessage("", "*");`;

    test.each(Object.entries(leave))("after %s", async (_, steps) => {
      expect(
        await run(
          `app.trustOrigins(["app://trusted"], { inFrames: true });
           serve({
             "/": "<body>",
             "/page": ${JSON.stringify(`<body><script>addEventListener("load", () => {${busy}})</script>`)},
             "/worker.js": "setInterval(() => {}, 1e6)",
             "/never": () => new Promise(() => {}),
           });
           const page = await open(), count = 30;
           const leftElsewhere = async () => {
             const file = path.join(__dirname, "heap.json");
             await page.takeHeapSnapshot(file);
             const { snapshot, nodes, strings } = await Bun.file(file).json(), fields = snapshot.meta.node_fields;
             const isNative = at => snapshot.meta.node_types[0][nodes[at - fields.indexOf("name")]] === "native";
             const names = nodes.filter((_, at) => at % fields.length === fields.indexOf("name") && isNative(at)).map(it => strings[it]);
             const [documents, windows] = ["HTMLDocument", "Window"].map(name => names.filter(it => it === name).length || NaN);
             return Math.max(documents, windows, app.getAppMetrics().length);
           };
           ${steps}
           const deadline = performance.now() + 2000;
           let left;
           do {
             await new Promise(setImmediate);
             Bun.gc(true);
             const { globalObjectCount, objectTypeCounts } = require("bun:jsc").heapStats();
             left = Math.max(globalObjectCount, objectTypeCounts.HTMLDocument ?? (await leftElsewhere()));
           } while (left > 8 && performance.now() < deadline);
           print(left <= 8 || left);`,
          {
            "preload.js": `require("electron").contextBridge.exposeInMainWorld("api", { title: () => document.title });`,
          },
        ),
      ).toEqual([true]);
    });
  });

  test("each frame has prototypes of its own, which are alike", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=/a></iframe>".repeat(4), "/a": "" });
        const page = await open();
        print(await page.executeJavaScript(\`
          const describe = realm => ["Node", "Element", "HTMLElement", "Document", "Event", "Navigator", "DOMTokenList", "NodeList"].map(name => {
            const { prototype } = realm[name];
            const isOwn = it => typeof it !== "function" || it instanceof realm.Function;
            return Reflect.ownKeys(prototype).map(key => {
              const { value, get, set, ...flags } = Object.getOwnPropertyDescriptor(prototype, key);
              return [String(key), typeof value === "object" ? "" : String(value), value?.length, get?.name, set?.name, [value, get, set].every(isOwn), Object.values(flags)];
            });
          }).join();
          const expected = describe(window);
          delete frames[1].Node.prototype.appendChild;
          frames[2].Element.prototype.remove = frames[2].Element.prototype.added = null;
          const late = document.body.appendChild(document.createElement("iframe")).contentWindow;
          const thrown = realm => { try { realm.Node.prototype.contains.call(0); } catch (error) { return error instanceof realm.TypeError; } };
          [frames[0], frames[1], frames[2], frames[3], late].map(it => [describe(it) === expected, thrown(it), it.document.body instanceof it.EventTarget].join())\`));`),
    ).toEqual([["true,true,true", "false,true,true", "false,true,true", "true,true,true", "true,true,true"]]);
  });

  test("AbortSignal extends the EventTarget of the page", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        print(await page.executeJavaScript(\`
          const controller = new AbortController(), seen = [];
          controller.signal.addEventListener("abort", event => seen.push(event.type, event.target === controller.signal), { once: true });
          controller.abort();
          [Object.getPrototypeOf(AbortSignal) === EventTarget, Object.getPrototypeOf(AbortSignal.prototype) === EventTarget.prototype, ...seen]\`));`),
    ).toEqual([[true, true, "abort", true]]);
  });

  test("what looks like a window is no source of a message", async () => {
    expect(
      await run(`
        serve({ "/": "<iframe></iframe><iframe sandbox srcdoc=x></iframe>" });
        const page = await open();
        print(await page.executeJavaScript(\`
          const fake = {};
          fake.window = fake;
          [window, frames[0], frames[1], new MessageChannel().port1, fake].map(source => {
            try { return new MessageEvent("message", { source }).source === source; } catch (error) { return error.name; }
          })\`));`),
    ).toEqual([[true, true, true, true, "TypeError"]]);
  });

  test("an empty frame that shares the realm stops with its window", async () => {
    expect(
      await run(`
        serve({ "/": "<body>", "/never": () => new Promise(() => {}) });
        const page = await open();
        print(await page.executeJavaScript(\`new Promise(done => {
          let ticks = 0;
          window.all = [];
          for (let i = 0; i < 20; i++) {
            const frame = document.body.appendChild(document.createElement("iframe")), inside = frame.contentDocument;
            all.push(new WeakRef(inside));
            inside.body.innerHTML = "<img src=/never><link rel=stylesheet href=/never><video src=/never></video>";
            frame.contentWindow.setInterval(() => (inside, ticks++));
            frame.contentWindow.fetch("/never").then(() => inside, () => ticks++);
            frame.contentWindow.scheduler.postTask(() => inside, { delay: 1e6 });
            inside.startViewTransition(() => new Promise(() => inside));
          }
          requestAnimationFrame(() => {
            document.body.replaceChildren();
            ticks = 0;
            setTimeout(() => setTimeout(() => done(ticks), 5), 5);
          });
        })\`));
        const deadline = performance.now() + 5000;
        let left;
        do {
          await new Promise(setImmediate);
          await collectGarbage(page);
          left = await page.executeJavaScript("all.filter(it => it.deref()).length");
        } while (left > 5 && performance.now() < deadline);
        print(left <= 5 || left);`),
    ).toEqual([0, true]);
  });

  test("takeRecords() of a PerformanceObserver keeps what it returns", async () => {
    expect(
      await run(
        `serve({ "/": "" });
         const page = await open();
         print(await page.executeJavaScript(\`
           let wrong = 0;
           for (let i = 0; i < 20; i++) {
             const observer = new PerformanceObserver(() => {});
             observer.observe({ type: "mark" });
             for (let j = 0; j < 2000; j++) performance.mark(j);
             performance.clearMarks();
             // The next big allocation collects.
             window.ballast = new Array(200_000);
             const records = observer.takeRecords();
             observer.disconnect();
             for (let j = 0; j < 4000; j++) new PerformanceMark("other");
             wrong += records.filter((it, j) => it.name !== String(j)).length;
           }
           wrong\`));`,
        {},
        [],
        { BUN_JSC_gcMaxHeapSize: "1000000", BUN_JSC_useConcurrentGC: "0" },
      ),
    ).toEqual([0]);
  });

  test("requests of pages: cookies, CORS and webRequest", async () => {
    expect(
      await run(`
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch(request) {
            const { pathname } = new URL(request.url);
            if (pathname === "/") return new Response("", { headers: { "content-type": "text/html", "set-cookie": "a=1; HttpOnly" } });
            const headers = pathname === "/open" ? { "access-control-allow-origin": "*" } : {};
            return Response.json([request.headers.get("cookie"), request.headers.get("x-added"), request.headers.get("origin")], { headers });
          },
        });
        const origin = server.url.origin;
        app.trustOrigins([origin]);
        serve({ "/": "" });
        const { webRequest, cookies } = session.defaultSession;
        webRequest.onBeforeRequest({ urls: ["*://*/blocked"] }, (_, callback) => callback({ cancel: true }));
        webRequest.onBeforeSendHeaders((details, callback) => callback({ requestHeaders: { ...details.requestHeaders, "x-added": "1" } }));
        const get = url => \`fetch("\${url}").then(response => response.json(), error => error.message)\`;
        const same = await open(origin);
        print(await same.executeJavaScript("document.cookie = 'b=2'; document.cookie"));
        print(await same.executeJavaScript(get("/echo")));
        print(await same.executeJavaScript(get("/blocked")));
        print(await same.executeJavaScript(\`new Promise(resolve => {
          const request = new XMLHttpRequest();
          request.onload = () => resolve([request.status, request.response[0]]);
          request.responseType = "json";
          request.open("POST", "/echo");
          request.send("body");
        })\`));
        const other = await open();
        print(await other.executeJavaScript(get(origin + "/echo")));
        print(await other.executeJavaScript(get(origin + "/open")));
        print((await cookies.get({})).map(cookie => [cookie.name, cookie.httpOnly]));
        print(await (await net.fetch(origin + "/echo")).json());
        print(await (await session.fromPartition("other").fetch(origin + "/echo")).json());
        server.stop(true);`),
    ).toEqual([
      "b=2",
      ["a=1; b=2", "1", null],
      "Failed to fetch",
      [200, "a=1; b=2"],
      "Failed to fetch",
      [null, "1", "app://trusted"],
      [
        ["a", true],
        ["b", false],
      ],
      ["a=1; b=2", "1", null],
      [null, null, null],
    ]);
  });

  test("proxies", async () => {
    expect(
      await run(
        `const proxy = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => new Response("proxied " + request.url) });
         const closed = Bun.listen({ port: 0, hostname: "127.0.0.1", socket: { data() {} } });
         closed.stop();
         const resolve = async (ses, ...urls) => print(await Promise.all(urls.map(url => ses.resolveProxy(url))));
         await resolve(session.defaultSession, "https://a.test/", "https://a.skipped/", "http://10.1.1.1/", "http://localhost/");
         const ses = session.fromPartition("proxied");
         await ses.setProxy({ proxyRules: "http=a,direct://;socks=b", proxyBypassRules: "<-loopback>;<local>" });
         await resolve(ses, "http://127.0.0.1/", "https://a.test/", "http://plain/");
         await ses.setProxy({ proxyRules: "127.0.0.1:" + closed.port + ",127.0.0.1:" + proxy.port });
         print(await (await ses.fetch("http://a.test/x")).text());
         await ses.setProxy({ proxyRules: "127.0.0.1:" + closed.port });
         print(await ses.fetch("http://a.test/").catch(error => error.message));
         await ses.setProxy({ proxyRules: "quic://a" });
         print(await ses.fetch("http://a.test/").catch(error => error.message));
         await ses.setProxy({ pacScript: "http://127.0.0.1:" + closed.port });
         print(await ses.fetch("http://a.test/").catch(error => error.message));
         await ses.setProxy({ mode: "system" });
         await resolve(ses, "https://a.test/", "http://a.test/", "https://b.direct.test/");
         proxy.stop(true);`,
        {},
        ["--proxy-server=https://pinned:8443", "--proxy-bypass-list=*.skipped;10.0.0.0/8"],
        { https_proxy: "http://environment:1", no_proxy: "direct.test", XDG_CURRENT_DESKTOP: "" },
      ),
    ).toEqual([
      ["HTTPS pinned:8443", "DIRECT", "DIRECT", "DIRECT"],
      ["PROXY a:80; DIRECT", "SOCKS b:1080", "DIRECT"],
      "proxied http://a.test/x",
      "net::ERR_PROXY_CONNECTION_FAILED",
      "net::ERR_NO_SUPPORTED_PROXIES",
      "net::ERR_MANDATORY_PROXY_CONFIGURATION_FAILED",
      isLinux ? ["PROXY environment:1", "DIRECT", "DIRECT"] : expect.anything(),
    ]);
  });

  test("PAC scripts", async () => {
    const scripts = {
      [`return url == "https://a.test/" && dnsDomainIs(host, ".test") && shExpMatch(host, "?.t*") ? "one" : "x"`]:
        "one",
      [`if (isInNet("localhost", "127.0.0.0", "255.0.0.0") && !isPlainHostName(host)) return "resolved"`]: "resolved",
      [`var s = ""; for (var k in { a: 1, b: 2 }) s += k; for (var i = 0; i < 3; i++) { if (i == 1) continue; s += i } return s`]:
        "ab02",
      [`switch (host) { case "b": return 1; case "a.test": var z = 2; default: z++; break; case "c": z = 9 } return "n" + z`]:
        "n3",
      [`function F(n) { this.n = n } F.prototype = { get t() { return this.n * 2 } };
        function G(n) { F.call(this, n) } G.prototype = { __proto__: F.prototype }; return "n" + new G(4).t`]: "n8",
      [`try { null.x } catch (e) { return e.name.toLowerCase() } finally {}`]: "typeerror",
      [`return /^A\\./i.test(host) + [3, 1].sort((a, b) => a - b).join("-") + 4 / 2 / 1`]: "true1-32",
      [`var found = [typeof process, typeof globalThis, typeof this, typeof eval, typeof Function];
        ["", [], /a/, 1, true, {}, new Date(), [].map, function () {}].forEach(function (it) {
          found.push(typeof it.constructor, typeof it.__defineGetter__);
        });
        return found.every(function (it) { return it == "undefined" }) ? "confined" : "escaped"`]: "confined",
      [`var escaped = 0;
        ["concat", "slice", "reverse", "sort", "map", "filter"].forEach(function (name) {
          ["a", 1, true, /a/].forEach(function (self) {
            try { [][name].call(self, function (it) { return it }); escaped++ } catch (e) {}
          });
        });
        try { "".valueOf.call([]); escaped++ } catch (e) {}
        return escaped ? "escaped" : "confined"`]: "confined",
      [`const made = []; for (let i = 0; i < 2; i++) made.push(() => i); { let made = 1 } return "n" + made.map(it => it()).join("")`]:
        "n01",
      [`const { a, b: [c, ...d] = [2, 3, 4], ...e } = { a: 1, f: 5 }; return \`n\${a}\${c}\${d.length}\${e.f}\${e.g?.h ?? 2 ** 3}\``]:
        "n12258",
      [`const join = (first = "n", ...rest) => first + rest.join(""); return join(undefined, ...new Set([1, 1, 2]), new Map([["k", 3]]).get("k"))`]:
        "n123",
      [`function f() { f() } try { f() } catch (e) {} finally { return "caught" }`]: null,
      [`var s = "a"; while (true) s += s`]: null,
      [`var s = "a".repeat(1 << 22); for (;;) ({ [s]: 1 })`]: null,
      [`var s = "a".repeat(1 << 22); for (;;) new Set().add(s)`]: null,
      [`var s = "a".repeat(1 << 22); "".concat(...Array(5000).map(() => s))`]: null,
      [`"a".repeat(1 << 22).replace("a", "$'".repeat(1 << 20))`]: null,
      [`new RegExp("(?=(.*))".repeat(5000)).exec("a".repeat(1 << 16))`]: null,
      [`new RegExp("\\\\p{RGI_Emoji}".repeat(5000), "v")`]: null,
      [`var keys = [], o = { ["a".repeat(1 << 22)]: 1 }; for (;;) keys.push(Object.keys(o))`]: null,
      [`var s = "1".repeat(1 << 22); Math.max(...Array(100000).map(() => s))`]: null,
      [`return "a".concat(null, undefined, 1) + [NaN].includes(NaN)`]: "anullundefined1true",
      [`return (`]: null,
    };
    expect(
      await run(
        `for (const script of ${JSON.stringify(Object.keys(scripts))}) {
           const source = "function find(url, host) {" + script + "} function FindProxyForURL(u, h) { return 'PROXY ' + find(u, h) + ':1' }";
           await session.defaultSession.setProxy({ pacScript: "data:;base64," + btoa(source) });
           print(await session.defaultSession.resolveProxy("https://a.test/secret?1").catch(() => null));
         }`,
      ),
    ).toEqual(Object.values(scripts).map(host => host && `PROXY ${host}:1`));
  });

  test("certificates", async () => {
    expect(
      await run(
        `let connections = 0;
         const server = Bun.serve({ port: 0, tls: ${JSON.stringify(tls)}, fetch: () => new Response("ok") });
         const url = "https://localhost:" + server.port;
         const ses = session.defaultSession;
         ses.setCertificateVerifyProc((request, callback) => (connections++, callback(-3)));
         print([await (await ses.fetch(url)).text(), await (await ses.fetch(url)).text(), connections]);
         ses.setCertificateVerifyProc((request, callback) => {
           print([request.hostname, request.validatedCertificate.data.slice(0, 27), request.isIssuedByKnownRoot]);
           callback(-2);
         });
         print(await ses.fetch(url).catch(error => error.message));
         server.stop(true);`,
        { "authority.pem": tls.cert },
        [],
        isLinux ? { SSL_CERT_FILE: "authority.pem" } : { NODE_EXTRA_CA_CERTS: "authority.pem" },
      ),
    ).toEqual([["ok", "ok", 1], ["localhost", "-----BEGIN CERTIFICATE-----", false], "net::ERR_FAILED"]);
  });

  test("a class that is made while an export of node:stream is replaced", async () => {
    expect(
      await run(
        `const stream = require("stream");
         const { Writable } = stream;
         const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
         stream.Writable = 1;
         try { net.request(server.url.href); } catch (error) { print(error.name); }
         stream.Writable = Writable;
         const request = net.request(server.url.href);
         const [response] = await once(request.end(), "response");
         print([request instanceof Writable, String(await response.toArray())]);
         server.stop(true);`,
      ),
    ).toEqual(["TypeError", [true, "ok"]]);
  });

  test.skipIf(isWindows)("a closed stdin is /dev/null before the main thread opens a file", async () => {
    const main = `console.log(fs.fstatSync(0).rdev === fs.statSync("/dev/null").rdev)`;
    const env = { ...bunEnv, BUN_DESKTOP_THREADS: "main" };
    const runs = Array.from({ length: 4 }, () =>
      $`sh -c ${'exec "$0" -e "$1" <&-'} ${bunExe()} ${main}`.env(env).text(),
    );
    expect(await Promise.all(runs)).toEqual(Array(4).fill("true\n"));
  });

  test("HTTP/2 waits for the verdict on the certificate", async () => {
    expect(
      await run(
        `let requests = 0, connections = 0;
         const server = require("http2").createSecureServer(${JSON.stringify(tls)}, (request, response) => (requests++, response.end(request.httpVersion)));
         server.on("secureConnection", socket => (connections++, socket.unref())).unref();
         await once(server.listen(0), "listening");
         const burst = ses => Promise.all(Array.from({ length: 8 }, () => ses.fetch("https://localhost:" + server.address().port).then(it => it.text(), error => error.message)));
         const refusing = session.fromPartition("refusing");
         refusing.setCertificateVerifyProc((_, callback) => setImmediate(callback, -2));
         print([[...new Set(await burst(refusing))], requests]);
         connections = 0;
         const requestsAtCheck = [];
         session.defaultSession.setCertificateVerifyProc((_, callback) => setImmediate(() => (requestsAtCheck.push(requests), callback(-3))));
         print([[...new Set([...(await burst(session.defaultSession)), ...(await burst(session.defaultSession))])], requestsAtCheck, requests, connections]);`,
        { "authority.pem": tls.cert },
        [],
        { NODE_EXTRA_CA_CERTS: "authority.pem" },
      ),
    ).toEqual([
      [["net::ERR_FAILED"], 0],
      [["2.0"], [0], 16, 1],
    ]);
  });

  test("a connection with HTTP/2 whose certificate only the app accepts is used again", async () => {
    expect(
      await run(
        `let connections = 0;
         const server = require("http2").createSecureServer(${JSON.stringify(tls)}, (request, response) => response.end(request.httpVersion));
         server.on("secureConnection", socket => (connections++, socket.unref())).unref();
         await once(server.listen(0), "listening");
         const get = ses => ses.fetch("https://localhost:" + server.address().port).then(it => it.text(), error => error.message);
         const ses = session.defaultSession;
         ses.setCertificateVerifyProc((_, callback) => callback(0));
         print([await get(ses), await get(ses), await get(ses), connections]);
         print(await get(session.fromPartition("other")));
         ses.setCertificateVerifyProc(null);
         print(await get(ses));`,
      ),
    ).toEqual([["2.0", "2.0", "2.0", 1], "net::ERR_CERT_AUTHORITY_INVALID", "net::ERR_CERT_AUTHORITY_INVALID"]);
  });

  test("a stream of HTTP/2 whose body has come is not reset", async () => {
    expect(
      await run(
        `const codes = [];
         const server = require("http2").createSecureServer(${JSON.stringify(tls)});
         server.on("stream", (stream, { ":path": path }) => {
           if (path === "/end") return codes.shift()(), stream.respond({}, { endStream: true });
           stream.respond({ "content-length": path.length - 1 });
           stream.write(path.slice(1));
           codes.push(() => stream.end());
           stream.on("close", () => print(stream.rstCode));
         });
         server.on("secureConnection", socket => socket.unref()).unref();
         await once(server.listen(0), "listening");
         session.defaultSession.setCertificateVerifyProc((_, callback) => callback(0));
         for (const path of ["/", "/text"]) {
           const response = await net.fetch("https://localhost:" + server.address().port + path);
           await net.fetch("https://localhost:" + server.address().port + "/end");
           await response.text();
         }`,
      ),
    ).toEqual([0, 0]);
  });

  test("a stream of HTTP/2 that the server resets without an error has ended", async () => {
    expect(
      await run(
        `let reset;
         const server = require("http2").createSecureServer(${JSON.stringify(tls)});
         server.on("stream", (stream, { ":path": path }) => {
           if (path === "/reset") return reset(), stream.respond({}, { endStream: true });
           if (path === "/none") return stream.close();
           stream.respond({ "content-length": path.slice(1) }, { waitForTrailers: true });
           stream.on("wantTrailers", () => {}).end("text");
           reset = () => stream.close();
         });
         server.on("secureConnection", socket => socket.unref()).unref();
         await once(server.listen(0), "listening");
         session.defaultSession.setCertificateVerifyProc((_, callback) => callback(0));
         const get = path => net.fetch("https://localhost:" + server.address().port + path);
         for (const path of ["/4", "/5"]) {
           const response = await get(path);
           await get("/reset");
           print(await response.text().catch(it => it.message));
         }
         print(await get("/none").catch(it => it.message));`,
      ),
    ).toEqual(["text", "net::ERR_CONTENT_LENGTH_MISMATCH", "net::ERR_HTTP2_PROTOCOL_ERROR"]);
  });

  test.each(
    ["http", "http2"].flatMap(module => [
      [module, "identity", "body"],
      [module, "gzip", "zlib.gzipSync(body, { level: 1 })"],
      [module, "br", "zlib.brotliCompressSync(body, { params: { 1: 1 } })"],
      [module, "zstd", "zlib.zstdCompressSync(body)"],
    ]),
  )("a long body is the same however it is sent and read, with %s and %s", async (module, encoding, packed) => {
    const digest = "d7c915682dfd3b334e8009644d0f31e03e061370";
    expect(
      await run(
        `const zlib = require("zlib");
         const body = Buffer.from(Uint32Array.from({ length: 1_100_001 }, (_, i) => i * 2654435761 & 0x0f0f0f0f).buffer);
         const packed = { ${encoding}: ${packed} };
         let resume;
         const handle = async (request, response) => {
           const [, encoding, framing] = request.url.split("/");
           if (encoding === "resume") return resume(), response.end();
           const bytes = packed[encoding];
           if (!bytes) return response.writeHead(200, { "content-type": "text/html" }), response.end();
           response.setHeader("content-encoding", encoding);
           response.setHeader("cache-control", "max-age=60");
           if (framing !== "chunked") response.setHeader("content-length", bytes.length);
           response.write(bytes.subarray(0, 70_000));
           await new Promise(resolve => (resume = resolve));
           response.write(bytes.subarray(70_000, -100));
           if (framing === "short") response.write("", () => response.destroy());
           else response.end(bytes.subarray(-100));
         };
         const server = ${module === "http" ? `require("http").createServer(handle)` : `require("http2").createSecureServer(${JSON.stringify(tls)}, handle)`};
         server.on("connection", socket => socket.unref()).unref();
         await once(server.listen(0), "listening");
         const origin = "${module === "http" ? "http" : "https"}://localhost:" + server.address().port;
         session.defaultSession.setCertificateVerifyProc((_, callback) => callback(0));
         app.trustOrigins([origin]);
         print(await (await open(origin)).executeJavaScript(\`(async () => {
           const resume = () => fetch("/resume");
           const request = (url, responseType) => new Promise((resolve, reject) => {
             const it = Object.assign(new XMLHttpRequest(), { responseType, onload: () => resolve(it.response), onerror: reject });
             it.addEventListener("progress", resume, { once: true });
             it.open("GET", url);
             it.send();
           });
           const readers = {
             early: url => fetch(url).then(it => Promise.all([it.arrayBuffer(), resume()])).then(it => it[0]),
             late: url => fetch(url).then(it => resume().then(() => it.arrayBuffer())),
             parts: url => fetch(url).then(it => resume().then(() => Array.fromAsync(it.body))).then(it => new Blob(it).arrayBuffer()),
             buffer: url => request(url, "arraybuffer"),
             blob: url => request(url, "blob").then(it => it.arrayBuffer()),
           };
           const digest = it => crypto.subtle.digest("SHA-1", it).then(it => new Uint8Array(it).toHex());
           const found = {};
           const note = (framing, result) => (found[framing] ??= new Set()).add(result);
           for (const framing of ["length", "chunked", "short"]) for (const name in readers) {
             const url = "/" + ["${encoding}", framing, name].join("/");
             note(framing, await readers[name](url).then(digest, () => "failed"));
             note(framing, await fetch(url, { cache: "only-if-cached", mode: "same-origin" }).then(it => it.arrayBuffer()).then(digest, () => "failed"));
           }
           return Object.values(found).map(it => [...it]);
         })()\`));
         print(new Bun.CryptoHasher("sha1").update(body).digest("hex"));`,
      ),
    ).toEqual([[[digest], [digest], ["failed"]], digest]);
  });

  test("a request for a buffer tells of its progress while the body is under way", async () => {
    expect(
      await run(
        `let write;
         const { url } = Bun.serve({ port: 0, fetch: ({ url }) =>
           url.endsWith("/more") ? (write(), new Response()) :
           url.endsWith("/body") ? new Response(new ReadableStream({ start(it) { let left = 4; (write = () => (left-- ? it.enqueue(new Uint8Array(1000)) : it.close()))(); } })) :
           new Response("", { headers: { "content-type": "text/html" } }) });
         app.trustOrigins([url.origin]);
         print(await (await open(url.href)).executeJavaScript(\`new Promise(resolve => {
           const loaded = [];
           const request = Object.assign(new XMLHttpRequest(), { responseType: "arraybuffer" });
           request.onprogress = event => (loaded.push(event.loaded), fetch("/more"));
           request.onload = () => resolve([loaded, request.response.byteLength, request.response === request.response]);
           request.open("GET", "/body");
           request.send();
         })\`));`,
      ),
    ).toEqual([[[1000, 2000, 3000, 4000], 4000, true]]);
  });

  test.each([false, true])("messages to a WebSocket arrive in order (compression: %p)", async perMessageDeflate => {
    expect(
      await run(
        `const got = [];
         const closed = Promise.withResolvers();
         const { url } = Bun.serve({
           port: 0,
           fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("", { headers: { "content-type": "text/html" } })),
           websocket: { perMessageDeflate: ${perMessageDeflate}, message: (_, it) => got.push(typeof it === "string" ? it.slice(0, 5) : [it.length, it[0], it.at(-1)]), close: (_, code) => closed.resolve(code) },
         });
         app.trustOrigins([url.origin]);
         print(await (await open(url.href)).executeJavaScript(\`new Promise(resolve => {
           const socket = new WebSocket(location.href);
           socket.onopen = () => {
             const bytes = new Uint8Array(300_000);
             for (let i = 0; i < 3000; i++) socket.send(String(i).padEnd(100));
             for (const it of ["", new Blob([bytes.fill(1)]), "é"]) socket.send(it);
             socket.send(bytes.fill(2));
             socket.send(bytes.fill(3).subarray(0, 126));
             socket.send("long".padEnd(70_000));
             socket.send(bytes.fill(4).buffer);
             bytes.fill(0);
             const buffered = socket.bufferedAmount;
             socket.onclose = () => resolve([buffered, socket.bufferedAmount]);
             socket.close(1000);
           };
         })\`));
         print([await closed.promise, got.slice(0, 3000).every((it, i) => Number(it) === i), got.slice(3000)]);`,
      ),
    ).toEqual([
      [1_270_128, 0],
      [1000, true, ["", [300_000, 1, 1], "é", [300_000, 2, 2], [126, 3, 3], "long ", [300_000, 4, 4]]],
    ]);
  });

  test("an expired authority does not hide the chain that is valid", async () => {
    const fixture = (file: string) =>
      readFileSync(join(import.meta.dir, "../../node/tls/fixtures/expired-intermediate", file), "utf8");
    expect(
      await run(
        `const server = Bun.serve({
           port: 0,
           tls: ${JSON.stringify({ key: fixture("leaf.key"), cert: fixture("leaf.pem") + fixture("int-valid.pem") })},
           fetch: () => new Response("ok"),
         });
         // After this one, those of the system are asked too.
         const unknown = Bun.serve({ port: 0, tls: ${JSON.stringify(tls)}, fetch: () => new Response("ok") });
         print(await net.fetch("https://localhost:" + unknown.port).catch(error => error.message));
         unknown.stop(true);
         session.defaultSession.setCertificateVerifyProc((request, callback) => {
           let length = 0;
           for (let it = request.validatedCertificate; it; it = it.issuerCert) length++;
           print([request.verificationResult, length]);
           callback(-3);
         });
         print(await (await net.fetch("https://localhost:" + server.port)).text());
         server.stop(true);`,
        { "authorities.pem": fixture("int-expired.pem") + fixture("root.pem") },
        [],
        { NODE_EXTRA_CA_CERTS: "authorities.pem" },
      ),
    ).toEqual(["net::ERR_CERT_AUTHORITY_INVALID", ["net::OK", 3], "ok"]);
  });

  test("a certificate that the server leaves out is fetched, and not trusted for that", async () => {
    // Root > Middle > localhost, which says that its issuer is at http://issuers.invalid/a
    const files = {
      "root.pem": `-----BEGIN CERTIFICATE-----
MIIBhTCCASugAwIBAgIUET3F64XtzhmaAmyrQGk2/vBrxoIwCgYIKoZIzj0EAwIw
DzENMAsGA1UEAwwEUm9vdDAgFw0yNjExMTcwOTI2NDlaGA8yMTI2MTAyNDA5MjY0
OVowDzENMAsGA1UEAwwEUm9vdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABC3O
jLajyFfrMIaMIdvjAz3RzX4msv7w0VWGoMEGvC9jNE7oFvjBnYyrmdv5TA0Zywfw
ARbxaqLAz66qLkFufmGjYzBhMB0GA1UdDgQWBBTWyqeWx+LwsEnBeV+PosOnzqoK
2zAfBgNVHSMEGDAWgBTWyqeWx+LwsEnBeV+PosOnzqoK2zAPBgNVHRMBAf8EBTAD
AQH/MA4GA1UdDwEB/wQEAwICBDAKBggqhkjOPQQDAgNIADBFAiEA5DAFneJanTbi
4uy8R7dGW4bXrhhamoYwNAPE6quQPBICIAzSDtFrqeAHOv3exvbzk6s2QMTj5WW5
VCbgk8cjAWx2
-----END CERTIFICATE-----`,
      "middle.pem": `-----BEGIN CERTIFICATE-----
MIIBdDCCARqgAwIBAgIBAjAKBggqhkjOPQQDAjAPMQ0wCwYDVQQDDARSb290MCAX
DTI2MTExNzA5MjY0OVoYDzIxMjYxMDI0MDkyNjQ5WjARMQ8wDQYDVQQDDAZNaWRk
bGUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAROdQ0zjRI0joKy2ObSPGg0/JP0
5CqNesDx+AYyvTYuFJkYgGVc23/ZXfiYDzHtQmzr3UgtJN2Y89rGtKUpLTgro2Mw
YTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwICBDAdBgNVHQ4EFgQUjGLE
kQ18haQdR01o+cobgzyMAdQwHwYDVR0jBBgwFoAU1sqnlsfi8LBJwXlfj6LDp86q
CtswCgYIKoZIzj0EAwIDSAAwRQIhAJDuDjF6Hu2VmYwSfRKxdw6RlR6xc0K1CNUo
d4siiV36AiBHtxarSngaN1ZQCj9uK/QihWcYHX7T38KjJ7+t6W9V6g==
-----END CERTIFICATE-----`,
      "cert.pem": `-----BEGIN CERTIFICATE-----
MIICcTCCAhegAwIBAgIBBDAKBggqhkjOPQQDAjARMQ8wDQYDVQQDDAZNaWRkbGUw
IBcNMjYxMTE3MDk1NDExWhgPMjEyNjEwMjQwOTU0MTFaMBQxEjAQBgNVBAMMCWxv
Y2FsaG9zdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAOVjOiyBGBcc
vq8yHVXQREWGy+Vmu1GiNLDq1p+vdJAGmFTv3f+saJhmUv+Un0ciUuTH0kxu5OM2
blTZ5HAeJNAh5YPhoIgRLA+WR1pVi0L4g6Pnlsk3zE1ruHkbInAXs+c960CwrITw
MwGfWAoyFoiKzscc5S2Tj8rdjil5Tjh3TjPTI+3om1jlJu+LUTukZfpP/Zz2wex0
gN4Ny1ad7CldezzOQCVrQo1ZB+kOelLnfDEB9K1MDiVKsD11rELuFmilCUvEUhsm
T7QEtsSxe2snnhPmKC4eT7YwNUDLgw6o/1dspXt4YeTveXr4JLCYfIcHGHgKHFFB
5PkE/QxROfUCAwEAAaOBjzCBjDAUBgNVHREEDTALgglsb2NhbGhvc3QwNAYIKwYB
BQUHAQEEKDAmMCQGCCsGAQUFBzAChhhodHRwOi8vaXNzdWVycy5pbnZhbGlkL2Ew
HQYDVR0OBBYEFMO5xJ4eLjnWVWVGqUM3QFGlWgJ9MB8GA1UdIwQYMBaAFIxixJEN
fIWkHUdNaPnKG4M8jAHUMAoGCCqGSM49BAMCA0gAMEUCIQCzd3t8IyBpaCs4sFZh
Wl86bTnDSjK/0uldmu6mDf4luAIga6yEvRPP4Pu3/VFxkGPjnsRbs/ArCjem4NdZ
7gZ/zCY=
-----END CERTIFICATE-----`,
      "key.pem": tls.key,
      "other.pem": tls.cert,
    };
    const trusting = (file: string) =>
      run(
        `const file = name => Bun.file(path.join(__dirname, name));
         const server = Bun.serve({ port: 0, tls: { cert: file("cert.pem"), key: file("key.pem") }, fetch: () => new Response("ok") });
         const asked = [];
         const proxy = Bun.serve({ port: 0, fetch: request => (asked.push(request.url), new Response(file("middle.pem"))) });
         const ses = session.defaultSession;
         await ses.setProxy({ proxyRules: "http=127.0.0.1:" + proxy.port });
         const get = host => ses.fetch("https://" + host + ":" + server.port).then(it => it.text(), error => error.message);
         print([await get("localhost"), await get("127.0.0.1"), asked]);
         server.stop(true);
         proxy.stop(true);`,
        files,
        [],
        isLinux ? { SSL_CERT_FILE: file } : { NODE_EXTRA_CA_CERTS: file },
      );
    const invalid = "net::ERR_CERT_AUTHORITY_INVALID";
    expect(await Promise.all([trusting("root.pem"), trusting("other.pem")])).toEqual([
      [["ok", invalid, ["http://issuers.invalid/a"]]],
      [[invalid, invalid, ["http://issuers.invalid/a"]]],
    ]);
  });

  /** A server that answers each request of a connection with `answer(line, headers, state)`. */
  const rawServer = `
    const raw = (answer, options) => new Promise(resolve => {
      const connected = socket => {
        const state = { socket };
        let received = "";
        socket.on("error", () => {}).on("data", function read(data) {
          received += data.toString("latin1");
          for (let end; (end = received.indexOf("\\r\\n\\r\\n")) >= 0; received = received.slice(end + 4)) {
            const [line, ...fields] = received.slice(0, end).split("\\r\\n");
            const headers = Object.fromEntries(fields.map(it => [it.slice(0, it.indexOf(":")).toLowerCase(), it.slice(it.indexOf(":") + 2)]));
            const [status, more, body] = answer(line, headers, state);
            socket.write("HTTP/1.1 " + status + "\\r\\n" + more + (body === undefined ? "" : "Content-Length: " + body.length + "\\r\\n") + "\\r\\n" + (body ?? ""));
            if (state.tunnel) socket.off("data", read).pipe(state.tunnel).pipe(socket);
          }
        });
      };
      const server = options ? require("tls").createServer(options, connected) : require("net").createServer(connected);
      server.unref().listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    const text = (ses, url, init) => ses.fetch(url, init).then(async it => it.status + " " + (await it.text()), error => error.message);
    const { createHash, createHmac } = require("crypto");
    const md5 = it => createHash("md5").update(it).digest("hex");
    /** The password is "secret". */
    const ntlm = (value = "", state, name, status) => {
      const message = Buffer.from(value.slice(5), "base64");
      if (state.user) return;
      if (message[8] === 1) {
        state.negotiate = message;
        state.challenge = Buffer.from("4e544c4d5353500002000000000000003000000005828900" + "0123456789abcdef" + "0000000000000000" + "1000100030000000" + "070008000090d336b734c301" + "00000000", "hex");
        return [status, name + ": NTLM " + state.challenge.toString("base64") + "\\r\\n", "again"];
      }
      if (message[8] === 3 && state.challenge) {
        const field = at => message.subarray(message.readUInt32LE(at + 4), message.readUInt32LE(at + 4) + message.readUInt16LE(at));
        const hmac = (key, ...parts) => createHmac("md5", key).update(Buffer.concat(parts)).digest();
        const [response, domain, user] = [field(20), field(28), field(36).toString("utf16le")];
        const key = hmac(createHash("md4").update(Buffer.from("secret", "utf16le")).digest(), Buffer.from(user.toUpperCase(), "utf16le"), domain);
        const proof = hmac(key, state.challenge.subarray(24, 32), response.subarray(16));
        const code = Buffer.from(message.subarray(72, 88));
        message.fill(0, 72, 88);
        if (proof.equals(response.subarray(0, 16)) && code.equals(hmac(hmac(key, proof), state.negotiate, state.challenge, message))) {
          return void (state.user = domain.toString("utf16le") + "/" + user);
        }
      }
      return [status, name + ": Negotiate\\r\\n" + name + ": NTLM\\r\\n", "who?"];
    };`;

  test("logins", async () => {
    expect(
      await run(
        `${rawServer}
         const port = await raw((line, { authorization = "" }, state) => {
           const path = line.split(" ")[1];
           if (path.startsWith("/basic/")) {
             return authorization === "Basic " + btoa("ann:secret") ? ["200 OK", "", "basic"] : ["401 No", 'WWW-Authenticate: Basic realm="a, b"\\r\\n', "who?"];
           }
           if (path.startsWith("/ntlm")) return ntlm(authorization, state, "WWW-Authenticate", "401 No") ?? ["200 OK", "", state.user];
           if (path === "/") return ["200 OK", "Content-Type: text/html\\r\\n", authorization];
           const given = Object.fromEntries([...authorization.matchAll(/(\\w+)="?([^",]*)/g)].map(it => it.slice(1)));
           const expected = md5([md5("ann:r:secret"), given.nonce, given.nc, given.cnonce, "auth", md5("GET:" + path)].join(":"));
           if (given.response === expected && given.nonce === "new") return ["200 OK", "", "digest " + given.nc + given.opaque];
           const nonce = given.response === expected ? '"new", stale=true' : '"old"';
           return ["401 No", 'WWW-Authenticate: Basic realm="r", Digest realm="r", qop="auth", opaque="o", nonce=' + nonce + "\\r\\n", "who?"];
         });
         const origin = "http://127.0.0.1:" + port;
         app.trustOrigins([origin]);
         const page = await open(origin);
         const get = (path, init) => page.executeJavaScript(\`fetch("\${path}", \${JSON.stringify(init)}).then(async it => it.status + " " + await it.text())\`);
         print(await get("/basic/1"));
         const passwords = ["wrong", "secret", "secret", "wrong", "secret"];
         app.on("login", (event, contents, details, info, callback) => {
           print([contents === page, details.firstAuthAttempt, info.scheme, info.realm, info.isProxy, info.port === port]);
           event.preventDefault();
           setImmediate(callback, info.scheme === "ntlm" ? "HOME\\\\ann" : "ann", passwords.shift());
         });
         print([await get("/basic/1"), await get("/basic/2"), await get("/"), await get("/basic/3", { credentials: "omit" })]);
         print([await get("/digest/1?a"), await get("/digest/2")]);
         print([await get("/ntlm"), await get("/ntlm"), ...(await Promise.all([get("/ntlm"), get("/ntlm")]))]);
         await session.defaultSession.clearAuthCache();
         const request = net.request(origin + "/basic/1").on("login", (info, callback) => callback("ann", "secret"));
         request.end();
         print([(await once(request, "response"))[0].statusCode, await text(session.fromPartition("other"), origin + "/basic/1")]);`,
      ),
    ).toEqual([
      "401 who?",
      [true, true, "basic", "a, b", false, true],
      [true, false, "basic", "a, b", false, true],
      ["200 basic", "200 basic", "200 ", "401 who?"],
      [true, true, "digest", "r", false, true],
      ["200 digest 00000001o", "200 digest 00000002o"],
      [true, true, "ntlm", "", false, true],
      [true, false, "ntlm", "", false, true],
      Array(4).fill("200 HOME/ann"),
      [200, "401 who?"],
    ]);
  });

  test("a user name with a line break is not sent", async () => {
    expect(
      await run(
        `${rawServer}
         const port = await raw((line, { authorization }) => {
           print(authorization ?? null);
           return ["401 No", 'WWW-Authenticate: Digest realm="r", nonce="n"\\r\\n', "who?"];
         });
         const request = net.request("http://127.0.0.1:" + port).on("login", (info, callback) => callback("a\\r\\nb", "c"));
         request.end();
         print((await once(request, "response"))[0].statusCode);`,
      ),
    ).toEqual([null, 401]);
  });

  test.skipIf(!isLinux || !Bun.which("cc"))(
    "the identity of the user is only for the servers that are listed",
    async () => {
      using library = tempDir("gssapi", {
        "gssapi.c": `
        struct buffer { unsigned long length; const char* value; };
        unsigned gss_import_name(unsigned* status, struct buffer* name, void* type, void** result) { *result = "name"; return 0; }
        unsigned gss_init_sec_context(unsigned* status, void* a, void** context, void* name, void* mechanism, unsigned flags, unsigned time,
                                      void* bindings, void* input, void* b, struct buffer* output, void* c, void* d) {
          *output = (struct buffer) { 6, flags & 1 ? "acting" : "ticket" };
          return 0;
        }
        unsigned gss_release_name(void) { return 0; }
        unsigned gss_release_buffer(void) { return 0; }
        unsigned gss_delete_sec_context(void) { return 0; }`,
      });
      await $`cc -shared -fPIC -nostdlib -o libgssapi_krb5.so.2 gssapi.c`.cwd(String(library));
      expect(
        await run(
          `${rawServer}
         const port = await raw((line, { authorization }) =>
           authorization ? ["200 OK", "", atob(authorization.slice(10))] : ["401 No", "WWW-Authenticate: Negotiate\\r\\nWWW-Authenticate: NTLM\\r\\n", "who?"]);
         const all = ses => Promise.all(["a.test", "b.a.test", "a.test.b.test", "c.test", "intranet"].map(host => text(ses, "http://" + host + ":" + port)));
         print(await all(session.defaultSession));
         const ses = session.fromPartition("other");
         ses.allowNTLMCredentialsForDomains("c.test");
         print(await all(ses));
         ses.allowNTLMCredentialsForDomains("");
         await ses.clearAuthCache();
         print(await all(ses));`,
          {},
          [
            "--host-resolver-rules=MAP * 127.0.0.1",
            "--auth-server-whitelist=*a.test",
            "--auth-negotiate-delegate-whitelist=b.a.test,a.test.b.test",
          ],
          { LD_LIBRARY_PATH: String(library) },
        ),
      ).toEqual([
        ["200 ticket", "200 acting", "401 who?", "401 who?", "401 who?"],
        ["401 who?", "401 who?", "401 who?", "200 ticket", "401 who?"],
        Array(5).fill("401 who?"),
      ]);
    },
  );

  test.skipIf(!isLinux)("libraries that the system does not have are named", async () => {
    const names = ["libnss3.so", "libgssapi_krb5.so.2", ...[1, 2, 3, 4].map(it => "libgssapi.so." + it)];
    using home = tempDir("home", { ".pki/nssdb/cert9.db": "", ...Object.fromEntries(names.map(it => [it, ""])) });
    const [printed, stderr] = await runWithErrors(
      `${rawServer}
       const port = await raw(() => ["401 No", "WWW-Authenticate: Negotiate\\r\\n", "who?"], ${JSON.stringify({ ...tls, requestCert: true, rejectUnauthorized: false })});
       print(await text(session.defaultSession, "https://localhost:" + port));`,
      { "authority.pem": tls.cert },
      ["--auth-server-whitelist=localhost"],
      { SSL_CERT_FILE: "authority.pem", HOME: String(home), LD_LIBRARY_PATH: String(home) },
    );
    expect(printed).toEqual(["401 who?"]);
    expect(stderr).toContain("cannot load libnss3.so");
    expect(stderr).toContain("the system has no GSSAPI library");
  });

  test("proxies that want a login, and SOCKS", async () => {
    expect(
      await run(
        `${rawServer}
         const secure = await raw(line => ["200 OK", "", "secure " + line], ${JSON.stringify(tls)});
         const plain = await raw((line, { host }) => ["200 OK", "", host + " " + line]);
         const proxy = check => raw((line, headers, state) => {
           const refusal = check(headers["proxy-authorization"], state);
           if (refusal) return refusal;
           if (!line.startsWith("CONNECT")) return ["200 OK", "", "proxied " + line];
           state.tunnel = require("net").connect(secure, "127.0.0.1");
           return ["200 OK", ""];
         });
         const proxies = {
           basic: await proxy(value => value !== "Basic " + btoa("ann:secret") && ["407 No", 'Proxy-Authenticate: Basic realm="p"\\r\\n', "who?"]),
           ntlm: await proxy((value, state) => ntlm(value, state, "Proxy-Authenticate", "407 No")),
         };
         const get = (ses, url, password) => new Promise(resolve => {
           const request = net.request({ url, session: ses }).on("error", error => resolve(error.message));
           if (password) request.on("login", (info, callback) => (print([info.isProxy, info.scheme]), callback("ann", password)));
           request.on("response", async response => resolve(response.statusCode + " " + (await response.toArray()))).end();
         });
         for (const [name, port] of Object.entries(proxies)) {
           for (const url of ["http://a.test/", "https://localhost/"]) {
             const ses = session.fromPartition(name + url);
             await ses.setProxy({ proxyRules: "127.0.0.1:" + port, proxyBypassRules: "<-loopback>" });
             print([await get(ses, url), await get(ses, url, "secret"), await get(ses, url), await ses.closeAllConnections(), await get(ses, url)]);
           }
         }
         const asked = [];
         const socks = require("net").createServer(socket => {
           socket.on("data", function read(data) {
             if (data.equals(Buffer.of(5, 1, 0))) return socket.write(Buffer.of(5, 0));
             const port = data.readUInt16BE(data[0] === 4 ? 2 : data.length - 2);
             asked.push(data[0] === 4 ? data.subarray(4, 8).join(".") : data.toString("latin1", 5, data.length - 2));
             if (port === 1) return socket.end(Buffer.of(5, 5, 0, 1, 0, 0, 0, 0, 0, 0));
             socket.write(data[0] === 4 ? Buffer.of(0, 90, 0, 0, 0, 0, 0, 0) : Buffer.of(5, 0, 0, 3, 1, 97, 0, 0));
             socket.off("data", read).pipe(require("net").connect(port === 443 ? secure : plain, "127.0.0.1")).pipe(socket);
           });
         }).unref();
         await once(socks.listen(0, "127.0.0.1"), "listening");
         const ses = session.fromPartition("socks");
         await ses.setProxy({ proxyRules: "socks5://127.0.0.1:" + socks.address().port, proxyBypassRules: "<-loopback>" });
         for (const url of ["http://a.test/1", "http://b.test/2", "http://a.test/3", "https://localhost/4", "https://c.test/5"]) print(await text(ses, url));
         await ses.setProxy({ proxyRules: "socks4://127.0.0.1:" + socks.address().port, proxyBypassRules: "<-loopback>" });
         print([await text(ses, "http://127.0.0.2/6"), asked]);
         print(await text(session.defaultSession, "http://127.0.0.1:" + proxies.basic));`,
        { "authority.pem": tls.cert },
        [],
        isLinux ? { SSL_CERT_FILE: "authority.pem" } : { NODE_EXTRA_CA_CERTS: "authority.pem" },
      ),
    ).toEqual([
      ...["basic", "ntlm"].flatMap(scheme => [
        [true, scheme],
        ["407 who?", ...[1, 1, 0, 1].map(it => (it ? "200 proxied GET http://a.test/ HTTP/1.1" : null))],
        [true, scheme],
        ["net::ERR_TUNNEL_CONNECTION_FAILED", ...[1, 1, 0, 1].map(it => (it ? "200 secure GET / HTTP/1.1" : null))],
      ]),
      "200 a.test GET /1 HTTP/1.1",
      "200 b.test GET /2 HTTP/1.1",
      "200 a.test GET /3 HTTP/1.1",
      "200 secure GET /4 HTTP/1.1",
      "net::ERR_CERT_COMMON_NAME_INVALID",
      ["200 127.0.0.2 GET /6 HTTP/1.1", ["a.test", "b.test", "localhost", "c.test", "127.0.0.2"]],
      "net::ERR_UNEXPECTED_PROXY_AUTH",
    ]);
  });

  test("the app has the last word about a certificate that is not valid", async () => {
    expect(
      await run(
        `${rawServer}
         const origin = "https://localhost:" + (await raw(() => ["200 OK", "Access-Control-Allow-Origin: *\\r\\n", "ok"], ${JSON.stringify(tls)}));
         serve({ "/": "" });
         const page = await open();
         const get = () => page.executeJavaScript(\`fetch("\${origin}").then(it => it.text(), error => error.name)\`);
         print(await get());
         for (const isTrusted of [false, true]) {
           app.once("certificate-error", (event, contents, url, error, certificate, callback, isMainFrame) => {
             print([contents === page, url === origin + "/", error, certificate.data.slice(0, 27), isMainFrame]);
             event.preventDefault();
             setImmediate(callback, isTrusted);
           });
           print(await get());
         }
         print(await text(session.defaultSession, origin, { credentials: "omit" }));
         for (const verdict of [-3, -2, 0]) {
           const ses = session.fromPartition("verdict" + verdict);
           ses.setCertificateVerifyProc((request, callback) => (print([request.verificationResult, request.errorCode]), setImmediate(callback, verdict)));
           print(await text(ses, origin));
         }`,
      ),
    ).toEqual([
      "TypeError",
      ...["TypeError", "ok"].flatMap(it => [
        [true, true, "net::ERR_CERT_AUTHORITY_INVALID", "-----BEGIN CERTIFICATE-----", false],
        it,
      ]),
      "net::ERR_CERT_AUTHORITY_INVALID",
      ...["net::ERR_CERT_AUTHORITY_INVALID", "net::ERR_FAILED", "200 ok"].flatMap(it => [
        ["net::ERR_CERT_AUTHORITY_INVALID", -202],
        it,
      ]),
    ]);
  });

  test.skipIf(!hasNss).each([
    ["agent1", "ca1", "TLSv1.2"],
    ["agent1", "ca1", "TLSv1.3"],
    ["ec10", "ca5", "TLSv1.3"],
  ])("the certificate %s of the user, from %s, with %s", async (name, authority, maxVersion) => {
    const fixture = (file: string) => join(import.meta.dir, "../../node/tls/fixtures", file);
    using home = tempDir("home", {});
    const bundle = join(String(home), "user.p12");
    await $`openssl pkcs12 -export -in ${fixture(name + "-cert.pem")} -inkey ${fixture(name + "-key.pem")} -passout pass:p -out ${bundle}`;
    expect(
      await run(
        `${rawServer}
         const serverFor = ca => raw((line, headers, { socket }) => ["200 OK", "", String(socket.getPeerCertificate().subject?.CN)], {
           ...${JSON.stringify(tls)}, ca: require("fs").readFileSync(ca), requestCert: true, rejectUnauthorized: false, maxVersion: "${maxVersion}",
         }).then(port => "https://localhost:" + port);
         const [origin, other] = [await serverFor(${JSON.stringify(fixture(authority + "-cert.pem"))}), await serverFor("authority.pem")];
         for (const password of ["wrong", "p"]) print(await new Promise(resolve => app.importCertificate({ certificate: ${JSON.stringify(bundle)}, password }, resolve)));
         const ses = session.defaultSession;
         print([await text(ses, origin), await text(ses, origin, { credentials: "omit" }), await text(ses, other)]);
         const proxied = session.fromPartition("proxied");
         const proxy = await raw((line, headers, state) => ((state.tunnel = require("net").connect(new URL(origin).port, "127.0.0.1")), ["200 OK", ""]));
         await proxied.setProxy({ proxyRules: "127.0.0.1:" + proxy, proxyBypassRules: "<-loopback>" });
         print(await text(proxied, origin));
         app.on("select-client-certificate", (event, contents, host, list, callback) => {
           print([host === new URL(origin).host, list.length]);
           event.preventDefault();
           callback();
         });
         print(await text(session.fromPartition("declined"), origin));
         const pinned = session.fromPartition("pinned");
         pinned.setCertificateVerifyProc((request, callback) => callback(-2));
         print(await text(pinned, origin));`,
        { "authority.pem": tls.cert },
        [],
        { SSL_CERT_FILE: "authority.pem", HOME: String(home) },
      ),
    ).toEqual([
      -702,
      0,
      [expect.stringMatching(/^200 agent1/), "200 undefined", "200 undefined"],
      expect.stringMatching(/^200 agent1/),
      [true, 1],
      "200 undefined",
      "net::ERR_FAILED",
    ]);
  });

  test.skipIf(!hasNss || !Bun.which("certutil"))("a certificate that the user never trusts", async () => {
    using home = tempDir("home", { ".pki/nssdb": {}, "cert.pem": tls.cert });
    const database = "sql:" + join(String(home), ".pki/nssdb");
    await $`certutil -N -d ${database} --empty-password`;
    await $`certutil -A -d ${database} -n never -t p,, -a -i ${join(String(home), "cert.pem")}`;
    expect(
      await run(
        `${rawServer}
         const port = await raw(() => ["200 OK", "", "ok"], ${JSON.stringify(tls)});
         const proxied = session.fromPartition("proxied");
         await proxied.setProxy({ proxyRules: "https://localhost:" + port });
         print([await text(session.defaultSession, "https://localhost:" + port), await text(proxied, "http://a.test/")]);
         const asked = session.fromPartition("asked");
         asked.setCertificateVerifyProc((request, callback) => (print(request.verificationResult), callback(0)));
         print(await text(asked, "https://localhost:" + port));`,
        { "authority.pem": tls.cert },
        [],
        { SSL_CERT_FILE: "authority.pem", HOME: String(home) },
      ),
    ).toEqual([
      ["net::ERR_CERT_AUTHORITY_INVALID", "net::ERR_CERT_AUTHORITY_INVALID"],
      "net::ERR_CERT_AUTHORITY_INVALID",
      "200 ok",
    ]);
  });

  test.skipIf(!hasNss || !Bun.which("certutil")).each(["keep-alive", "close"])(
    "a certificate that the user stops trusting, connection: %s",
    async connection => {
      using home = tempDir("home", { ".pki/nssdb": {}, "cert.pem": tls.cert });
      const database = "sql:" + join(String(home), ".pki/nssdb");
      await $`certutil -N -d ${database} --empty-password`;
      const distrust = ["-A", "-d", database, "-n", "never", "-t", "p,,", "-a", "-i", join(String(home), "cert.pem")];
      expect(
        await run(
          `${rawServer}
         const port = await raw((_, __, { socket }) => ["200 OK", "Connection: ${connection}\\r\\n", String(socket.isSessionReused())], ${JSON.stringify(tls)});
         const ask = () => text(session.defaultSession, "https://localhost:" + port);
         print([await ask(), await ask()]);
         require("child_process").execFileSync("certutil", ${JSON.stringify(distrust)});
         print(await ask());`,
          { "authority.pem": tls.cert },
          [],
          { SSL_CERT_FILE: "authority.pem", HOME: String(home) },
        ),
      ).toEqual([["200 false", "200 " + (connection === "close")], "net::ERR_CERT_AUTHORITY_INVALID"]);
    },
  );

  test("style sheets in data: URLs", async () => {
    expect(
      await run(`
        serve({ "/": "<link rel=stylesheet href=\\"data:/,@import url('x/');\\"><link rel=stylesheet href='data:text/plain,p{color:red}'><p>" });
        const page = await open();
        print(await page.executeJavaScript(\`(\${() => {
          const color = () => getComputedStyle(document.querySelector("p")).color;
          const before = color();
          document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "data:text/css,p{color:blue}" }));
          return [document.compatMode, before, color()];
        }})()\`));`),
    ).toEqual([["BackCompat", "rgb(0, 0, 0)", "rgb(0, 0, 255)"]]);
  });

  test("a style sheet in a data: URL that may import another one is waited for", async () => {
    expect(
      await run(`
        serve({ "/": "<!doctype html><p>", "/a.css": "p { color: blue }" });
        const page = await open();
        print(await page.executeJavaScript(\`(\${async () => {
          const all = [];
          for (const rule of ["import", "IMPORT", "%5C69mport", "media"]) {
            const href = "data:text/css,@" + rule + " url(app://trusted/a.css); @media all { b { color: red } }";
            const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href });
            document.head.append(link);
            const atOnce = !!link.sheet;
            await new Promise(resolve => (link.onload = link.onerror = resolve));
            all.push([atOnce, getComputedStyle(document.querySelector("p")).color]);
            link.remove();
          }
          return all;
        }})()\`));`),
    ).toEqual([
      [
        [false, "rgb(0, 0, 255)"],
        [false, "rgb(0, 0, 255)"],
        [false, "rgb(0, 0, 255)"],
        [true, "rgb(0, 0, 0)"],
      ],
    ]);
  });

  test("a large style sheet follows its media and its place while it is compiled", async () => {
    expect(
      await run(`
        serve({
          "/": "<!doctype html><link rel=stylesheet href=/a.css media=print><div><p></div><section><p></section>",
          "/a.css": ".a { color: red }".repeat(1e4) + "@scope { p { color: blue } }",
        });
        const page = await open();
        print(await page.executeJavaScript(\`(\${async () => {
          const colors = () => [...document.querySelectorAll("p")].map(it => getComputedStyle(it).color);
          const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/a.css", media: "print" });
          document.querySelector("div").append(link);
          await new Promise(resolve => (link.onload = resolve));
          link.media = "screen";
          const first = colors();
          document.querySelector("section").moveBefore(link, null);
          const second = colors();
          link.media = "print";
          return [first, second, colors()];
        }})()\`));`),
    ).toEqual([
      [
        ["rgb(0, 0, 255)", "rgb(0, 0, 0)"],
        ["rgb(0, 0, 0)", "rgb(0, 0, 255)"],
        ["rgb(0, 0, 0)", "rgb(0, 0, 0)"],
      ],
    ]);
  });

  test("the late answer to a key is shown before the tasks that follow it", async () => {
    expect(
      await run(`
        serve({ "/": "<!doctype html><p style='width: 1px'>" });
        const page = await open();
        page.focus();
        for (let answer; !answer; ) {
          const answering = page.executeJavaScript(\`(\${() =>
            new Promise(resolve => {
              const p = document.querySelector("p"), order = [];
              const task = steps => {
                const { port1, port2 } = new MessageChannel();
                port1.onmessage = steps;
                port2.postMessage(0);
              };
              const observer = new ResizeObserver(() => order.length && order.push("frame"));
              observer.observe(p);
              onkeydown = () => {
                const start = performance.now();
                task(() => {
                  while (performance.now() - start < 40);
                  p.style.width = p.offsetWidth + 1 + "px";
                  order.push("answer");
                  task(() => {
                    order.push("task");
                    const isInTime = performance.now() - start < 150;
                    requestAnimationFrame(() => setTimeout(() => (observer.disconnect(), resolve(isInTime && order))));
                  });
                });
              };
              requestAnimationFrame(() => setTimeout(() => console.log("ready")));
            })})()\`);
          await once(page, "console-message");
          page.sendInputEvent({ type: "keyDown", keyCode: "F2" });
          page.sendInputEvent({ type: "keyUp", keyCode: "F2" });
          answer = await answering;
          if (answer) print(answer);
        }`),
    ).toEqual([["answer", "frame", "task"]]);
  });

  test.skipIf(!isLinux || !Bun.which("openssl"))("a host that wants nothing but HTTPS is remembered", async () => {
    using made = tempDir("hsts", {});
    await $`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=a.test -addext ${"subjectAltName=DNS:a.test,DNS:*.a.test"} -keyout key -out cert`
      .cwd(String(made))
      .quiet();
    const [key, cert] = await Promise.all(["key", "cert"].map(it => Bun.file(join(String(made), it)).text()));
    expect(
      await run(
        `${rawServer}
         const port = await raw(line => ["200 OK", "Strict-Transport-Security: max-age=" + line.split(/[/ ]/)[2] + "; includeSubDomains\\r\\n", "ok"], ${JSON.stringify({ key, cert })});
         app.commandLine.appendSwitch("host-resolver-rules", "MAP *.test 127.0.0.1");
         const ses = session.defaultSession;
         ses.setCertificateVerifyProc((request, callback) => callback(0));
         const get = url => ses.fetch(url.replace("/?", ":" + port)).then(it => it.url.split(":")[0], () => "failed");
         for (const url of ["http://a.test/?/9", "https://a.test/?/99", "http://a.test/?/99", "http://b.a.test/?/0", "http://test.test/?/0", "https://a.test/?/0", "http://a.test/?/0"]) {
           await ses.closeAllConnections();
           print(await get(url));
         }
         for (const url of ["https://wrong.test/?/99", "https://wrong.test/?/99", "http://wrong.test/?/99"]) print(await get(url));`,
        { "authority.pem": cert },
        [],
        { SSL_CERT_FILE: "authority.pem" },
      ),
    ).toEqual(["failed", "https", "https", "https", "failed", "https", "failed", "https", "https", "failed"]);
  });

  test("responses that only browsers accept", async () => {
    expect(
      await run(
        `for (const response of [
           "HTTP/1.1 200\\nA: 1\\n 2\\nno colon\\nB : \\x01\\nContent-Length: 2, 2\\n\\nbody",
           "\\r\\nhttp/1.1 299 Odd\\r\\nA: 1\\r\\nContent-Length: 1, 1\\r\\nContent-Length: 1\\r\\n\\r\\nbody",
           "HTTP/1.1 200 OK\\r\\nA: 1",
           "HTTP/1.1 200 OK\\r\\nContent-Length: -1\\r\\n\\r\\nbody",
           "HTTP/1.1 200 OK\\r\\nContent-Length: 1, 2\\r\\n\\r\\nbody",
           "HTTP/1.1 200 OK\\r\\nA: \\0\\r\\n\\r\\n",
           "no head at all",
         ]) {
           const server = Bun.listen({ port: 0, hostname: "127.0.0.1", socket: { data: socket => socket.end(response) } });
           print(await net.fetch("http://127.0.0.1:" + server.port).then(async it => [it.status, it.headers.get("a"), await it.text()], error => error.message));
           server.stop();
         }`,
      ),
    ).toEqual([
      [200, "1 2", "bo"],
      [299, "1", "b"],
      [200, "1", ""],
      [200, null, "body"],
      "net::ERR_RESPONSE_HEADERS_MULTIPLE_CONTENT_LENGTH",
      "net::ERR_INVALID_HTTP_RESPONSE",
      "net::ERR_INVALID_HTTP_RESPONSE",
    ]);
  });

  test("a response with too many headers or too long a status", async () => {
    expect(
      await run(
        `for (const response of ["HTTP/1.1 200 OK\\n" + "a:1\\n".repeat(3000) + "\\n", "HTTP/1.1 65736 OK\\r\\n\\r\\n"]) {
           const server = require("net").createServer(socket => socket.on("error", () => {}).once("data", () => socket.end(response)));
           await once(server.listen(0, "127.0.0.1"), "listening");
           print(await net.fetch("http://127.0.0.1:" + server.address().port).then(it => it.status, () => "refused"));
           server.close();
         }`,
      ),
    ).toEqual(["refused", "refused"]);
  });

  test.each([
    ["inflates to", "zstd", `Buffer.concat(Array(40).fill(Bun.zstdCompressSync(spaces)))`, 1],
    ["has", "identity", `spaces`, 40],
  ])("a style sheet that %s too many bytes is given up", async (_, encoding, part, count) => {
    expect(
      await run(
        `const spaces = Buffer.alloc(16 << 20, " "), part = ${part};
         const server = require("net").createServer(socket => socket.on("error", () => {}).once("data", async () => {
           socket.write("HTTP/1.1 200 OK\\ncontent-type: text/css\\ncontent-encoding: ${encoding}\\ncontent-length: " + part.length * ${count} + "\\n\\n");
           for (let i = 0; i < ${count}; i++) await new Promise(resolve => socket.write(part, resolve));
         }));
         await once(server.listen(0, "127.0.0.1"), "listening");
         serve({ "/": "<link rel=stylesheet onload=title=event.type onerror=title=event.type href=http://127.0.0.1:" + server.address().port + ">" });
         print(await (await open()).executeJavaScript("document.querySelector('link').title"));
         server.close();`,
      ),
    ).toEqual(["error"]);
  });

  test("the files of an origin are cleared with those of its frames in other sites", async () => {
    expect(
      await run(
        `app.trustOrigins(["app://trusted", "app://other"], { inFrames: true, injectedScripts: true });
         serve({ "/": "<iframe src=app://other/frame></iframe>", "/frame": "" });
         const [frame] = (await open()).mainFrame.frames;
         const find = create => frame.executeJavaScript("navigator.storage.getDirectory().then(it => it.getFileHandle('a', { create: " + create + " })).then(it => it.name, it => it.name)");
         print(await find(true));
         await session.defaultSession.clearData({ origins: ["app://other"] });
         print(await find(false));`,
      ),
    ).toEqual(["a", "NotFoundError"]);
  });

  test("a page does not log in to another origin with the credentials in the URL of a subresource", async () => {
    expect(
      await run(
        `const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => (print(new URL(request.url).pathname), new Response()) });
         const at = "127.0.0.1:" + server.port;
         serve({ "/": "<img src='http://a:b@" + at + "/image'><link rel=stylesheet href='http://a:b@" + at + "/sheet'><img src='http://" + at + "/plain'>" });
         await open();
         server.stop(true);`,
      ),
    ).toEqual(["/plain"]);
  });

  test("a page cannot set the headers of the browser, however they are written", async () => {
    expect(
      await run(
        `serve({ "/": "", "/echo": request => Response.json(["cookie", "sec-a", "proxy-a", "x-a"].map(it => request.headers.get(it))) });
         const page = await open();
         print(await page.executeJavaScript(\`(async () => {
           const headers = { Cookie: "1", COOKIE: "1", "SEC-a": "1", "Proxy-A": "1", "X-A": "1" };
           const request = new XMLHttpRequest();
           request.open("GET", "/echo", false);
           for (const name in headers) request.setRequestHeader(name, headers[name]);
           request.send();
           return [await (await fetch("/echo", { headers })).json(), JSON.parse(request.response)];
         })()\`));`,
      ),
    ).toEqual([Array(2).fill([null, null, null, "1"])]);
  });

  test("a response that has arrived can still be aborted", async () => {
    expect(
      await run(
        `serve({ "/": "", "/text": "text" });
         const page = await open();
         print(await page.executeJavaScript(\`Promise.all([it => it.text(), it => it.body.getReader().read(), it => it.clone().text()].map(async read => {
           const controller = new AbortController();
           const response = await fetch("/text", { signal: controller.signal });
           await fetch("/text").then(it => it.text());
           controller.abort("reason");
           return read(response).catch(it => it);
         }))\`));`,
      ),
    ).toEqual([["reason", "reason", "reason"]]);
  });

  test("the user agent of a page that is there changes", async () => {
    expect(
      await run(
        `serve({ "/": "", "/agent": request => new Response(request.headers.get("user-agent")) });
         const page = await open();
         page.setUserAgent("another");
         print(await page.executeJavaScript("fetch('/agent').then(it => it.text())"));`,
      ),
    ).toEqual(["another"]);
  });

  test("a frame has to go along with the policy that its embedder requires", async () => {
    expect(
      await run(
        `app.trustOrigins([], { inFrames: true });
         const frame = headers => request =>
           new Response("<title>" + request.headers.get("sec-required-csp") + "</title>", { headers: { "content-type": "text/html", ...headers } });
         serve({
           "/": "",
           "/silent": frame(),
           "/agrees": frame({ "allow-csp-from": "app://trusted" }),
           "/stricter": frame({ "content-security-policy": "img-src 'none'" }),
           "/laxer": frame({ "content-security-policy": "img-src *" }),
         });
         const page = await open();
         print(await page.executeJavaScript(\`Promise.all(["/silent", "/agrees", "/stricter", "/laxer"].map(async src => {
           const frame = Object.assign(document.createElement("iframe"), { src, csp: "img-src 'self'" });
           await new Promise(resolve => document.body.append(Object.assign(frame, { onload: resolve })));
           return frame.contentDocument?.title;
         }))\`));`,
      ),
    ).toEqual([[null, "img-src 'self'", "img-src 'self'", null]]);
  });

  test("a request that is aborted gives up its connection, whether or not something reads", async () => {
    expect(
      await run(
        `const closed = Promise.withResolvers();
         const server = Bun.listen({
           port: 0,
           hostname: "127.0.0.1",
           socket: {
             data: socket => socket.write("HTTP/1.1 200 OK\\r\\naccess-control-allow-origin: *\\r\\n\\r\\nstart"),
             close: () => closed.resolve("closed"),
           },
         });
         serve({ "/": "" });
         const page = await open();
         print(await page.executeJavaScript(\`(async () => {
           const controller = new AbortController();
           window.response = await fetch("http://127.0.0.1:\${server.port}/", { signal: controller.signal });
           const { value } = await response.body.getReader().read();
           controller.abort();
           return value.length;
         })()\`));
         print(await closed.promise);
         server.stop(true);`,
      ),
    ).toEqual([5, "closed"]);
  });

  test("the certificate of a WebSocket of a worker is verified", async () => {
    expect(
      await run(
        `const server = Bun.serve({
           port: 0,
           tls: ${JSON.stringify(tls)},
           fetch: (request, server) => void server.upgrade(request),
           websocket: { message() {} },
         });
         serve({
           "/": "",
           "/worker.js": \`Object.assign(new WebSocket("wss://localhost:\${server.port}/"), {
             onopen: () => postMessage("open"),
             onclose: () => postMessage("close"),
           })\`,
         });
         const page = await open();
         for (const verdict of [-3, -2]) {
           session.defaultSession.setCertificateVerifyProc((request, callback) => (print(request.hostname), callback(verdict)));
           print(await page.executeJavaScript(\`new Promise(resolve => { new Worker("/worker.js").onmessage = event => resolve(event.data); })\`));
         }
         server.stop(true);`,
        { "authority.pem": tls.cert },
        [],
        { NODE_EXTRA_CA_CERTS: "authority.pem" },
      ),
    ).toEqual(["localhost", "open", "localhost", "close"]);
  });

  test("a worker has the geometry interfaces", async () => {
    expect(
      await run(
        `serve({ "/": "", "/worker.js": "postMessage(new DOMPoint(1, 2).matrixTransform(new DOMMatrix().scale(3)).y)" });
         const page = await open();
         print(await page.executeJavaScript(\`new Promise(resolve => {
           Object.assign(new Worker("/worker.js"), { onmessage: it => resolve(it.data), onerror: it => resolve(it.message) });
         })\`));`,
      ),
    ).toEqual([6]);
  });

  test("a sandboxed frame is not told of cookies", async () => {
    expect(
      await run(`
        const listens = '<script>cookieStore.onchange = event => parent.postMessage(origin, "*"); parent.postMessage("ready", "*")</script>';
        const { url } = Bun.serve({ port: 0, fetch: ({ url }) => new Response(url.endsWith("/frame") ? listens : "<body>", { headers: { "content-type": "text/html" } }) });
        app.trustOrigins([url.origin], { inFrames: true });
        print(await (await open(url.href)).executeJavaScript(\`(async () => {
          const heard = [];
          const hear = wanted => new Promise(resolve => (onmessage = ({ data }) => (heard.push(data === origin ? "own" : data), data === wanted && resolve())));
          for (const sandbox of ["allow-scripts", "allow-scripts allow-same-origin"]) {
            document.body.append(Object.assign(document.createElement("iframe"), { sandbox, src: "/frame" }));
            await hear("ready");
          }
          for (const name of ["a", "b"]) {
            document.cookie = name + "=1; SameSite=None; Secure";
            await hear(origin);
          }
          return heard;
        })()\`));`),
    ).toEqual([["ready", "ready", "own", "own"]]);
  });

  test("cookies outlive the process, unless they are for the session", async () => {
    expect(
      await run(
        `const { cookies } = session.defaultSession;
         if (process.argv.includes("again")) return print((await cookies.get({})).map(it => [it.name, it.value, it.domain, it.httpOnly]));
         await cookies.set({ url: "https://a.test/", name: "kept", value: "1", httpOnly: true, expirationDate: Date.now() / 1000 + 60 });
         await cookies.set({ url: "https://a.test/", name: "lost", value: "2" });
         await cookies.flushStore();
         Bun.spawnSync([process.execPath, "--preload=bun:desktop/electron", ".", "again", "--use-mock-keychain"], { stdout: "inherit", stderr: "inherit" });`,
        {},
        ["--use-mock-keychain"],
      ),
    ).toEqual([[["kept", "1", "a.test", true]]]);
  });

  test("cookies that could not be saved are saved the next time", async () => {
    expect(
      await run(
        `const { cookies, storagePath } = session.defaultSession;
         if (process.argv.includes("again")) return print((await cookies.get({})).map(it => it.name));
         const { mkdirSync, rmdirSync } = require("node:fs");
         mkdirSync(storagePath + "/Cookie Jar~", { recursive: true });
         await cookies.set({ url: "https://a.test/", name: "kept", value: "1", expirationDate: Date.now() / 1000 + 60 });
         await cookies.flushStore();
         rmdirSync(storagePath + "/Cookie Jar~");
         await cookies.flushStore();
         Bun.spawnSync([process.execPath, "--preload=bun:desktop/electron", ".", "again", "--use-mock-keychain"], { stdout: "inherit", stderr: "inherit" });`,
        {},
        ["--use-mock-keychain"],
      ),
    ).toEqual([["kept"]]);
  });

  test("overlay scrollbars that appear in a frame do not need another one", async () => {
    expect(
      await run(
        `serve({ "/": "<div id=a style='height:50px;overflow:auto'><p style='height:500px'></div>" });
         const page = await open();
         print(await page.executeJavaScript(\`new Promise(done => {
           const order = [];
           a.onscrollend = () => order.push("scrolled");
           requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
             a.scrollTop = 10;
             setTimeout(() => setTimeout(() => done(order)));
           })));
         })\`));`,
        {},
        [],
        { BUN_DESKTOP_OVERLAY_SCROLLBARS: "1" },
      ),
    ).toEqual([["scrolled"]]);
  });

  test("a page that has little stack left", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "" });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`new Promise(done => {
          const onTheWayUp = act => {
            let left = 0;
            (function deeper() {
              try { deeper(); } catch { left = 200; }
              if (left > 0) try { act(); left--; } catch {}
            })();
          };
          onTheWayUp(() => setTimeout("window.ran = true", 1));
          onTheWayUp(() => screenX + navigator.languages + navigator.onLine);
          onTheWayUp(() => document.body.appendChild(document.createElement("iframe")).remove());
          setTimeout(() => done(window.ran), 2);
        })\`));`),
    ).toEqual([true]);
  });

  test.each(["get", "value", "writable"])("a frame navigates while Object.prototype has %s", async name => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=/first></iframe>", "/first": "", "/second": "" });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`new Promise(done => {
          const frame = document.querySelector("iframe"), { contentWindow } = frame;
          frame.onload = () => (delete Object.prototype.${name}, done([contentWindow.location.pathname, typeof contentWindow.performance]));
          frame.src = "/second";
          Object.prototype.${name} = 1;
        })\`));`),
    ).toEqual([["/second", "object"]]);
  });

  test("a message to another origin is copied on the way, and fails with an error of the sender", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted", "app://other"], { inFrames: true, injectedScripts: true });
        serve({
          "/": "<iframe src=app://other/frame></iframe>",
          "/frame": \`<script>
            let isOwn = true;
            const { Set } = window;
            window.Set = function (list) { return isOwn &&= list instanceof Array, new Set(list); };
            onmessage = ({ data, ports }) => ports[0].postMessage([isOwn, data.port === ports[0], data.bytes.byteLength]);
          </script>\`,
        });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`new Promise(done => {
          const thrown = {}, caught = (...args) => { try { frames[0].postMessage(...args); } catch (error) { return error; } };
          const errors = [caught(() => {}, "*") instanceof DOMException, caught(1, "*", [{}]) instanceof DOMException, caught({ get a() { throw thrown; } }, "*") === thrown];
          const { port1, port2 } = new MessageChannel(), bytes = new ArrayBuffer(3);
          port1.onmessage = ({ data }) => done([errors, data, bytes.byteLength]);
          frames[0].postMessage({ port: port2, bytes }, "*", [port2, bytes]);
        })\`));`),
    ).toEqual([[[true, true, true], [true, true, 3], 0]]);
  });

  test("the next document of a frame calls no function of Object that the first one has replaced", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({ "/": "<body>", "/frame": "" });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`new Promise(done => {
          const frame = Object.assign(document.createElement("iframe"), { src: "/frame" });
          document.body.append(frame);
          let calls = 0;
          frame.contentWindow.Object.assign = () => calls++;
          frame.onload = () => done(calls);
        })\`));`),
    ).toEqual([0]);
  });

  test("a page cannot keep the realm of a frame from being set up", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=/first></iframe>", "/first": "", "/second": "" });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`new Promise(done => {
          const frame = document.querySelector("iframe"), { contentWindow } = frame, { getPrototypeOf } = Object, before = contentWindow.Object;
          frame.src = "/second";
          Object.getPrototypeOf = () => { throw 1; };
          const poll = setInterval(() => {
            if (contentWindow.Object === before) return;
            clearInterval(poll);
            Object.getPrototypeOf = getPrototypeOf;
            done([typeof contentWindow.performance.now(), contentWindow.top === window, contentWindow.location.pathname]);
          });
        })\`));`),
    ).toEqual([["number", true, "/second"]]);
  });

  test("a native function that listens in a frame does not act for the script that removes the frame", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted", "app://other"], { inFrames: true, injectedScripts: true });
        serve({
          "/": "<iframe src=app://other/frame></iframe>",
          "/frame": \`<script>
            addEventListener("pagehide", open.bind(window, "page", "_blank"));
            addEventListener("pagehide", parent.postMessage.bind(parent, "", "*", []));
          </script>\`,
        });
        const page = await open("app://trusted/");
        page.setWindowOpenHandler(({ url }) => (print(url), { action: "deny" }));
        print(await page.executeJavaScript(\`new Promise(done => {
          onmessage = event => done(event.origin);
          document.querySelector("iframe").remove();
        })\`));`),
    ).toEqual(["app://other"]);
  });

  test("looking for a frame by its name calls no method of arrays that the page has replaced", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted", "app://other"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=app://other/frame></iframe>", "/frame": "" });
        const page = await open("app://trusted/");
        page.setWindowOpenHandler(() => ({ action: "deny" }));
        print(await page.executeJavaScript(\`
          let calls = 0;
          const { map } = Array.prototype;
          Array.prototype.map = function () { return calls++, map.apply(this, arguments); };
          open("", "nobody");
          Array.prototype.map = map;
          calls\`));`),
    ).toEqual([0]);
  });

  test("the first use of fonts in a worker calls no built-in function that the worker has replaced", async () => {
    expect(
      await run(`
        serve({
          "/": "",
          "/worker.js": \`
            let calls = 0;
            String.prototype.split = Object.assign = () => (calls++, []);
            new OffscreenCanvas(9, 9).getContext("2d").fillText("a", 0, 0);
            postMessage([calls, self.fonts.size]);\`,
        });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript('new Promise(done => (new Worker("/worker.js").onmessage = event => done(event.data)))'));`),
    ).toEqual([[0, 0]]);
  });

  test("a reload that is redirected leaves the entries of the document before", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted", "app://other"]);
        let requests = 0;
        serve({
          "/": () => (++requests === 2 ? Response.redirect("app://other/other") : new Response("", { headers: { "content-type": "text/html" } })),
          "/other": "",
        });
        const page = await open("app://trusted/");
        await page.executeJavaScript('history.pushState("state", "", "#a")');
        page.reload();
        await once(page, "did-finish-load");
        print(await page.executeJavaScript("[origin, history.state]"));
        page.executeJavaScript("history.back()");
        await Promise.race([once(page, "did-finish-load"), once(page, "did-navigate-in-page")]);
        print([page.getURL(), page.mainFrame.origin]);`),
    ).toEqual([
      ["app://other", null],
      ["app://trusted/", "app://trusted"],
    ]);
  });

  test("frames and popups are made without reading from Object.prototype", async () => {
    expect(
      await run(`
        serve({ "/": "<body>" });
        const page = await open("app://trusted/");
        print(await page.executeJavaScript(\`
          const read = [];
          const names = ["checksSpelling", "container", "fontScope", "global", "isLocalFrame", "messaging", "mirror", "surface"];
          for (const name of names) Object.defineProperty(Object.prototype, name, { get: () => void read.push(name), configurable: true });
          document.body.append(document.createElement("iframe"));
          frames[0].document;
          open().close();
          for (const name of names) delete Object.prototype[name];
          read\`));`),
    ).toEqual([[]]);
  });

  test.each([
    ["allow-scripts", []],
    ["allow-scripts allow-top-navigation-by-user-activation", []],
    ["allow-scripts allow-top-navigation-to-custom-protocols", ["other:a"]],
    ["allow-scripts allow-popups", ["other:a"]],
  ])("a frame in the sandbox %s hands URLs to other programs: %j", async (flags, expected) => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({ "/": '<iframe sandbox="${flags}" src=/frame></iframe>', "/frame": "<script>location = 'other:a'</script>" });
        const asked = [];
        session.defaultSession.setPermissionRequestHandler((_, name, answer, { externalURL }) => (asked.push(externalURL), answer(false)));
        const page = new BrowserWindow().webContents;
        const wished = new Promise(done => page.on("will-frame-navigate", ({ url }) => url === "other:a" && done()));
        await Promise.all([page.loadURL("app://trusted/"), wished]);
        await new Promise(setImmediate);
        print(asked);`),
    ).toEqual([expected]);
  });

  test("a document without a type is text if it says nosniff", async () => {
    expect(
      await run(`
        serve({ "/": () => new Response(Buffer.from("<b>a</b>"), { headers: { "x-content-type-options": "nosniff" } }) });
        print(await (await open()).executeJavaScript("[document.contentType, document.body.textContent]"));`),
    ).toEqual([["text/plain", "<b>a</b>"]]);
  });

  test("input is read without what a page has put on Object.prototype", async () => {
    expect(
      await run(`
        serve({ "/": "<input autofocus>" });
        const page = await open();
        page.focus();
        await page.executeJavaScript(\`
          window.read = [];
          for (const name of ["range", "selection", "forward"]) Object.defineProperty(Object.prototype, name, { get: () => void read.push(name) });\`);
        page.sendInputEvent({ type: "char", keyCode: "a" });
        page.findInPage("a");
        print(await page.executeJavaScript("read"));`),
    ).toEqual([[]]);
  });

  test.each([
    ["allow-same-origin", []],
    ["allow-same-origin allow-forms", ["invalid", "submit", "close"]],
  ])("a form in the sandbox %s is submitted: %j", async (flags, expected) => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({
          "/": '<iframe sandbox="${flags}" src=/frame></iframe>',
          "/frame": "<form><input required></form><dialog open><form method=dialog></form></dialog>",
        });
        print(await (await open()).executeJavaScript(\`
          const seen = [], { forms } = frames[0].document;
          for (const name of ["invalid", "submit"]) frames[0].addEventListener(name, () => seen.push(name), true);
          for (const form of forms) form.requestSubmit();
          if (!forms[1].parentNode.open) seen.push("close");
          seen\`));`),
    ).toEqual([expected]);
  });

  test.each([true, false])(
    "a sandbox by policy has no forms and no dialogs (frames are trusted: %p)",
    async inFrames => {
      expect(
        await run(`
        app.trustOrigins(["app://trusted"], { inFrames: ${inFrames} });
        const headers = { "content-type": "text/html", "content-security-policy": "sandbox allow-scripts" };
        serve({ "/": () => new Response("<form></form>", { headers }) });
        const page = await open();
        page.on("will-navigate", () => print("navigates"));
        print(await page.executeJavaScript(\`
          onbeforeunload = event => event.preventDefault();
          document.forms[0].submit();
          new Promise(done => setTimeout(done)).then(() => [alert("a") ?? null, confirm("a"), prompt("a")])\`));
        page.on("will-prevent-unload", () => print("stays")).on("close", () => print("closes"));
        page.close({ waitForBeforeUnload: true });`),
      ).toEqual([[null, false, null], "closes"]);
    },
  );

  test.each([
    ["allow-scripts", false],
    ["allow-scripts allow-top-navigation", true],
  ])("a frame in the sandbox %s closes the window: %p", async (flags, expected) => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({ "/": '<iframe sandbox="${flags}" src=/frame></iframe>', "/frame": "<script>top.close(); console.log(top.closed)</script>" });
        const window = new BrowserWindow();
        window.on("close", event => event.preventDefault());
        const said = new Promise(done => window.webContents.on("console-message", ({ message }) => done(message)));
        window.loadURL("app://trusted/").catch(() => {});
        print(await said);
        window.destroy();`),
    ).toEqual([String(expected)]);
  });

  test.each([
    ["allow-scripts", "#a"],
    ["allow-scripts allow-top-navigation", ""],
  ])(
    "a frame in the sandbox %s goes back by two, then the page by one: it first gets to %j",
    async (flags, expected) => {
      expect(
        await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({ "/": "", "/frame": "<script>onmessage = () => { history.go(-2); console.log('asked') }</script>" });
        const page = await open();
        await page.executeJavaScript(\`
          history.pushState(null, "", "#a");
          history.pushState(null, "", "#b");
          const first = new Promise(done => (onpopstate = () => done(location.hash)));
          const frame = Object.assign(document.createElement("iframe"), { sandbox: "${flags}", src: "/frame" });
          new Promise(done => document.body.appendChild(frame).onload = () => done())\`);
        const asked = new Promise(done => page.once("console-message", done));
        await page.executeJavaScript("frames[0].postMessage(0, '*')");
        await asked;
        print(await page.executeJavaScript("history.back(), first"));`),
      ).toEqual([expected]);
    },
  );

  test("what a frame may do is the same at the end of the stack", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({
          "/": "<iframe sandbox=allow-scripts src=/frame></iframe>",
          "/frame": \`<script>
            const seen = new Set();
            let depth = 0;
            (function descend() {
              try { descend(); } catch {}
              if (++depth % 50 || depth > 2000) return;
              seen.add(document.fullscreenEnabled).add(navigation.entries().length);
              try { history.pushState(null, "", "/other"); } catch {}
            })();
            console.log(JSON.stringify([...seen, location.pathname]));
          </script>\`,
        });
        const page = new BrowserWindow().webContents;
        const said = new Promise(done => page.on("console-message", ({ message }) => done(message)));
        page.loadURL("app://trusted/");
        print(JSON.parse(await said));`),
    ).toEqual([[false, 0, "/frame"]]);
  });

  test("navigator.clipboard.write() copies pixels, and refuses if there are none", async () => {
    expect(
      await run(`
        const { clipboard, nativeImage } = require("electron");
        const png = nativeImage.createFromBitmap(Buffer.alloc(16, 255), { width: 2, height: 2 }).toPNG();
        serve({ "/": "" });
        const page = await open();
        page.debugger.attach();
        await page.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        const write = bytes => "navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([Uint8Array.of(" + [...bytes] + ")], { type: 'image/png' }) })])";
        clipboard.writeText("before");
        print([await page.executeJavaScript(write(png.subarray(0, 40)) + ".catch(it => it.name)"), await clipboard.readText()]);
        print(await page.executeJavaScript(write(Buffer.concat([png, Buffer.from("more")])) + ".then(() => navigator.clipboard.read()).then(([it]) => it.types)"));
        const [item] = await clipboard.read();
        const copied = Buffer.from(await (await item.getType("image/png")).arrayBuffer());
        print([nativeImage.createFromBuffer(copied).getSize(), copied.includes("more")]);`),
    ).toEqual([["DataError", "before"], ["image/png"], [{ width: 2, height: 2 }, false]]);
  });

  test("copyImageAt() copies pixels, and nothing if there are none", async () => {
    expect(
      await run(`
        const { clipboard, nativeImage } = require("electron");
        const png = nativeImage.createFromBitmap(Buffer.alloc(16, 255), { width: 2, height: 2 }).toPNG();
        const bodies = [png, "not an image", Buffer.concat([png, Buffer.from("more")])];
        protocol.handle("app", ({ url }) =>
          url.endsWith(".png")
            ? new Response(bodies.shift(), { headers: { "cache-control": "no-store" } })
            : new Response("<img src=/a.png width=100 height=100>", { headers: { "content-type": "text/html" } }));
        const page = await open();
        clipboard.writeText("before");
        page.copyImageAt(50, 50);
        await page.executeJavaScript("fetch('/').then(it => it.text())");
        print([bodies.length, await clipboard.readText()]);
        page.copyImageAt(50, 50);
        while (await clipboard.readText()) await new Promise(setImmediate);
        const [item] = await clipboard.read();
        const copied = Buffer.from(await (await item.getType("image/png")).arrayBuffer());
        print([nativeImage.createFromBuffer(copied).getSize(), copied.includes("more")]);`),
    ).toEqual([
      [1, "before"],
      [{ width: 2, height: 2 }, false],
    ]);
  });

  test("a view that outlives its window goes on without one", async () => {
    expect(
      await run(`
        process.on("uncaughtException", error => print(error.message));
        app.on("window-all-closed", () => {});
        serve({ "/": "", "/next": "" });
        const [window, view] = [new electron.BaseWindow({ width: 400, height: 300 }), new WebContentsView()];
        window.contentView.addChildView(view);
        const page = view.webContents;
        await page.loadURL("app://trusted/");
        window.destroy();
        await page.executeJavaScript("focus(), moveTo(1, 1), resizeTo(200, 200)", true);
        page.focus();
        page.setZoomFactor(2);
        await page.loadURL("app://trusted/next");
        print([page.getOwnerBrowserWindow(), await page.executeJavaScript("location.pathname")]);`),
    ).toEqual([[null, "/next"]]);
  });

  test("a file chooser that cannot be shown is as good as cancelled", async () => {
    expect(
      await run(`
        process.on("uncaughtException", error => print("uncaught " + error.message));
        process.on("warning", warning => print(warning.message));
        electron.dialog.showOpenDialog = async () => { throw new Error("no chooser") };
        serve({ "/": "<input type=file>" });
        const page = await open();
        print(await page.executeJavaScript(\`new Promise(done => {
          const input = document.querySelector("input");
          input.oncancel = event => done(event.type);
          input.click();
        })\`, true));`),
    ).toEqual(["no chooser", "cancel"]);
  });

  test("a page cannot move its window off the screen or make it larger than that", async () => {
    const [{ x, y, width, height }, ...seen] = await run(`
      serve({ "/": "" });
      const page = await open();
      let asked;
      page.on("content-bounds-updated", (_, bounds) => (asked = bounds));
      print(electron.screen.getPrimaryDisplay().workArea);
      for (const move of ["resizeTo(1e9, 1e9)", "resizeTo(200, 100), moveTo(1e9, 1e9)", "moveBy(-1e9, -1e9)"]) {
        print(await page.executeJavaScript(move + ", [screenX, screenY, outerWidth, outerHeight]"));
        await page.executeJavaScript("new Promise(done => setTimeout(done))");
        print(Object.values(asked));
      }
      page.setWindowOpenHandler(() => ({ action: "allow" }));
      const created = once(page, "did-create-window");
      await page.executeJavaScript("void open('/', '', 'width=99999,height=99999,left=99999,top=99999')");
      print(Object.values((await created)[0].getBounds()));`);
    const twice = (...bounds: number[]) => [bounds, bounds];
    expect(seen).toEqual([
      ...twice(x, y, width, height),
      ...twice(x + width - 200, y + height - 100, 200, 100),
      ...twice(x, y, 200, 100),
      [x, y, width, height],
    ]);
  });

  test("a fetch is aborted, and a worker is terminated while it derives a key", async () => {
    expect(
      await run(`
        serve({ "/": "", "/worker.js": \`
          crypto.subtle.importKey("raw", new Uint8Array(8), "PBKDF2", false, ["deriveBits"]).then(key => {
            crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(8), iterations: 1e5 }, key, 256);
            postMessage(0);
          });\` });
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          const controller = new AbortController(), fetched = fetch("/", controller);
          controller.abort();
          const { name } = await fetched.catch(error => error);
          const worker = new Worker("/worker.js");
          await new Promise(done => (worker.onmessage = done));
          worker.terminate();
          await fetch("/");
          return name;
        })()\`));`),
    ).toEqual(["AbortError"]);
  });

  test("theme colors that come together are reported together", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        page.on("did-change-theme-color", (_, color) => print(color));
        await page.executeJavaScript(\`
          for (const content of ["red", "lime"]) document.head.prepend(Object.assign(document.createElement("meta"), { name: "theme-color", content }));
          new Promise(done => setTimeout(done))\`);`),
    ).toEqual(["#00FF00"]);
  });

  test("icons that come together are reported together", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        page.on("page-favicon-updated", (_, urls) => print(urls.length));
        await page.executeJavaScript(\`
          document.head.innerHTML = "<link rel=icon href=/a.png>".repeat(3);
          new Promise(done => setTimeout(done))\`);
        await page.executeJavaScript("document.head.lastChild.href = '/b.png', new Promise(done => setTimeout(done))");`),
    ).toEqual([3, 3]);
  });

  test("a frame that is removed at the end of the stack is gone", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({ "/": "<iframe src=/frame></iframe>".repeat(4), "/frame": "" });
        const page = await open();
        await page.executeJavaScript(\`{
          globalThis.windows = Array.from(frames);
          let depth = 0;
          (function descend() {
            try { descend(); } catch {}
            if (++depth % 50 === 0) document.querySelector("iframe")?.remove();
          })();
          new Promise(done => setTimeout(done));
        }\`);
        print([page.mainFrame.frames.length, await page.executeJavaScript("windows.map(it => it.closed)")]);`),
    ).toEqual([[0, [true, true, true, true]]]);
  });

  test("the app hears of the errors of an isolated world, and the page does not", async () => {
    expect(
      await run(`
        serve({ "/": "<script>onerror = onunhandledrejection = () => console.log('page')</script>" });
        const page = await open();
        page.on("console-message", ({ message }) => print(message));
        await page.executeJavaScriptInIsolatedWorld(5, [{ code: \`
          addEventListener("a", () => { throw new Error("listener") });
          dispatchEvent(new Event("a"));
          reportError(new Error("reported"));
          new Promise(done => setTimeout(() => { setTimeout(done); throw "timer" }))\` }]);
        const rejected = new Promise(done => page.once("console-message", done));
        await page.executeJavaScriptInIsolatedWorld(5, [{ code: "void Promise.reject(new Error('rejected'))" }]);
        await rejected;
        await page.executeJavaScript("reportError('timer')");
        await new Promise(setImmediate);`),
    ).toEqual([
      "Uncaught Error: listener",
      "Uncaught Error: reported",
      "Uncaught timer",
      "Uncaught (in promise) Error: rejected",
      "page",
      "Uncaught timer",
    ]);
  });

  test("an isolated world sends messages as its page", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({ "/": "<iframe src=/frame></iframe>", "/frame": "<script>onmessage = event => console.log(event.source === parent)</script>" });
        const page = await open();
        const said = new Promise(done => page.on("console-message", ({ message }) => done(message)));
        await page.executeJavaScriptInIsolatedWorld(5, [{ code: "frames[0].postMessage(0)" }]);
        print(await said);`),
    ).toEqual(["true"]);
  });

  test.each([
    ["_top", "allow-top-navigation"],
    ["_blank", "allow-popups allow-popups-to-escape-sandbox"],
  ])("a javascript: link to %s needs allow-scripts", async (target, flags) => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        const frame = (name, more) => '<iframe sandbox="allow-same-origin ${flags} ' + more + '" src=/' + name + "></iframe>";
        const link = name => '<a target=${target} rel=opener href="javascript:void (opener ?? top).top.ran(\\'' + name + '\\')"></a>';
        serve({ "/": frame("a", "") + frame("b", "allow-scripts"), "/a": link("a"), "/b": link("b") });
        print(await (await open()).executeJavaScript(\`new Promise(done => {
          window.ran = done;
          frames[0].document.links[0].click();
          requestAnimationFrame(() => setTimeout(() => frames[1].document.links[0].click()));
        })\`));`),
    ).toEqual(["b"]);
  });

  test("a javascript: URL is subject to the policy of the document that it runs in", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
        const headers = { "content-type": "text/html", "content-security-policy": "script-src 'none'" };
        serve({ "/": "<iframe src=/frame></iframe>", "/frame": () => new Response("", { headers }) });
        print(await (await open()).executeJavaScript(\`new Promise(done => {
          window.ran = done;
          frames[0].document.onsecuritypolicyviolation = event => done(event.violatedDirective);
          frames[0].location = "javascript:void top.ran('ran')";
        })\`));`),
    ).toEqual(["script-src-elem"]);
  });

  test("style attributes from documents without a window are subject to the policy", async () => {
    expect(
      await run(`
        const headers = { "content-type": "text/html", "content-security-policy": "style-src 'none'" };
        serve({ "/": () => new Response("<body><template><p style=color:red></p></template>", { headers }) });
        print(await (await open()).executeJavaScript(\`
          const parse = () => new DOMParser().parseFromString("<p style=color:red>", "text/html").body.firstChild;
          const edit = element => ((element.style.top = "0"), element);
          const { content } = document.querySelector("template"), own = content.ownerDocument.createElement("p");
          own.style.color = "red";
          [parse(), document.importNode(parse()), edit(parse()), content.firstChild.cloneNode(), content.firstChild,
            own.cloneNode(), document.importNode(own), document.importNode(own).cloneNode(), own,
          ].map(it => getComputedStyle(document.body.appendChild(it)).color === "rgb(255, 0, 0)")\`));`),
    ).toEqual([[false, false, false, false, false, true, true, true, true]]);
  });

  test("a nonce that a second body or html tag brings is hidden", async () => {
    expect(
      await run(`
        const headers = { "content-type": "text/html", "content-security-policy": "script-src 'nonce-a'" };
        serve({ "/": () => new Response("<body><body nonce=a><html nonce=a>", { headers }) });
        print(await (await open()).executeJavaScript("[...document.querySelectorAll('[nonce]')].map(it => [it.getAttribute('nonce'), it.nonce])"));`),
    ).toEqual([
      [
        ["", "a"],
        ["", "a"],
      ],
    ]);
  });

  test("all attributes that are handlers require trusted types", async () => {
    expect(
      await run(`
        const headers = { "content-type": "text/html", "content-security-policy": "require-trusted-types-for 'script'" };
        serve({ "/": () => new Response("<svg><set /></svg>", { headers }) });
        print(await (await open()).executeJavaScript(\`
          ["onbegin", "onend", "onrepeat", "onfocusin", "onfocusout", "onother"].filter(name => {
            try { document.querySelector("set").setAttribute(name, "0"); return true; } catch {}
          })\`));`),
    ).toEqual([["onother"]]);
  });

  test("scripts without Trusted Types or integrity", async () => {
    expect(
      await run(`
        const page = (text, headers) => () => new Response(text, { headers: { "content-type": "text/html", ...headers } });
        serve({
          "/": page("<iframe src=/integrity></iframe>", { "content-security-policy": "require-trusted-types-for 'script'" }),
          "/integrity": page("<script src=/a.js></script>", { "integrity-policy": "blocked-destinations=(script)" }),
          "/a.js": () => (print("fetched"), new Response("")),
        });
        print(await (await open()).executeJavaScript(\`
          const script = document.createElementNS("http://www.w3.org/2000/svg", "script");
          script.append("document.title = 'ran'");
          document.body.append(script);
          [document.title, (() => { try { document.write("<b>"); } catch (error) { return error.name; } })()]\`));`),
    ).toEqual([["", "TypeError"]]);
  });

  test("a link that downloads is a request of the page", async () => {
    expect(
      await run(`
        const about = request => ["mode", "dest", "site"].map(it => request.headers.get("sec-fetch-" + it));
        const headers = { "content-disposition": "attachment; filename=theirs" };
        const other = Bun.serve({ port: 0, fetch: request => (print(about(request)), new Response("b", { headers })) });
        const server = Bun.serve({ port: 0, routes: {
          "/": new Response("<a href=/a download=mine></a><a href=/b download=mine></a>", { headers: { "content-type": "text/html" } }),
          "/a": request => (print(about(request)), new Response("a")),
          "/b": Response.redirect("http://127.0.0.1:" + other.port),
        } });
        app.trustOrigins([server.url.origin, "http://127.0.0.1:" + other.port]);
        const { webContents } = new BrowserWindow({ show: false });
        await webContents.loadURL(server.url.href);
        for (const at of [0, 1]) {
          const told = new Promise(resolve => electron.session.defaultSession.once("will-download", (event, item) => {
            event.preventDefault();
            resolve([item.getFilename(), item.hasUserGesture()]);
          }));
          await webContents.executeJavaScript("document.links[" + at + "].click()");
          print(await told);
        }
        server.stop(true);
        other.stop(true);`),
    ).toEqual([
      ["navigate", "empty", "same-origin"],
      ["mine", false],
      ["navigate", "document", "cross-site"],
      ["theirs", false],
    ]);
  });

  describe("a request that is repeated", () => {
    const sites = `
      const headers = { "content-type": "text/html", "cache-control": "no-store" };
      const told = async request => {
        print([request.method, await request.text(), ...["sec-fetch-site", "sec-fetch-user", "cookie"].map(it => request.headers.get(it))]);
        return new Response("", { headers });
      };
      const server = Bun.serve({ port: 0, routes: {
        "/": () => new Response("", { headers }),
        "/told": told,
        "/moved": () => new Response(null, { status: 303, headers: { location: "/told" } }),
      } });
      const [own, other] = ["127.0.0.1", "localhost"].map(it => "http://" + it + ":" + server.port);
      app.trustOrigins([own, other]);
      await electron.session.defaultSession.cookies.set({ url: own, name: "a", value: "b", sameSite: "strict" });
      const page = await open(other);
      const after = async (step, event = "did-finish-load") => {
        const done = once(page, event);
        typeof step === "string" ? page.executeJavaScript(step) : step();
        return done;
      };
      const post = to => "document.body.innerHTML = '<form method=post action=" + own + to + "><input name=c value=d>'; document.forms[0].submit()";`;

    test("comes from whoever has made it", async () => {
      expect(
        await run(`${sites}
          await after("location = '" + own + "/told'");
          await after(() => page.navigationHistory.goBack());
          await after("history.forward()");
          await after(() => page.reload());
          await after("location.reload()");
          server.stop(true);`),
      ).toEqual([
        ["GET", "", "cross-site", null, null],
        ["GET", "", "cross-site", null, null],
        ["GET", "", "cross-site", null, null],
        ["GET", "", "same-origin", null, "a=b"],
      ]);
    });

    test("does not have the body that a redirect has dropped", async () => {
      expect(
        await run(`${sites}
          await after(post("/moved"));
          await after("location.reload()");
          server.stop(true);`),
      ).toEqual([
        ["GET", "", "cross-site", null, null],
        ["GET", "", "same-origin", null, "a=b"],
      ]);
    });

    test("does not have a body after replaceState()", async () => {
      expect(
        await run(`${sites}
          await after(post("/told"));
          await page.executeJavaScript("history.replaceState(null, '')");
          await after(() => page.reload());
          server.stop(true);`),
      ).toEqual([
        ["POST", "c=d", "cross-site", null, null],
        ["GET", "", "same-origin", null, "a=b"],
      ]);
    });

    test("is not sent on the way through the history if it has a body", async () => {
      expect(
        await run(`${sites}
          await after(post("/told"));
          await after(() => page.navigationHistory.goBack());
          print((await after("history.forward()", "did-fail-load"))[2]);
          server.stop(true);`),
      ).toEqual([["POST", "c=d", "cross-site", null, null], "ERR_CACHE_MISS"]);
    });
  });

  test("a download belongs to the frame that has started it", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted", "app://other"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=app://other/frame></iframe><a href=data:,a download></a>", "/frame": "<a href=data:,b download></a>" });
        const page = await open();
        const [frame] = page.mainFrame.frames;
        const names = new Map([[frame, "inner"], [page.mainFrame, "outer"], [null, "none"]]);
        for (const start of [frame, page.mainFrame].map(it => () => it.executeJavaScript("document.links[0].click()")).concat(() => page.downloadURL("data:,c"))) {
          const told = new Promise(resolve => page.session.once("will-download", (event, item, _, by) => {
            event.preventDefault();
            resolve([item.getInitiatorOrigin(), names.get(by)]);
          }));
          start();
          print(await told);
        }`),
    ).toEqual([
      ["app://other", "inner"],
      ["app://trusted", "outer"],
      ["", "none"],
    ]);
  });

  test("a page without the focus does not get at the clipboard", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        const use = "Promise.all([navigator.clipboard.writeText('a'), navigator.clipboard.readText()].map(it => it.then(() => 'done', it => it.name)))";
        print(await page.executeJavaScript(use));
        page.debugger.attach();
        await page.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        print(await page.executeJavaScript(use));`),
    ).toEqual([
      ["NotAllowedError", "NotAllowedError"],
      ["done", "done"],
    ]);
  });

  test.skipIf(!hasScreen)("a frame of another origin does not raise the window by itself", async () => {
    await using screen = await openScreen();
    expect(
      await run(
        `app.trustOrigins(["app://trusted", "app://other"], { inFrames: true, injectedScripts: true });
        serve({ "/": "<iframe src=app://other/frame></iframe>", "/frame": "" });
        const page = await open();
        const [own, second] = [BrowserWindow.fromWebContents(page), new BrowserWindow()];
        await once(second, "focus");
        own.on("focus", () => print("raised"));
        await page.mainFrame.frames[0].executeJavaScript("top.focus()");
        await once(new BrowserWindow(), "focus");
        print("asked");
        page.mainFrame.frames[0].executeJavaScript("top.focus()", true);
        await once(own, "focus");`,
        {},
        [],
        screen.env,
      ),
    ).toEqual(["asked", "raised"]);
  });

  test("what a handler imports does not get the nonce of a script", async () => {
    expect(
      await run(`
        const headers = { "content-type": "text/html", "content-security-policy": "script-src 'nonce-a' 'unsafe-hashes' 'sha256-" + require("crypto").createHash("sha256").update("b=import('/b.js')").digest("base64") + "'" };
        serve({
          "/": () => new Response("<script nonce=a>a=import('/a.js')</script><body onload=b=import('/b.js')>", { headers }),
          "/a.js": () => new Response("", { headers: { "content-type": "text/javascript" } }),
          "/b.js": () => new Response("", { headers: { "content-type": "text/javascript" } }),
        });
        print(await (await open()).executeJavaScript("Promise.allSettled([a, b]).then(all => all.map(it => it.status))"));`),
    ).toEqual([["fulfilled", "rejected"]]);
  });

  test("an embed that fails is not loaded again, and object-src holds for images", async () => {
    expect(
      await run(`
        const headers = { "content-type": "text/html", "content-security-policy": "object-src app://trusted/a" };
        serve({
          "/": () => new Response("<embed type=image/png src=/a><object type=image/png data=/b></object>", { headers }),
          "/a": () => (print("a"), new Response("")),
          "/b": () => (print("b"), new Response("")),
        });
        await (await open()).executeJavaScript(\`(async () => {
          for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
        })()\`);`),
    ).toEqual(["a"]);
  });

  test.each([
    "<a href=/b target='\n<i>'></a>",
    "<a href=/b></a><base target='\n<i>'>",
    "<form action=/b target='\n<i>'><button></button></form>",
    "<form action=/b><button formtarget='\n<i>'></button></form>",
  ])("a target that holds markup does not name the window: %j", async markup => {
    expect(
      await run(`
        serve({ "/": ${JSON.stringify(markup)} });
        const page = await open();
        const opened = new Promise(done => page.setWindowOpenHandler(it => (done(it.frameName), { action: "deny" })));
        await page.executeJavaScript("document.querySelector('a, button').click()");
        print(await opened);`),
    ).toEqual([""]);
  });

  test.each([
    ["columns:2", "<table><td>"],
    ["columns:2", "a<div style=break-before:column>"],
    ["", "<i style=float:left></i>a<div style=display:flow-root><div style=columns:2>"],
    [
      "",
      "<div style='display:flex;flex-flow:column wrap;max-height:50px'><div style='display:grid;grid:1fr auto/1fr auto;height:90%'>",
    ],
  ])("layout ends in <div style=%s> with 40 times %s", async (style, tags) => {
    expect(
      await run(`
        serve({ "/": "<div style=width:400px;${style}>" + ${JSON.stringify(tags)}.repeat(40) + "a<br>b" });
        print(await (await open()).executeJavaScript("document.body.firstChild.offsetWidth"));`),
    ).toEqual([400]);
  });

  test("a cue is styled by the video that shows it", async () => {
    expect(
      await run(`
        serve({
          "/": "<style>.a::cue { background: url(/a) } .b::cue { background: url(/b) }</style><video></video><video></video>",
          "/a": () => (print("a"), new Response("")),
          "/b": () => (print("b"), new Response("")),
        });
        await (await open()).executeJavaScript(\`(async () => {
          const frame = () => new Promise(requestAnimationFrame), cue = new VTTCue(0, 9, "x");
          const videos = [...document.querySelectorAll("video")];
          const [first, second] = videos.map(it => (it.play().catch(() => {}), Object.assign(it.addTextTrack("subtitles"), { mode: "showing" })));
          first.addCue(cue);
          await frame();
          first.removeCue(cue);
          [videos[0].className, videos[1].className] = "ab";
          second.addCue(cue);
          for (let i = 0; i < 3; i++) await frame();
        })()\`);`),
    ).toEqual(["b"]);
  });

  test("an element that was restyled in one document is restyled in another", async () => {
    expect(
      await run(`
        serve({ "/": "<i></i>".repeat(300) + "<div style=height:9px><p><b></b><p></div><iframe></iframe>" });
        print(await (await open()).executeJavaScript(\`
          const moved = document.querySelector("div"), { body } = frames[0].document;
          moved.offsetHeight;
          moved.querySelector("b").style.color = "red";
          moved.offsetHeight;
          body.append(moved);
          body.style.transition = "opacity 9s";
          moved.offsetHeight;
          body.style.opacity = 0;
          moved.offsetHeight\`));`),
    ).toEqual([9]);
  });

  test("invisible text in a translucent box changes its color without a leak", async () => {
    const ASAN_OPTIONS = [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":");
    const [megabytes] = await run(
      `
      serve({ "/": "<div></div>".repeat(20000) + "<div id=box style=opacity:.5><p style=visibility:hidden>a</div>" });
      const page = await open();
      const recolor = times => page.executeJavaScript(\`(async () => {
        for (let i = 0; i < \${times}; i++) {
          box.style.color = i % 2 ? "red" : "blue";
          for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
        }
      })()\`);
      await recolor(2);
      const before = process.memoryUsage.rss();
      await recolor(20);
      print((process.memoryUsage.rss() - before) / 2 ** 20);`,
      {},
      [],
      { ASAN_OPTIONS },
    );
    expect(megabytes).toBeLessThan(isASAN || isDebug ? 60 : 30);
  });

  test("a foreignObject is in the nearest svg", async () => {
    const svg = "<svg width=99 height=99 style=display:block><foreignObject x=10 y=10 width=80 height=80>";
    expect(
      await run(`
        serve({ "/": "<body style=margin:0>${svg}${svg}<p style=margin:0>a" });
        print(await (await open()).executeJavaScript(\`
          const { x, y } = document.querySelector("p").getBoundingClientRect();
          [x, y, document.elementFromPoint(x + 1, y + 1).localName]\`));`),
    ).toEqual([[20, 20, "p"]]);
  });

  test("a fieldset with a legend skips its contents, and shows them again", async () => {
    expect(
      await run(`
        serve({ "/": "<fieldset style=border-width:2px;padding:0><legend style=height:20px></legend><div style=height:10px>" });
        print(await (await open()).executeJavaScript(\`
          ["", "hidden", ""].map(it => ((document.body.firstChild.style.contentVisibility = it), document.body.firstChild.offsetHeight))\`));`),
    ).toEqual([[32, 4, 32]]);
  });

  test("a square root can be as deep as any box", async () => {
    expect(
      await run(`
        serve({ "/": "<div><math><msqrt></msqrt></math>".repeat(450) });
        print(await (await open()).executeJavaScript("document.body.offsetHeight > 0"));`),
    ).toEqual([true]);
  });

  const nest = `const nest = make => { let top = make(); const leaf = top; for (let i = 0; i < 200000; i++) { const it = make(); it.append(top); top = it; } return [top, leaf]; };`;

  test.each([
    [
      "the selection is moved out of",
      `const [top, leaf] = nest(() => document.createElement("b"));
      document.body.append("a", top);
      getSelection().collapse(leaf, 0);
      getSelection().modify("move", "backward", "character");
      getSelection().focusNode.data`,
      "a",
    ],
    [
      "checkIntersection() is asked about",
      `const svg = document.body.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
      svg.checkIntersection(nest(() => document.createElementNS(svg.namespaceURI, "g"))[0], svg.createSVGRect())`,
      false,
    ],
  ])("%s a very deep tree", async (_, script, result) => {
    expect(
      await run(`
        serve({ "/": "<body>" });
        print(await (await open()).executeJavaScript(${JSON.stringify(`{ ${nest} ${script} }`)}));`),
    ).toEqual([result]);
  });

  test.skipIf(!isLinux || !process.env.DISPLAY).each([
    ["a very deep inline element fades", `nest(() => document.createElement("b"))[0]`, "{ duration: 9000 }"],
    ["an animation rests for ages", `document.createElement("p")`, `{ duration: 1e30, easing: "step-end" }`],
  ])("%s in a window on a display", async (_, element, timing) => {
    const script = `(async () => {
      ${nest}
      const it = document.body.appendChild(${element});
      it.prepend("a");
      await it.animate({ opacity: [0.9, 0] }, ${timing}).ready;
      for (let i = 0; i < 9; i++) (document.body.append("b"), await new Promise(requestAnimationFrame));
    })()`;
    expect(
      await run(
        `const complaints = [];
        process.on("warning", it => it.message.includes("UI library") && complaints.push(it.message));
        serve({ "/": "<body>" });
        await (await open()).executeJavaScript(${JSON.stringify(script)});
        print(complaints);`,
        {},
        [],
        { BUN_DESKTOP_HEADLESS: "0" },
      ),
    ).toEqual([[]]);
  });

  test("subgrids in subgrids of another writing mode", async () => {
    const grids = [
      "9px/9px",
      "subgrid/auto;writing-mode:vertical-rl",
      "subgrid/subgrid;writing-mode:horizontal-tb",
      "subgrid/subgrid",
    ];
    expect(
      await run(`
        serve({ "/": "${grids.map(it => `<div style=display:grid;grid:${it}>`).join("")}" });
        print(await (await open()).executeJavaScript("document.body.firstChild.offsetHeight"));`),
    ).toEqual([9]);
  });

  test.each(["<p style=display:grid>", "<p style=display:flex>", "<table><td>"])(
    "a formula in %s in columns",
    async around => {
      expect(
        await run(`
        serve({ "/": "<div style=columns:2>${around}<math display=block><mi>a" });
        print(await (await open()).executeJavaScript("document.querySelector('math').getClientRects().length"));`),
      ).toEqual([1]);
    },
  );

  test("a window has no more than 1000 frames", async () => {
    expect(
      await run(`
        serve({ "/": "<body>" });
        const page = await open();
        print(await page.executeJavaScript(\`
          const add = (to, count) => Array.from({ length: count }, () => to.body.appendChild(to.createElement("iframe")));
          const [first] = add(document, 1);
          const nested = add(first.contentDocument, 998);
          const more = add(document, 2).map(it => it.contentWindow !== null);
          first.remove();
          [nested.length, more, add(document, 1)[0].contentWindow !== null]\`));`),
    ).toEqual([[998, [true, false], true]]);
  });

  test("a handler of a protocol passes on what net.fetch has got", async () => {
    expect(
      await run(
        `const file = require("url").pathToFileURL(path.join(__dirname, "file.txt")).href;
         serve({
           "/": "",
           "/whole": () => net.fetch(file),
           "/part": request => net.fetch(file, { headers: request.headers }),
           "/like": () => ({ status: 201, headers: { "x-like": "response" }, body: null }),
           "/echo": request => new Response(request.body),
         });
         const page = await open();
         print(await page.executeJavaScript(\`Promise.all([
           fetch("/whole").then(it => it.text()),
           fetch("/part", { headers: { range: "bytes=2-4" } }).then(async it => [it.status, await it.text()]),
           fetch("/like").then(it => [it.status, it.headers.get("x-like")]),
           fetch("/echo", { method: "POST", body: new Blob(["a", "b"]).stream(), duplex: "half" }).then(it => it.text()),
         ])\`));`,
        { "file.txt": "0123456789" },
      ),
    ).toEqual([["0123456789", [206, "234"], [201, "response"], "ab"]]);
  });

  test("frames, timelines and performance.now() share the origin of the document", async () => {
    expect(
      await run(`
        serve({ "/": "<p>a" });
        const page = await open();
        print(await page.executeJavaScript(\`new Promise(resolve => {
          const before = performance.now();
          requestAnimationFrame(time => resolve([before <= time + 1, time <= performance.now() + 1, document.timeline.currentTime - time < 1]));
        })\`));`),
    ).toEqual([[true, true, true]]);
  });

  test("the performance timeline", async () => {
    expect(
      await run(`
        serve({ "/": "<p>a<img src=/missing.png>", "/worker.js": "fetch('/').then(it => it.text()).then(() => postMessage([performance.mark('w').name, PerformanceObserver.supportedEntryTypes]))" });
        const page = await open();
        print(await page.executeJavaScript(\`new Promise(done => {
          const detail = { a: [1] };
          const mark = performance.mark("a", { detail, startTime: 1 });
          new PerformanceObserver((list, observer) => done([
            list.getEntries().map(it => [it.name, it.startTime, it.duration, it.detail]),
            [mark.detail, mark.detail !== detail, new PerformanceMark("b", { detail: "text" }).detail],
            performance.getEntriesByType("navigation").map(it => [it.name, it.type, it.loadEventEnd > 0, it.toJSON().entryType]),
            performance.timing.loadEventEnd >= performance.timing.navigationStart,
            performance.eventCounts.get("click"),
          ])).observe({ type: "measure" });
          performance.measure("m", { start: "a", duration: 2, detail: 3 });
        })\`));
        print(await page.executeJavaScript(\`new Promise(done => new Worker("/worker.js").onmessage = it => done(it.data))\`));`),
    ).toEqual([
      [[["m", 1, 2, 3]], [{ a: [1] }, true, "text"], [["app://trusted/", "navigate", true, "navigation"]], true, 0],
      ["w", ["mark", "measure", "resource"]],
    ]);
  });

  test("locks, permissions, origins and derived exceptions", async () => {
    expect(
      await run(`
        serve({ "/": "<a href=https://a.example/>" });
        session.defaultSession.setPermissionCheckHandler((_, name, origin, { mediaType }) => name === "media" && mediaType === "video");
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          const order = [];
          const held = navigator.locks.request("a", () => new Promise(() => {})).catch(it => order.push(it.name));
          const controller = new AbortController();
          const waiting = navigator.locks.request("a", { signal: controller.signal }, () => order.push("never")).catch(it => order.push(it));
          order.push(await navigator.locks.request("a", { ifAvailable: true }, lock => lock));
          controller.abort("aborted");
          order.push(await navigator.locks.request("a", { steal: true }, lock => lock.name + lock.mode));
          await Promise.all([held, waiting]);
          const error = structuredClone(new QuotaExceededError("full", { quota: 1, requested: 2 }));
          return [
            order.sort(),
            await navigator.locks.query(),
            await Promise.all(["camera", "microphone"].map(name => navigator.permissions.query({ name }).then(it => it.state))),
            await navigator.permissions.query({ name: "nothing" }).catch(it => it.name),
            await new Promise(done => (new Notification("a").onerror = it => done([it.type, Notification.permission]))),
            [document.links[0], new URL("https://a.example/b"), self].map(it => Origin.from(it).isSameOrigin(Origin.from("https://a.example"))),
            [error instanceof QuotaExceededError, error instanceof DOMException, error.name, error.message, error.code, error.quota, error.requested],
          ];
        })()\`));`),
    ).toEqual([
      [
        ["AbortError", "aborted", "aexclusive", null],
        { held: [], pending: [] },
        ["granted", "denied"],
        "TypeError",
        ["error", "denied"],
        [true, true, false],
        [true, true, "QuotaExceededError", "full", 22, 1, 2],
      ],
    ]);
  });

  test("Trusted Types and the reports of violations", async () => {
    expect(
      await run(`
        serve({ "/": "<p>" }, { "content-security-policy": "require-trusted-types-for 'script'" });
        const page = await open();
        print(await page.executeJavaScript(\`new Promise(done => {
          const seen = [];
          document.onsecuritypolicyviolation = it => seen.push(it.sample, it.disposition, it.isTrusted);
          new ReportingObserver(([report]) => done([...seen, report.type, report.toJSON().body.blockedURL, document.body.innerHTML])).observe();
          try { document.body.innerHTML = "<b>"; } catch (error) { seen.push(error.name); }
          document.body.innerHTML = trustedTypes.createPolicy("a", { createHTML: it => it + "!" }).createHTML("<i>");
        })\`));`),
    ).toEqual([
      ["TypeError", "Element innerHTML|<b>", "enforce", true, "csp-violation", "trusted-types-sink", "<i>!</i>"],
    ]);
  });

  test("storage outlives the document", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        const database = use => \`new Promise((resolve, reject) => {
          const request = indexedDB.open("db", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("s", { keyPath: "id" }).createIndex("n", "n");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const store = request.result.transaction("s", "readwrite").objectStore("s");
            const done = (\${use})(store);
            store.transaction.oncomplete = () => resolve(done.result);
          };
        })\`;
        await page.executeJavaScript("localStorage.a = '\\\\ud800'; sessionStorage.b = 2; window.c = 3");
        await page.executeJavaScript(database("store => (store.put({ id: 2, n: 'x' }), store.put({ id: 1, n: 'y', map: new Map([[1, 2]]) }))"));
        page.reload();
        await once(page, "did-finish-load");
        print(await page.executeJavaScript("[localStorage.a.charCodeAt(), sessionStorage.b, typeof c]"));
        print(await page.executeJavaScript(database("store => store.index('n').getAllKeys()")));
        const second = await open();
        const changed = second.executeJavaScript("new Promise(resolve => onstorage = event => resolve([event.key, event.newValue, sessionStorage.length]))");
        await second.executeJavaScript("0");
        await page.executeJavaScript("localStorage.d = 4");
        print(await changed);
        await session.defaultSession.clearStorageData();
        print(await page.executeJavaScript("localStorage.length"));`),
    ).toEqual([[0xd800, "2", "undefined"], [2, 1], ["d", "4", 0], 0]);
  });

  const again = `Bun.spawnSync([process.execPath, "--preload=bun:desktop/electron", ".", "again"], { stdout: "inherit", stderr: "inherit" });`;
  const openDatabase = `new Promise(resolve => {
    const request = indexedDB.open("db");
    request.onupgradeneeded = () => request.result.createObjectStore("s", { autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
  })`;

  test("a key that cannot be extracted is stored, and stays so", async () => {
    const use = `(async () => {
      const algorithm = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" }, data = new Uint8Array(1);
      const made = await crypto.subtle.generateKey(algorithm, false, ["sign", "verify"]);
      const store = (await ${openDatabase}).transaction("s", "readwrite").objectStore("s");
      store.add(made);
      const all = await new Promise(resolve => store.getAll().onsuccess = event => resolve(event.target.result));
      await new Promise(resolve => store.transaction.oncomplete = resolve);
      const { privateKey, publicKey } = all[0];
      const signature = await crypto.subtle.sign(algorithm, privateKey, data);
      return [all.length, privateKey.extractable, await crypto.subtle.verify(algorithm, publicKey, signature, data), await crypto.subtle.exportKey("jwk", privateKey).catch(error => error.name)];
    })()`;
    expect(
      await run(`
        serve({ "/": "", "/worker.js": ${JSON.stringify(use + ".then(postMessage)")} });
        const page = await open(undefined, { webPreferences: { nodeIntegration: true, contextIsolation: false } });
        print(await page.executeJavaScript(${JSON.stringify(use)}));
        if (process.argv.includes("again")) return;
        print(await page.executeJavaScript("new Promise(resolve => new Worker('/worker.js').onmessage = event => resolve(event.data))"));
        print(await page.executeJavaScript(\`crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then(key => {
          history.replaceState(key, "");
          try { require("v8").serialize(key); } catch (error) { return [history.state.extractable, error.name]; }
        })\`));
        ${again}`),
    ).toEqual([
      [1, false, true, "InvalidAccessError"],
      [2, false, true, "InvalidAccessError"],
      [false, "DataCloneError"],
      [3, false, true, "InvalidAccessError"],
    ]);
  });

  test("storage outlives the process", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          const store = (await ${openDatabase}).transaction("s", "readwrite").objectStore("s");
          store.add(new File(["a"], "name"));
          const files = await new Promise(resolve => store.getAll().onsuccess = event => resolve(event.target.result));
          await new Promise(resolve => store.transaction.oncomplete = resolve);
          const cache = await caches.open("c");
          const handle = await (await navigator.storage.getDirectory()).getFileHandle("f.txt", { create: true });
          const found = [localStorage.a, sessionStorage.a, files.map(it => it instanceof File && it.name), await (await cache.match("/"))?.text(), await (await handle.getFile()).text()];
          localStorage.a = sessionStorage.a = 1;
          await fetch("/").then(() => cache.put(new Request("https://a.test/"), new Response("cached")));
          const stream = await handle.createWritable();
          await stream.write("written");
          await stream.close();
          return [...found, await (await caches.match("https://a.test/")).text()];
        })()\`));
        if (process.argv.includes("again")) return;
        session.defaultSession.flushStorageData();
        ${again}`),
    ).toEqual([
      [null, null, ["name"], null, "", "cached"],
      ["1", null, ["name", "name"], null, "written", "cached"],
    ]);
  });

  test("large records are files, for as long as they are stored", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        const files = async count => {
          while (require("fs").readdirSync(path.join(app.getPath("userData"), "Web Storage.values")).length !== count) await new Promise(setImmediate);
        };
        const write = steps => page.executeJavaScript(\`new Promise(async resolve => {
          const store = (globalThis.db ??= await ${openDatabase}).transaction("s", "readwrite").objectStore("s");
          const large = fill => new Uint8Array(1 << 20).fill(fill);
          \${steps};
          const seen = [];
          store.transaction.oncomplete = store.transaction.onabort = () => {
            const read = db.transaction("s").objectStore("s");
            const note = it => seen.push(it[0] + it.at(-1) + it.length);
            read.getAll().onsuccess = event => event.target.result.forEach(note);
            read.openCursor().onsuccess = ({ target: { result } }) => (result ? (note(result.value), result.continue()) : resolve(seen));
          };
        })\`);
        if (process.argv.includes("again")) {
          print(await write(""));
          await files(1);
          await page.executeJavaScript("db.close(), new Promise(resolve => (indexedDB.deleteDatabase('db').onsuccess = () => resolve()))");
          return files(0);
        }
        print(await write("store.put(large(1), 1), store.put([5], 2), store.put(large(2), 3), store.put(large(3), 4)"));
        await files(3);
        print(await page.executeJavaScript("navigator.storage.estimate().then(it => it.usage >> 20)"));
        print(await write("store.put(large(4), 1), store.put([6], 3), store.delete(4)"));
        await files(1);
        print(await write("store.put(large(7), 1), store.put(large(7), 5).onsuccess = () => store.transaction.abort()"));
        print(await write("store.clear(), store.put(large(8), 1)"));
        await files(1);
        require("fs").writeFileSync(path.join(app.getPath("userData"), "Web Storage.values", "1-0"), "x");
        session.defaultSession.flushStorageData();
        ${again}`),
    ).toEqual([
      [1048578, 11, 1048580, 1048582, 1048578, 11, 1048580, 1048582],
      3,
      [1048584, 11, 13, 1048584, 11, 13],
      [1048584, 11, 13, 1048584, 11, 13],
      [1048592, 1048592],
      [1048592, 1048592],
    ]);
  });

  test("a cursor does not read large records before it comes to them", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        await page.executeJavaScript(\`new Promise(async resolve => {
          const store = (globalThis.db = await ${openDatabase}).transaction("s", "readwrite").objectStore("s");
          for (let i = 0; i < 9; i++) store.put(i < 8 ? i : new Uint8Array(1 << 20), i);
          store.transaction.oncomplete = () => resolve();
        })\`);
        const directory = path.join(app.getPath("userData"), "Web Storage.values");
        for (const name of require("fs").readdirSync(directory)) require("fs").truncateSync(path.join(directory, name));
        print(await page.executeJavaScript(\`new Promise(resolve => {
          let last;
          const request = db.transaction("s").objectStore("s").openCursor();
          request.onsuccess = () => ((last = request.result.value), request.result.continue());
          request.onerror = () => resolve([last, request.error.name]);
        })\`));`),
    ).toEqual([[7, "UnknownError"]]);
  });

  test("a cursor sees what is written on its way", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        print(await (await open()).executeJavaScript(\`(async () => {
          const db = await ${openDatabase};
          const filling = db.transaction("s", "readwrite");
          for (let i = 0; i < 100; i++) filling.objectStore("s").put(i, i);
          const store = db.transaction("s", "readwrite").objectStore("s");
          const seen = [];
          await new Promise(resolve => (store.openCursor().onsuccess = ({ target: { result } }) => {
            if (!result) return resolve();
            if (result.key !== result.value || result.key % 30 < 2) seen.push([result.key, result.value]);
            if (result.key === 30) store.delete(31), store.put("changed", 32), store.put("added", 32.5);
            if (result.key === 40) result.continue(60);
            else if (result.key === 70) result.advance(20);
            else result.continue();
          }));
          return seen;
        })()\`));`),
    ).toEqual([
      [
        [0, 0],
        [1, 1],
        [30, 30],
        [32, "changed"],
        [32.5, "added"],
        [60, 60],
        [61, 61],
        [90, 90],
        [91, 91],
      ],
    ]);
  });

  test("localStorage of a profile of Chromium is taken over, once", async () => {
    const entry = (key: string, value: string) =>
      `\x01${String.fromCharCode(key.length)}${key}${String.fromCharCode(value.length)}${value}`;
    const batch =
      "\x01\0\0\0\0\0\0\0\x02\0\0\0" +
      entry("_app://trusted\0\x01narrow", "\x01a") +
      entry("_app://trusted\0\x01wide", "\0\x01\x26");
    expect(
      await run(
        `serve({ "/": "" });
         const page = await open();
         print(await page.executeJavaScript("Object.entries(localStorage).sort()"));
         if (process.argv.includes("again")) return;
         await page.executeJavaScript("localStorage.removeItem('narrow')");
         session.defaultSession.flushStorageData();
         ${again}`,
        { "data/Local Storage/leveldb/000003.log": `\0\0\0\0${String.fromCharCode(batch.length)}\0\x01${batch}` },
      ),
    ).toEqual([
      [
        ["narrow", "a"],
        ["wide", "☁"],
      ],
      [["wide", "☁"]],
    ]);
  });

  test("a damaged database is set aside", async () => {
    const garbage = Buffer.alloc(4096, "x").toString();
    expect(
      await run(
        `serve({ "/": "" });
         const page = await open();
         print(await page.executeJavaScript("localStorage.a = 1; " + ${JSON.stringify(openDatabase)} + ".then(it => it.version)"));
         print(require("fs").statSync(path.join(__dirname, "data", "Web Storage.sqlite.damaged")).size);`,
        { "data/Web Storage.sqlite": garbage },
      ),
    ).toEqual([1, 4096]);
  });

  test("a page and its worker share databases, files and their locks, until they are cleared", async () => {
    expect(
      await run(`
        serve({
          "/": "",
          "/worker.js": \`(async () => {
            const db = await ${openDatabase};
            db.onversionchange = event => (db.close(), postMessage([event.oldVersion, event.newVersion]));
            const handle = await (await navigator.storage.getDirectory()).getFileHandle("f", { create: true });
            self.access = await handle.createSyncAccessHandle();
            db.transaction("s", "readwrite").objectStore("s").add("of the worker").onsuccess = () => postMessage("ready");
          })()\`,
        });
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          const worker = new Worker("/worker.js");
          const message = () => new Promise(resolve => worker.onmessage = event => resolve(event.data));
          await message();
          const handle = await (await navigator.storage.getDirectory()).getFileHandle("f");
          const refused = await handle.createWritable().catch(error => error.name);
          const [versions, db] = await Promise.all([message(), new Promise(resolve => indexedDB.open("db", 2).onsuccess = event => resolve(event.target.result))]);
          const stored = await new Promise(resolve => db.transaction("s").objectStore("s").get(1).onsuccess = event => resolve(event.target.result));
          window.isClosed = new Promise(resolve => db.onclose = () => resolve(true));
          return [refused, versions, stored];
        })()\`));
        await session.defaultSession.clearStorageData({ storages: ["indexdb"] });
        print(await page.executeJavaScript("Promise.all([isClosed, indexedDB.databases()])"));`),
    ).toEqual([
      ["NoModificationAllowedError", [1, 2], "of the worker"],
      [true, []],
    ]);
  });

  test("a File is read when it is read, and not after it has changed", async () => {
    const [result] = await run(`
      serve({ "/": "" });
      const page = await open();
      print(await page.executeJavaScript(\`(async () => {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle("a.txt", { create: true });
        const write = async data => { const it = await handle.createWritable(); await it.write(data); await it.close(); };
        const failure = promise => promise.then(() => "read", error => error.name);
        await write("0123456789");
        const file = await handle.getFile();
        const form = new FormData();
        form.append("part", file.slice(1, 2));
        const { port1, port2 } = new MessageChannel();
        const posted = new Promise(resolve => (port2.onmessage = event => resolve(event.data)));
        port1.postMessage(file);
        const clone = await posted;
        const url = URL.createObjectURL(file);
        const joined = new Blob([file.slice(8), "-", file.slice(0, 1)]);
        const database = await new Promise(resolve => {
          const request = indexedDB.open("files");
          request.onupgradeneeded = () => request.result.createObjectStore("all").put(file, 1);
          request.onsuccess = () => resolve(request.result);
        });
        const reader = file.slice(2, 5).stream().getReader({ mode: "byob" });
        const before = [
          file.name, file.type, file.size, await file.slice(2, 4).text(), (await file.bytes()).length, form.get("part").name,
          clone instanceof File, clone.name, clone.lastModified === file.lastModified, await clone.text(),
          await (await fetch(url)).text(), new TextDecoder().decode((await reader.read(new Uint8Array(8))).value),
        ];
        await write("changed");
        const request = database.transaction("all").objectStore("all").get(1);
        const stored = await new Promise(resolve => (request.onsuccess = () => resolve(request.result)));
        const after = [
          file.size, await failure(file.text()), await failure(clone.arrayBuffer()), await failure(fetch(url).then(it => it.text())),
          await failure(new Blob([file, "x"]).text()), await joined.text(), stored.name, await stored.text(),
        ];
        const newer = await handle.getFile();
        await root.removeEntry("a.txt");
        return [before, after, await failure(newer.text())];
      })()\`));`);
    expect(result).toEqual([
      ["a.txt", "text/plain", 10, "23", 10, "blob", true, "a.txt", true, "0123456789", "0123456789", "234"],
      [10, "NotReadableError", "NotReadableError", "TypeError", "NotReadableError", "89-0", "a.txt", "0123456789"],
      "NotFoundError",
    ]);
  });

  test("the timing of a navigation starts with the navigation", async () => {
    const [first, second, opened] = await run(`
      let answer;
      serve({ "/": "<p>a", "/slow": () => new Promise(resolve => (answer = resolve)) });
      const look = \`(([it], { timing }) => ({
        order: [it.fetchStart, it.responseStart, it.responseEnd, it.domInteractive, it.loadEventEnd].every((time, i, all) => time > 0 && time >= (all[i - 1] ?? 0)),
        hasUnloaded: [it.unloadEventStart > 0, it.unloadEventEnd >= it.unloadEventStart, timing.unloadEventEnd > 0],
        domLoading: timing.domLoading >= timing.navigationStart,
        confidence: it.confidence?.value,
        origin: performance.timeOrigin,
        interactive: it.domInteractive,
      }))(performance.getEntriesByType("navigation"), performance)\`;
      const contents = await open();
      print(await contents.executeJavaScript(look));
      const loaded = contents.loadURL("app://trusted/slow");
      while (!answer) await new Promise(setImmediate);
      const askedAt = performance.timeOrigin + performance.now();
      while (performance.timeOrigin + performance.now() < askedAt + 5);
      answer(new Response("<p>b", { headers: { "content-type": "text/html" } }));
      await loaded;
      const { origin, ...rest } = await contents.executeJavaScript(look);
      print({ ...rest, isBeforeRequest: origin <= askedAt + 1 });
      await contents.executeJavaScript("document.open(); document.write('c'); document.close()");
      print(await contents.executeJavaScript(look));
    `);
    expect(first).toMatchObject({ order: true, hasUnloaded: [false, true, false], domLoading: true });
    expect(first.confidence).toBeString();
    expect(second).toMatchObject({ order: true, hasUnloaded: [true, true, true], isBeforeRequest: true });
    expect(opened.interactive).toBe(second.interactive);
  });

  test("an <object> asks for the image by the URL that it has, not by the one that it was redirected to", async () => {
    expect(
      await run(`
        app.trustOrigins([], { inFrames: true });
        const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
        const asked = [];
        serve({
          "/": "<object data=/from></object>",
          "/from": () => (asked.push("from"), Response.redirect("app://trusted/to")),
          "/to": () => (asked.push("to"), new Response(png, { headers: { "content-type": "image/png" } })),
        });
        const contents = await open();
        print([await contents.executeJavaScript("document.querySelector('object').offsetWidth"), asked]);
      `),
    ).toEqual([[1, ["from", "to", "from", "to"]]]);
  });

  test("the SVG document of an <object> is as large as the object", async () => {
    expect(
      await run(`
        app.trustOrigins([], { inFrames: true });
        serve({
          "/": "<!doctype html><object style='width: 60px' data=/a.svg></object>",
          "/a.svg": () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="60px"/>', { headers: { "content-type": "image/svg+xml" } }),
        });
        const contents = await open();
        print(await contents.executeJavaScript(\`{
          const object = document.querySelector("object"), root = object.contentDocument.documentElement;
          const size = () => [object.offsetHeight, root.getBoundingClientRect().height, root.clientWidth];
          [size(), (object.style.height = "40px", size())];
        }\`));
      `),
    ).toEqual([
      [
        [60, 60, 60],
        [40, 40, 60],
      ],
    ]);
  });

  test("the document of a frame without a box has no boxes", async () => {
    expect(
      await run(`
        app.trustOrigins([], { inFrames: true });
        const asked = [];
        serve({
          "/": "<iframe src=/in style=display:none></iframe>",
          "/in": \`<!doctype html><html style="display:flex;font-size:20px"><style>@keyframes k{to{opacity:0}}</style><body style="display:inline">
            <p id=a style="height:2rem;animation:k 9s">a  b</p><input id=i><object data=/object></object><div style="height:3000px"></div>\`,
          "/object": () => (asked.push("object"), new Response("")),
        });
        const contents = await open();
        const look = \`(w => (w.i.focus({ preventScroll: true }), [w.innerWidth, w.a.offsetHeight, w.getComputedStyle(w.a).height, w.getComputedStyle(w.document.documentElement).display,
          w.getComputedStyle(w.document.body).display, w.a.innerText, w.document.getAnimations().length, w.document.activeElement.id, w.scrollY,
          (w.i.animate({ order: [7, 7] }, 9000), w.getComputedStyle(w.i).order), w.i.getAnimations()[0].cancel()]))(frames[0])\`;
        const display = value => contents.executeJavaScript("document.querySelector('iframe').style.display = '" + value + "'; " + look);
        print([await contents.executeJavaScript(look), asked]);
        print(await display(""));
        await contents.executeJavaScript("frames[0].scrollTo(0, 100); frames[0].i.blur()");
        print(await display("none"));
        print(await display(""));
      `),
    ).toEqual([
      [[0, 0, "40px", "flex", "block", "a  b", 0, "", 0, "7", null], []],
      [300, 40, "40px", "flex", "block", "a b", 1, "i", 0, "7", null],
      [300, 0, "40px", "flex", "block", "a  b", 0, "", 0, "7", null],
      [300, 40, "40px", "flex", "block", "a b", 1, "i", 100, "7", null],
    ]);
  });

  test("webFrame knows the frames of its origin", async () => {
    expect(
      await run(
        `app.trustOrigins(["app://other"], { inFrames: true });
         serve({ "/": "<iframe name=a src=/in></iframe><iframe id=b name=b src=/in></iframe><iframe id=c src=app://other/in></iframe>", "/in": "<title>in</title>" });
         const heard = new Set();
         ipcMain.on("top", (event, isTop) => heard.add(String(isTop)));
         const page = await open(undefined, { webPreferences: { ...preload.webPreferences, nodeIntegrationInSubFrames: true } });
         print([...heard].sort());
         print(await page.executeJavaScript("look()"));`,
        {
          "preload.js": `const { contextBridge, ipcRenderer, webFrame } = require("electron");
            ipcRenderer.send("top", webFrame.top ? webFrame.top.frameToken === webFrame.frameToken : null);
            const name = frame => frame && frame.executeJavaScript("name");
            contextBridge.exposeInMainWorld("look", () => Promise.all([
              webFrame.parent, webFrame.firstChild, webFrame.firstChild.nextSibling, webFrame.firstChild.nextSibling.nextSibling, webFrame.firstChild.parent,
              webFrame.findFrameByName("b"), webFrame.getFrameForSelector("#b"), webFrame.getFrameForSelector("#c"), webFrame.getFrameForSelector("body"),
              webFrame.findFrameByToken(webFrame.firstChild.frameToken), webFrame.findFrameByRoutingId(webFrame.firstChild.routingId),
            ].map(name)));`,
        },
      ),
    ).toEqual([
      ["false", "null", "true"],
      [null, "a", "b", null, "", "b", "b", null, null, "a", "a"],
    ]);
  });

  test("a page is visible until its window is hidden, or for good if it is not throttled", async () => {
    expect(
      await run(`
        serve({ "/": "<script>log = [document.visibilityState]; document.onvisibilitychange = () => log.push(document.visibilityState)</script>" });
        const log = page => page.executeJavaScript("new Promise(resolve => setTimeout(resolve)).then(() => log.join())");
        const frames = page => page.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))).then(() => 3)");
        const unshown = await open(undefined, { show: false });
        print([await frames(unshown), await log(unshown), unshown.mainFrame.visibilityState, unshown.getBackgroundThrottling()]);
        unshown.getOwnerBrowserWindow().hide();
        print([await log(unshown), unshown.mainFrame.visibilityState]);
        unshown.setBackgroundThrottling(false);
        print([await frames(unshown), await log(unshown), unshown.backgroundThrottling]);
        unshown.setBackgroundThrottling(true);
        print(await log(unshown));
        print(await log(await open(undefined, { show: false, paintWhenInitiallyHidden: false })));
        const eager = await open(undefined, { webPreferences: { backgroundThrottling: false } });
        eager.getOwnerBrowserWindow().hide();
        print([await frames(eager), await log(eager)]);
        const view = new WebContentsView();
        new BrowserWindow().contentView.addChildView(view);
        await view.webContents.loadURL("app://trusted/");
        view.setBounds({ x: 0, y: 0, width: 9, height: 9 });
        print(await log(view.webContents));`),
    ).toEqual([
      [3, "visible", "visible", true],
      ["visible,hidden", "hidden"],
      [3, "visible,hidden,visible", false],
      "visible,hidden,visible,hidden",
      "hidden",
      [3, "visible"],
      "hidden,visible",
    ]);
  });

  test("nothing runs in place of a page that has crashed, and a frame that is gone cannot be read", async () => {
    const gone = "Render frame was disposed before WebFrameMain could be accessed";
    expect(
      await run(`
        app.trustOrigins([], { inFrames: true });
        serve({ "/": "<iframe src=/in></iframe>", "/in": "a" });
        const page = await open();
        const [frame] = page.mainFrame.frames;
        await page.executeJavaScript("document.querySelector('iframe').remove()");
        while (!frame.isDestroyed()) await new Promise(setImmediate);
        const read = name => { try { return typeof frame[name]; } catch (error) { return error.message; } };
        print(["url", "origin", "parent", "routingId", "detached", "frameTreeNodeId"].map(read));
        page.forcefullyCrashRenderer();
        const failure = promise => promise.then(() => "", error => error.message);
        print(await Promise.all([page.executeJavaScript("1"), page.insertCSS("a{}"), page.insertText("a")].map(failure)));
        page.selectAll();
        page.sendInputEvent({ type: "mouseDown", x: 1, y: 1 });
        page.setZoomFactor(2);
        print([(await page.capturePage()).isEmpty(), page.getOSProcessId(), page.mainFrame.origin, page.isCrashed()]);
        page.reload();
        await once(page, "did-finish-load");
        print([await page.executeJavaScript("origin"), page.getZoomFactor()]);`),
    ).toEqual([
      [gone, gone, gone, gone, "boolean", "number"],
      [gone, gone, gone],
      [true, 0, "", true],
      ["app://trusted", 1],
    ]);
  });

  test("insertCSS() goes before the sheets of the page, or has the origin of the user", async () => {
    expect(
      await run(`
        serve({ "/": "<style>p { order: 2 } b { order: 2 !important } i { order: revert }</style><p>a</p><b class=c>b</b><i>c</i><div><template shadowrootmode=open><s class=c></s></template></div>" });
        const page = await open();
        const look = () => page.executeJavaScript("[...document.body.children, document.querySelector('div').shadowRoot.firstChild].map(it => getComputedStyle(it).order).join('')");
        const author = await page.insertCSS("p, i, s { order: 1 }");
        print(await look());
        await page.removeInsertedCSS(author);
        const user = await page.insertCSS("p, i { order: 1 } .c { order: 3 !important }", { cssOrigin: "user" });
        print(await look());
        await page.executeJavaScript("document.querySelector('p').className = 'c'");
        print(await look());
        await page.removeInsertedCSS(user);
        print(await look());`),
    ).toEqual(["22000", "23103", "33103", "22000"]);
  });

  test("the preferences for fonts, text areas and encodings", async () => {
    expect(
      await run(`
        serve({ "/": "<!doctype html><p style=width:10em>a</p><code>b</code><textarea></textarea>" });
        const look = \`(([p, code, area], size = (it, value) => (it.style.fontSize = value, getComputedStyle(it).fontSize)) =>
          [size(p, ""), size(code, ""), size(p, "small"), size(code, "small"), size(p, "2rem"), size(p, "0.2em"), getComputedStyle(p).width, size(p, "3px"), size(p, "0"),
           getComputedStyle(p).fontFamily, getComputedStyle(area).resize, matchMedia("(min-width: 21em)").matches].join(" "))(document.body.children)\`;
        print(await (await open()).executeJavaScript(look));
        print(await (await open(undefined, { webPreferences: { zoomFactor: 2 } })).executeJavaScript(\`((it, context) => [
          ...["font-size: 0.2em", "font-size: 0.2em; zoom: 2", "zoom: 0.25", "font-size: calc(0.1em)"].map(css => (it.style.cssText = css, getComputedStyle(it).fontSize)),
          (context.font = "small monospace", context.font)].join(" "))(document.body.firstChild, document.createElement("canvas").getContext("2d"))\`));
        const webPreferences = { defaultFontSize: 20, defaultMonospaceFontSize: 11, minimumFontSize: 9, defaultFontFamily: { standard: "A" }, textAreasAreResizable: false };
        print(await (await open(undefined, { webPreferences })).executeJavaScript(look));
        const server = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array([0xc3, 0xa9]), { headers: { "content-type": "text/html" } }) });
        app.trustOrigins([server.url.origin]);
        print(await (await open(server.url.href, { webPreferences: { defaultEncoding: "UTF-8" } })).executeJavaScript("document.body.textContent"));`),
    ).toEqual([
      expect.stringMatching(/^16px 13px 13px 12px 32px 6px 32px 3px 0px .* both true$/),
      "6px 6px 16px 1.6px 12px monospace",
      "20px 11px 17.8px 10px 40px 9px 40px 9px 0px A none false",
      "é",
    ]);
  });

  test("a page reports its cursor, theme color, preferred size and frames", async () => {
    expect(
      await run(`
        serve({ "/": "<!doctype html><body style=margin:0><a href=/ style='display:block;width:50px;height:40px'></a>" });
        const page = await open(undefined, { useContentSize: true, webPreferences: { enablePreferredSizeMode: true } });
        const after = async (event, act) => { const heard = once(page, event); await act(); return (await heard)[1]; };
        const move = (x, y) => () => page.sendInputEvent({ type: "mouseMove", x, y });
        const run = code => () => page.executeJavaScript(code);
        print([await after("cursor-changed", move(5, 5)), await after("cursor-changed", move(200, 200))]);
        print(await after("cursor-changed", run("document.documentElement.style.cursor = 'crosshair'")));
        print([
          await after("did-change-theme-color", run("document.head.innerHTML = '<meta name=theme-color content=no><meta name=theme-color content=red>'")),
          await after("did-change-theme-color", run("document.head.innerHTML = ''")),
        ]);
        print(await after("preferred-size-changed", run("document.links[0].style.width = '70px'")));
        const frame = await new Promise(resolve => page.beginFrameSubscription((image, dirty) => resolve([image.getSize(), dirty])));
        page.endFrameSubscription();
        print(frame);
        page.enableDeviceEmulation({ screenSize: { width: 500, height: 600 }, viewSize: { width: 200, height: 100 }, deviceScaleFactor: 2 });
        print(await page.executeJavaScript("[innerWidth, innerHeight, devicePixelRatio, screen.width]"));
        page.disableDeviceEmulation();
        print(await page.executeJavaScript("[innerWidth, innerHeight, devicePixelRatio]"));`),
    ).toEqual([
      ["hand", "pointer"],
      "crosshair",
      ["#FF0000", null],
      { width: 70, height: 40 },
      [
        { width: 400, height: 300 },
        { x: 0, y: 0, width: 400, height: 300 },
      ],
      [200, 100, 2, 500],
      [400, 300, 1],
    ]);
  });

  test("what has happened to a window does not wait for the timers of its page", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open(), window = BrowserWindow.fromWebContents(page), order = [], due = new Int32Array(new SharedArrayBuffer(4));
        window.on("resize", () => order.push("resize"));
        page.on("console-message", ({ message }) => {
          order.push(message);
          if (message !== "task") return;
          window.setSize(310, 300);
          window.isMinimized();
          Atomics.wait(due, 0, 0, 2);
        });
        await page.executeJavaScript("new Promise(resolve => { setTimeout(() => resolve(console.log('timer')), 1); console.log('task'); })");
        while (order.length < 3) await new Promise(setImmediate);
        print(order);`),
    ).toEqual([["task", "resize", "timer"]]);
  });

  test("scrollToBottom(), adjustSelection(), clone() and getLastWebPreferences()", async () => {
    expect(
      await run(`
        serve({ "/": "<p id=p style=height:3000px>hello world", "/b": "b" });
        const page = await open(undefined, { webPreferences: { nodeIntegration: true, partition: undefined } });
        page.scrollToBottom();
        print(await page.executeJavaScript("scrollY > 2000"));
        page.scrollToTop();
        await page.executeJavaScript("getSelection().setBaseAndExtent(p.firstChild, 2, p.firstChild, 5)");
        page.adjustSelection({ start: -1, end: 3 });
        print(await page.executeJavaScript("[scrollY, String(getSelection()), document.queryCommandSupported('paste')]"));
        const { sandbox, nodeIntegration, webSecurity, webviewTag } = page.getLastWebPreferences();
        print([sandbox, nodeIntegration, webSecurity, webviewTag]);
        await page.loadURL("app://trusted/b");
        const copy = page.clone();
        await once(copy, "did-finish-load");
        print([copy.getURL(), copy.navigationHistory.length()]);`),
    ).toEqual([true, [0, "ello wo", false], [false, true, true, false], ["app://trusted/b", 2]]);
  });

  test("a window that does not paint while it is hidden is ready once it is shown", async () => {
    expect(
      await run(`
        serve({ "/": "a" });
        const window = new BrowserWindow({ show: false, paintWhenInitiallyHidden: false });
        window.once("ready-to-show", () => print(window.isVisible()));
        await Promise.all([once(window.webContents, "ready-to-show"), window.loadURL("app://trusted/")]);
        window.show();`),
    ).toEqual([true]);
  });

  test("savePage()", async () => {
    const [failures, only, complete, files, archive] = await run(`
      const fs = require("fs");
      const source = "<!doctype html><title>t</title><link rel=stylesheet href=/s.css><script src=/a/x.js></script><img src=/b/x.js><a href=/next>é</a>";
      serve({ "/": source, "/s.css": "a { background: url(i.png) }", "/a/x.js": "document.title = 'u'", "/b/x.js": "", "/i.png": "png" });
      const page = await open();
      const file = name => path.join(__dirname, "saved", name);
      print(await Promise.all([page.savePage("a.html", "HTMLOnly"), page.savePage(file("a.html"), "no")].map(it => it.catch(error => error.message))));
      await page.savePage(file("only.html"), "HTMLOnly");
      print(fs.readFileSync(file("only.html"), "utf8") === source);
      await page.savePage(file("all.html"), "HTMLComplete");
      print(fs.readFileSync(file("all.html"), "utf8"));
      print(fs.readdirSync(file("all_files")).sort());
      await page.savePage(file("all.mhtml"), "MHTML");
      print(fs.readFileSync(file("all.mhtml"), "utf8").match(/(?<=^Content-Location: ).*/gm));`);
    expect(failures).toEqual([
      "Path must be absolute",
      "Error processing argument at index 1, conversion failure from no",
    ]);
    expect(only).toBe(true);
    expect(complete).toEndWith(
      `<title>u</title><link rel="stylesheet" href="./all_files/s.css"><script src="./all_files/x.js"></script></head><body><img src="./all_files/(2)x.js"><a href="app://trusted/next">é</a></body></html>`,
    );
    expect(files).toContain("x.js");
    expect(archive).toEqual(expect.arrayContaining(["app://trusted/", "app://trusted/s.css", "app://trusted/i.png"]));
  });

  test("savePage() fetches for a frame what the frame may fetch", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        const asked = [];
        const note = (body, type) => request => (asked.push(new URL(request.url).pathname), new Response(body, { headers: { "content-type": type } }));
        const headers = { "content-type": "text/html", "content-security-policy": "img-src 'none'" };
        serve({
          "/": "<iframe src=/frame></iframe><img src=/both.png>",
          "/frame": () => new Response("<link rel=stylesheet href=/s.css><img src=/both.png><img src=/refused.png>", { headers }),
          "/s.css": note("a { background: url(/indirect.png) }", "text/css"),
          "/both.png": note("", "image/png"),
          "/refused.png": note("", "image/png"),
          "/indirect.png": note("", "image/png"),
        });
        const page = await open("app://trusted/#--><b>");
        for (const kind of ["HTMLComplete", "MHTML"]) {
          asked.length = 0;
          await page.savePage(path.join(__dirname, kind), kind);
          print(asked.sort());
        }
        print(require("fs").readFileSync(path.join(__dirname, "HTMLComplete"), "utf8").split("\\n")[1]);`),
    ).toEqual([
      ["/both.png", "/s.css"],
      ["/both.png", "/s.css"],
      "<!-- saved from url=(0029)app://trusted/#-%2D%3E%3Cb%3E -->",
    ]);
  });

  test("an archive of a page has an end if its style sheets have none", async () => {
    expect(
      await run(`
        protocol.handle("app", ({ url }) =>
          url.includes(".css")
            ? new Response("a { background: url(/" + (parseInt(url.split("/")[3]) + 1) + ".css) }", { headers: { "content-type": "text/css" } })
            : new Response("<link rel=stylesheet href=/0.css>", { headers: { "content-type": "text/html" } }),
        );
        const page = await open();
        await page.savePage(path.join(__dirname, "a.mhtml"), "MHTML");
        print(require("fs").readFileSync(path.join(__dirname, "a.mhtml"), "utf8").match(/^Content-Location/gm).length);`),
    ).toEqual([2002]);
  });

  test("a blob: URL is shown in a window if it cannot run scripts", async () => {
    expect(
      await run(`
        app.setWebEngine(null);
        serve({ "/": "a" });
        const page = await open();
        const go = async (type, event) => {
          await page.loadURL("app://trusted/");
          const arrived = once(page, event);
          await page.executeJavaScript("void (location = URL.createObjectURL(new Blob(['<script>document.title = 1</scr' + 'ipt>'], { type: '" + type + "' })))");
          return (await arrived)[2];
        };
        await go("text/plain", "did-finish-load");
        print([page.getURL().slice(0, 19), await page.executeJavaScript("[document.contentType, document.title]")]);
        print([await go("text/html", "did-fail-load"), await go("image/svg+xml", "did-fail-load")]);`),
    ).toEqual([
      ["blob:app://trusted/", ["text/plain", ""]],
      ["ERR_BLOCKED_BY_CLIENT", "ERR_BLOCKED_BY_CLIENT"],
    ]);
  });

  test("pages have the members of the web, and their own blob: URLs", async () => {
    const [result] = await run(`
      serve({ "/": "" });
      const page = await open();
      print(await page.executeJavaScript(\`(async () => {
        "use strict";
        const names = it => Object.getOwnPropertyNames(it.prototype).sort().join(" ");
        const url = URL.createObjectURL(new Blob(["x"]));
        const worker = new Worker(URL.createObjectURL(new Blob(["postMessage(URL.createObjectURL(new Blob(['y'])))"])));
        const ofWorker = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
        const read = it => fetch(it).then(response => response.text(), () => null);
        const before = await read(ofWorker);
        worker.terminate();
        while ((await read(ofWorker)) !== null);
        return [
          names(Blob), names(Crypto), "text" in ReadableStream.prototype, "toJSON" in URLSearchParams.prototype,
          Object.keys(Object.assign(new Blob(), { name: "a", lastModified: 1 })), delete Blob.prototype.stream,
          url.slice(0, -36), await read(url), before,
        ];
      })()\`));`);
    expect(result).toEqual([
      "arrayBuffer bytes constructor size slice stream text type",
      "constructor getRandomValues randomUUID",
      false,
      false,
      ["name", "lastModified"],
      true,
      "blob:app://trusted/",
      "x",
      "y",
    ]);
  });

  test("Blob, File and FileReader convert their arguments as a browser does", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          const thrown = run => { try { run() } catch (error) { return error.name } };
          const file = new File(new Set(["a\\\\r", null]), "x/y", { type: "A/B", endings: "native", lastModified: 1.9 });
          const reader = new FileReader();
          const events = [];
          for (const type of ["loadstart", "progress", "load"]) reader.addEventListener(type, event => events.push(type, event.loaded));
          reader.readAsDataURL(file.slice("-4", undefined, null));
          await new Promise(resolve => reader.onloadend = resolve);
          return [
            [file.name, file.type, file.lastModified, Object.getPrototypeOf(File) === Blob, structuredClone(file) instanceof File],
            [file.slice() instanceof File, new Blob([file]).type, thrown(() => new Blob("a")), thrown(() => File.prototype.name)],
            [events, reader.result],
          ];
        })()\`));`),
    ).toEqual([
      [
        ["x/y", "a/b", 1, true, true],
        [false, "", "TypeError", "TypeError"],
        [["loadstart", 0, "progress", 4, "load", 4], "data:null;base64,bnVsbA=="],
      ],
    ]);
  });

  test("the console and what a page leaves uncaught", async () => {
    expect(
      await run(`
        serve({ "/": "<script src=/a.js></script>", "/a.js": \`
          console.log("%s|%d|%f|%c|%%|%x|%s", "a", "12.7px", "1.5e3x", "color: red", Symbol("s"), null);
          console.assert(false), console.assert(true), console.count(), console.count(), console.countReset(), console.count("a");
          console.warn(Object.create(null));
          onunhandledrejection = ({ promise, reason }) => reason === 1 ? false : void setTimeout(() => promise.catch(() => {}));
          onrejectionhandled = ({ reason }) => console.debug("handled", reason);
          Promise.reject(1), Promise.reject(2), Promise.reject(3).catch(() => {});
          (function deeper() { try { deeper(); } catch {} navigator.onLine; })();
          throw 4;\` });
        const { webContents } = new BrowserWindow();
        const done = Promise.withResolvers();
        webContents.on("console-message", ({ level, message, lineNumber, sourceId }) => {
          print([level, message, lineNumber, sourceId]);
          if (level === "debug") done.resolve();
        });
        webContents.loadURL("app://trusted/");
        await done.promise;`),
    ).toEqual(
      [
        ["info", "a|12|1500||%|%x|Symbol(s) null", 2],
        ["error", "Assertion failed: console.assert", 3],
        ["info", "default: 1", 3],
        ["info", "default: 2", 3],
        ["info", "a: 1", 3],
        ["warning", "[object Object]", 4],
        ["error", "Uncaught 4", 9],
        ["error", "Uncaught (in promise) 2", 0],
        ["debug", "handled 2", 6],
      ].map(it => [...it, it[2] ? "app://trusted/a.js" : ""]),
    );
  });

  test.each([
    "",
    "Error.stackTraceLimit = 0",
    "Error.prepareStackTrace = error => (seen.push(error.message), ' at (app://trusted/:1:1)')",
  ])("the errors of a script of another origin are muted: %p", async trick => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted", "app://other"]);
        const scripts = ["a secret", "throw new Error('secret')", "setTimeout(() => { throw 'secret' })", "Promise.reject('secret')", "(async () => secret)()"];
        serve(Object.fromEntries([["/", ""], ...scripts.map((it, index) => ["/" + index + ".js", it])]));
        print(await (await open()).executeJavaScript(\`(async () => {
          const seen = [];
          onerror = message => (seen.push(message), true);
          onunhandledrejection = event => (seen.push(event.reason), false);
          ${trick};
          for (let index = 0; index < 5; index++) {
            const script = Object.assign(document.createElement("script"), { src: "app://other/" + index + ".js" });
            await new Promise(resolve => document.head.appendChild(script).onload = resolve);
          }
          await new Promise(resolve => {
            addEventListener("unhandledrejection", resolve);
            setTimeout(() => Promise.reject("last"));
          });
          return seen;
        })()\`));`),
    ).toEqual([["Script error.", "Script error.", "Script error.", "last"]]);
  });

  test("web workers", async () => {
    expect(
      await run(`
        serve({
          "/": "",
          "/module.js": \`import { n } from "./dependency.js";
            onmessage = async ({ data }) => {
              const inherited = [];
              for (const key in {}) inherited.push(key);
              postMessage([data + n, typeof process, typeof document, location.href, inherited, await (await fetch("/data.json")).json()]);
            };\`,
          "/dependency.js": "export const n = 1",
          "/classic.js": "importScripts('/imported.js'); postMessage(imported); missing();",
          "/imported.js": "var imported = performance.now() >= 0 && 5",
          "/data.json": "[2]",
        });
        const page = await open();
        print(await page.executeJavaScript(\`new Promise(resolve => {
          const worker = new Worker("/module.js", { type: "module" });
          worker.onmessage = event => resolve(event.data);
          worker.postMessage(1);
        })\`));
        print(await page.executeJavaScript(\`(worker => Promise.all([
          new Promise(resolve => worker.onmessage = event => resolve(event.data)),
          new Promise(resolve => worker.onerror = event => resolve(event.filename)),
        ]))(new Worker("/classic.js"))\`));`),
    ).toEqual([
      [2, "undefined", "undefined", "app://trusted/module.js", [], [2]],
      [5, "app://trusted/classic.js"],
    ]);
  });

  test("what a page stores, clones and uploads", async () => {
    expect(
      await run(`
        serve({ "/": "", "/echo": async request => Response.json([...(await request.formData())].map(([name, file]) => [name, file.name, file.size])) });
        const page = await open();
        print(await page.executeJavaScript(\`(\${async () => {
          const thrown = run => { try { run(); } catch (error) { return error.name; } };
          const form = new FormData();
          form.append("a", new Blob(["12"]));
          const order = [];
          await Promise.all(["background", "user-visible", "user-blocking"].map(priority => scheduler.postTask(() => order.push(priority), { priority })));
          return [
            thrown(() => localStorage.setItem("big", "x".repeat(6 << 20))),
            thrown(() => structuredClone(document.body)),
            thrown(() => history.pushState(new Event("a"), "")),
            await (await fetch("/echo", { method: "POST", body: form })).json(),
            order,
            Origin.from("https://a.example.com").isSameSite(Origin.from(new URL("https://b.example.com"))),
          ];
        }})()\`));`),
    ).toEqual([
      [
        "QuotaExceededError",
        "DataCloneError",
        "DataCloneError",
        [["a", "blob", 2]],
        ["user-blocking", "user-visible", "background"],
        true,
      ],
    ]);
  });

  test("the order of scripts, their microtasks and their events", async () => {
    expect(
      await run(`
        const script = name => "log.push('" + name + "'); Promise.resolve().then(() => log.push('microtask'))";
        serve({
          "/": "<script>log = []</script><script src=/a.js onload=log.push('load')></script><script type=module src=/b.js onload=log.push('load')></script>",
          "/a.js": script("classic"),
          "/b.js": script("module"),
        });
        print(await (await open()).executeJavaScript("log"));`),
    ).toEqual([["classic", "microtask", "load", "module", "microtask", "load"]]);
  });

  test("refresh, beforeunload and traversals that add up", async () => {
    expect(
      await run(`
        serve({ "/": "<meta http-equiv=refresh content='0; url=/next'><script>onbeforeunload = () => console.log('beforeunload')</script>", "/next": "" });
        const page = await open();
        page.on("console-message", event => print(event.message));
        await new Promise(resolve => page.once("did-finish-load", resolve));
        print(await page.executeJavaScript(\`new Promise(resolve => {
          for (const hash of "abc") location.hash = hash;
          onhashchange = () => location.hash === "#a" && resolve(location.pathname + history.length);
          history.back();
          history.back();
        })\`));`),
    ).toEqual(["beforeunload", "/next4"]);
  });

  test("a window that a script closes is there for the tasks that were queued before", async () => {
    expect(
      await run(
        `app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
         serve({ "/": "<a href=/popup target=popup>", "/popup": "<script>new BroadcastChannel('a').postMessage(0); close();</script>" });
         const page = await open();
         print(await page.executeJavaScript(\`new Promise(done => {
           const popup = open("", "popup");
           new BroadcastChannel("a").onmessage = () => done([popup.closed, popup.opener === window]);
           document.links[0].click();
         })\`));`,
      ),
    ).toEqual([[true, true]]);
  });

  test("frames only go back to what they showed when the history is traversed", async () => {
    expect(
      await run(
        `app.trustOrigins(["app://trusted"], { inFrames: true, injectedScripts: true });
         let count = 0;
         serve({ "/": () => new Response("<iframe src=/" + ++count + "></iframe>", { headers: { "content-type": "text/html" } }), "/1": "1", "/2": "2", "/3": "3", "/4": "4", "/other": "" });
         const page = await open();
         const shown = async () => print(new URL(page.mainFrame.frames[0].url).pathname);
         const loaded = act => new Promise(done => (page.once("did-finish-load", done), act()));
         await shown();
         await page.loadURL(page.getURL());
         await shown();
         await loaded(() => page.reload());
         await shown();
         await page.loadURL(page.getURL() + "other");
         await loaded(() => page.navigationHistory.goBack());
         await shown();`,
      ),
    ).toEqual(["/1", "/2", "/3", "/3"]);
  });

  test("window.open", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        const page = await open();
        page.setWindowOpenHandler(({ url, frameName }) => (print([url, frameName]), { action: frameName ? "allow" : "deny" }));
        print(await page.executeJavaScript("window.open('https://example.com/')"));
        const created = once(page, "did-create-window");
        print(await page.executeJavaScript(\`
          popup = window.open("about:blank", "name", "width=200,height=100");
          popup.document.body.append(document.createElement("p"));
          [popup.opener === window, popup.document.body.innerHTML]\`));
        const [window] = await created;
        print([window.getSize(), await window.webContents.executeJavaScript("document.body.innerHTML")]);
        window.close();
        await once(window, "closed");
        print(await page.executeJavaScript("popup.closed"));
        page.once("did-create-window", window => window.webContents.once("will-navigate", event => {
          event.preventDefault();
          app.emit("refused", event.url);
        }));
        page.executeJavaScript("window.open('app://other/', 'other', 'noopener')");
        print(await once(app, "refused"));`),
    ).toEqual([
      ["https://example.com/", ""],
      null,
      ["about:blank", "name"],
      [true, "<p></p>"],
      [[200, 100], "<p></p>"],
      true,
      ["app://other/", "other"],
      ["app://other/"],
    ]);
  });

  test("views, zoom, input and capturePage", async () => {
    expect(
      await run(`
        serve({ "/": "<!doctype html><body style='margin:0;background:#f00'><input autofocus style='width:50px'>" });
        const window = new electron.BaseWindow({ width: 400, height: 300 });
        const view = new WebContentsView();
        window.contentView.addChildView(view);
        view.setBounds({ x: 10, y: 10, width: 200, height: 100 });
        const page = view.webContents;
        await page.loadURL("app://trusted/");
        print(await page.executeJavaScript("[innerWidth, innerHeight]"));
        const scale = await page.executeJavaScript("devicePixelRatio");
        page.setZoomFactor(2);
        print(await page.executeJavaScript("[innerWidth, innerHeight, devicePixelRatio / " + scale + "]"));
        page.on("before-input-event", (event, input) => input.key === "b" && event.preventDefault());
        page.focus();
        await page.executeJavaScript("typed = []; onkeydown = event => typed.push(event.key); document.querySelector('input').focus()");
        for (const keyCode of ["a", "b"]) page.sendInputEvent({ type: "keyDown", keyCode });
        page.sendInputEvent({ type: "char", keyCode: "a" });
        print(await page.executeJavaScript("[typed, document.activeElement.value]"));
        const image = await page.capturePage({ x: 190, y: 90, width: 2, height: 1 });
        print([Object.values(image.getSize()).map(it => it / scale), [...image.toBitmap().subarray(0, 8)]]);
        page.findInPage("nothing");
        print((await once(page, "found-in-page"))[1].matches);
        page.close();
        print([page.isDestroyed(), electron.webContents.getAllWebContents().length]);`),
    ).toEqual([
      [200, 100],
      [100, 50, 2],
      [["a"], "a"],
      [
        [2, 1],
        [0, 0, 255, 255, 0, 0, 255, 255],
      ],
      0,
      [true, 0],
    ]);
  });

  test("closing a window asks the page", async () => {
    expect(
      await run(`
        serve({ "/": "<script>onbeforeunload = event => event.preventDefault()</script>" });
        app.on("window-all-closed", () => print("all closed"));
        const page = await open();
        const window = BrowserWindow.fromWebContents(page);
        app.quit();
        await once(page, "will-prevent-unload");
        print(window.isDestroyed());
        page.once("will-prevent-unload", event => event.preventDefault());
        window.close();
        print(window.isDestroyed());
        await once(window, "closed");`),
    ).toEqual([false, false, "all closed"]);
  });

  test("the frames of a window by their indices", async () => {
    const script = `[length, Object.keys(window).filter(it => +it >= 0), window[0] === a.contentWindow, window[1] === b.contentWindow, 2 in window,
      Reflect.set(window, 2, 1), Reflect.defineProperty(window, 0, { value: 1 }), Reflect.deleteProperty(window, 0), Reflect.deleteProperty(window, 2),
      window[0].inPage]`;
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({ "/": "<iframe id=a src=/f></iframe><iframe id=b></iframe>", "/f": "<script>inPage = 1</script>" });
        const page = await open();
        print(await page.executeJavaScript(${JSON.stringify(script)}));
        print(await page.executeJavaScriptInIsolatedWorld(1, [{ code: ${JSON.stringify(script)} }]));
        print(await page.executeJavaScript("a.remove(), [length, window[0] === b.contentWindow, 1 in window]"));`),
    ).toEqual([
      [2, ["0", "1"], true, true, false, false, false, false, true, 1],
      [2, ["0", "1"], true, true, false, false, false, false, true, null],
      [1, true, false],
    ]);
  });

  test.each([
    ["en-US", "en-US", "2024-01-02"],
    ["de-AT", "de", "2024-02-01"],
    ["es-MX", "es-419", "2024-02-01"],
    ["en-001", isMacOS ? "en-US" : "en-GB", isMacOS ? "2024-01-02" : "2024-02-01"],
  ])("the fields of a date are in the order of the locale of the app: %s", async (lang, locale, value) => {
    expect(
      await run(
        `serve({ "/": "<input type=date autofocus>" });
         require("electron").session.defaultSession.setUserAgent("a", "ja");
         const page = await open();
         await page.executeJavaScript("document.body.firstChild.focus()");
         for (const keyCode of "01022024") for (const type of ["keyDown", "keyUp"]) page.sendInputEvent({ type, keyCode });
         print([app.getLocale(), await page.executeJavaScript("document.body.firstChild.value")]);`,
        {},
        ["--lang=" + lang],
      ),
    ).toEqual([[locale, value]]);
  });

  test("the files that are chosen for an input", async () => {
    expect(
      await run(
        `serve({ "/": "<input type=file multiple>" });
         const page = await open(undefined, preload);
         page.debugger.attach();
         const { result } = await page.debugger.sendCommand("Runtime.evaluate", { expression: "document.body.firstChild" });
         await page.debugger.sendCommand("DOM.setFileInputFiles", { objectId: result.objectId, files: [__dirname + "/a.txt", __dirname] });
         const [path, ...rest] = await page.executeJavaScript("look()");
         print([path === __dirname + "/a.txt", ...rest]);`,
        {
          "a.txt": "abc",
          "preload.js": `const { contextBridge, webUtils } = require("electron");
            contextBridge.exposeInMainWorld("look", async () => {
              const { files } = document.querySelector("input");
              const data = new DataTransfer();
              for (const file of files) data.items.add(file);
              const entries = Array.from(data.items, it => it.webkitGetAsEntry());
              return [webUtils.getPathForFile(files[0]), webUtils.getPathForFile(new File([], "b")), files[0].name, files[0].type, await files[0].text(),
                entries.map(it => [String(it), it.isFile, it.isDirectory]), entries[0].fullPath,
                await new Promise(resolve => entries[0].file(it => resolve(it.name)))];
            });`,
        },
      ),
    ).toEqual([
      [
        true,
        "",
        "a.txt",
        "text/plain",
        "abc",
        [
          ["[object FileSystemFileEntry]", true, false],
          ["[object FileSystemDirectoryEntry]", false, true],
        ],
        "/a.txt",
        "a.txt",
      ],
    ]);
  });

  test("the keys of sendInputEvent() are those of a US keyboard", async () => {
    expect(
      await run(`
        serve({ "/": "<script>onkeydown = e => window.seen = [e.key, e.code, e.keyCode, e.location, e.shiftKey, e.getModifierState('CapsLock')].join()</script>" });
        const page = await open();
        for (const [keyCode, ...modifiers] of [["="], ["=", "shift"], ["Plus"], ["["], ["1", "shift"], ["=", "meta", "right"], ["A"], ["a", "capsLock"], ["Shift", "left"], ["Cmd"], ["num5"], ["numadd", "isKeypad"], ["VolumeUp"], ["\\t"], ["nonsense"]]) {
          page.sendInputEvent({ type: "keyDown", keyCode, modifiers });
          print(await page.executeJavaScript("seen"));
        }`),
    ).toEqual([
      "=,Equal,187,0,false,false",
      "+,Equal,187,0,true,false",
      "+,Equal,187,0,true,false",
      "[,BracketLeft,219,0,false,false",
      "!,Digit1,49,0,true,false",
      "=,Equal,187,2,false,false",
      "a,KeyA,65,0,false,false",
      "A,KeyA,65,0,false,true",
      "Shift,ShiftLeft,16,1,false,false",
      "Meta,MetaLeft,91,0,false,false",
      "5,Numpad5,101,0,false,false",
      "+,NumpadAdd,107,3,false,false",
      "AudioVolumeUp,AudioVolumeUp,175,0,false,false",
      "Tab,Tab,9,0,false,false",
      ",,0,0,false,false",
    ]);
  });

  test("Tab goes through a frame", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        serve({ "/": "<input id=a><iframe id=f src=/f></iframe><input id=d>", "/f": "<input id=b><input id=c>" });
        const page = await open();
        page.debugger.attach();
        await page.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        for (const modifiers of [[], [], [], [], ["shift"]]) {
          for (const type of ["keyDown", "keyUp"]) page.sendInputEvent({ type, keyCode: "Tab", modifiers });
          print(await page.executeJavaScript("document.activeElement.id + f.contentDocument.activeElement.id + document.querySelector(':focus')?.id"));
        }`),
    ).toEqual(["aa", "fbundefined", "fcundefined", "dd", "fcundefined"]);
  });

  test("the DevTools protocol", async () => {
    expect(
      await run(
        `serve({ "/": "<!doctype html><button onclick='clicked = 1' style='width:50px;height:50px'>" }, {});
         const page = await open();
         const [port] = require("fs").readFileSync(path.join(app.getPath("userData"), "DevToolsActivePort"), "utf8").split("\\n");
         const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
         print(list.map(target => target.url));
         print((await fetch("http://127.0.0.1:" + port + "/json/list", { headers: { origin: "https://example.com" } })).status);
         page.debugger.attach();
         for (const type of ["mousePressed", "mouseReleased"]) {
           await page.debugger.sendCommand("Input.dispatchMouseEvent", { type, x: 20, y: 20, button: "left", clickCount: 1 });
         }
         print(await page.debugger.sendCommand("Runtime.evaluate", { expression: "clicked" }));
         print(await page.debugger.sendCommand("Unknown.method").catch(error => error.message));`,
        {},
        ["--remote-debugging-port=0"],
      ),
    ).toEqual([["app://trusted/"], 403, { result: { type: "number", value: 1 } }, "'Unknown.method' wasn't found"]);
  });

  test("what the debugger runs may evaluate strings, whatever the policy of the page", async () => {
    expect(
      await run(`
        serve({ "/": "" }, { "content-security-policy": "script-src 'self'; require-trusted-types-for 'script'" });
        const page = await open();
        page.debugger.attach();
        const value = async (method, params) => (await page.debugger.sendCommand(method, params)).result.value;
        const { result } = await page.debugger.sendCommand("Runtime.evaluate", { expression: "window" });
        print(await value("Runtime.evaluate", { expression: "eval('1 + 1')" }));
        print(await value("Runtime.callFunctionOn", { objectId: result.objectId, functionDeclaration: "function () { return this.eval('2 + 2') }" }));
        print(await page.executeJavaScript("try { eval('3') } catch (error) { error.name }"));`),
    ).toEqual([2, 4, "EvalError"]);
  });

  test("the DevTools protocol: objects, worlds and requests over a WebSocket", async () => {
    expect(
      await run(
        `serve({ "/": "<!doctype html><p id=p style='margin:0;height:20px'>", "/data": "real" }, {});
         const page = await open();
         const [port, browser] = require("fs").readFileSync(path.join(app.getPath("userData"), "DevToolsActivePort"), "utf8").split("\\n");
         const socket = new WebSocket("ws://127.0.0.1:" + port + browser), waiting = new Map();
         await new Promise(resolve => (socket.onopen = resolve));
         socket.onmessage = ({ data }) => (data = JSON.parse(data), waiting.get(data.id ?? data.method)?.(data.result ?? data.params ?? data.error));
         const next = key => new Promise(resolve => waiting.set(key, resolve));
         let id = 0, sessionId;
         const send = (method, params) => (socket.send(JSON.stringify({ id: ++id, method, params, sessionId })), next(id));
         const [{ targetId }] = (await send("Target.getTargets")).targetInfos;
         ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
         const { executionContextId } = await send("Page.createIsolatedWorld", { worldName: "w" });
         const { objectId } = (await send("Runtime.evaluate", { expression: "self.mine = p", contextId: executionContextId })).result;
         const { backendNodeId, nodeName } = (await send("DOM.describeNode", { objectId })).node;
         const { object } = await send("DOM.resolveNode", { backendNodeId });
         print([nodeName, (await send("DOM.getBoxModel", { objectId })).model.height]);
         print(await send("Runtime.callFunctionOn", {
           objectId: object.objectId,
           functionDeclaration: "function (a, b, c) { return [this === p, typeof mine, a instanceof Object, b === this, String(c)] }",
           arguments: [{ value: {} }, { objectId: object.objectId }, { unserializableValue: "1n" }],
           returnByValue: true,
         }));
         print((await send("Runtime.evaluate", { expression: "throw new RangeError('r')" })).exceptionDetails.exception.subtype);
         await send("Fetch.enable", { patterns: [{ urlPattern: "*/dat?" }] });
         const paused = next("Fetch.requestPaused");
         const text = send("Runtime.evaluate", { expression: "fetch('/data').then(it => it.text())", awaitPromise: true });
         await send("Fetch.fulfillRequest", { requestId: (await paused).requestId, responseCode: 200, body: btoa("fake") });
         print((await text).result.value);
         print(await send("Runtime.getProperties", { objectId: "none" }));`,
        {},
        ["--remote-debugging-port=0"],
      ),
    ).toEqual([
      ["P", 20],
      { result: { type: "object", value: [true, "undefined", true, true, "1"] } },
      "error",
      "fake",
      { code: -32000, message: "Could not find object with given id" },
    ]);
  });

  test("a track element loads WebVTT", async () => {
    expect(
      await run(`
        serve({
          "/": "<video><track default src=a.vtt srclang=en label=A><track src=missing.vtt></video>",
          "/a.vtt": "WEBVTT\\n\\nREGION\\nid:r width:40%\\n\\none\\n00:01.000 --> 00:02.500 region:r align:left\\n<v.loud Ann>Hi &amp; <i>bye</i>\\n\\nbroken --> line\\nx\\n\\n00:00.000 --> 01:00:00.000 line:10% vertical:rl\\nfirst",
        });
        const page = await open();
        print(await page.executeJavaScript(\`(async () => {
          const [good, bad] = document.querySelectorAll("track"), { textTracks } = document.querySelector("video");
          if (good.readyState !== 2) await new Promise(resolve => (good.onload = resolve));
          const before = [bad.readyState, bad.track.mode, bad.track.cues];
          bad.track.mode = "hidden";
          await new Promise(resolve => (bad.onerror = resolve));
          const holder = document.createElement("p");
          holder.append(good.track.cues.getCueById("one").getCueAsHTML());
          return [
            [textTracks.length, textTracks[0] === good.track, good.track.mode, good.track.kind, good.track.label, good.track.language],
            [...good.track.cues].map(it => [it.id, it.startTime, it.endTime, it.line, it.snapToLines, it.vertical, it.align, it.region?.width]),
            holder.innerHTML, before, bad.readyState,
          ];
        })()\`));`),
    ).toEqual([
      [
        [2, true, "showing", "subtitles", "A", "en"],
        [
          ["", 0, 3600, 10, false, "rl", "center", null],
          ["one", 1, 2.5, "auto", true, "", "left", 40],
        ],
        '<span class="loud" title="Ann">Hi &amp; <i>bye</i></span>',
        [0, "disabled", null],
        3,
      ],
    ]);
  });

  test("menus", async () => {
    expect(
      await run(`
        const menu = electron.Menu.buildFromTemplate([
          { type: "separator" },
          { id: "a", label: "A", custom: 1 },
          { type: "separator" },
          { type: "separator" },
          { role: "reload" },
          { label: "B", before: ["a"], accelerator: "CmdOrCtrl+numadd" },
          { type: "separator" },
        ]);
        print(menu.items.map(item => item.label || item.type));
        print(menu.getMenuItemById("a").custom);`),
    ).toEqual([["B", "A", "Reload"], 1]);
  });

  test("the order of menu items, radio groups and click()", async () => {
    expect(
      await run(`
        const { Menu, MenuItem } = electron;
        const labels = template => print(Menu.buildFromTemplate(template).items.map(it => it.label || "-").join(""));
        const line = { type: "separator" };
        labels([{ id: "a", label: "A" }, line, { label: "B", beforeGroupContaining: ["a"] }, { label: "C" }]);
        labels([{ label: "A", afterGroupContaining: ["c"] }, line, { label: "B" }, line, { id: "c", label: "C" }]);
        labels([{ id: "a", label: "A", after: ["b"] }, { id: "b", label: "B", after: ["a"] }]);
        labels([{ label: "A", visible: false }, line, { label: "B" }]);
        const radio = checked => ({ label: "r", type: "radio", checked });
        const { items } = Menu.buildFromTemplate([radio(true), radio(false), line, radio(true)]);
        items[1].checked = true;
        print(items.map(it => it.checked));
        const item = new MenuItem({ label: "x", type: "checkbox", click: (it, window, event) => print([it === item, event]) });
        item.click("event");
        print([item.checked, new MenuItem({ role: "zoomIn" }).role, new MenuItem({ label: "x", "é": 1 })["é"]]);`),
    ).toEqual(["BC-A", "C-A-B", "BA", "A-B", [false, true, false, true], [true, "event"], [true, "zoomin", 1]]);
  });

  test("contextBridge lets no object of the other world through", async () => {
    expect(
      await run(
        `serve({ "/": "" });
        ipcMain.handle("echo", (event, value) => [value, event.type, typeof event.reply]);
        const contents = await open(undefined, preload);
        const thrown = call => "(() => { try { " + call + " } catch (error) { return [error instanceof Error, error.message] } })()";
        for (const code of [
          "api.unbound()",
          "(it => api.same(it) === it)(() => {})",
          "(it => [it.self === it, it instanceof Object, Object.getPrototypeOf(it.method) === Function.prototype])(api.cycle())",
          "(it => api.equal(it, it))({ method() {} })",
          "(it => [Object.keys(it), it.x])(api.proto())",
          "[api.same.call(0, 1), api.same.bind(0, 2)(), Object.isFrozen(api.nested.list[0])]",
          thrown("api.throwsInGetter()"),
          thrown("api.throwsObject()"),
          thrown("api.send('channel', Symbol())"),
          thrown("api.send(1)"),
        ]) print(await contents.executeJavaScript(code));`,
        {
          "preload.js": `
            const { contextBridge, ipcRenderer: { invoke, send } } = require("electron");
            contextBridge.exposeInMainWorld("api", {
              unbound: () => invoke("echo", 1),
              same: it => it,
              cycle() { const it = { method() {} }; return (it.self = it); },
              equal: (a, b) => a === b,
              proto: () => Object.assign(JSON.parse('{ "__proto__": { "x": 1 } }'), { method() {} }),
              nested: { list: [{}] },
              throwsInGetter: () => ({ get x() { throw new TypeError("getter"); } }),
              throwsObject() { throw {}; },
              send,
            });`,
        },
      ),
    ).toEqual([
      [1, "frame", "undefined"],
      true,
      [true, true, true],
      true,
      [["__proto__", "method"], null],
      [1, 2, true],
      [true, expect.stringContaining("getter")],
      [true, expect.stringContaining("An unknown exception occurred in the isolated context")],
      [true, "An object could not be cloned."],
      [true, "Error processing argument at index 0 of send, conversion failure: channel must be a string"],
    ]);
  });

  test("contextBridge makes objects of the world that gets them, whoever got that shape before", async () => {
    expect(
      await run(
        `serve({ "/": "" });
        const event = { type: "text", at: { line: 1 } };
        const all = [await open(undefined, preload), await open(undefined, preload)];
        for (let round = 0; round < 6; round++) {
          for (const contents of all) {
            contents.send("event", event);
            print(await contents.executeJavaScript("api.last().then(([isOwn, it]) => [isOwn, it instanceof Object, it.at instanceof Object, it])"));
          }
          if (round % 2) Bun.gc(round === 3);
        }`,
        {
          "preload.js": `
            const { contextBridge, ipcRenderer } = require("electron");
            let next = Promise.withResolvers();
            ipcRenderer.on("event", (_, it) => next.resolve([it instanceof Object && it.at instanceof Object, it]));
            contextBridge.exposeInMainWorld("api", { last: () => next.promise.finally(() => (next = Promise.withResolvers())) });`,
        },
      ),
    ).toEqual(Array(12).fill([true, true, true, { type: "text", at: { line: 1 } }]));
  });

  test("the classes can be extended, and what they hold survives a collection", async () => {
    expect(
      await run(`
        class Mine extends BrowserWindow {
          extra = 1;
          constructor() { super({ show: false, title: "Title" }); }
        }
        (() => {
          const view = new electron.View();
          view.custom = {};
          new Mine().contentView.addChildView(view);
          electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate([{ label: "A", submenu: [{ id: "b", label: "B", click: () => print("clicked") }] }]));
          ipcMain.handleOnce("once", () => 1);
        })();
        Bun.gc(true);
        const [window] = BrowserWindow.getAllWindows();
        print([window instanceof Mine, window instanceof electron.BaseWindow, window.extra, window.title, window.contentView.children[0].custom]);
        electron.Menu.getApplicationMenu().getMenuItemById("b").click();
        print([ipcMain._invokeHandlers.get("once")(), ipcMain._invokeHandlers.has("once"), ipcMain.emit("error")]);`),
    ).toEqual([[true, true, 1, "Title", {}], "clicked", [1, false, true]]);
  });

  describe("service workers", () => {
    const runInApp = (main: string, files?: Record<string, string>, args?: string[], env?: object) =>
      run(main, files, args, { BUN_DESKTOP_PAGE_PROCESSES: undefined, ...env });

    /** `site(files)` is trusted, `foreign` is not. `control()` returns a page that `/worker.js` controls. */
    const sites = `
      const asked = [];
      const site = files => Bun.serve({ port: 0, fetch(request) {
        const { pathname } = new URL(request.url), file = files[pathname] ?? "<body>network";
        asked.push(pathname);
        if (typeof file === "function") return file(request);
        return new Response(file, { headers: { "content-type": types[path.extname(pathname)] ?? "text/html", "access-control-allow-origin": "*" } });
      } }).url.origin;
      const foreign = site({ "/code.js": "self.ran = true", "/page": "<script>self.ran = true</script>" });
      const claims = 'oninstall = () => skipWaiting(); onactivate = event => event.waitUntil(clients.claim());';
      const control = async (worker, files, options) => {
        const own = site({ "/worker.js": claims + worker, ...files });
        app.trustOrigins([own], { inFrames: [own + "/*"] });
        const page = await open(own + "/", options);
        await page.executeJavaScript(\`new Promise((resolve, reject) => {
          navigator.serviceWorker.oncontrollerchange = () => resolve();
          navigator.serviceWorker.register("/worker.js").catch(reject);
        })\`);
        return [page, own];
      };`;

    test("one answers for its pages, their frames and their workers", async () => {
      expect(
        await runInApp(`${sites}
          const [page, own] = await control(
            \`onfetch = event => {
              const { request } = event;
              if (request.url.includes("/answered"))
                event.respondWith(request.text().then(body => new Response([request.mode, request.destination, body], { headers: { "content-type": "text/html" } })));
            };
            onmessage = event => event.source.postMessage([event.data, event.source.type, typeof require, typeof process, typeof Bun]);\`,
            { "/dedicated.js": 'fetch("/answered").then(it => it.text()).then(postMessage)' },
          );
          print(await page.executeJavaScript(\`(async () => {
            const message = target => new Promise(resolve => (target.onmessage = event => resolve(event.data)));
            const frame = document.createElement("iframe"), loaded = new Promise(resolve => (frame.onload = resolve));
            frame.src = "/answered";
            document.body.append(frame);
            await loaded;
            navigator.serviceWorker.controller.postMessage("ping");
            return [
              await message(navigator.serviceWorker),
              await (await fetch("/answered", { method: "POST", body: "sent" })).text(),
              await (await fetch("/other")).text(),
              frame.contentDocument.body.textContent,
              await message(new Worker("/dedicated.js")),
            ];
          })()\`));
          await page.loadURL(own + "/answered");
          print([await page.executeJavaScript("document.body.textContent"), asked.includes("/answered")]);`),
      ).toEqual([
        [
          ["ping", "window", "undefined", "undefined", "undefined"],
          "cors,,sent",
          "<body>network",
          "navigate,iframe,",
          "cors,,",
        ],
        ["navigate,document,", false],
      ]);
    });

    test("none runs code from an origin that is not trusted", async () => {
      expect(
        await runInApp(`${sites}
          const own = site({
            "/moved.js": () => Response.redirect(foreign + "/code.js"),
            "/imports.js": \`importScripts("\${foreign}/code.js")\`,
            "/imports-moved.js": 'importScripts("/moved.js")',
            "/module.js": \`import "\${foreign}/code.js"\`,
            "/excepted.js": "",
            "/harmless.js": "",
          });
          app.trustOrigins([own], { except: [own + "/excepted.js"] });
          const page = await open(own + "/");
          for (const [url, type] of [[foreign + "/code.js"], ["/moved.js"], ["/imports.js"], ["/imports-moved.js"], ["/module.js", "module"], ["/excepted.js"], ["/harmless.js"]])
            print(await page.executeJavaScript(\`navigator.serviceWorker.register("\${url}", { type: "\${type ?? "classic"}" }).then(it => "registered", error => error.name)\`));`),
      ).toEqual([
        "SecurityError",
        "SecurityError",
        "TypeError",
        "TypeError",
        "TypeError",
        "SecurityError",
        "registered",
      ]);
    });

    test.each([
      ["what it has fetched", `fetch(foreign)`],
      ["what it has fetched without CORS", `fetch(foreign, { mode: "no-cors" })`],
      ["a clone", `fetch(foreign).then(it => it.clone())`],
      ["what a redirect has led to", `fetch("/moved" + to)`],
      ["a redirect", `Response.redirect(foreign)`],
      ["what it passes on", `fetch(event.request).then(it => new Response(it.body, it))`],
      ["what it asks for by the same URL", `fetch(event.request.url).then(it => new Response(it.body, it))`],
      ["what it has got when it was installed", `early.then(it => it.clone())`],
      [
        "what it has cached",
        `caches.open("a").then(async cache => (await cache.put(event.request, await fetch(foreign)), cache.match(event.request)))`,
      ],
    ])("%s from an origin that is not trusted is not code", async (_, answer) => {
      expect(
        await runInApp(`${sites}
          const [page, own] = await control(
            \`const early = fetch("/moved/code.js").then(async it => new Response(await it.text(), it));
            addEventListener("install", event => event.waitUntil(early.catch(() => {})));
            onfetch = event => {
              const to = new URL(event.request.url).search.slice(1), foreign = "\${foreign}" + to;
              if (to) event.respondWith(${answer});
            };\`,
            Object.fromEntries(["/moved/code.js", "/moved/page", "/a", "/b", "/c", "/d", "/e"].map(it => [it, ({ url }) => Response.redirect(foreign + (new URL(url).search.slice(1) || it.slice(6)))])),
          );
          print(await page.executeJavaScript(\`(async () => {
            const load = (name, more) => new Promise(resolve => {
              const element = Object.assign(document.createElement(name), more, { onload: () => resolve(element), onerror: () => resolve(element) });
              document.body.append(element);
            });
            await load("script", { src: "/a?/code.js" });
            await load("script", { src: "/b?/code.js", type: "module" });
            await import("/c?/code.js").catch(() => {});
            const frame = await load("iframe", { src: "/d?/page" });
            const worker = new Worker("/e?/code.js");
            await new Promise(resolve => (worker.onerror = resolve));
            return [self.ran, frame.contentDocument?.defaultView.ran].map(String);
          })()\`));`),
      ).toEqual([["undefined", "undefined"]]);
    });

    test("an update does not follow an import to an origin that is not trusted", async () => {
      expect(
        await runInApp(`${sites}
          let times = 0;
          const [page] = await control('importScripts("/imported.js")', {
            "/imported.js": () => times++ ? Response.redirect(foreign + "/code.js") : new Response("", { headers: { "content-type": "text/javascript" } }),
          });
          print(await page.executeJavaScript("navigator.serviceWorker.ready.then(it => it.update()).then(it => [it.installing, it.waiting])"));
          print([times, asked.includes("/code.js")]);`),
      ).toEqual([
        [null, null],
        [2, false],
      ]);
    });

    test("what an origin keeps is counted and has limits", async () => {
      expect(
        await runInApp(`${sites}
          const script = text => () => new Response(text, { headers: { "content-type": "text/javascript" } });
          const [page] = await control("//" + Buffer.alloc(1 << 20, "a"), {
            "/empty.js": "",
            "/large.js": script(Buffer.alloc(33 << 20, " ")),
            "/imports.js": 'importScripts("/half.js?1", "/half.js?2")',
            "/half.js": script(Buffer.alloc(17 << 20, " ")),
            "/routes.js": \`oninstall = event => {
              let condition = { requestMethod: "GET" };
              for (let i = 0; i < 9; i++) condition = { or: Array(50).fill(condition) };
              event.waitUntil(event.addRoutes({ condition, source: "network" }));
            };\`,
          });
          print(await page.executeJavaScript(\`(async () => {
            const outcome = promise => promise.then(() => "done", error => error.name);
            const { serviceWorker } = navigator, own = await serviceWorker.ready;
            const register = (url, scope) => serviceWorker.register(url, { scope });
            const usage = async () => (await navigator.storage.estimate()).usageDetails.serviceWorkerRegistrations >> 20;
            const names = count => Array.from({ length: count }, (_, i) => ({ name: "n" + i }));
            const { installing } = await register("/routes.js", "/routes");
            await new Promise(resolve => (installing.onstatechange = resolve));
            const result = [
              await usage(),
              installing.state,
              await outcome(own.cookies.subscribe(names(101))),
              await outcome(own.cookies.subscribe(names(100))),
              await outcome(own.navigationPreload.setHeaderValue("a".repeat(1 << 20))),
              await outcome(register("/large.js", "/large")),
              await outcome(register("/imports.js", "/imports")),
              await outcome(register("/empty.js", "/" + "a".repeat(400 << 10))),
              await outcome(register("/empty.js", "/" + "b".repeat(400 << 10))),
              new Set(await Promise.all(Array.from({ length: 300 }, () => outcome(own.update())))).size,
            ];
            return result;
          })()\`));
          await page.session.clearStorageData({ storages: ["serviceworkers"] });
          print(await page.executeJavaScript("navigator.storage.estimate().then(it => it.usageDetails)"));`),
      ).toEqual([
        [
          1,
          "redundant",
          "QuotaExceededError",
          "done",
          "QuotaExceededError",
          "TypeError",
          "TypeError",
          "done",
          "QuotaExceededError",
          2,
        ],
        {},
      ]);
    });

    test("no more than 32 of an origin run at once", async () => {
      expect(
        await runInApp(`${sites}
          const [page] = await control("", { "/echo.js": "onmessage = event => event.source.postMessage(registration.scope)" });
          print(await page.executeJavaScript(\`(async () => {
            const { serviceWorker } = navigator, all = [];
            for (let i = 0; i < 40; i++) {
              const { installing } = await serviceWorker.register("/echo.js", { scope: "/" + i });
              while (installing.state !== "activated") await new Promise(resolve => (installing.onstatechange = resolve));
              all.push(installing);
            }
            all[0].postMessage("");
            return new URL((await new Promise(resolve => (serviceWorker.onmessage = resolve))).data).pathname;
          })()\`));
          print(Object.keys(page.session.serviceWorkers.getAllRunning()).length);`),
      ).toEqual(["/0", 32]);
    });

    test("those that have failed to install count too", async () => {
      expect(
        await runInApp(`${sites}
          const [page] = await control("", {
            "/fails.js": \`oninstall = event => event.waitUntil(new Promise((_, reject) => {
              onmessage = event => (event.waitUntil(new Promise(() => {})), reject());
            }));\`,
          });
          let [running, most] = [0, 0];
          page.session.serviceWorkers.on("running-status-changed", ({ runningStatus }) => {
            running += { starting: 1, stopped: -1 }[runningStatus] ?? 0;
            most = Math.max(most, running);
          });
          await page.executeJavaScript(\`(async () => {
            for (let i = 0; i < 40; i++) {
              const { installing } = await navigator.serviceWorker.register("/fails.js", { scope: "/" + i });
              installing.postMessage("");
              await new Promise(resolve => (installing.onstatechange = resolve));
            }
          })()\`);
          print(most <= 32);`),
      ).toEqual([true]);
    });

    test("no more than 8 of an origin are loaded at once", async () => {
      expect(
        await runInApp(`${sites}
          const [all, eight] = [Promise.withResolvers(), Promise.withResolvers()];
          let [held, most] = [0, 0];
          const [page] = await control("", {
            "/held.js": async () => {
              most = Math.max(most, ++held);
              if (held === 8) eight.resolve();
              await all.promise;
              held--;
              return new Response("", { headers: { "content-type": "text/javascript" } });
            },
            "/release": async () => {
              await eight.promise;
              for (let i = 0; i < 20; i++) await fetch(foreign);
              all.resolve();
              return new Response();
            },
          });
          print(await page.executeJavaScript(\`(async () => {
            const all = Array.from({ length: 40 }, (_, i) => navigator.serviceWorker.register("/held.js", { scope: "/" + i }));
            await fetch("/release");
            return (await Promise.all(all)).length;
          })()\`));
          print(most);`),
      ).toEqual([40, 8]);
    });

    test("a notification has a largest size", async () => {
      expect(
        await runInApp(`${sites}
          const [page] = await control("");
          print(await page.executeJavaScript(\`navigator.serviceWorker.ready.then(own => Promise.all(
            [{ data: "a".repeat(1 << 20) + "a" }, { data: new Uint8Array(2 << 20) }, { body: "a".repeat(2 << 20) }, { data: "a" }]
              .map(it => own.showNotification("", it).then(() => "shown", error => error.name)),
          ))\`));`),
      ).toEqual([["TypeError", "TypeError", "TypeError", "shown"]]);
    });

    test("an opaque response is only served once", async () => {
      expect(
        await runInApp(`${sites}
          const [page] = await control(\`
            let kept;
            onfetch = event => event.respondWith((kept ??= fetch("\${foreign}/code.js", { mode: "no-cors" })));\`);
          print(await page.executeJavaScript(\`(async () => {
            const ask = () => fetch("/a", { mode: "no-cors" }).then(it => it.type, error => error.name);
            return [await ask(), await ask()];
          })()\`));`),
      ).toEqual([["opaque", "TypeError"]]);
    });

    test("none sees what a preload script asks for", async () => {
      expect(
        await runInApp(
          `${sites}
          const [page] = await control('onfetch = event => event.respondWith(new Response("worker"))', {}, preload);
          page.send("go");
          print((await once(page.ipc, "got"))[1]);
          print(await page.executeJavaScript('fetch("/").then(it => it.text())'));`,
          {
            "preload.js": `
              const { ipcRenderer } = require("electron");
              ipcRenderer.on("go", async () => {
                const request = new XMLHttpRequest(), loaded = new Promise(resolve => (request.onload = resolve));
                request.open("GET", "/");
                request.send();
                await loaded;
                ipcRenderer.send("got", [await (await fetch("/")).text(), await (await Promise.resolve("/").then(fetch)).text(), request.response]);
              });`,
          },
        ),
      ).toEqual([Array(3).fill("<body>network"), "worker"]);
    });

    test("a cache does not give away the size of an opaque response", async () => {
      expect(
        await runInApp(`${sites}
          const image = size => () => new Response(new Uint8Array(size), { headers: { "content-type": "image/png" } });
          const other = site({ "/a": image(10), "/b": image(54321) }), [page] = await control("");
          print(await page.executeJavaScript(\`(async () => {
            const cache = await caches.open("a"), usage = async () => (await navigator.storage.estimate()).usage, added = [];
            for (const name of ["/a", "/b"]) {
              const before = await usage();
              await cache.put(name, await fetch("\${other}" + name, { mode: "no-cors" }));
              added.push((await usage()) - before);
            }
            return added[0] === added[1];
          })()\`));`),
      ).toEqual([true]);
    });

    test("a scheme of the app has them if it says so", async () => {
      expect(
        await runInApp(
          `for (const scheme of ["with", "without"])
            protocol.handle(scheme, ({ url }) =>
              url.endsWith("/worker.js")
                ? new Response('onactivate = event => event.waitUntil(clients.claim()); onfetch = event => event.respondWith(new Response("self.from = 1", { headers: { "content-type": "text/javascript" } }))', { headers: { "content-type": "text/javascript" } })
                : new Response("self.from = 2", { headers: { "content-type": url.endsWith(".js") ? "text/javascript" : "text/html" } }));
          app.trustOrigins(["with://trusted", "without://trusted"]);
          print(await (await open("without://trusted/")).executeJavaScript('navigator.serviceWorker.register("/worker.js").then(() => "registered", error => error.name)'));
          print(await (await open("with://trusted/")).executeJavaScript(\`(async () => {
            navigator.serviceWorker.register("/worker.js");
            await new Promise(resolve => (navigator.serviceWorker.oncontrollerchange = resolve));
            await import("/code.js");
            return [await (await fetch("/data")).text(), self.from];
          })()\`));`,
          {
            "package.json": JSON.stringify({ name: "fixture", main: "first.js" }),
            "first.js": `
              const { protocol } = require("electron"), register = protocol.registerSchemesAsPrivileged;
              const privileges = { standard: true, secure: true, supportFetchAPI: true };
              protocol.registerSchemesAsPrivileged = all => register.call(protocol, [
                ...all,
                { scheme: "with", privileges: { ...privileges, allowServiceWorkers: true } },
                { scheme: "without", privileges },
              ]);
              require("./main.js");`,
          },
        ),
      ).toEqual(["TypeError", ["self.from = 1", 1]]);
    });

    test.skipIf(isWindows)("a registration outlives the app", async () => {
      expect(
        await runInApp(
          `${sites}
          const again = process.argv.find(it => it.startsWith("http:"));
          if (again) {
            app.trustOrigins([again]);
            return print(await (await open(again + "/offline")).executeJavaScript("document.body.textContent"));
          }
          const [, own] = await control(
            'importScripts("/imported.js"); onfetch = event => event.respondWith(new Response(text, { headers: { "content-type": "text/html" } }));',
            { "/imported.js": 'var text = "kept"' },
          );
          app.relaunch({ args: ["--preload=bun:desktop/electron", ".", own] });
          print("registered");`,
          {},
          [],
          { BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
        ),
      ).toEqual(["registered", "kept"]);
    });

    test.skipIf(isWindows)("one that nothing needs cannot give itself more to do", async () => {
      const heard: string[] = [];
      const [first, last] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      using server = Bun.serve({
        port: 0,
        async fetch(request) {
          const { pathname, search } = new URL(request.url);
          if (pathname === "/first") await first.promise;
          if (pathname === "/last") await last.promise;
          if (pathname === "/heard") (heard.push(search), (search.startsWith("?last") ? last : first).resolve());
          if (pathname !== "/worker.js") return new Response("", { headers: { "content-type": "text/html" } });
          const script = `let count = 0;
            oncookiechange = event => event.waitUntil((async () => {
              if (event.changed[0]?.value === "last") return fetch("/heard?last," + count);
              if (++count > 1) return;
              await cookieStore.set("a", "own");
              await cookieStore.set({ name: "a", value: "brief", maxAge: 1 });
              const { expires } = await cookieStore.get("a");
              while (Date.now() <= expires) await new Promise(resolve => setTimeout(resolve, 20));
              await fetch("/heard?" + await registration.update().then(() => "updated", error => error.name), { credentials: "omit" });
            })());`;
          return new Response(script, { headers: { "content-type": "text/javascript" } });
        },
      });
      await runInApp(
        `${sites}
        const url = "${server.url.origin}", other = site({});
        app.trustOrigins([url, other]);
        if (process.argv.includes("again")) {
          const { cookies } = session.defaultSession;
          await open(other);
          await cookies.set({ url, name: "a", value: "first" });
          await fetch(url + "/first");
          await cookies.set({ url, name: "a", value: "last" });
          return print((await fetch(url + "/last")).status);
        }
        await (await open(url)).executeJavaScript(\`navigator.serviceWorker.register("/worker.js")
          .then(() => navigator.serviceWorker.ready).then(it => it.cookies.subscribe([{ name: "a" }]))\`);
        app.relaunch({ args: ["--preload=bun:desktop/electron", ".", "again"] });
        print(0);`,
        {},
        [],
        { BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      );
      expect(heard).toEqual(["?AbortError", "?last,1"]);
    });

    test.skipIf(isWindows)("two instances of the app do not mix up their scripts", async () => {
      expect(
        await runInApp(`${sites}
          const says = text => \`onmessage = event => event.source.postMessage("\${text}");\`;
          if (process.argv.includes("second")) {
            await control("");
            process.send("started");
            await once(process, "message");
            return void (await control(says("second")));
          }
          await control("");
          const started = Promise.withResolvers();
          const second = Bun.spawn([process.execPath, "--preload=bun:desktop/electron", ".", "second"], { ipc: started.resolve });
          await started.promise;
          await control("");
          const [page] = await control(says("first"), { "/empty.js": "" });
          second.send("");
          await second.exited;
          print(await page.executeJavaScript(\`(async () => {
            const { serviceWorker } = navigator;
            for (let i = 0; i < 32; i++) {
              const { installing } = await serviceWorker.register("/empty.js", { scope: "/" + i });
              while (installing.state !== "activated") await new Promise(resolve => (installing.onstatechange = resolve));
            }
            serviceWorker.controller.postMessage("");
            return new Promise(resolve => {
              serviceWorker.onmessage = event => resolve(event.data);
              serviceWorker.controller.onstatechange = event => resolve(event.target.state);
            });
          })()\`));`),
      ).toEqual(["first"]);
    });

    test.skipIf(isWindows)("what is on the disk does not pass for a compiled script", async () => {
      using server = Bun.serve({
        port: 0,
        fetch: ({ url }) =>
          url.endsWith(".js")
            ? new Response(`onfetch = event => event.respondWith(new Response("worker"));`, {
                headers: { "content-type": "text/javascript" },
              })
            : new Response("network", { headers: { "content-type": "text/html" } }),
      });
      expect(
        await runInApp(
          `
          const url = "${server.url.origin}";
          app.trustOrigins([url]);
          if (process.argv.includes("again")) {
            const file = path.join(app.getPath("userData"), "Service Workers"), bytes = require("fs").readFileSync(file);
            bytes[bytes.indexOf("/worker.js") + "/worker.js".length] |= 4;
            require("fs").writeFileSync(file, bytes);
            app.setCompiledScripts({}, { exclusive: true });
            return print(await (await open(url)).executeJavaScript('fetch("/a").then(it => it.text())'));
          }
          await (await open(url)).executeJavaScript('navigator.serviceWorker.register("/worker.js").then(() => navigator.serviceWorker.ready).then(() => {})');
          app.relaunch({ args: ["--preload=bun:desktop/electron", ".", "again"] });
          print("registered");`,
          {},
          [],
          { BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
        ),
      ).toEqual(["registered", "network"]);
    });

    test("the app hears of them, and clears them", async () => {
      expect(
        await runInApp(`${sites}
          const { serviceWorkers } = session.defaultSession, heard = [];
          serviceWorkers.on("registration-completed", (_, it) => heard.push(new URL(it.scope).pathname));
          serviceWorkers.on("running-status-changed", it => heard.push(it.runningStatus));
          serviceWorkers.on("console-message", (_, it) => heard.push([it.message, it.level, it.source, new URL(it.sourceUrl).pathname]));
          const [page, own] = await control('console.warn("hello")');
          const [[id, running]] = Object.entries(serviceWorkers.getAllRunning());
          print([running.scope === own + "/", running.scriptUrl === own + "/worker.js", serviceWorkers.getInfoFromVersionID(+id).scope === running.scope]);
          const stopped = new Promise(resolve => serviceWorkers.on("running-status-changed", it => it.runningStatus === "stopped" && resolve()));
          await session.defaultSession.clearStorageData({ storages: ["serviceworkers"] });
          await stopped;
          print(heard);
          print([serviceWorkers.getAllRunning(), await page.executeJavaScript("navigator.serviceWorker.getRegistrations().then(it => [it.length, navigator.serviceWorker.controller])")]);`),
      ).toEqual([
        [true, true, true],
        ["starting", ["hello", 2, "console-api", "/worker.js"], "running", "/", "stopping", "stopped"],
        [{}, [0, null]],
      ]);
    });

    test("one is told when a request is given up, and of cookies", async () => {
      expect(
        await runInApp(`${sites}
          const [page] = await control(\`
            const tell = async it => (await clients.matchAll())[0].postMessage(it);
            onfetch = event => {
              event.request.signal.onabort = () => tell("aborted");
              event.respondWith(new Promise(() => {}));
              tell("asked");
            };
            oncookiechange = event => tell(event.changed.map(it => it.name + "=" + it.value));\`);
          print(await page.executeJavaScript(\`(async () => {
            const message = () => new Promise(resolve => (navigator.serviceWorker.onmessage = event => resolve(event.data)));
            const controller = new AbortController(), failed = fetch("/never", controller).catch(error => error.name);
            const heard = [await message()];
            controller.abort();
            heard.push(await message(), await failed);
            await (await navigator.serviceWorker.ready).cookies.subscribe([{ name: "b" }]);
            document.cookie = "a=1";
            document.cookie = "b=2";
            return [...heard, await message()];
          })()\`));`),
      ).toEqual([["asked", "aborted", "AbortError", ["b=2"]]]);
    });

    test("routes are taken without asking it", async () => {
      expect(
        await runInApp(`${sites}
          const [page] = await control(\`
            addEventListener("install", event => event.waitUntil(Promise.all([
              event.addRoutes([
                { condition: { urlPattern: "/network/*" }, source: "network" },
                { condition: { urlPattern: { pathname: "/cached" }, requestMethod: "get" }, source: { cacheName: "a" } },
              ]),
              caches.open("a").then(cache => cache.put("/cached", new Response("cache"))),
            ])));
            onfetch = event => event.respondWith(new Response("worker"));\`);
          print(await page.executeJavaScript(\`Promise.all([["/network/a"], ["/cached"], ["/cached", { method: "POST" }], ["/other"]].map(async it => (await fetch(...it)).text()))\`));`),
      ).toEqual([["<body>network", "cache", "worker", "worker"]]);
    });

    test("a notification is up to the app", async () => {
      expect(
        await runInApp(`${sites}
          const [page] = await control("");
          const show = () => page.executeJavaScript(\`navigator.serviceWorker.ready.then(async it => {
            await it.showNotification("Title", { tag: "a", data: { b: 1 }, actions: [{ action: "c", title: "C" }] });
            const [[shown], none] = [await it.getNotifications(), await it.getNotifications({ tag: "other" })];
            shown.close();
            return [shown.title, shown.tag, shown.data, shown.actions, none.length, (await it.getNotifications()).length];
          }).catch(error => error.name)\`);
          print(await show());
          session.defaultSession.setPermissionCheckHandler((_, name) => name !== "notifications");
          print(await show());`),
      ).toEqual([["Title", "a", { b: 1 }, [{ action: "c", title: "C" }], 0, 0], "TypeError"]);
    });

    test.skipIf(isWindows)("a page in a process of its own has none", async () => {
      expect(
        await run(
          `${sites}
          const own = site({ "/worker.js": "" });
          app.trustOrigins([own]);
          const page = await open(own + "/");
          print([await page.executeJavaScript(\`navigator.serviceWorker.register("/worker.js").catch(error => error.name)\`), asked]);`,
          {},
          [],
          { BUN_DESKTOP_PAGE_PROCESSES: "1" },
        ),
      ).toEqual([["SecurityError", ["/"]]]);
    });
  });

  test("the storage of a frame that has been removed is out of reach", async () => {
    expect(
      await run(`
        using server = Bun.serve({ port: 0, fetch: () => new Response("", { headers: { "content-type": "text/html" } }) });
        app.trustOrigins([server.url.origin], { inFrames: true });
        print(await (await open(server.url.href)).executeJavaScript(\`(async () => {
          const frame = Object.assign(document.createElement("iframe"), { src: "/frame" });
          await new Promise(resolve => document.body.append(Object.assign(frame, { onload: resolve })));
          const all = [frame.contentWindow.localStorage, frame.contentWindow.sessionStorage];
          all.forEach(it => (it.a = "1"));
          frame.remove();
          const uses = [it => it.length, it => it.key(0), it => it.a, it => (it.b = 2), it => delete it.a, it => Object.keys(it), it => it.clear()];
          const attempt = (use, it) => { try { return use(it); } catch (error) { return error.name; } };
          return [new Set(all.flatMap(it => uses.map(use => attempt(use, it)))).values().toArray(), { ...localStorage }, { ...sessionStorage }];
        })()\`));`),
    ).toEqual([[["SecurityError"], { a: "1" }, { a: "1" }]]);
  });

  test("timers that are set once a timer has settled a promise are nested", async () => {
    expect(
      await run(`
        serve({ "/": "" });
        print(await (await open()).executeJavaScript(\`(async () => {
          const start = performance.now();
          for (let i = 0; i < 15; i++) await new Promise(resolve => setTimeout(resolve));
          return performance.now() - start >= 9 * 4;
        })()\`));`),
    ).toEqual([true]);
  });

  test("the cookies of a document are those of the URL that it came from", async () => {
    expect(
      await run(`
        const { url } = Bun.serve({ port: 0, fetch: () => new Response("<iframe></iframe>", { headers: { "content-type": "text/html" } }) });
        app.trustOrigins([url.origin], { inFrames: true });
        print(await (await open(url.href + "a/")).executeJavaScript(\`(async () => {
          document.cookie = "a=1";
          document.cookie = "b=2; path=/b";
          history.pushState(null, "", "/b/");
          return [document.cookie, (await cookieStore.getAll()).map(it => it.name), frames[0].document.cookie];
        })()\`));`),
    ).toEqual([["a=1", ["a"], "a=1"]]);
  });
});

describe.skipIf(!hasLibrary || !isLinux).concurrent("in an app bundle, with stand-ins for the tools of macOS", () => {
  const tools = {
    codesign: `for it; do :; done; signed=$(cat "$it/Contents/signed") || exit
      if [ $1 = -d ]; then echo "designated => $signed"; else [ "$4" = "-R=$signed" ] || { echo unsatisfied >&2; exit 3; }; fi`,
    ditto: `mkdir "$3" && tar -xf "$2" -C "$3"`,
    plutil: `sed -n "s/^$2=//p" "$6" | grep .`,
    open: `echo "$1" > "\${0%/*}/opening" && mv "\${0%/*}/opening" "\${0%/*}/opened"`,
  };
  const contents = (version: string, signed = "team", id = "test.fixture") => ({
    "Info.plist": `CFBundleIdentifier=${id}\nCFBundleShortVersionString=${version}\nElectronSquirrelPreventDowngrades=true\n`,
    signed,
  });
  const shared = tempDir("bundle", {});
  afterAll(() => shared[Symbol.dispose]());

  async function runInBundle(
    main: string,
    { signed = "team", readOnly = [] as string[], opens = false, files = {} } = {},
  ) {
    using dir = tempDir("bundle", {
      "package.json": JSON.stringify({ name: "fixture", productName: "Fixture", version: "1.2.3", main: "main.js" }),
      "main.js": `${prelude}
        const { autoUpdater } = electron;
        const fs = require("fs");
        const staged = () => path.resolve([...new Bun.Glob("Library/Caches/*/update.*").scanSync({ onlyFiles: false })][0]);
        const archive = name => require("child_process").execFileSync("tar", ["-cC", path.join(__dirname, name), "."]);
        const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
          const { pathname, searchParams } = new URL(request.url);
          if (pathname.endsWith(".zip")) return new Response(archive(pathname.slice(1, -4)));
          print([request.headers.get("accept"), request.headers.get("x-given")]);
          return new Response(searchParams.get("body"), { status: +searchParams.get("status") || 200 });
        } });
        const update = (name, more) => ({ url: server.url + name + ".zip", name, ...more });
        const check = (body, { status = 200, ...options } = {}) => new Promise(resolve => {
          autoUpdater.setFeedURL({ url: server.url + "?" + new URLSearchParams({ status, body: typeof body === "string" ? body : JSON.stringify(body) }), ...options });
          for (const name of ["error", "update-not-available", "update-downloaded"]) autoUpdater.once(name, () => setImmediate(resolve));
          autoUpdater.checkForUpdates();
        });
        autoUpdater.on("error", (error, message) => print([message, error.domain, error.code]));
        for (const name of ["checking-for-update", "update-available", "update-not-available", "update-downloaded", "before-quit-for-update"])
          autoUpdater.on(name, (_, ...more) => print([name, ...more.slice(0, 3)]));
        app.whenReady().then(async () => {${main}\n}).catch(error => { console.error(error); app.exit(1); });`,
      tools: Object.fromEntries(Object.entries(tools).map(([name, text]) => [name, "#!/bin/sh\n" + text])),
      place: { "Fixture.app": { Contents: { ...contents("1.2.3", signed), MacOS: { keep: "" } } } },
      newer: { "Other name.app": { Contents: contents("1.10.0") } },
      older: { "Fixture.app": { Contents: contents("1.2.2") } },
      forged: { "Fixture.app": { Contents: contents("2.0.0", "somebody") } },
      another: { "Fixture.app": { Contents: contents("2.0.0", "team", "test.another") } },
      Applications: { keep: "", ...files },
    });
    const at = (...parts: string[]) => join(String(dir), ...parts);
    const executable = join(String(shared), "bun");
    if (!existsSync(executable)) copyFileSync(bunExe(), executable);
    linkSync(executable, at("place/Fixture.app/Contents/MacOS/Fixture"));
    for (const name in tools) chmodSync(at("tools", name), 0o755);
    for (const it of readOnly) chmodSync(at(it), 0o555);
    await using proc = Bun.spawn({
      cmd: [at("place/Fixture.app/Contents/MacOS/Fixture"), "--preload=bun:desktop/electron", "."],
      env: {
        ...bunEnv,
        BUN_DESKTOP_HEADLESS: "1",
        BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
        HOME: String(dir),
        PATH: at("tools") + ":" + bunEnv.PATH,
      },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`exited with ${exitCode}\n${stdout}\n${stderr}`);
    while (opens && !existsSync(at("tools/opened"))) await new Promise(setImmediate);
    const read = (file: string) => (existsSync(at(file)) ? readFileSync(at(file), "utf8").trim() : undefined);
    const version = (place: string) => read(place + "/Fixture.app/Contents/Info.plist")?.match(/[\d.]{5,}/)![0];
    const result = {
      printed: stdout.match(/.+/g)!.map(line => JSON.parse(line)),
      place: [version("place"), ...readdirSync(at("place"))],
      applications: version("Applications"),
      opened: read("tools/opened")?.slice(String(dir).length),
      log: read("Library/Caches/sh.bun.app.fixture.ShipIt/ShipIt_stderr.log")?.replace(/^.*?ShipIt\[\d+\] /gm, ""),
    };
    chmodSync(at("place"), 0o755);
    if (existsSync(at("place/Fixture.app"))) chmodSync(at("place/Fixture.app"), 0o755);
    return result;
  }

  const asked = [["checking-for-update"], ["application/json", null]];
  const installed = "Beginning installation\nInstallation completed successfully";

  test("autoUpdater: what is no update", async () => {
    const later = "Update check failed. The server sent an invalid response. Try again later.";
    expect(
      await runInBundle(`
        autoUpdater.checkForUpdates();
        autoUpdater.quitAndInstall();
        for (const options of [undefined, {}, { url: "a", serverType: "b" }]) try { autoUpdater.setFeedURL(options); } catch (error) { print(error.message); }
        await check("", { status: 204, headers: { "X-Given": "1" } });
        await check("", { status: 500 });
        await check("{");
        await check({});
        for (const currentRelease of ["1.2.3", "1.2.2"]) await check({ currentRelease, releases: [] }, { serverType: "json" });
        for (const name of ["older", "forged", "another"]) await check(update(name));
        await check(update("newer", { sha256: "00" }));
        await check(update("newer", { size: 1 }));
        app.quit();`),
    ).toEqual({
      printed: [
        ["Update URL is not set", null, null],
        ["before-quit-for-update"],
        ["No update available, can't quit and install", null, null],
        "Expected an options object with a 'url' property to be provided",
        "Expected options object to contain a 'url' string property in setFeedUrl call",
        "Expected serverType to be 'default' or 'json'",
        ...[["checking-for-update"], ["application/json", "1"], ["update-not-available"]],
        ...[...asked, [later, "SQRLUpdaterErrorDomain", 5]],
        ...[...asked, [later, "SQRLUpdaterErrorDomain", 7]],
        ...[...asked, [later.replace("invalid", "invalid JSON"), "SQRLUpdaterErrorDomain", 6]],
        ...[...asked, ["update-not-available"], ...asked, ["update-not-available"]],
        ...[
          ["Cannot update to a bundle with a lower version number", "SQRLUpdaterErrorDomain", 2],
          ["Code signature did not pass validation: unsatisfied", "SQRLCodeSignatureErrorDomain", -1],
          ["Could not locate update bundle", "SQRLUpdaterErrorDomain", 2],
          [expect.stringContaining("Update download failed"), "SQRLUpdaterErrorDomain", 9],
          [expect.stringContaining("Update download failed"), "SQRLUpdaterErrorDomain", 9],
        ].flatMap(failure => [...asked, ["update-available"], failure]),
      ],
      place: ["1.2.3", "Fixture.app"],
    });
  });

  test("autoUpdater: the name of the new bundle is only a name", async () => {
    const name = String.raw`\0056.\0057..\0057..\0057..\0057Applications\0057Fixture.app\n\c.app`;
    expect(
      await runInBundle(
        `require("fs").renameSync("newer/Other name.app", "newer/" + ${JSON.stringify(name)});
        await check(update("newer"));
        app.quit();`,
        { files: { "Fixture.app": { Contents: contents("1.0.0") } } },
      ),
    ).toMatchObject({ place: ["1.10.0", "Fixture.app"], applications: "1.0.0" });
  });

  test("autoUpdater: a link is no bundle", async () => {
    const { printed, place } = await runInBundle(`
      require("fs").rmSync("older/Fixture.app", { recursive: true });
      require("fs").symlinkSync(path.join(__dirname, "newer/Other name.app"), "older/Fixture.app");
      await check(update("older"));
      app.quit();`);
    expect([printed.at(-1), place]).toEqual([
      ["Could not locate update bundle", "SQRLUpdaterErrorDomain", 2],
      ["1.2.3", "Fixture.app"],
    ]);
  });

  test("autoUpdater: a signature that only this build has", async () => {
    const main = `try { autoUpdater.setFeedURL("http://127.0.0.1/"); } catch (error) { print(error.message); } app.quit();`;
    expect((await runInBundle(main, { signed: `cdhash H"00"` })).printed).toEqual([
      "Could not get code signature for running application",
    ]);
  });

  test("autoUpdater: quitAndInstall() closes the windows, installs and opens the app", async () => {
    expect(
      await runInBundle(
        `const updateTo = update("newer", { notes: "notes", pub_date: "2020-01-02T03:04:05Z", size: archive("newer").length, sha256: Bun.SHA256.hash(archive("newer"), "hex") });
        await check({ currentRelease: "1.10.0", releases: [{ version: "1.9.0" }, { version: "1.10.0", updateTo }] }, { serverType: "json" });
        new BrowserWindow().on("closed", () => print("closed"));
        for (const name of ["window-all-closed", "before-quit", "will-quit"]) app.on(name, () => print(name));
        autoUpdater.quitAndInstall();`,
        { opens: true },
      ),
    ).toEqual({
      printed: [
        ...[...asked, ["update-available"], ["update-downloaded", "notes", "newer", "2020-01-02T03:04:05.000Z"]],
        ...[["before-quit-for-update"], "closed", "window-all-closed", ["before-quit-for-update"]],
        ...["before-quit", "will-quit"],
      ],
      place: ["1.10.0", "Fixture.app"],
      opened: "/place/Fixture.app",
      log: installed,
    });
  });

  test.each([
    ["is installed when the app quits", "", "1.10.0", installed],
    ["stays if the next one fails", `await check(update("forged"));`, "1.10.0", installed],
    ["can be removed", `fs.rmSync("Library", { recursive: true });`, "1.2.3", undefined],
    [
      "is checked again",
      `for (const it of new Bun.Glob("Library/**/signed").scanSync()) await Bun.write(it, "somebody");`,
      "1.2.3",
      expect.stringMatching(/Installation error: [^]*Domain=SQRLCodeSignatureErrorDomain/),
    ],
    [
      "is not a link",
      `fs.rmSync(staged() + "/update.app", { recursive: true }); fs.symlinkSync(path.resolve("newer/Other name.app"), staged() + "/update.app");`,
      "1.2.3",
      expect.stringContaining("Installation error: Error Domain=NSPOSIXErrorDomain"),
    ],
    [
      "has nothing but files, directories and links",
      `require("child_process").execFileSync("mkfifo", [staged() + "/update.app/Contents/pipe"]);`,
      "1.2.3",
      expect.stringContaining("Installation error: Error Domain=NSPOSIXErrorDomain Code=22"),
    ],
  ])("autoUpdater: a downloaded update %s", async (_, meanwhile, version, log) => {
    const result = await runInBundle(`await check(update("newer")); ${meanwhile} app.quit();`);
    expect(result).toEqual({ printed: expect.anything(), place: [version, "Fixture.app"], log });
  });

  test.each(["a\n1\n.app", "-R.app", "$(false).app"])("autoUpdater: a bundle that is called %j", async name => {
    const { printed, place } = await runInBundle(`
      fs.renameSync("newer/Other name.app", "newer/" + ${JSON.stringify(name)});
      await check(update("newer"));
      print(fs.readdirSync(staged()));
      app.quit();`);
    expect([printed.at(-1), place]).toEqual([["update.app"], ["1.10.0", "Fixture.app"]]);
  });

  test("autoUpdater: what has taken the name of the bundle in the meantime is left alone", async () => {
    const { place, log } = await runInBundle(`
      await check(update("newer"));
      fs.writeFileSync("tools/ps", "#!/bin/sh\\nmv place/Fixture.app place/Moved.app && mv another/Fixture.app place", { mode: 0o755 });
      app.quit();`);
    expect([place[0], log]).toEqual(["2.0.0", expect.stringContaining("Could not locate")]);
  });

  const canBeRoot = Bun.spawnSync({ cmd: ["env", "unshare", "-Ur", "true"], stderr: "ignore" }).success;
  test.skipIf(!canBeRoot || process.getuid?.() === 0)("autoUpdater: what root is asked to run", async () => {
    const { printed } = await runInBundle(`
      const made = "newer/Other name.app/Contents/";
      fs.symlinkSync("../../kept", made + "link");
      fs.writeFileSync(made + "tool", "");
      fs.chmodSync(made + "tool", 0o6777);
      await check(update("newer"));
      fs.chmodSync(staged() + "/update.app/Contents/tool", 0o6777);
      const { execFileSync, spawnSync } = require("child_process");
      fs.writeFileSync("installer.js", "");
      execFileSync(process.execPath, ["build", "--compile", "--desktop", "installer.js", "--outfile", "installer"]);
      const installer = path.join(path.dirname(process.execPath), "Installer");
      fs.linkSync(fs.realpathSync("installer.AppDir/AppRun"), installer);
      const install = (directory, ...as) => {
        const { stdout, status } = spawnSync("env", [...as, installer, "--bun-desktop-install-update", directory, String(process.pid)], { env: { ...process.env, BUN_OPTIONS: "--version" } });
        return [stdout.toString(), status];
      };
      for (const name of ["forged", "older", "another"]) fs.renameSync(name + "/Fixture.app", name + "/update.app"), print(install(name, "unshare", "-Ur"));
      print(install(staged()));
      print(install(staged(), "unshare", "-Ur"));
      const installed = "place/Fixture.app/Contents/";
      print([fs.readlinkSync(installed + "link"), (fs.statSync(installed + "tool").mode & 0o7777).toString(8), fs.readdirSync("place")]);
      fs.rmSync("Library", { recursive: true });
      app.quit();`);
    expect(printed.slice(-6)).toEqual([
      [expect.stringContaining("Domain=SQRLCodeSignatureErrorDomain Code=-1"), 1],
      [expect.stringContaining("lower version"), 1],
      [expect.stringContaining("Could not locate"), 1],
      ["", 1],
      ["done", 0],
      ["../../kept", "755", ["Fixture.app"]],
    ]);
  });

  test.skipIf(process.getuid?.() === 0).each([
    ["app.quit()", ["place"], "1.10.0", installed],
    ["app.quit()", ["place/Fixture.app"], "1.2.3", expect.stringContaining("NSPOSIXErrorDomain Code=13")],
    ["autoUpdater.quitAndInstall()", ["place", "place/Fixture.app"], "1.2.3", expect.stringContaining("Code=13")],
  ])("autoUpdater: %s if the user cannot write to %p", async (quit, readOnly, version, log) => {
    const result = await runInBundle(`await check(update("newer")); new BrowserWindow(); ${quit};`, { readOnly });
    expect([result.place, result.log]).toEqual([[version, "Fixture.app"], log]);
  });

  test("app.moveToApplicationsFolder()", async () => {
    expect(await runInBundle(`print(app.moveToApplicationsFolder());`, { opens: true })).toEqual({
      printed: [true],
      place: [undefined],
      applications: "1.2.3",
      opened: "/Applications/Fixture.app",
    });
    expect(
      await runInBundle(
        `print(app.moveToApplicationsFolder({ conflictHandler: it => (print(it), false) })); app.quit();`,
        { files: { "Fixture.app": { Contents: contents("1.0.0") } } },
      ),
    ).toEqual({ printed: ["exists", false], place: ["1.2.3", "Fixture.app"], applications: "1.0.0" });
  });
});
