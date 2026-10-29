const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { PassThrough } = require("node:stream");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "history-"));
const out = [];
const say = (...a) => out.push(a.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
const text = stream => { let s = ""; stream.on("data", c => (s += c)); return () => s; };
(async () => {
  const readline = require("node:readline");
  {
    const input = new PassThrough(), output = new PassThrough();
    const rl = readline.createInterface({ input, output, terminal: true, historySize: 3, removeHistoryDuplicates: true });
    const lines = []; rl.on("line", l => lines.push(l)); rl.on("history", h => say("history event", h));
    input.write("one\ntwo\none\nthree\nfour\n"); await new Promise(r => setTimeout(r, 30));
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
    const error = await new Promise(r => server.setupHistory(file, e => r(e)));
    for (const c of commands) { input.write(c + "\n"); await new Promise(r => setTimeout(r, 30)); }
    const closed = new Promise(r => server.on("exit", r)); input.write(".exit\n"); await closed; await new Promise(r => setTimeout(r, 60));
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
