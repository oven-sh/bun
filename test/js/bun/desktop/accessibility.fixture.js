const { app, BrowserWindow, WebContentsView, protocol } = require("electron");
const { once } = require("events");
const ask = require("bun:internal-for-testing").desktopInternals.askAsAssistiveTechnology;
app.setPath("userData", require("path").join(__dirname, "data"));
if (process.env.ENGINE) app.setWebEngine(JSON.parse(process.env.ENGINE));
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://trusted"], { inFrames: true });

const print = (...lines) => console.log(lines.join("\n").trimEnd());
const until = async condition => {
  for (const end = Date.now() + 30_000; ; await new Promise(setImmediate)) {
    const result = await condition();
    if (result) return result;
    if (Date.now() > end) throw new Error(`gave up on ${condition}\n${ask("tree root")}\n${heard.join("\n")}`);
  }
};
const respond = html =>
  new Response(`<!doctype html><title>Title</title>${html}`, { headers: { "content-type": "text/html" } });
const site = html => Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => respond(html) }).url.href;

/** What was posted and has not been taken. */
let heard = [];
const listen = () => heard.push(...ask("notifications").split("\n").filter(Boolean));
/** Waits for a notification that starts with `last`, and takes those that match. */
const hear = async (last, wanted = /./) => {
  await until(() => (listen(), heard.some(it => it.startsWith(last))));
  return heard.splice(0).filter(it => wanted.test(it));
};
const get = (element, ...expressions) => expressions.map(it => `${it} = ${ask(`get ${element} ${it}`)}`);

let window;
/** Shows a page while a screen reader is on. */
const open = async (html, others = {}) => {
  protocol.handle("app", request => respond(others[new URL(request.url).pathname] ?? html));
  window = new BrowserWindow({ width: 400, height: 300 });
  ask("listen");
  await window.loadURL("app://trusted/");
  await until(() => ask("get root AXTitle") === '"Title"' && ask("get root AXLoaded") === "true");
  listen();
  heard = [];
  return window.webContents;
};
const press = (keyCode, ...modifiers) => {
  for (const type of ["keyDown", "keyUp"]) window.sendInputEvent({ type, keyCode, modifiers });
};
