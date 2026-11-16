import { hasLibrary } from "./library";

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir, tls } from "harness";

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
`;

/** What the app has passed to `print`. */
async function run(main: string, files: Record<string, string> = {}, args: string[] = [], env = {}) {
  using dir = tempDir("electron", {
    "package.json": JSON.stringify({ name: "fixture", productName: "Fixture", version: "1.2.3", main: "main.js" }),
    "main.js": `${prelude}\napp.whenReady().then(async () => {${main}\n}).then(() => app.quit(), error => { console.error(error); app.exit(1); });`,
    ...files,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload=bun:desktop/electron", ".", ...args],
    env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", ...env },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`exited with ${exitCode}\n${stdout}\n${stderr}`);
  return stdout
    .trim()
    .split("\n")
    .map(line => JSON.parse(line));
}

describe.skipIf(!hasLibrary).concurrent("bun:desktop/electron", () => {
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
        const flush = () => print(events.splice(0));
        await page.loadURL("app://trusted/");
        flush();
        page.once("will-navigate", event => event.preventDefault());
        await page.executeJavaScript("document.querySelector('a').click()");
        await once(page, "will-navigate");
        flush();
        page.executeJavaScript("history.pushState({ n: 1 }, '', '/pushed')");
        await once(page, "did-navigate-in-page");
        flush();
        await page.loadURL("app://trusted/r");
        flush();
        print(page.navigationHistory.getAllEntries().map(entry => entry.url));
        page.navigationHistory.goToIndex(0);
        await once(page, "did-finish-load");
        print([page.getURL(), page.navigationHistory.canGoBack(), page.navigationHistory.canGoForward()]);`),
    ).toEqual([
      ["did-start-loading", "did-start-navigation", "did-navigate", "dom-ready", "did-finish-load", "did-stop-loading"],
      ["will-navigate"],
      ["did-start-navigation", "did-navigate-in-page"],
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
         await ses.setProxy({ proxyRules: "socks5://a" });
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
      [`function f() { f() } try { f() } catch (e) {} finally { return "caught" }`]: null,
      [`var s = "a"; while (true) s += s`]: null,
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
    ).toEqual([["ok", "ok", 1], ["localhost", "-----BEGIN CERTIFICATE-----", !isLinux], "net::ERR_FAILED"]);
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
          "/imported.js": "var imported = 5",
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
        page.setZoomFactor(2);
        print(await page.executeJavaScript("[innerWidth, innerHeight, devicePixelRatio]"));
        page.on("before-input-event", (event, input) => input.key === "b" && event.preventDefault());
        page.focus();
        await page.executeJavaScript("typed = []; onkeydown = event => typed.push(event.key); document.querySelector('input').focus()");
        for (const keyCode of ["a", "b"]) page.sendInputEvent({ type: "keyDown", keyCode });
        page.sendInputEvent({ type: "char", keyCode: "a" });
        print(await page.executeJavaScript("[typed, document.activeElement.value]"));
        const image = await page.capturePage({ x: 190, y: 90, width: 2, height: 1 });
        print([image.getSize(), [...image.toBitmap()]]);
        page.findInPage("nothing");
        print((await once(page, "found-in-page"))[1].matches);
        page.close();
        print([page.isDestroyed(), electron.webContents.getAllWebContents().length]);`),
    ).toEqual([
      [200, 100],
      [100, 50, 2],
      [["a"], "a"],
      [{ width: 2, height: 1 }, [0, 0, 255, 255, 0, 0, 255, 255]],
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
    ).toEqual([["B", "A", "separator", "Reload"], 1]);
  });
});
