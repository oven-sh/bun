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

async function run(code) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

// A ShadowRealm gets its own global. JSC reports a rejected promise, and an exception that
// escapes a microtask, to the global of the realm they happened in. These must reach the
// `process` of the realm that created the ShadowRealm, like the same code outside a realm
// (and like Node), instead of being dropped or bypassing its handlers.
// https://github.com/oven-sh/bun/issues/11845
describe.concurrent("errors inside a ShadowRealm", () => {
  it("an unhandled rejection is reported and fails the process", async () => {
    const [stdout, stderr, exitCode] = await run(`
      const r = new ShadowRealm();
      r.evaluate("Promise.reject(new Error('rejected-in-realm')); 1");
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("error: rejected-in-realm");
    expect(exitCode).toBe(1);
  });

  it("unhandled rejections reach process.on('unhandledRejection')", async () => {
    const [stdout, stderr, exitCode] = await run(`
      const seen = [];
      process.on("unhandledRejection", reason => seen.push(reason.message));
      process.on("exit", () => console.log(JSON.stringify(seen.sort())));
      const r = new ShadowRealm();
      r.evaluate("Promise.reject(new Error('from evaluate')); 1");
      r.evaluate("Promise.resolve().then(() => { throw new Error('from a reaction') }); 1");
      const viaWrapped = r.evaluate("() => { (async () => { throw new Error('from a wrapped function') })(); }");
      viaWrapped();
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(`["from a reaction","from a wrapped function","from evaluate"]\n`);
    expect(exitCode).toBe(0);
  });

  it("a rejection handled inside the realm is not reported", async () => {
    const [stdout, stderr, exitCode] = await run(`
      process.on("unhandledRejection", reason => { console.log("unhandledRejection", reason.message); process.exitCode = 1; });
      const r = new ShadowRealm();
      r.evaluate("Promise.reject(new Error('caught')).catch(() => {}); 1");
      r.evaluate("var p = Promise.reject(new Error('caught later in the same tick')); queueMicrotask(() => p.catch(() => {})); 1");
      process.on("exit", () => console.log("done"));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);
  });

  it("handling a reported rejection later emits 'rejectionHandled'", async () => {
    const [stdout, stderr, exitCode] = await run(`
      const r = new ShadowRealm();
      const attach = r.evaluate("var p = Promise.reject(new Error('late')); () => { p.catch(() => {}); }");
      process.on("unhandledRejection", reason => { console.log("unhandledRejection", reason.message); setImmediate(attach); });
      process.on("rejectionHandled", () => console.log("rejectionHandled"));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("unhandledRejection late\nrejectionHandled\n");
    expect(exitCode).toBe(0);
  });

  it("an exception thrown from a microtask reaches process.on('uncaughtException')", async () => {
    const [stdout, stderr, exitCode] = await run(`
      process.on("uncaughtException", (err, origin) => console.log(origin, err.message));
      const r = new ShadowRealm();
      r.evaluate("queueMicrotask(() => { throw new Error('thrown in a realm microtask') }); 1");
      process.on("exit", code => console.log("exit", code));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("uncaughtException thrown in a realm microtask\nexit 0\n");
    expect(exitCode).toBe(0);
  });

  it("EventTarget listeners that throw or reject reach process.on('uncaughtException')", async () => {
    const [stdout, stderr, exitCode] = await run(`
      const seen = [];
      process.on("uncaughtException", (err, origin) => seen.push(origin + " " + err.message));
      process.on("exit", code => console.log(JSON.stringify(seen.sort()), "exit", code));
      const r = new ShadowRealm();
      r.evaluate(\`
        const target = new EventTarget();
        target.addEventListener("ping", () => { throw new Error("thrown in a realm listener") });
        target.addEventListener("ping", async () => { throw new Error("rejected in a realm listener") });
        target.dispatchEvent(new Event("ping"));
        1
      \`);
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      `["uncaughtException rejected in a realm listener","uncaughtException thrown in a realm listener"] exit 0\n`,
    );
    expect(exitCode).toBe(0);
  });

  it("a nested ShadowRealm reports to the outermost realm's process", async () => {
    const [stdout, stderr, exitCode] = await run(`
      process.on("unhandledRejection", reason => console.log("unhandledRejection", reason.message));
      const outer = new ShadowRealm();
      outer.evaluate("new ShadowRealm().evaluate(\\"Promise.reject(new Error('nested')); 1\\")");
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("unhandledRejection nested\n");
    expect(exitCode).toBe(0);
  });
});
