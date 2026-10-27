// child.stdin.destroy() and its relatives against a child that never reads its stdin.
// Prints one line per case: the events in the order they came. Runs under bun and under node.
// usage: <runtime> stdin-destroy-fixture.js [case title]...
const { spawn } = require("node:child_process");
const { Readable, finished } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const MB = () => Buffer.alloc(1 << 20, 97);
const turn = () => new Promise(resolve => setImmediate(resolve));
const name = err => (err ? (err.syscall ? err.message : err.code) : "ok");
const boom = () => Object.assign(new Error("boom"), { code: "EBOOM" });

// Writes 1 MB until the pipe does not take one whole. `say` gets that write's callback.
function park(stdin, say, label = "callback") {
  for (;;) {
    let insideWrite = true;
    let acknowledged = false;
    stdin.write(MB(), err => {
      if (insideWrite) acknowledged = true;
      else say(`${label} ${name(err)}`);
    });
    insideWrite = false;
    if (!acknowledged) return;
  }
}

const cases = {
  "destroy()": (stdin, say) => {
    park(stdin, say);
    stdin.destroy();
    say(`closed=${stdin.closed}`);
  },
  "destroy(err)": (stdin, say) => {
    park(stdin, say);
    stdin.destroy(boom());
    say(`closed=${stdin.closed}`);
  },
  "two writes, destroy()": (stdin, say) => {
    park(stdin, say, "first");
    stdin.write("y", err => say(`second ${name(err)}`));
    stdin.destroy();
  },
  "two writes, destroy(err)": (stdin, say) => {
    park(stdin, say, "first");
    stdin.write("y", err => say(`second ${name(err)}`));
    stdin.destroy(boom());
  },
  "end(callback), then destroy()": (stdin, say) => {
    park(stdin, say);
    stdin.end(err => say(`end ${name(err)}`));
    stdin.destroy();
  },
  "destroy(), then end(callback)": (stdin, say) => {
    park(stdin, say);
    stdin.destroy();
    stdin.end(err => say(`end ${name(err)}`));
  },
  "write after destroy()": (stdin, say) => {
    park(stdin, say);
    stdin.destroy();
    say(`write returned ${stdin.write("y", err => say(`late ${name(err)}`))}`);
  },
  "finished()": (stdin, say) => {
    finished(stdin, err => say(`finished ${name(err)}`));
    park(stdin, say);
    stdin.destroy();
  },
  "aborted pipeline()": async (stdin, say) => {
    const controller = new AbortController();
    const source = new Readable({ read() {} });
    const paused = new Promise(resolve => source.once("pause", resolve));
    pipeline(source, stdin, { signal: controller.signal }).then(
      () => say("pipeline ok"),
      err => say(`pipeline ${err.code}`),
    );
    for (let i = 0; i < 4; i++) source.push(MB());
    await paused;
    controller.abort();
    say(`closed=${stdin.closed}`);
  },
  "destroy() with nothing written": (stdin, say) => {
    stdin.destroy();
    say(`closed=${stdin.closed}`);
  },
  "'close' listener added one tick after destroy()": (stdin, say) => {
    stdin.destroy();
    process.nextTick(() => stdin.on("close", () => say("late listener")));
  },
  "destroy() in 'prefinish'": (stdin, say) => {
    stdin.on("prefinish", () => {
      say("prefinish");
      stdin.destroy();
    });
    stdin.on("finish", () => say("finish"));
    stdin.end();
  },
};

async function events(run) {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  // A destroy() in the tick of the spawn is another case.
  await turn();
  const { stdin } = child;
  const seen = [];
  const say = event => seen.push(event);
  const closed = new Promise(resolve => stdin.once("close", resolve));
  stdin.on("error", err => say(`error ${err.code}`));
  stdin.on("close", () => say("close"));
  await run(stdin, say);
  await closed;
  await turn();
  say(child.exitCode === null && child.signalCode === null ? "child alive" : "child gone");
  child.kill("SIGKILL");
  child.unref();
  return seen.join(", ");
}

(async () => {
  // The cases named in argv, or all of them. One child at a time: each is killed while it still starts.
  const titles = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(cases);
  for (const title of titles) console.log(`${title}: ${await events(cases[title])}`);
})();
