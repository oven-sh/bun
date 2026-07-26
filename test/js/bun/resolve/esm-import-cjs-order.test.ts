// When an ESM graph imports a CommonJS module, the CommonJS body must evaluate
// at its source-order (depth-first post-order) position in InnerModuleEvaluation,
// the same as any other dependency. Previously Bun ran the body the moment its
// async transpile settled, so it could observe state from before earlier ESM
// siblings ran and, with multiple CJS siblings, in transpile-completion (i.e.
// nondeterministic) order.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(dir: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("ESM importing CommonJS: evaluation order", () => {
  test.concurrent("CJS dependency runs after an earlier ESM sibling (setup/config shape)", async () => {
    using dir = tempDir("esm-cjs-order-setup", {
      "entry.mjs": `
        import "./setup.mjs";
        import "./dep.cjs";
      `,
      "setup.mjs": `
        globalThis.__ORDER__ = ["setup.mjs"];
        globalThis.__CONFIG__ = { db: "postgres://localhost" };
      `,
      "dep.cjs": `
        globalThis.__ORDER__ = globalThis.__ORDER__ || [];
        globalThis.__ORDER__.push("dep.cjs");
        module.exports.config = globalThis.__CONFIG__;
        console.log(JSON.stringify({ order: globalThis.__ORDER__, config: globalThis.__CONFIG__ }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      order: ["setup.mjs", "dep.cjs"],
      config: { db: "postgres://localhost" },
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("esm, cjs, esm siblings evaluate in source order", async () => {
    using dir = tempDir("esm-cjs-order-sandwich", {
      "entry.mjs": `
        import "./a.mjs";
        import "./b.cjs";
        import "./c.mjs";
        console.log(JSON.stringify(globalThis.__O__));
      `,
      "a.mjs": `(globalThis.__O__ ||= []).push("a");`,
      "b.cjs": `(globalThis.__O__ ||= []).push("b"); module.exports.b = 1;`,
      "c.mjs": `(globalThis.__O__ ||= []).push("c");`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["a", "b", "c"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("two CJS siblings evaluate in source order (was transpile-race nondeterministic)", async () => {
    using dir = tempDir("esm-cjs-order-two", {
      "entry.mjs": `
        import "./a.cjs";
        import "./b.cjs";
        console.log(JSON.stringify(globalThis.__O__));
      `,
      "a.cjs": `(globalThis.__O__ ||= []).push("a"); module.exports.a = 1;`,
      "b.cjs": `(globalThis.__O__ ||= []).push("b"); module.exports.b = 1;`,
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => run(String(dir), "entry.mjs")));
    for (const { stdout, stderr, exitCode } of results) {
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(["a", "b"]);
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("named import reads a value produced by an earlier ESM sibling (dotenv shape)", async () => {
    using dir = tempDir("esm-cjs-order-dotenv", {
      "entry.mjs": `
        import "./load-env.mjs";
        import { url } from "./db.cjs";
        console.log(url);
      `,
      "load-env.mjs": `process.env.DB_URL = "postgres://set-by-load-env";`,
      "db.cjs": `exports.url = process.env.DB_URL;`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("postgres://set-by-load-env");
    expect(exitCode).toBe(0);
  });

  test.concurrent("static named exports from exports.x / module.exports.x are importable", async () => {
    using dir = tempDir("esm-cjs-order-named", {
      "entry.mjs": `
        import "./setup.mjs";
        import def, { foo, bar, baz } from "./lib.cjs";
        console.log(JSON.stringify({ def, foo, bar, baz, order: globalThis.__ORDER__ }));
      `,
      "setup.mjs": `
        globalThis.__ORDER__ = ["setup"];
        globalThis.__VAL__ = 42;
      `,
      "lib.cjs": `
        globalThis.__ORDER__ = globalThis.__ORDER__ || [];
        globalThis.__ORDER__.push("lib");
        exports.foo = globalThis.__VAL__;
        exports.bar = "bar";
        module.exports.baz = "baz";
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      def: { foo: 42, bar: "bar", baz: "baz" },
      foo: 42,
      bar: "bar",
      baz: "baz",
      order: ["setup", "lib"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("an error thrown by the CJS body rejects the importing promise", async () => {
    using dir = tempDir("esm-cjs-order-throws", {
      "entry.mjs": `
        try {
          await import("./throws.cjs");
          console.log("unreachable");
        } catch (e) {
          console.log("caught:" + e.message);
        }
      `,
      "throws.cjs": `
        exports.x = 1;
        throw new Error("boom from cjs");
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("caught:boom from cjs");
    expect(exitCode).toBe(0);
  });
});
