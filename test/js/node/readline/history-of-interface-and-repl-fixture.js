const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { PassThrough } = require("node:stream");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "history-"));
const out = [];
const say = (...a) => out.push(a.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
const text = stream => { let s = ""; stream.on("data", c => (s += c)); return () => s; };
// Waits for `listen` to call back. When the process has nothing left to do, that cannot happen: the wait fails then, and the output so far is printed.
const wait = (what, listen) => new Promise((resolve, reject) => {
  const idle = () => reject(`${what} did not come`);
  process.once("beforeExit", idle); listen(value => { process.off("beforeExit", idle); resolve(value); });
});
const event = (emitter, name) => wait(`the "${name}" event`, resolve => emitter.once(name, resolve));
(async () => {
  const readline = require("node:readline");
  {
    const input = new PassThrough(), output = new PassThrough();
    const rl = readline.createInterface({ input, output, terminal: true, historySize: 3, removeHistoryDuplicates: true });
    const lines = []; rl.on("line", l => lines.push(l)); rl.on("history", h => say("history event", h));
    input.write("one\ntwo\none\nthree\nfour\n"); while (lines.length < 5) await event(rl, "line");
    say("lines", lines, "history", rl.history); rl.close();
  }
  {
    const input = new PassThrough();
    const rl = readline.createInterface({ input, history: ["b", "a"], terminal: false });
    say("given history", rl.history, rl.historySize); rl.close();
  }
  try { readline.createInterface({ input: new PassThrough(), history: 5 }); } catch (e) { say("bad history", e.code); }
  try { readline.createInterface({ input: new PassThrough(), historySize: -1 }); } catch (e) { say("bad size", e.code); }
  const repl = require("node:repl");
  const run = async (file, commands) => {
    const input = new PassThrough(), output = new PassThrough(); const read = text(output);
    const server = repl.start({ input, output, terminal: true, prompt: "> ", useColors: false, useGlobal: false });
    let taken = 0, exited = false; server.on("line", () => taken++); server.on("exit", () => (exited = true));
    const error = await wait("the callback of setupHistory", resolve => server.setupHistory(file, resolve));
    // The REPL saves its history a moment after each line. A ".exit" that comes before that save is saved too, so wait for the save after each line.
    for (const c of commands) { const before = taken; input.write(c + "\n"); while (taken === before) await event(server, "line"); while (server.isFlushing) await event(server, "flushHistory"); }
    input.write(".exit\n"); while (!exited) await event(server, "exit");
    return { error: error && (error.code ?? error.message), history: server.history, printed: read().replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/).map(l => l.trim()).filter(l => /^(2|'ab'|Uncaught|3)/.test(l)) };
  };
  const file = path.join(dir, "h.txt");
  say("first", await run(file, ["1 + 1", "'a' + 'b'", "throw new RangeError('r')"]));
  say("file", fs.readFileSync(file, "utf8").split(/\r?\n/));
  say("mode", (fs.statSync(file).mode & 0o777).toString(8));
  say("second", await run(file, ["1 + 2"]));
  say("file", fs.readFileSync(file, "utf8").split(/\r?\n/));
  say("no file", await run("", ["1 + 1"]));
  say("a folder", await run(dir, ["1 + 1"]));
  const home = process.env.HISTORY_HOME;
  if (home !== undefined && os.homedir() === home && process.env.NODE_REPL_HISTORY === undefined) {
    say("default", await run(undefined, ["1 + 1"]), fs.readFileSync(path.join(home, ".node_repl_history"), "utf8"));
  } else say("default: not run");
  fs.rmSync(dir, { recursive: true });
  console.log(out.join("\n"));
})().catch(e => { console.log(out.join("\n")); console.log("FAILED", e); });
