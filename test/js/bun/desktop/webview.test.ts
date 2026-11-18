import { hasLibrary } from "./library";

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const chromium = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "microsoft-edge"]
  .map(name => Bun.which(name))
  .find(Boolean);
const args = process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const engines = [
  { type: "chromium", path: process.env.BUN_CHROME_PATH ?? chromium, args },
  { type: "electron", path: process.env.BUN_DESKTOP_TEST_ELECTRON, args },
];

const prelude = `
  const { app, BrowserWindow, WebContentsView, ipcMain, protocol, session } = require("electron");
  const { once } = require("events");
  const path = require("path");
  app.setPath("userData", path.join(__dirname, "data"));
  app.setWebEngine(JSON.parse(process.env.ENGINE));
  protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  app.trustOrigins(["app://trusted"]);
  const print = value => console.log(JSON.stringify(value));
  const respond = (body, headers) => typeof body === "function" ? body : () => new Response(body, { headers: { "content-type": "text/html", ...headers } });
  /** The origin of a site that is not trusted. */
  const site = files => Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => respond(files[new URL(request.url).pathname] ?? "")(request) }).url.origin;
  const open = async (html, headers, options) => {
    protocol.handle("app", respond(html, headers));
    const window = new BrowserWindow({ width: 400, height: 300, ...options });
    await window.loadURL("app://trusted/");
    return window.webContents;
  };
  const inbox = "<script>const seen = [], waiting = []; onmessage = e => (waiting.shift() ?? (e => seen.push(e)))(e); next = () => new Promise(r => seen.length ? r(seen.shift()) : waiting.push(r));</script>";
  const click = (page, x, y) => { for (const type of ["mouseMove", "mouseDown", "mouseUp"]) page.sendInputEvent({ type, x, y, button: "left" }); };
  const pixel = async (page, x, y) => [...(await page.capturePage({ x, y, width: 1, height: 1 })).toBitmap().subarray(0, 4)].join();
  const until = async condition => {
    for (const end = Date.now() + 60_000; !(await condition()); await new Promise(setImmediate)) if (Date.now() > end) process.exit(2);
  };
`;

