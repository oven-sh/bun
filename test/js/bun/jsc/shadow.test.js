import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

// A ShadowRealm gets its own global object (and so its own `process`), but it
// shares the event loop with the realm that created it. Anything queued with
// the realm's process.nextTick has to be drained by that event loop, otherwise
// every node API that delivers events through nextTick (streams, child_process,
// http, ...) is silent inside the realm. https://github.com/oven-sh/bun/issues/25608
describe.concurrent("ShadowRealm event delivery", () => {
  async function runScript(source) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("process.nextTick callbacks queued inside a realm run, in order with the host's", async () => {
    const { stdout, stderr, exitCode } = await runScript(`
      const realm = new ShadowRealm();
      const order = [];
      const queueInRealm = realm.evaluate(\`(report) => {
        process.nextTick(() => report("realm tick 1"));
        process.nextTick(() => report("realm tick 2"));
      }\`);
      queueInRealm(line => order.push(line));
      process.nextTick(() => order.push("host tick"));
      Promise.resolve().then(() => order.push("host microtask"));
      setTimeout(() => console.log(JSON.stringify(order)), 0);
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["realm tick 1", "realm tick 2", "host tick", "host microtask"]);
    expect(exitCode).toBe(0);
  });

  it("process.nextTick inside a realm is a realm-owned function that validates its callback there", () => {
    const realm = new ShadowRealm();
    expect(realm.evaluate(`process.nextTick instanceof Function && process.nextTick === process.nextTick`)).toBe(true);
    expect(
      realm.evaluate(`
        try { process.nextTick(1); "did not throw"; }
        catch (e) { String(e instanceof TypeError && e.code); }
      `),
    ).toBe("ERR_INVALID_ARG_TYPE");
  });

  it("a throwing nextTick callback inside a realm reaches process.on('uncaughtException')", async () => {
    const { stdout, stderr, exitCode } = await runScript(`
      process.on("uncaughtException", err => {
        console.log("caught:" + err.message);
      });
      const realm = new ShadowRealm();
      realm.evaluate(\`process.nextTick(() => { throw new Error("boom from realm"); }); undefined\`);
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("caught:boom from realm\n");
    expect(exitCode).toBe(0);
  });

  it("child_process callbacks and events fire inside a realm", async () => {
    const { stdout, stderr, exitCode } = await runScript(`
      const realm = new ShadowRealm();
      const lines = [];
      const run = realm.evaluate(\`(report) => {
        const cp = process.getBuiltinModule("child_process");
        cp.execFile(process.execPath, ["-e", "console.log('from execFile')"], (err, out) => {
          report("execFile:" + (err ? err.message : String(out).trim()));
        });
        const child = cp.spawn(process.execPath, ["-e", "console.log('from spawn')"]);
        let out = "";
        child.stdout.on("data", chunk => { out += chunk; });
        child.on("exit", code => report("spawn exit:" + code));
        child.on("close", code => report("spawn close:" + code + ":" + out.trim()));
      }\`);
      run(line => lines.push(line));
      process.on("exit", () => console.log(JSON.stringify(lines.sort())));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["execFile:from execFile", "spawn close:0:from spawn", "spawn exit:0"]);
    expect(exitCode).toBe(0);
  });
});