async function spawn(files: Record<string, string>, engine: object | null, ...cmd: string[]) {
  using dir = tempDir("webview", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", ENGINE: JSON.stringify(engine), XDG_CONFIG_HOME: String(dir) },
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

/** What the app has passed to `print`. */
const runWith =
  (engine: object | null) =>
  (main: string, files: Record<string, string> = {}) =>
    spawn(
      {
        "package.json": JSON.stringify({ name: "fixture", main: "main.js" }),
        "main.js": `${prelude}\napp.whenReady().then(async () => {${main}\n}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });`,
        ...files,
      },
      engine,
      "--preload=bun:desktop/electron",
      ".",
    );

describe.skipIf(!hasLibrary).concurrent("in the process of the app", () => {
  const run = runWith(null);

  test("without a web engine, a frame stays empty", async () => {
    expect(
      await run(`
        let requests = 0;
        const origin = site({ "/": () => (requests++, new Response("")) });
        const page = await open('<iframe src="' + origin + '"></iframe><iframe srcdoc="<script>parent.ran = 1</script>"></iframe>');
        print(await page.executeJavaScript("[typeof ran, frames.length, document.querySelector('iframe').contentDocument]"));
        print(await page.loadURL(origin).catch(error => error.code));
        print(requests);`),
    ).toEqual([["undefined", 2, null], "ERR_BLOCKED_BY_CLIENT", 0]);
  });

  test("markup that is put into a page without a policy does not become code", async () => {
    expect(
      await run(`
        const origin = site({ "/a.js": () => new Response("ran.push('remote')", { headers: { "content-type": "text/javascript", "access-control-allow-origin": "*" } }) });
        const page = await open('<script>ran = ["own script"]</script><b onclick="ran.push(&quot;own handler&quot;)"></b>');
        print(await page.executeJavaScript(\`(async () => {
          document.querySelector("b").click();
          const add = html => document.body.appendChild(document.createRange().createContextualFragment(html)) && document.body.lastChild;
          const failed = it => new Promise(resolve => it.addEventListener("error", resolve));
          add("<script>ran.push('script')<" + "/script>");
          add("<script type=module>ran.push('module')<" + "/script>");
          add("<i onclick='ran.push(1)'></i>").click();
          add("<a href='javascript:ran.push(2)'></a>").click();
          add("<iframe></iframe>").contentDocument.body.innerHTML = "<i onclick='ran.push(3)'></i>";
          frames[0].document.body.firstChild.click();
          await failed(add("<script src='data:text/javascript,ran.push(4)'><" + "/script>"));
          await failed(add("<script src='\${origin}/a.js'><" + "/script>"));
          await import("\${origin}/a.js").catch(() => ran.push("refused"));
          return ran;
        })()\`));`),
    ).toEqual([["own script", "own handler", "refused"]]);
  });

  test("a policy cannot let in the scripts of another party", async () => {
    expect(
      await run(`
        const origin = site({ "/a.js": () => new Response("ran = 1", { headers: { "content-type": "text/javascript" } }) });
        const page = await open('<script src="' + origin + '/a.js"></script>', { "content-security-policy": "script-src *" });
        print(await page.executeJavaScript("typeof ran"));`),
    ).toEqual(["undefined"]);
  });

  test("the policy holds for handlers that come from a document without a window", async () => {
    expect(
      await run(`
        const page = await open("", { "content-security-policy": "script-src 'self'" });
        print(await page.executeJavaScript(\`(\${() => {
          const template = Object.assign(document.createElement("template"), { innerHTML: "<b onclick='ran = 1'></b>" });
          const parsed = new DOMParser().parseFromString("<b onclick='ran = 2'></b>", "text/html");
          for (const element of [template.content.firstChild, parsed.body.firstChild]) document.body.appendChild(element).click();
          return typeof ran;
        }})()\`));`),
    ).toEqual(["undefined"]);
  });

  test("what decides whether a script runs cannot be talked round", async () => {
    expect(
      await run(`
        app.trustOrigins([], { except: ["app://trusted/user/*"] });
        const page = await open(({ url }) => url.endsWith("upload")
          ? new Response("<script>ran = 1</script>", { headers: { "content-type": 'text/plain; name="a.html"' } })
          : respond("<p>a onx=ran=2 b</p><!-- <i onx=ran=3> --><textarea><i onx=ran=5></textarea><noscript><i onx=ran=6></noscript><template><i onclick=own=1></i></template><script type=application/json>{ \\"a\\": \\" onx=ran=4 \\" }</script>")());
        print(await page.executeJavaScript(\`(\${() => {
          document.body.appendChild(document.querySelector("template").content.firstChild.cloneNode()).click();
          if (typeof own === "undefined") return "the handler of the template did not run";
          const policy = "<meta http-equiv=Content-Security-Policy content=\\"default-src * 'unsafe-inline'\\">";
          document.body.append(new DOMParser().parseFromString("<head>" + policy + "</head>", "text/html").documentElement);
          for (const n of [2, 3, 4, 5, 6, 7]) {
            document.body.insertAdjacentHTML("beforeend", "<b onclick=ran=" + n + "></b>");
            document.body.lastChild.click();
          }
          return typeof ran;
        }})()\`));
        for (const url of ["app://trusted/user/a", "app://x@trusted/user/a", "app://trusted/%75ser/a", "app://trusted//user/a"]) {
          print(await page.loadURL(url).then(() => "loaded", () => "refused"));
        }
        await page.loadURL("app://trusted/upload");
        print(await page.executeJavaScript("typeof ran"));`),
    ).toEqual(["undefined", "refused", "refused", "refused", "refused", "undefined"]);
  });

  test("what the app throws or returns to a page is of the realm of the page", async () => {
    expect(
      await run(`
        const page = await open("");
        print(await page.executeJavaScript(\`(\${async () => {
          const thrown = run => Promise.try(run).then(value => value, error => error);
          const directory = await navigator.storage.getDirectory();
          const opening = indexedDB.open("a");
          opening.onupgradeneeded = () => opening.result.createObjectStore("b").put(1, 2);
          await new Promise(resolve => (opening.onsuccess = resolve));
          const keys = opening.result.transaction("b").objectStore("b").getAllKeys();
          await new Promise(resolve => (keys.onsuccess = resolve));
          const all = [await thrown(() => prompt()), await thrown(() => directory.getFileHandle("a".repeat(300), { create: true })), keys.result];
          return all.map(it => it instanceof Object);
        }})()\`));`),
    ).toEqual([[true, true, true]]);
  });

  test("a download that does not finish leaves the file alone", async () => {
    expect(
      await run(`
        const file = path.join(__dirname, "kept.txt");
        await Bun.write(file, "kept");
        const done = new Promise(resolve => session.defaultSession.on("will-download", (_, item) => {
          item.once("done", (_, state) => resolve(state));
          item.setSavePath(file);
          item.cancel();
        }));
        session.defaultSession.downloadURL(site({}));
        print([await done, await Bun.file(file).text()]);`),
    ).toEqual([["cancelled", "kept"]]);
  });

  test("setCompiledScripts with source", async () => {
    expect(
      await run(`
        const source = async url => ({ "/a.js": "export { default } from './b.js'", "/b.js": "export default 'b'" })[new URL(url).pathname];
        app.setCompiledScripts({}, { exclusive: true, source });
        const page = await open("<p>");
        print(await page.executeJavaScript("Promise.all(['/a.js', '/c.js'].map(url => import(url).then(all => all.default, () => 'refused')))"));
      `),
    ).toEqual([["b", "refused"]]);
  });

  test("setCompiledScripts with exclusive", async () => {
    expect(
      await run(`
        app.setCompiledScripts({}, { exclusive: true });
        const page = await open(
          request => request.url.endsWith(".js")
            ? new Response("ran.push('file')", { headers: { "content-type": "text/javascript" } })
            : respond("<script>ran = ['own']</script><script src=/a.js></script>", { "content-security-policy": "script-src * blob: data: 'unsafe-inline' 'unsafe-eval'" })(),
        );
        print(await page.executeJavaScript(\`(\${async () => {
          document.body.append(Object.assign(document.createElement("script"), { text: "ran.push('injected')" }));
          setTimeout("ran.push('timer')");
          const blob = URL.createObjectURL(new Blob(["ran.push('blob')"], { type: "text/javascript" }));
          for (const url of ["/a.js", blob, "data:text/javascript,ran.push('data')"]) await import(url).catch(() => {});
          await new Promise(resolve => Object.assign(new Worker(blob), { onerror: event => resolve(event.message && ran.push("worker")) }));
          await new Promise(resolve => setTimeout(resolve));
          try { new Function("ran.push('Function')")(); } catch {}
          return ran;
        }})()\`));`),
    ).toEqual([["own"]]);
  });

  test("base-uri, form-action and wasm-unsafe-eval", async () => {
    expect(
      await run(`
        const page = await open('<base href="app://other/"><form action="app://other/"></form>', {
          "content-security-policy": "script-src 'self'; base-uri 'self'; form-action 'self'",
        });
        page.on("will-navigate", (_, url) => print(url));
        print(await page.executeJavaScript(\`document.forms[0].submit(), WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => "compiled", error => [document.baseURI, error.name])\`));`),
    ).toEqual([["app://trusted/", "CompileError"]]);
  });

  test("a page does not navigate to data: or file:", async () => {
    expect(
      await run(`
        const page = await open("");
        const messages = [];
        for (const url of ["data:text/html,a", "file:///"]) {
          page.executeJavaScript("location.href = '" + url + "'");
          messages.push((await once(page, "console-message"))[0].message);
        }
        print([messages, page.getURL()]);`),
    ).toEqual([
      [
        ["Not allowed to navigate top frame to data URL", "Not allowed to navigate top frame to file URL"],
        "app://trusted/",
      ],
    ]);
  });

  test("a link does not download or open a local file", async () => {
    expect(
      await run(`
        const file = Bun.pathToFileURL(__filename).href;
        const page = await open('<a download href="' + file + '"></a><a target=_blank href="' + file + '"></a>');
        page.session.on("will-download", () => print("download"));
        page.setWindowOpenHandler(() => (print("open"), { action: "deny" }));
        for (const index of [0, 1]) {
          page.executeJavaScript("document.links[" + index + "].click()", true);
          print((await once(page, "console-message"))[0].message);
        }`),
    ).toEqual(["Not allowed to navigate top frame to file URL", "Not allowed to load local resource"]);
  });

  test("a port from the main process belongs to the realm of the page", async () => {
    expect(
      await run(
        `const { MessageChannelMain } = require("electron");
         const page = await open(inbox, {}, { webPreferences: { preload: path.join(__dirname, "preload.js") } });
         page.postMessage("port", null, [new MessageChannelMain().port1]);
         print(await page.executeJavaScript("next().then(e => e.ports[0].constructor.constructor('return typeof Bun')())"));`,
        { "preload.js": `require("electron").ipcRenderer.on("port", e => window.postMessage(1, "*", e.ports));` },
      ),
    ).toEqual(["undefined"]);
  });

  test("a page does not get at what Bun has more than a browser", async () => {
    expect(
      await run(`
        const page = await open("<iframe srcdoc=a></iframe>");
        print(await page.executeJavaScript(\`(\${() => {
          const thrown = run => { try { run(); } catch (error) { return error; } };
          const inherits = Class => Object.getPrototypeOf(Class).name + Object.getPrototypeOf(Class.prototype).constructor.name;
          return [
            thrown(() => new Blob(["a"]).image()) instanceof TypeError,
            thrown(() => window[0].postMessage(() => {}, "*")) instanceof DOMException,
            document.createElement("canvas").getContext("2d").getImageData(0, 0, 1, 1).data.buffer instanceof ArrayBuffer,
            inherits(WebSocket),
            inherits(BroadcastChannel),
            new BroadcastChannel("a").name,
          ];
        }})()\`));`),
    ).toEqual([[true, true, true, "EventTargetEventTarget", "EventTargetEventTarget", "a"]]);
  });

  test("markup that is put into a Window does not become code", async () => {
    expect(
      await spawn(
        {
          "main.js": `
            import { Window, app } from "bun:desktop";
            globalThis.ran = [];
            const window = new Window();
            await window.loadHTML("<script>ran.push('own')</script>");
            document.body.innerHTML = "<i onclick='ran.push(1)'></i><a href='javascript:ran.push(2)'></a>";
            for (const element of document.body.children) element.click();
            document.body.append(document.createRange().createContextualFragment("<script>ran.push(3)</script>"));
            setTimeout(() => (console.log(JSON.stringify(ran)), app.exit(0)));`,
        },
        null,
        "--preload=bun:desktop/dom",
        "main.js",
      ),
    ).toEqual([["own"]]);
  });

  test("a Window runs the modules of the app, and no others", async () => {
    expect(
      await spawn(
        {
          "main.js": `
            import { Window, app } from "bun:desktop";
            globalThis.ran = [];
            const other = Bun.serve({ port: 0, fetch: () => new Response("ran.push('other')", { headers: { "content-type": "text/javascript" } }) }).url;
            const window = new Window();
            await window.loadFile("index.html");
            const second = new Window();
            await second.loadHTML("<script>ran.push('second')</script><script type=module>ran.push('second')</script>");
            for (const type of ["module", "text/javascript"]) {
              const script = Object.assign(document.createElement("script"), { type, src: other });
              await new Promise(resolve => ((script.onload = script.onerror = resolve), document.head.append(script)));
            }
            await last;
            console.log(JSON.stringify(ran.sort()));
            app.exit(0);`,
          "index.html": `<script>globalThis.last = new Promise(resolve => (globalThis.done = resolve))</script><script src=a.js></script>
            <script type=module src=b.js></script><script type=module>ran.push("inline"); done()</script>`,
          "a.js": `ran.push("classic")`,
          "b.js": `ran.push(typeof import.meta.url)`,
        },
        null,
        "--preload=bun:desktop/dom",
        "main.js",
      ),
    ).toEqual([["classic", "inline", "string"]]);
  });

  test("a message to a Window has the ports of the runtime", async () => {
    expect(
      await spawn(
        {
          "main.js": `
            import { Window, app } from "bun:desktop";
            const { window } = new Window();
            const { port1, port2 } = new MessageChannel();
            port1.onmessage = ({ data }) => (console.log(JSON.stringify(data)), app.exit(0));
            window.onmessage = event => {
              const { data, ports, source } = event;
              ports[0].postMessage([event instanceof MessageEvent, ports.length, data.port === ports[0], source === window]);
            };
            const bytes = new ArrayBuffer(1);
            window.postMessage({ port: port2, bytes }, "*", [bytes, port2]);`,
        },
        null,
        "main.js",
      ),
    ).toEqual([[true, 1, true, true]]);
  });

  test("the link under the mouse is reported, and only the page gets ready to show", async () => {
    expect(
      await run(`
        app.trustOrigins(["app://trusted"], { inFrames: true });
        const page = await open("<a href=/next style='position:fixed;inset:0 50% 0 0'><b>a</b></a>");
        const seen = [];
        page.on("ready-to-show", () => seen.push("ready"));
        await page.capturePage();
        await new Promise(setImmediate);
        seen.length = 0;
        await page.executeJavaScript("new Promise(r => document.body.append(Object.assign(document.createElement('iframe'), { srcdoc: 'a', onload: () => requestAnimationFrame(() => requestAnimationFrame(r)), style: 'width:9px;height:9px' })))");
        for (const x of [100, 300]) {
          page.sendInputEvent({ type: "mouseMove", x, y: 200 });
          seen.push((await once(page, "update-target-url"))[1]);
        }
        print(seen);`),
    ).toEqual([["app://trusted/next", ""]]);
  });

  test("a javascript: URL is subject to the policy", async () => {
    expect(
      await run(`
        const page = await open("<a href='javascript:void(ran = 1)'></a>", { "content-security-policy": "script-src 'self'" });
        print(await page.executeJavaScript("new Promise(r => { onsecuritypolicyviolation = document.onsecuritypolicyviolation = e => r([e.effectiveDirective, typeof ran]); document.links[0].click() })"));`),
    ).toEqual([["script-src-elem", "undefined"]]);
  });

  test("a malformed or huge box does not stop the painting", async () => {
    expect(
      await run(`
        const page = await open('<body style="margin:0"><div style="height:9999999px;border-radius:3px;background:#f00">');
        print(await pixel(page, 50, 50));`),
    ).toEqual(["0,0,255,255"]);
  });
});

for (const engine of engines) {
  const isElectron = engine.type === "electron";
  const trusted = isElectron ? "app://trusted" : "https://trusted.app.invalid";
  const run = runWith(engine);

  describe.skipIf(!hasLibrary || !engine.path).concurrent(`in the web engine: ${engine.type}`, () => {
    test("a frame has nothing of the app, and its messages have its origin", async () => {
      const [origin, ...rest] = await run(`
        const origin = site({ "/": "<script>parent.postMessage([typeof Bun, typeof process, typeof require, location.ancestorOrigins[0]], '*'); onmessage = e => e.ports[0].postMessage([e.data, e.origin])</script>" });
        const page = await open(inbox + '<iframe src="' + origin + '"></iframe><iframe sandbox=allow-scripts srcdoc="<script>parent.postMessage(typeof Bun, &quot;*&quot;)</script>"></iframe>');
        print(origin);
        print(await page.executeJavaScript(\`(async () => {
          const first = [await next(), await next()].sort((a, b) => a.origin < b.origin ? -1 : 1);
          const ask = target => new Promise(resolve => {
            const { port1, port2 } = new MessageChannel();
            port1.onmessage = e => resolve(e.data);
            frames[0].postMessage(new Map([[1n, new Uint8Array([2])]]), target, [port2]);
          });
          const [data, from] = await Promise.race([ask("http://other.invalid").then(() => ["leaked"]), ask("\${origin}")]);
          let error;
          try { frames[0].document } catch (thrown) { error = thrown.name }
          return [first.map((e, i) => [e.data, e.origin, e.source === frames[i]]), data.get(1n)[0], from, error];
        })()\`));
        print(page.mainFrame.frames.map(frame => [frame.origin, frame.parent === page.mainFrame, frame.top === page.mainFrame]).sort());`);
      expect(rest).toEqual([
        [
          [
            [["undefined", "undefined", "undefined", trusted], origin, true],
            ["undefined", "null", true],
          ],
          2,
          trusted,
          "SecurityError",
        ],
        [
          [origin, true, true],
          ["null", true, true],
        ],
      ]);
    });

    test("a frame is painted below what is above it, and only gets its own input", async () => {
      expect(
        await run(`
          const inner = site({ "/": "<body style='margin:0;background:#0f0;height:100vh' onclick='top.postMessage([&quot;inner&quot;, event.clientX, event.clientY, event.isTrusted], &quot;*&quot;)' onload='top.postMessage(0, &quot;*&quot;)'>" }).replace("127.0.0.1", "localhost");
          const outer = site({ "/": "<body style='margin:0;background:#f00'><input style='position:absolute;inset:0;width:50px' oninput='top.postMessage(value, &quot;*&quot;)' onfocus='top.postMessage(1, &quot;*&quot;)'><iframe style='position:absolute;left:100px;top:50px;border:0' src='" + inner + "'></iframe>" });
          const page = await open(inbox + '<body style="margin:0;background:#fff"><iframe style="position:absolute;left:10px;top:20px;border:0;border-radius:30px" src="' + outer + '"></iframe><div style="position:absolute;left:200px;top:100px;width:20px;height:20px;background:#00f" onclick="postMessage(2)"></div>');
          const next = () => page.executeJavaScript("next().then(e => e.data)");
          await next();
          await until(async () => (await pixel(page, 150, 100)) === "0,255,0,255");
          print([await pixel(page, 80, 100), await pixel(page, 210, 110), await pixel(page, 308, 22)]);
          page.focus();
          click(page, 150, 100);
          print(await next());
          click(page, 210, 110);
          print(await next());
          click(page, 40, 30);
          print(await next());
          page.sendInputEvent({ type: "char", keyCode: "é" });
          print([await next(), await page.executeJavaScript("document.activeElement.localName")]);`),
      ).toEqual([["0,0,255,255", "255,0,0,255", "255,255,255,255"], ["inner", 40, 30, true], 2, 1, ["é", "iframe"]]);
    });

    test("frame-src and sandbox hold", async () => {
      expect(
        await run(`
          let requests = 0;
          const refused = site({ "/": () => (requests++, new Response("")) });
          const allowed = site({
            "/": "<script>try { top.location = '/top' } catch (e) { parent.postMessage([e.name, origin, String(open('/popup'))], '*') }</script>",
            "/r": () => Response.redirect(refused, 302),
          });
          const page = await open(
            '<iframe src="' + refused + '"></iframe><iframe sandbox=allow-scripts src="' + allowed + '"></iframe><iframe src="' + allowed + '/r"></iframe>',
            { "content-security-policy": "frame-src " + allowed },
          );
          const failed = once(page, "did-fail-load");
          print(await page.executeJavaScript("new Promise(resolve => onmessage = e => resolve(e.data))"));
          await failed;
          print([requests, page.getURL()]);`),
      ).toEqual([
        ["SecurityError", "null", "null"],
        [0, "app://trusted/"],
      ]);
    });

    test("a window goes to a site and comes back", async () => {
      const [origin, ...rest] = await run(`
        const origin = site({ "/": "<title>Site</title><a href=/no>no</a>", "/back": () => Response.redirect(${JSON.stringify(trusted)} + "/back", 302) });
        const page = await open("<title>App</title>");
        print(origin);
        page.executeJavaScript("location.href = '" + origin + "'");
        await once(page, "did-finish-load");
        print([page.getURL(), page.getTitle(), page.mainFrame.origin, page.getOSProcessId() === process.pid, await page.executeJavaScript("typeof RTCPeerConnection")]);
        page.once("will-navigate", event => event.preventDefault());
        page.executeJavaScript("document.links[0].click()");
        print((await once(page, "will-navigate"))[1]);
        page.executeJavaScript("location.href = '/back'");
        await until(() => page.getURL() === "app://trusted/back" && !page.isLoading());
        print([page.getOSProcessId() === process.pid, page.navigationHistory.getAllEntries().map(it => it.url)]);`);
      expect(rest).toEqual([
        [origin + "/", "Site", origin, false, "function"],
        origin + "/no",
        [true, ["app://trusted/", origin + "/", "app://trusted/back"]],
      ]);
    });

    const echo = `
      const names = ["sec-fetch-site", "sec-fetch-user", "cookie", "origin", "referer"];
      app.on("window-all-closed", () => {});
      let last;
      const echo = async request => {
        last = [request.method, ...names.map(it => request.headers.get(it)?.replace(/:\\d+/, "") ?? null)];
        if (request.method === "POST") {
          const [type, boundary] = request.headers.get("content-type").split("; boundary=");
          last.push(type, Buffer.from(await request.bytes()).toString("latin1").replaceAll(boundary, "B"));
        }
        return respond("<title>echo</title>")();
      };
      const redirect = request => Response.redirect(new URL(request.url).search.slice(1));
      const other = site({ "/echo": echo, "/to": redirect, "/nothing": () => new Response(null, { status: 204 }), "/top": "<script>top.location = location.search.slice(1)</script>" }).replace("127.0.0.1", "localhost");
      const own = site({ "/echo": echo, "/quiet": "<meta name=referrer content=no-referrer>", "/to": redirect, "/echo/to": redirect, "/trusted": echo });
      app.trustOrigins([own], { except: [own + "/echo", own + "/echo/*"] });
      for (const url of [own, other]) for (const sameSite of ["strict", "lax"])
        await session.defaultSession.cookies.set({ url, name: sameSite, value: "1", sameSite });
      const events = ["did-start-loading", "did-start-navigation", "will-navigate", "navigation-entry-committed", "did-navigate", "did-finish-load", "did-stop-loading"];
      const go = async (from, script, isByUser) => {
        const { webContents: page } = new BrowserWindow();
        for (const url of new Set([own + "/a", from])) await page.loadURL(url);
        await until(() => !page.isLoading());
        const seen = [];
        for (const name of events) page.on(name, (_, url, __, replaces) => seen.push(name === events[3] ? name + " " + replaces : name));
        page.executeJavaScript(script, isByUser).catch(() => {});
        await once(page, "did-stop-loading");
        return { page, seen, entries: page.navigationHistory.getAllEntries().map(it => it.url.replace(/:\\d+/, "")) };
      };`;

    test.each([
      [`own + "/a", other + "/echo"`, ["cross-site", null, "lax=1", null, "http://127.0.0.1/"]],
      [`own + "/a", other + "/echo", true`, ["cross-site", "?1", "lax=1", null, "http://127.0.0.1/"]],
      [`own + "/quiet", other + "/echo"`, ["cross-site", null, "lax=1", null, null]],
      [`own + "/a", own + "/echo"`, ["same-origin", null, "strict=1; lax=1", null, "http://127.0.0.1/a"]],
      [`own + "/a", own + "/to?" + other + "/echo"`, ["cross-site", null, "lax=1", null, "http://127.0.0.1/"]],
      [`other + "/", own + "/to?" + own + "/echo"`, ["cross-site", null, "lax=1", null, "http://localhost/"]],
    ])("a site is told who has asked for its page: %s", async (given, headers) => {
      expect(
        await run(`${echo}
          const [from, to, isByUser] = [${given}];
          await go(from, "void (location = '" + to + "')", isByUser);
          await until(() => last);
          print(last);`),
      ).toEqual([["GET", ...headers]]);
    });

    const back = `own + "/trusted"`;
    test.each([
      ["the page", `own + "/echo"`, `location = to`, ["same-origin", "strict=1; lax=1"]],
      ["the page, by a redirect", `own + "/echo"`, `location = "/echo/to?" + to`, ["same-origin", "strict=1; lax=1"]],
      ["the page, by another site", `own + "/echo"`, `location = other + "/to?" + to`, ["cross-site", "lax=1"]],
      ["a frame", `own + "/echo"`, `frame(to)`, ["cross-site", "lax=1"]],
      ["a frame, by a redirect", `own + "/echo"`, `frame(location.origin + "/echo/to?" + to)`, ["cross-site", "lax=1"]],
      ["another site, by a redirect", `other + "/"`, `location = own + "/echo/to?" + to`, ["cross-site", "lax=1"]],
    ])("a trusted site is told who has asked for its page: %s", async (_, from, script, headers) => {
      expect(
        await run(`${echo}
          const { page } = await go(${from}, "{ const [own, other, to] = " + JSON.stringify([own, other, ${back}]) + ";" + ${JSON.stringify(
            `const frame = to => document.body.append(Object.assign(document.createElement("iframe"), { sandbox: "allow-scripts allow-same-origin allow-top-navigation", src: other + "/top?" + to })); ${script}; }`,
          )});
          await until(() => page.getURL() === ${back} && !page.isLoading());
          print([last[1], last[3]]);`),
      ).toEqual([headers]);
    });

    test("a trusted site is told that a window has asked for the page of its opener", async () => {
      expect(
        await run(`${echo}
          const { page } = await go(own + "/a", "void (location = '/echo')");
          page.executeJavaScript("void open('" + other + "/')", true);
          const [{ webContents: opened }] = await once(page, "did-create-window");
          await until(() => opened.getURL() === other + "/" && !opened.isLoading());
          await opened.executeJavaScript("void (opener.location = '" + own + "/trusted')", true);
          await until(() => page.getURL() === ${back} && !page.isLoading());
          print([last[1], last[3]]);`),
      ).toEqual([["cross-site", "lax=1"]]);
    });

    test("a site is told again who has asked for its page when the history goes back to it", async () => {
      expect(
        await run(`${echo}
          const { page } = await go(own + "/a", "void (location = '" + other + "/echo')");
          await page.loadURL(own + "/b");
          last = undefined;
          const seen = [];
          for (const name of events) page.on(name, () => seen.push(name));
          page.navigationHistory.goBack();
          await until(() => page.getURL() === other + "/echo" && !page.isLoading());
          const { navigationHistory: history } = page;
          print([last[1], last[3], seen.includes("will-navigate"), history.getActiveIndex(), history.getAllEntries().map(it => new URL(it.url).pathname)]);`),
      ).toEqual([["cross-site", "lax=1", false, 1, ["/a", "/echo", "/b"]]]);
    });

    test("a site is told that the app has asked for its page", async () => {
      expect(await run(`${echo} await new BrowserWindow().loadURL(other + "/echo"); print(last);`)).toEqual([
        ["GET", "none", "?1", "strict=1; lax=1", null, null],
      ]);
    });

    test.each([
      ["noopener", "http://127.0.0.1/"],
      ["noreferrer", null],
    ])("a site is told who has opened it with %s", async (rel, referrer) => {
      expect(
        await run(`${echo}
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(own + "/a");
          page.executeJavaScript("void open('" + other + "/echo', '', '${rel}')");
          const [opened] = await once(page, "did-create-window");
          await until(() => opened.webContents.getTitle() === "echo");
          print([last, opened.webContents.navigationHistory.length()]);`),
      ).toEqual([[["GET", "cross-site", null, "lax=1", null, referrer], 1]]);
    });

    test("a site is told that a frame has asked for its page", async () => {
      expect(
        await run(`${echo}
          protocol.handle("app", respond('<iframe sandbox="allow-scripts allow-same-origin allow-top-navigation" src="' + other + "/top?" + own + '/echo"></iframe>'));
          const { webContents: page } = new BrowserWindow();
          page.loadURL("app://trusted/").catch(() => {});
          await until(() => page.getTitle() === "echo");
          print(last.slice(0, 4));`),
      ).toEqual([["GET", "cross-site", null, "lax=1"]]);
    });

    test.each([
      ["location = '/b'", "will-navigate,navigation-entry-committed false,did-navigate,did-finish-load", 3],
      ["location.replace('/b')", "will-navigate,navigation-entry-committed true,did-navigate,did-finish-load", 2],
      ["history.pushState(0, '', '/b')", "navigation-entry-committed false,did-navigate-in-page", 3],
      ["location.reload()", "will-navigate,navigation-entry-committed false,did-navigate,did-finish-load", 2],
      [
        "location = 'http://localhost:1/'",
        "will-navigate,navigation-entry-committed false,did-fail-provisional-load,did-fail-load,did-finish-load",
        3,
      ],
      ["location = '/nothing'", "will-navigate", 2],
    ])("what the app hears if a site does %s", async (script, heard, length) => {
      expect(
        await run(`${echo}
          events.push("did-navigate-in-page", "did-fail-provisional-load", "did-fail-load");
          const { seen, entries } = await go(other + "/", "void (${script})", true);
          print([seen.slice(2, -1).join(), entries.length]);`),
      ).toEqual([[heard, length]]);
    });

    test("a site opens a window and closes its own", async () => {
      expect(
        await run(`${echo}
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(other + "/");
          print(await page.executeJavaScript("history.length"));
          page.executeJavaScript("void open('/c')", true);
          const [opened] = await once(page, "did-create-window");
          print((await once(opened.webContents, "will-navigate"))[1] === other + "/c");
          page.executeJavaScript("close()").catch(() => {});
          await once(page, "destroyed");`),
      ).toEqual([1, true]);
    });

    test("one load right after the other", async () => {
      expect(
        await run(`
          const origin = site({ "/leaves": request => (print(request.headers.get("x-given")), respond("<script>location = '/to'</script>")()), "/to": request => (print(request.headers.get("x-given")), respond("<title>to</title>")()) });
          const { webContents: page } = new BrowserWindow();
          page.on("will-navigate", (_, url) => print(url.slice(origin.length)));
          for (let i = 0; i < 12; i++) await page.loadURL(origin + "/" + i);
          page.loadURL(origin + "/leaves", { extraHeaders: "x-given: 1" }).catch(() => {});
          await until(() => page.getTitle() === "to");`),
      ).toEqual(["1", "/to", null]);
    });

    test("the listeners of webRequest hear of what a page has asked for, and of nothing else", async () => {
      expect(
        await run(`${echo}
          session.defaultSession.webRequest.onBeforeRequest(({ url }, answer) => {
            if (!url.startsWith(other + "/favicon")) print(url.replace(/:\\d+/, ""));
            answer({});
          });
          await go(own + "/a", "void (location = '" + other + "/echo')");`),
      ).toEqual(["http://127.0.0.1/a", "http://localhost/echo"]);
    });

    test("a form is sent to a site as it is", async () => {
      const part = (name: string, value: string) =>
        `--B\r\nContent-Disposition: form-data; name=${name}\r\n\r\n${value}\r\n`;
      const file = (name: string, type: string) => `"f"; filename="${name}"\r\nContent-Type: ${type}`;
      expect(
        await run(`${echo}
          for (const type of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data"]) {
            const { entries } = await go(own + "/a", \`(\${(action, type) => {
              document.body.innerHTML = '<form method=post accept-charset=utf-8><input name=_charset_ value="é €+%&="><textarea name=submit>a&#10;b</textarea><input type=file name=f><input type=file name=f></form>';
              const chosen = new DataTransfer();
              chosen.items.add(new File([Uint8Array.of(0, 128, 255)], 'é".bin', { type: "a/b" }));
              document.forms[0].elements[2].files = chosen.files;
              HTMLFormElement.prototype.submit.call(Object.assign(document.forms[0], { action, enctype: type }));
            }})("\${other}/echo", "\${type}")\`, true);
            print([last, entries]);
          }`),
      ).toEqual(
        [
          [
            "application/x-www-form-urlencoded",
            "_charset_=%C3%A9+%E2%82%AC%2B%25%26%3D&submit=a%0D%0Ab&f=%C3%A9%22.bin&f=",
          ],
          ["text/plain", '_charset_=\xc3\xa9 \xe2\x82\xac+%&=\r\nsubmit=a\r\nb\r\nf=\xc3\xa9".bin\r\nf=\r\n'],
          [
            "multipart/form-data",
            part('"_charset_"', "\xc3\xa9 \xe2\x82\xac+%&=") +
              part('"submit"', "a\r\nb") +
              part(file("\xc3\xa9%22.bin", "a/b"), "\0\x80\xff") +
              part(file("", "application/octet-stream"), "") +
              "--B--\r\n",
          ],
        ].map(sent => [
          ["POST", "cross-site", "?1", null, "http://127.0.0.1", "http://127.0.0.1/", ...sent],
          ["http://127.0.0.1/a", "http://localhost/echo"],
        ]),
      );
    });

    test("what the app hears of a page that goes to a site", async () => {
      expect(
        await run(`${echo}
          for (const script of ["location.assign('" + other + "/echo')", "location.replace('" + other + "/echo')", "location.assign('" + other + "/nothing')"]) {
            const { page, seen, entries } = await go(own + "/a", script);
            print([seen, entries, page.getOSProcessId() === process.pid]);
          }`),
      ).toEqual([
        ...[false, true].map(replaces => [
          [
            ...["did-start-loading", "did-start-navigation", "will-navigate", "navigation-entry-committed " + replaces],
            ...["did-navigate", "did-finish-load", "did-stop-loading"],
          ],
          [...(replaces ? [] : ["http://127.0.0.1/a"]), "http://localhost/echo"],
          false,
        ]),
        [
          ["did-start-loading", "did-start-navigation", "will-navigate", "did-stop-loading"],
          ["http://127.0.0.1/a"],
          true,
        ],
      ]);
    });

    test("what was posted to one page is not posted to the next", async () => {
      expect(
        await run(`${echo}
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(other, { postData: [{ type: "rawData", bytes: Buffer.from("secret") }], extraHeaders: "content-type: text/plain" });
          page.executeJavaScript("void (location = '/echo')");
          await until(() => page.getTitle() === "echo" && !page.isLoading());
          page.reload();
          await once(page, "did-finish-load");
          print(last[0]);`),
      ).toEqual(["GET"]);
    });

    test("the excepted pages of a trusted site, and their cookies", async () => {
      expect(
        await run(`
          const origin = site({
            "/": request => respond("<title>in</title>" + request.headers.get("cookie"))(),
            "/login": "<title>login</title>",
            "/login/done": () => new Response(null, { status: 302, headers: { location: "/", "set-cookie": "b=2; HttpOnly; Path=/" } }),
          });
          app.trustOrigins([origin], { except: [origin + "/login*"] });
          const { webContents: page } = new BrowserWindow();
          await session.defaultSession.cookies.set({ url: origin, name: "a", value: "1" });
          await page.loadURL(origin);
          page.executeJavaScript("history.pushState(0, '', '/login')");
          await until(() => page.getTitle() === "login");
          print([page.getOSProcessId() === process.pid, await page.executeJavaScript("document.cookie")]);
          page.executeJavaScript("location.href = '/login/done'");
          await until(() => page.getTitle() === "in" && !page.isLoading());
          print([page.getOSProcessId() === process.pid, await page.executeJavaScript("document.body.textContent")]);`),
      ).toEqual([
        [false, "a=1"],
        [true, "a=1; b=2"],
      ]);
    });

    test("pages that are excepted only when they are loaded", async () => {
      expect(
        await run(`
          const origin = site({ "/": "<title>in</title>", "/item": "<title>item</title>" });
          app.trustOrigins([origin], { exceptWhenLoaded: [origin + "/item*"] });
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(origin);
          await page.executeJavaScript("history.pushState(0, '', '/item'); new Promise(done => setTimeout(done))");
          print([page.getOSProcessId() === process.pid, page.isLoading(), page.getTitle()]);
          page.reload();
          await until(() => page.getTitle() === "item");
          print([page.getOSProcessId() === process.pid]);`),
      ).toEqual([[true, false, "in"], [false]]);
    });

    test("a frame of the app is handed over if the app does not have its document", async () => {
      expect(
        await run(`
          const origin = site({ "/shell": "<script>parent.postMessage(location.pathname, '*')</script>" });
          app.trustOrigins([origin], { inFrames: [origin + "/shell*"] });
          protocol.serve(origin, ({ destination }) => destination === "document" ? respond(inbox + "<iframe src=/shell></iframe>")() : undefined);
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(origin);
          print(await page.executeJavaScript("next().then(e => [e.data, e.source === frames[0], document.querySelector('iframe').contentDocument])"));`),
      ).toEqual([["/shell", true, null]]);
    });

    test("a frame in an empty window that a page has opened", async () => {
      expect(
        await run(`
          const origin = site({ "/": "<script>parent.postMessage(location.ancestorOrigins[0].replace(/^https:..(.*).app.invalid/, 'app://$1'), '*')</script>" });
          const page = await open("");
          page.setWindowOpenHandler(() => ({ action: "allow" }));
          print(await page.executeJavaScript(\`new Promise(resolve => {
            const opened = open("about:blank");
            opened.addEventListener("message", event => resolve(event.data));
            opened.document.body.append(Object.assign(opened.document.createElement("iframe"), { src: "\${origin}" }));
          })\`));`),
      ).toEqual(["app://trusted"]);
    });

    test("what covers a frame gets the click, however deep the frame is", async () => {
      expect(
        await run(`
          const fill = "style='position:fixed;inset:0;width:100%;height:100%;border:0'";
          const other = site({ "/": "<body bgcolor=blue onmousedown='top.postMessage(0, &quot;*&quot;)' " + fill + ">" }).replace("127.0.0.1", "localhost");
          const origin = site({ "/": inbox + "<iframe src=/inner " + fill + "></iframe><p onclick='postMessage(1)' style='position:fixed;inset:0 50% 0 0;margin:0;background:red'>", "/inner": "<iframe src='" + other + "' " + fill + "></iframe>" });
          const { webContents: page } = new BrowserWindow({ width: 400, height: 300 });
          await page.loadURL(origin);
          await until(async () => (await pixel(page, 300, 100)) === "255,0,0,255");
          for (const x of [300, 100]) {
            click(page, x, 100);
            print(await page.executeJavaScript("next().then(e => e.data)"));
          }`),
      ).toEqual([0, 1]);
    });

    test("the background of the view is that of the page", async () => {
      expect(
        await run(`
          const window = new BrowserWindow({ backgroundColor: "#00f" });
          const origin = site({ "/dark": "<meta name=color-scheme content=dark>" });
          await window.loadURL(origin);
          print(await pixel(window.webContents, 5, 5));
          window.setBackgroundColor("#0f0");
          await until(async () => (await pixel(window.webContents, 5, 5)) === "0,255,0,255");
          await window.loadURL(origin + "/dark");
          await until(async () => (await pixel(window.webContents, 5, 5)) === "18,18,18,255");`),
      ).toEqual(["255,0,0,255"]);
    });

    test("a frame of the app around a frame that is not", async () => {
      expect(
        await run(`
          const origin = site({ "/": "<body style='margin:0;background:#00f'><input style='width:90px;height:40px;box-sizing:border-box' oninput='parent.postMessage(value, &quot;*&quot;)' onmousedown='parent.postMessage([event.clientX, event.clientY], &quot;*&quot;)'>" });
          const style = "style='position:absolute;left:30px;top:20px;width:80%;height:80%;border:0'";
          app.trustOrigins(["app://trusted"], { inFrames: ["app://trusted/shell*"] });
          const page = await open(({ url }) => new Response(url.endsWith("shell")
            ? inbox + "<title>shell</title><iframe " + style + " src='" + origin + "'></iframe>"
            : url.endsWith("other") ? "" : "<iframe " + style + " src=/shell></iframe><iframe hidden src=/other></iframe>", { headers: { "content-type": "text/html" } }));
          print(await page.executeJavaScript("[...document.querySelectorAll('iframe')].map(it => it.contentDocument?.title ?? null)"));
          print(await page.executeJavaScript("[frames[0].parent === self, frames[0].frameElement?.localName, frames[0].document.querySelector('iframe').contentDocument]"));
          await until(async () => (await pixel(page, 200, 150)) === "255,0,0,255");
          click(page, 70, 55);
          print(await page.executeJavaScript("frames[0].next().then(e => [e.data, e.origin === '" + origin + "', e.source === frames[0].frames[0]])"));
          page.sendInputEvent({ type: "keyDown", keyCode: "a" });
          page.sendInputEvent({ type: "char", keyCode: "a" });
          page.sendInputEvent({ type: "keyUp", keyCode: "a" });
          print(await page.executeJavaScript("frames[0].next().then(e => [e.data, e.source.top === self, document.activeElement.localName, frames[0].document.activeElement.localName])"));
          const { focusedFrame, mainFrame } = page;
          print([focusedFrame.origin === origin, focusedFrame.parent.url, focusedFrame.top === mainFrame, focusedFrame.parent.frameTreeNodeId === mainFrame.frameTreeNodeId]);`),
      ).toEqual([
        ["shell", null],
        [true, "iframe", null],
        [[10, 15], true, true],
        ["a", true, "iframe", "iframe"],
        [true, "app://trusted/shell", true, false],
      ]);
    });

    test("the microphone and the speakers", async () => {
      expect(
        await runWith({ ...engine, args: [...args, "--use-fake-device-for-media-stream"] })(`
          let allows = false;
          session.defaultSession.setPermissionRequestHandler((_, name, answer, { mediaTypes }) => (print([name, mediaTypes]), answer(allows)));
          const page = await open("");
          print(await page.executeJavaScript("navigator.mediaDevices.getUserMedia({ audio: true }).catch(error => error.name)"));
          allows = true;
          print(await page.executeJavaScript(\`(\${async () => {
            const once = (target, type) => new Promise(resolve => target.addEventListener(type, resolve, { once: true }));
            const context = new AudioContext({ sampleRate: 16000 });
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
            const processor = context.createScriptProcessor(256, 1, 1);
            context.createMediaStreamSource(stream).connect(processor).connect(context.destination);
            const { inputBuffer } = await once(processor, "audioprocess");
            stream.getTracks()[0].stop();
            const source = new AudioBufferSourceNode(context, { buffer: context.createBuffer(1, 160, 16000) });
            source.connect(new GainNode(context, { gain: 0 })).connect(context.destination);
            const at = context.currentTime + 0.05;
            source.start(at);
            await once(source, "ended");
            const isLater = context.currentTime >= at;
            await context.close();
            return [inputBuffer.length, inputBuffer.sampleRate, stream.active, isLater, context.state];
          }})()\`));`),
      ).toEqual([["media", ["audio"]], "NotAllowedError", ["media", ["audio"]], [256, 16000, false, true, "closed"]]);
    });

    test("an audio worklet", async () => {
      expect(
        await run(`
          const page = await open("");
          print(await page.executeJavaScript(\`(\${async () => {
            const failure = make => Promise.try(make).catch(error => error.name);
            const module = text => URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
            const context = new OfflineAudioContext(1, 128, 8000);
            const unknown = await failure(() => new AudioWorkletNode(context, "level"));
            const register = () =>
              registerProcessor("level", class extends AudioWorkletProcessor {
                static parameterDescriptors = [{ name: "level", defaultValue: 0.25, maxValue: 1, automationRate: "k-rate" }];
                constructor({ processorOptions }) {
                  super();
                  this.port.onmessage = ({ data }) => this.port.postMessage(new Float32Array([data.get("a"), processorOptions.b]));
                }
                process(_, [[output]], { level }) {
                  output.fill(level[0]);
                  return true;
                }
              });
            await context.audioWorklet.addModule(module("(" + register + ")()"));
            const node = new AudioWorkletNode(context, "level", { numberOfInputs: 0, parameterData: { level: 0.5 }, processorOptions: { b: 2 } });
            const { defaultValue, value, maxValue, automationRate } = node.parameters.get("level");
            const echo = new Promise(resolve => (node.port.onmessage = resolve));
            node.port.postMessage(new Map([["a", 1]]));
            const { data } = await echo;
            node.connect(context.destination);
            return [
              unknown,
              [defaultValue, value, maxValue, automationRate],
              [data instanceof Float32Array, ...data],
              (await context.startRendering()).getChannelData(0)[127],
              await failure(() => new AudioWorkletNode(context, "level", { outputChannelCount: [1, 1] })),
              await failure(() => context.audioWorklet.addModule(module("import 'http://127.0.0.1:1/';"))),
            ];
          }})()\`));`),
      ).toEqual([["InvalidStateError", [0.25, 0.5, 1, "k-rate"], [true, 1, 2], 0.5, "IndexSizeError", "AbortError"]]);
    });

    test("a recording", async () => {
      expect(
        await run(`
          const page = await open("");
          print(await page.executeJavaScript(\`(\${async () => {
            const context = new AudioContext();
            const destination = context.createMediaStreamDestination();
            const source = new OscillatorNode(context);
            source.connect(destination);
            source.start();
            const recorder = new MediaRecorder(destination.stream, { mimeType: "audio/webm;codecs=opus" });
            const events = [];
            recorder.onstart = recorder.onstop = event => events.push(event.type);
            recorder.start(10);
            const { data } = await new Promise(resolve => (recorder.ondataavailable = resolve));
            recorder.stop();
            const { state } = recorder;
            await new Promise(resolve => recorder.addEventListener("stop", resolve));
            return [events, state, data.type, (await data.slice(0, 1).bytes())[0], MediaRecorder.isTypeSupported("audio/x")];
          }})()\`));`),
      ).toEqual([[["start", "stop"], "inactive", "audio/webm;codecs=opus", 0x1a, false]]);
    });

    test("a video", async () => {
      expect(
        await run(`
          const { webContents: recorder } = new BrowserWindow();
          await recorder.loadURL(site({}));
          const recorded = await recorder.executeJavaScript(\`(\${async () => {
            const context = Object.assign(document.createElement("canvas"), { width: 32, height: 16 }).getContext("2d");
            context.fillStyle = "#0f0";
            context.fillRect(0, 0, 32, 16);
            const recorder = new MediaRecorder(context.canvas.captureStream(), { mimeType: "video/webm;codecs=vp8" });
            setInterval(() => context.fillRect(0, 0, 32, 16), 10);
            const parts = [];
            recorder.start(50);
            while (parts.length < 4) parts.push((await new Promise(resolve => (recorder.ondataavailable = resolve))).data);
            return (await new Blob(parts).bytes()).toBase64();
          }})()\`);
          const page = await open("<video muted></video>");
          print(await page.executeJavaScript(\`(\${async recorded => {
            const video = document.querySelector("video");
            video.src = URL.createObjectURL(new Blob([Uint8Array.fromBase64(recorded)], { type: "video/webm" }));
            await new Promise(resolve => (video.onloadeddata = resolve));
            const context = new OffscreenCanvas(32, 16).getContext("2d");
            context.drawImage(video, 0, 0);
            const ended = new Promise(resolve => (video.onended = resolve));
            const times = [];
            const note = (_, { mediaTime }) => ((video.loop = times.push(mediaTime) < 3), video.requestVideoFrameCallback(note));
            video.requestVideoFrameCallback(note);
            video.loop = true;
            await video.play();
            await ended;
            // WebM counts milliseconds.
            const areOfFrames = times.every(it => Math.abs(it * 1000 - Math.round(it * 1000)) < 1e-6);
            return [video.videoWidth, video.clientHeight, context.getImageData(8, 8, 1, 1).data[1] > 200, video.paused, areOfFrames];
          }})("\${recorded}")\`));`),
      ).toEqual([[32, 16, true, true, true]]);
    });

    test("each frame of a video is presented once", async () => {
      expect(
        await run(`
          const { webContents: recorder } = new BrowserWindow();
          await recorder.loadURL(site({}));
          const recorded = await recorder.executeJavaScript(\`(\${async () => {
            const context = document.createElement("canvas").getContext("2d");
            const stream = context.canvas.captureStream(0);
            const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
            recorder.start();
            for (let i = 0; i < 4; i++) {
              context.fillRect(0, 0, 9, 9);
              stream.getVideoTracks()[0].requestFrame();
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            recorder.stop();
            return (await (await new Promise(resolve => (recorder.ondataavailable = resolve))).data.bytes()).toBase64();
          }})()\`);
          const page = await open("<video muted></video>");
          print(await page.executeJavaScript(\`(\${async recorded => {
            const video = document.querySelector("video");
            video.src = URL.createObjectURL(new Blob([Uint8Array.fromBase64(recorded)], { type: "video/webm" }));
            let presented = 0;
            const count = () => video.requestVideoFrameCallback(() => count(presented++));
            count();
            await video.play();
            await new Promise(resolve => (video.onended = resolve));
            return presented > 1 && presented < 8;
          }})("\${recorded}")\`));`),
      ).toEqual([true]);
    });

    test("print() downloads a PDF", async () => {
      expect(
        await run(`
          const page = await open("<title>a/b</title><p>text");
          const file = require("node:path").join(app.getPath("userData"), "printed.pdf");
          page.session.on("will-download", (_, item) => (print(item.getFilename()), item.setSavePath(file)));
          await page.executeJavaScript("new Promise(resolve => { onafterprint = () => resolve(); print(); })");
          print((await Bun.file(file).text()).slice(0, 5));`),
      ).toEqual(["a b.pdf", "%PDF-"]);
    });

    test("printToPDF() and print() of a trusted page", async () => {
      expect(
        await run(`
          const page = await open("<title>own</title><p style='break-after:page'>1<p>2<noscript><p style='break-before:page'>3</noscript><script>log = []; onbeforeprint = onafterprint = e => log.push(e.type)</script>");
          const look = pdf => [pdf.toString("latin1").match(/Type .Page\\b/g).length, ...pdf.toString("latin1").match(/MediaBox \\[0 0 (\\d+)[.\\d]* (\\d+)/).slice(1)];
          print((await Promise.all([page.printToPDF({}), page.mainFrame.printToPDF({ pageSize: "A4", landscape: true, pageRanges: "1" })])).map(look));
          print(await page.executeJavaScript("log"));
          print(await Promise.all([{ pageSize: "x" }, { landscape: 1 }, undefined].map(it => page.printToPDF(it).catch(error => error.message))));
          await page.executeJavaScript("document.body.innerHTML = '<div></div>'; document.body.firstChild.attachShadow({ mode: 'closed' }).innerHTML = '<p style=break-after:page>1<p style=break-after:page>2<p>3'");
          print(look(await page.printToPDF({}))[0]);
          print(await new Promise(done => page.print({ deviceName: "none" }, (...it) => done(it))));`),
      ).toEqual([
        [
          [2, "612", "792"],
          [1, "842", "595"],
        ],
        ["beforeprint", "beforeprint", "afterprint", "afterprint"],
        ["Invalid pageSize x", "landscape must be a boolean", "options must be an object"],
        3,
        [false, "Invalid deviceName provided"],
      ]);
    });

    test("the engine gets the HTML behind a blob: URL of a trusted page", async () => {
      expect(
        await run(`
          const page = await open("a");
          const arrived = once(page, "page-title-updated");
          await page.executeJavaScript("void (location = URL.createObjectURL(new Blob(['<script>document.title = origin</scr' + 'ipt>'], { type: 'text/html' })))");
          print((await arrived)[1]);`),
      ).toEqual(["null"]);
    });

    const turn = "break-before:page";
    test.each([
      [2, `<p>1<p style=${turn}>2`],
      [1, `<style>p+p{${turn}}</style><p>1<p style=${turn}>2`, "", "style-src 'none'"],
      [1, `<p>1<noscript><style>p+*{display:block;${turn}}</style>2</noscript>`, "", "style-src 'none'"],
      [
        1,
        `<p>1<p>2`,
        `document.body.append(Object.assign(document.createElementNS("urn:a", "style"), { textContent: "p+p{${turn}}" }))`,
        "style-src 'none'",
      ],
      [2, `<p>1<p>2`, `document.body.lastChild.style.breakBefore = "page"`, "style-src 'none'"],
      [
        3,
        `<p>1<div>`,
        `document.body.lastChild.attachShadow({ mode: "closed" }).innerHTML = "<style>p{${turn}}</style><p>2<p>3"`,
      ],
      [
        2,
        `<style>:checked+p,:placeholder-shown+p{${turn}}</style>1<input type=checkbox><p>2</p><input placeholder=a><p>3`,
        `document.body.children[0].click(); document.body.children[2].value = "b"`,
      ],
      [2, `<p>1<p>2`, `onbeforeprint = () => (document.body.lastChild.style.breakBefore = "page")`],
    ])("a page of the app is printed as it is shown, on %d: %s %s", async (pages, html, script = "", policy) => {
      expect(
        await run(`
          const page = await open(${JSON.stringify("<!doctype html>" + html)}, ${JSON.stringify(policy && { "content-security-policy": policy })});
          await page.executeJavaScript(${JSON.stringify(script + "; 0")});
          print((await page.printToPDF({})).toString("latin1").match(/Type .Page\\b/g).length);`),
      ).toEqual([pages]);
    });

    test("what a frame refers to is fetched for the frame when a page is printed", async () => {
      expect(
        await run(`
          app.trustOrigins(["app://trusted"], { inFrames: true });
          const asked = new Set();
          const elsewhere = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: ({ url }) => (asked.add(new URL(url).pathname), new Response("")) }).url.origin;
          const refers = name =>
            "<link rel=stylesheet href=/" + name + ".css><style>p { background: url(/" + name + "-inline.png) }</style><p style='border-image: url(/" + name + "-attribute.png) 1'>a</p>" +
            "<img src=/" + name + ".png referrerpolicy=no-referrer><img src=" + elsewhere + "/" + name + "-far.png>";
          const files = {
            "/": respond(refers("top") + "<iframe sandbox src=/free></iframe><iframe src=/bound></iframe><iframe id=blank></iframe><script>blank.contentDocument.body.innerHTML = '<img src=/blank.png>'</script>"),
            "/free": respond(refers("free")),
            "/bound": respond(refers("bound"), { "content-security-policy": "img-src 'none'" }),
          };
          const page = await open(({ url }) => {
            const { pathname } = new URL(url);
            asked.add(pathname);
            const sheet = respond("body { background: url(" + pathname + ".png) }", { "content-type": "text/css" });
            return (files[pathname] ?? (pathname.endsWith(".css") ? sheet : respond("")))();
          });
          asked.clear();
          await page.printToPDF({ printBackground: true });
          print([...asked].sort());`),
      ).toEqual([
        [
          "/blank.png",
          "/bound.css",
          ...["-attribute.png", "-far.png", "-inline.png", ".css", ".css.png", ".png"].map(it => "/free" + it),
          ...["-attribute.png", "-far.png", "-inline.png", ".css", ".css.png", ".png"].map(it => "/top" + it),
        ],
      ]);
    });

    test("the options for printing a page of the app", async () => {
      expect(
        await run(`
          const page = await open("<p>1<p style=${turn}>2");
          print((await page.mainFrame.printToPDF({ pageRanges: "2" })).toString("latin1").match(/Type .Page\\b/g).length);
          page.session.on("will-download", (_, item) => item.setSavePath(path.join(app.getPath("userData"), "printed.pdf")));
          print(await new Promise(done => page.print({}, (...result) => done(result))));`),
      ).toEqual([1, [true, ""]]);
    });

    test("the engine shows no dialog of its own to print", async () => {
      expect(
        await run(`
          const { webContents: page } = new BrowserWindow();
          const file = name => path.join(app.getPath("userData"), name);
          page.session.on("will-download", (_, item) => item.setSavePath(file(item.getFilename())));
          const printed = async start => {
            const announced = once(page.session, "will-download");
            start();
            const [, item] = await announced;
            await once(item, "done");
            return [item.getFilename(), (await Bun.file(item.savePath).text()).match(/^%PDF-|Type .Page\\b/g).length];
          };
          await page.loadURL(site({ "/": "<title>two</title><p style='break-after:page'>1<p>2" }));
          print(await printed(() => page.executeJavaScript("print()")));
          await until(() => new Promise(done => page.print({ pageRanges: [{ from: 1, to: 1 }] }, done)));
          print((await Bun.file(file("two.pdf")).text()).match(/^%PDF-|Type .Page\\b/g).length);
          print(await page.executeJavaScript("[print.name, /native code/.test(print)]"));
          const inner = site({ "/": "<script>print(); top.postMessage(print.toString(), '*')</script>" }).replace("127.0.0.1", "localhost");
          await page.loadURL(site({ "/": inbox + "<title>outer</title>" }));
          const add = more => page.executeJavaScript("document.body.innerHTML = '<iframe " + more + " src=" + inner + "></iframe>'; next().then(e => e.data)");
          page.session.once("will-download", (_, item) => print("allowed"));
          print(await add("sandbox=allow-scripts"));
          print(await printed(() => add("")));`),
      ).toEqual([["two.pdf", 3], 2, ["print", true], "function () { [native code] }", "allowed", ["outer.pdf", 2]]);
    });

    test("the list of a <select> is a menu of the app", async () => {
      expect(
        await run(`
          const window = new BrowserWindow({ width: 400, height: 300 });
          const page = window.webContents;
          const options = "<option>a<option disabled>b<optgroup label=g><option>c</optgroup>";
          const at = top => " style='position:absolute;left:10px;top:" + top + "px;width:100px;height:20px'>";
          await page.loadURL(site({ "/": inbox + "<select onchange='postMessage(value)'" + at(10) + options + "</select><div onmousedown='event.preventDefault(); postMessage(0)'><select" + at(200) + options + "</select></div>" }));
          window.focus();
          page.focus();
          print(await page.executeJavaScript("getComputedStyle(document.querySelector('select')).appearance"));
          const press = keyCode => ["keyDown", "keyUp"].forEach(type => page.sendInputEvent({ type, keyCode }));
          click(page, 20, 210);
          print(await page.executeJavaScript("next().then(e => [e.data, document.activeElement.localName])"));
          const { Menu } = require("electron");
          const popup = Menu.prototype.popup;
          let shown;
          Menu.prototype.popup = function (options) { shown = [this, options]; };
          for (const open of [() => click(page, 20, 20), () => press("Space")]) {
            shown = undefined;
            open();
            await until(() => shown);
            print([shown[0].items.map(it => [it.label.trim(), it.enabled, it.checked]), shown[1].x]);
            shown[0].items.find(it => it.enabled && !it.checked).click();
            print(await page.executeJavaScript("next().then(e => e.data)"));
          }`),
      ).toEqual([
        "auto",
        [0, "body"],
        ...["a", "c"].flatMap(checked => [
          [["a", "b", "g", "c"].map(it => [it, it === "a" || it === "c", it === checked]), 10],
          checked === "a" ? "c" : "a",
        ]),
      ]);
    });

    test("a page is told whether the engine is driven over a debugging pipe", async () => {
      expect(
        await run(`
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(site({}));
          print(await page.executeJavaScript("navigator.webdriver"));`),
      ).toEqual([engine.type === "chromium"]);
    });

    test("editing commands go to the frame that has the focus, and only there", async () => {
      expect(
        await run(`
          const origin = site({ "/": "<input value=inner style='position:absolute;inset:0' onfocus='top.postMessage(1, &quot;*&quot;)' oninput='top.postMessage(value, &quot;*&quot;)' ><body onload='top.postMessage(0, &quot;*&quot;)'>" });
          const page = await open(inbox + '<body style="margin:0"><iframe src="' + origin + '"></iframe>outer');
          const next = () => page.executeJavaScript("next().then(e => e.data)");
          await next();
          page.focus();
          click(page, 100, 20);
          await next();
          page.selectAll();
          page.delete();
          print([await next(), await page.executeJavaScript("String(getSelection())")]);`),
      ).toEqual([["", ""]]);
    });

    test("the app asks where to save a download", async () => {
      expect(
        await run(`
          const origin = site({ "/file": () => new Response("hello", { headers: { "content-disposition": "attachment; filename=a.txt" } }) });
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(origin);
          for (const filePath of [path.join(__dirname, "b.txt"), ""]) {
            require("bun:desktop").dialog.showSaveDialog = async (...args) => (print(path.basename(args.at(-1).defaultPath)), { filePath });
            page.executeJavaScript("location.href = '/file'", true);
            const [item, state] = await new Promise(resolve => session.defaultSession.once("will-download", (_, item) => item.once("done", (_, state) => resolve([item, state]))));
            print([state, item.getSavePath() && (await Bun.file(item.getSavePath()).text())]);
          }`),
      ).toEqual(["a.txt", ["completed", "hello"], "a.txt", ["cancelled", ""]]);
    });

    test("a download is a request of the site", async () => {
      expect(
        await run(`
          const headers = { "content-disposition": "attachment" };
          const other = site({ "/file": request => new Response(String(request.headers.get("cookie")), { headers }) }).replace("127.0.0.1", "localhost");
          const origin = site({});
          await session.defaultSession.cookies.set({ url: other, name: "a", value: "b", sameSite: "strict" });
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(origin);
          const file = path.join(__dirname, "file");
          page.executeJavaScript("location.href = '" + new URL("/file", other) + "'", true);
          const item = await new Promise(resolve => session.defaultSession.once("will-download", (_, item) => (item.setSavePath(file), item.once("done", () => resolve(item)))));
          print([item.getInitiatorOrigin() === new URL(origin).origin, await Bun.file(file).text()]);`),
      ).toEqual([[true, "null"]]);
    });

    test.skipIf(!isElectron)("setWebEngineHosts", async () => {
      expect(
        await run(`
          const origin = site({
            "/moved": () => new Response(null, { status: 307, headers: { location: "/api", "set-cookie": "a=1" } }),
            "/api": async request => Response.json([request.headers.get("cookie"), (await request.bytes()).length]),
          });
          app.trustOrigins([origin]);
          session.defaultSession.setWebEngineHosts(["127.0.0.1"]);
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(origin);
          print(await page.executeJavaScript("fetch('/moved', { method: 'POST', body: new Uint8Array(1e6) }).then(it => it.json())"));
          print([page.getOSProcessId() === process.pid, app.getAppMetrics().some(it => it.name === "Web Engine")]);`),
      ).toEqual([
        ["a=1", 1e6],
        [true, true],
      ]);
    });

    test.skipIf(!isElectron)("desktopCapturer.getSources()", async () => {
      expect(
        await run(`
          const { desktopCapturer } = require("electron");
          print(await desktopCapturer.getSources({}).catch(error => error.message));
          const [it] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 8, height: 8 } });
          print([Object.keys(it), /^screen:\\d+:0$/.test(it.id), it.thumbnail.getSize().width]);`),
      ).toEqual(["Invalid options", [["name", "id", "thumbnail", "display_id", "appIcon"], true, 8]]);
    });

    test.skipIf(!isElectron)("getAppMetrics has the process of a page", async () => {
      expect(
        await run(`
          const { webContents: page } = new BrowserWindow();
          await page.loadURL(site({}));
          const find = () => app.getAppMetrics().find(it => it.pid === page.getOSProcessId());
          await until(find);
          print([find().type, typeof find().cpu.cumulativeCPUUsage, find().memory.workingSetSize > 0]);`),
      ).toEqual([["Tab", "number", true]]);
    });

    test("sessions", async () => {
      expect(
        await run(`
          const origin = site({
            "/": request => new Response(request.headers.get("cookie") + "|" + request.headers.get("x-added"), { headers: { "set-cookie": "b=2; HttpOnly" } }),
          });
          const own = session.fromPartition("own");
          await own.cookies.set({ url: origin, name: "a", value: "1" });
          own.webRequest.onBeforeSendHeaders((details, answer) => answer({ requestHeaders: { ...details.requestHeaders, "x-added": details.resourceType } }));
          own.webRequest.onBeforeRequest({ urls: ["*://*/blocked"] }, (_, answer) => answer({ cancel: true }));
          own.protocol.handle("app", request => new Response("served " + request.url, { headers: { "content-type": "text/html" } }));
          const show = async (partition, url) => {
            const { webContents } = new WebContentsView({ webPreferences: { partition } });
            return webContents.loadURL(url).then(() => webContents.executeJavaScript("document.body.innerText"), error => error.code);
          };
          print([await show("own", origin), await show("other", origin), await show("own", origin + "/blocked"), await show("own", "app://site/a")]);
          await until(async () => (await own.cookies.get({})).length === 2);
          print((await session.defaultSession.cookies.get({})).length);`),
      ).toEqual([["a=1|mainFrame", "null|null", "ERR_BLOCKED_BY_CLIENT", "served app://site/a"], 0]);
    });

    test("window.open", async () => {
      const [origin, ...rest] = await run(`
        const origin = site({ "/": "<script>onmessage = e => e.source.postMessage([e.data, e.origin], '*'); opener.postMessage('opened', '*')</script>", "/opener": "" });
        const page = await open(inbox);
        print(origin);
        print(await page.executeJavaScript("popup = open('" + origin + "'), next().then(e => [e.data, e.origin, e.source === popup])"));
        print(await page.executeJavaScript("popup.postMessage('hi', '*'), next().then(e => e.data)"));
        const { webContents } = new WebContentsView();
        await webContents.loadURL(origin + "/opener");
        const asked = new Promise(resolve => webContents.setWindowOpenHandler(details => (resolve(details.url), { action: "deny" })));
        webContents.executeJavaScript("void open('/denied')");
        print([await asked, BrowserWindow.getAllWindows().length]);`);
      expect(rest).toEqual([
        ["opened", origin, true],
        ["hi", trusted],
        [origin + "/denied", 2],
      ]);
    });

    test("debugger, capturePage and printToPDF", async () => {
      expect(
        await run(`
          const origin = site({ "/": "<body style='background:#f00'>" });
          const { webContents } = new WebContentsView({ webPreferences: { partition: "own" } });
          await webContents.loadURL("about:blank");
          webContents.debugger.attach();
          await webContents.debugger.sendCommand("Page.enable");
          await webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: "early = 1" });
          await webContents.loadURL(origin);
          print((await webContents.debugger.sendCommand("Runtime.evaluate", { expression: "early" })).result.value);
          print(await webContents.debugger.sendCommand("Runtime.evaluate", { expression: "1" }, "other").catch(error => error.message));
          print([await pixel(webContents, 5, 5), (await webContents.printToPDF({})).toString("latin1", 0, 5)]);`),
      ).toEqual([1, "Session with given id not found.", ["0,0,255,255", "%PDF-"]]);
    });

    test("the app outlives the engine", async () => {
      expect(
        await run(`
          const origin = site({});
          const { webContents } = new WebContentsView();
          await webContents.loadURL(origin);
          process.kill(app.getAppMetrics().find(it => it.name === "Web Engine").pid, "SIGKILL");
          print((await once(webContents, "render-process-gone"))[1].reason);
          await webContents.loadURL(origin);
          print(await webContents.executeJavaScript("1 + 1"));`),
      ).toEqual(["crashed", 2]);
    });

    test("a window that the page opens is painted, in the size of its window", async () => {
      expect(
        await run(`
          const other = site({ "/": "<body bgcolor=blue>" }).replace("127.0.0.1", "localhost");
          const { webContents: page } = new BrowserWindow({ width: 400, height: 300 });
          await page.loadURL(site({}));
          const painted = new Promise(resolve => page.once("did-create-window", opened => opened.once("ready-to-show", () => resolve(opened))));
          await page.executeJavaScript("popup = open('about:blank', '', 'width=300,height=200'), popup.document.body.bgColor = 'lime', 0", true);
          const opened = await painted;
          const shows = async (color, width) => {
            await until(async () => (await opened.webContents.executeJavaScript("innerWidth")) === width);
            await until(async () => (await pixel(opened.webContents, width - 5, 5)) === color);
            print((await opened.capturePage()).getSize().width);
          };
          await shows("0,255,0,255", 300);
          opened.setContentSize(320, 200);
          await shows("0,255,0,255", 320);
          await opened.loadURL(other);
          await shows("255,0,0,255", 320);
          opened.setContentSize(340, 200);
          await shows("255,0,0,255", 340);`),
      ).toEqual([300, 320, 320, 340]);
    });

    test("an engine that does not start", async () => {
      expect(
        await run(`
          app.setWebEngine({ ...JSON.parse(process.env.ENGINE), path: process.execPath + ".missing" });
          const { webContents } = new WebContentsView();
          const gone = once(webContents, "render-process-gone");
          webContents.loadURL(site({})).catch(() => {});
          print((await gone)[1].reason);`),
      ).toEqual(["launch-failed"]);
    });

    test.skipIf(isWindows).each([
      ["app.quit()", [0, null]],
      ["app.exit(3)", [3, null]],
      ["process.kill(process.pid, 'SIGKILL')", [null, "SIGKILL"]],
      ["process.crash()", [null, "SIGABRT"]],
    ])("the engine does not outlive %s", async (end, status) => {
      using dir = tempDir("webview", {
        "package.json": JSON.stringify({ name: "fixture", main: "main.js" }),
        "main.js": `${prelude}
          app.whenReady().then(async () => {
            const window = new BrowserWindow();
            await window.loadURL(site({ "/": "<title>shown</title>" }));
            require("fs").writeSync(1, window.webContents.getTitle());
            ${end};
          });`,
      });
      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", 'ulimit -c 0 && exec "$@"', "--", bunExe(), "--preload=bun:desktop/electron", "."],
        env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", ENGINE: JSON.stringify(engine), ELECTRON_ENABLE_LOGGING: "1" },
        cwd: String(dir),
        stderr: "pipe",
      });
      // The processes of the engine have these pipes too, so they end with the last of them.
      const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("shown");
      expect([proc.exitCode, proc.signalCode]).toEqual(status);
    });

    test.skipIf(isWindows).each(["engine", "renderer"])("a page comes back after its %s has died", async which => {
      expect(
        await run(`
          const { Menu } = require("electron");
          const origin = site({ "/": "<title>first</title>", "/next": "<title>next</title>" });
          const window = new BrowserWindow();
          const page = window.webContents;
          Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "View", submenu: [{ role: "reload" }] }]));
          await page.loadURL(origin);
          await page.loadURL(origin + "/next");
          const press = () => page.sendInputEvent({ type: "keyDown", keyCode: "R", modifiers: [process.platform === "darwin" ? "meta" : "control"] });
          for (const recover of [() => page.reload(), press]) {
            const gone = once(page, "render-process-gone");
            if ("${which}" === "renderer") page.forcefullyCrashRenderer();
            else for (const it of require("child_process").execSync("pgrep -P " + process.pid + " || true").toString().match(/\\d+/g)) try { process.kill(+it, "SIGKILL"); } catch {}
            await gone;
            await until(() => page.isCrashed());
            print(page.getURL() === origin + "/next");
            recover();
            await once(page, "did-finish-load");
            print([page.isCrashed(), await page.executeJavaScript("document.title"), page.navigationHistory.getAllEntries().map(it => it.url.slice(origin.length))]);
          }
          page.navigationHistory.goBack();
          await once(page, "did-finish-load");
          print(await page.executeJavaScript("document.title"));`),
      ).toEqual([true, [false, "next", ["/", "/next"]], true, [false, "next", ["/", "/next"]], "first"]);
    });

    // About one request in 100 from a new frame is never settled by Chromium.
    test("a frame in a Window", async () => {
      expect(
        await spawn(
          {
            "main.js": `
              import { Window, app } from "bun:desktop";
              app.setWebEngine(JSON.parse(process.env.ENGINE));
              const { window, document } = new Window();
              window.addEventListener("message", event => (console.log(JSON.stringify([event.data, event.source === window[0]])), app.exit(0)), { once: true });
              document.body.innerHTML = "<iframe srcdoc='<script>setInterval(() => Notification.requestPermission().then(it => parent.postMessage([typeof Bun, it], &quot;*&quot;)), 20)</script>'></iframe>";`,
          },
          engine,
          "main.js",
        ),
      ).toEqual([[["undefined", "denied"], true]]);
    });

    test("ports go to a frame in a Window, and come back", async () => {
      expect(
        await spawn(
          {
            "main.js": `
              import { Window, app } from "bun:desktop";
              app.setWebEngine(JSON.parse(process.env.ENGINE));
              const { window, document } = new Window();
              window.onmessage = ({ ports: [given] }) => {
                const [outer, inner] = [new MessageChannel(), new MessageChannel()];
                inner.port1.onmessage = ({ data }) => given.postMessage(data + 1);
                given.onmessage = ({ data }) => (console.log(JSON.stringify([given instanceof MessagePort, data])), app.exit(0));
                window[0].postMessage(0, "*", [outer.port2]);
                outer.port1.postMessage(1, [inner.port2]);
              };
              document.body.innerHTML = \`<iframe srcdoc='<script>
                const { port1, port2 } = new MessageChannel();
                port1.onmessage = e => port1.postMessage(e.data + 1);
                onmessage = e => (e.ports[0].onmessage = e => e.ports[0].postMessage(e.data + 1));
                parent.postMessage(0, "*", [port2]);
              </script>'></iframe>\`;`,
          },
          engine,
          "main.js",
        ),
      ).toEqual([[true, 4]]);
    });

    test.skipIf(!isElectron)("a preload script, and who has sent a message", async () => {
      const [origin, inner, ...rest] = await run(
        `const inner = site({}).replace("127.0.0.1", "localhost");
         const origin = site({ "/": "<iframe src='" + inner + "'></iframe>" });
         const who = event => [event.senderFrame.origin, event.senderFrame === event.sender.mainFrame];
         const seen = [];
         ipcMain.handle("invoke", (event, value) => (seen.push(who(event)), value + 1));
         ipcMain.on("sync", event => (event.returnValue = "answer"));
         ipcMain.on("send", (event, ...args) => seen.push(args));
         const { webContents } = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "preload.js"), nodeIntegrationInSubFrames: true, nodeIntegration: true, sandbox: false } });
         await webContents.loadURL(origin);
         await until(() => seen.length === 4);
         print(origin);
         print(inner);
         print(seen.map(it => JSON.stringify(it)).sort().map(it => JSON.parse(it)));
         print(await webContents.executeJavaScript("typeof require"));`,
        {
          "preload.js": `const { ipcRenderer } = require("electron");
            ipcRenderer.invoke("invoke", 1).then(value => ipcRenderer.send("send", value, ipcRenderer.sendSync("sync"), process.sandboxed, ["h", ["view", -1]]));`,
        },
      );
      const sent = [2, "answer", true, ["h", ["view", -1]]];
      expect(rest).toEqual([[[origin, true], [inner, false], sent, sent], "undefined"]);
    });

    test.skipIf(!isElectron)("permissions are up to the handlers of the session", async () => {
      const [origin, ...rest] = await run(`
        const origin = site({ "/": "<script>navigator.geolocation.getCurrentPosition(() => {}, e => parent.postMessage(e.code, '*'))</script>" });
        session.defaultSession.setPermissionRequestHandler((sender, name, answer, details) => {
          print([sender === page, name, details.requestingUrl, details.isMainFrame]);
          answer(false);
        });
        session.defaultSession.setPermissionCheckHandler(() => true);
        print(origin);
        const page = await open(inbox + '<iframe allow=geolocation src="' + origin + '"></iframe>');
        print(await page.executeJavaScript("next().then(e => e.data)"));`);
      expect(rest).toEqual([[true, "geolocation", origin + "/", false], 1]);
    });
  });
}
