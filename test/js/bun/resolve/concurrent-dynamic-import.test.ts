import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Two dynamic imports of the same specifier issued before the first async
// transpile/fetch settles must both resolve. Under the new C++ module loader
// each call gets its own embedder fetch promise (the registry entry is created
// only after the first fetch settles), so the loser of that race must still be
// resolved by Bun__onFulfillAsyncModule rather than left pending forever.
test("concurrent dynamic imports of the same module both resolve", async () => {
  using dir = tempDir("concurrent-dyn-import", {
    "shared.ts": `export const heavy = "H";`,
    "modules.ts": `import { heavy } from "./shared";\nexport const lazy = heavy + "-lazy";`,
    "entry.mjs": `
      const first = import("./modules.ts");
      const second = import("./modules.ts");
      const [a, b] = await Promise.all([first, second]);
      if (a.lazy !== "H-lazy" || b.lazy !== "H-lazy") throw new Error("wrong value");
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

describe.concurrent("imported CommonJS files run in the order of the imports, whichever is transpiled first", () => {
  // Takes a thread longer than the others.
  const slow = Array.from({ length: 400 }, (_, i) => `function f${i}(a, b) { return a * ${i} + b; }`).join("\n");
  const cjs = (name: string, more = "") => `(globalThis.order ??= []).push("${name}"); exports.x = 1; ${more}`;
  const esm = (imports: string[], more = "") => imports.map(file => `import "./${file}";`).join(" ") + more;
  const says = (name: string) => `order.push("${name}"); export {};`;
  const rounds = [0, 1, 2, 3, 4];
  const inRounds = (files: Record<string, string>) =>
    Object.fromEntries(
      rounds.flatMap(round => Object.entries(files).map(([file, text]) => [`${round}/${file}`, text])),
    );
  const loadEveryRound = (load: "import" | "require") => `
    for (const round of ${JSON.stringify(rounds)}) {
      globalThis.order = [];
      try {
        await ${load}("./" + round + "/root.mjs");
      } catch (error) {
        order.push(error.code ?? error.message);
      }
      console.log("order:", order.join());
    }
  `;
  const everyRound = loadEveryRound("import");

  async function run(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("commonjs-run-order", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const orders = stdout.split("\n").filter(line => line.startsWith("order:"));
    return { orders: orders.length ? orders : stderr, exitCode };
  }

  type Case = [name: string, files: Record<string, string>, order: string];
  const synchronous: Case[] = [
    [
      "imported by one module",
      { "root.mjs": esm(["a.cjs", "b.cjs", "c.cjs"]), "a.cjs": cjs("a", slow), "b.cjs": cjs("b"), "c.cjs": cjs("c") },
      "a,b,c",
    ],
    [
      "imported by two modules",
      {
        "root.mjs": esm(["first.mjs", "second.mjs"]),
        "first.mjs": esm(["a.cjs"], slow),
        "second.mjs": esm(["b.cjs"]),
        "a.cjs": cjs("a"),
        "b.cjs": cjs("b"),
      },
      "a,b",
    ],
    [
      "that the module further back asks for first",
      {
        "root.mjs": esm(["first.mjs", "second.mjs"]),
        "first.mjs": esm(["a.cjs", "c.cjs"], slow),
        "second.mjs": esm(["c.cjs", "b.cjs", "a.cjs"]),
        "a.cjs": cjs("a"),
        "b.cjs": cjs("b"),
        "c.cjs": cjs("c"),
      },
      "a,c,b",
    ],
    [
      "below a module that one further down asks for first",
      {
        "root.mjs": esm(["first.mjs", "second.mjs"]),
        "first.mjs": esm(["shared.mjs"], slow),
        "second.mjs": esm(["third.mjs"]),
        "third.mjs": esm(["b.cjs", "shared.mjs"]),
        "shared.mjs": esm(["a.cjs"]),
        "a.cjs": cjs("a"),
        "b.cjs": cjs("b"),
      },
      "a,b",
    ],
    [
      "below a cycle",
      {
        "root.mjs": esm(["first.mjs", "a.cjs"]),
        "first.mjs": esm(["second.mjs", "b.cjs"], slow),
        "second.mjs": esm(["first.mjs", "c.cjs"]),
        "a.cjs": cjs("a"),
        "b.cjs": cjs("b", slow),
        "c.cjs": cjs("c"),
      },
      "c,b,a",
    ],
    [
      "when one requires another ahead of its turn",
      {
        "root.mjs": esm(["a.cjs", "b.cjs", "c.cjs"]),
        "a.cjs": cjs("a", `require("./c.cjs");` + slow),
        "b.cjs": cjs("b"),
        "c.cjs": cjs("c"),
      },
      "a,c,b",
    ],
    [
      "when one empties require.cache",
      {
        "root.mjs": `import "./a.cjs"; import b from "./b.cjs"; order.push(b.x);`,
        "a.cjs": cjs("a", `for (const key in require.cache) delete require.cache[key];` + slow),
        "b.cjs": cjs("b"),
      },
      "a,b,1",
    ],
    [
      "when one requires an ES module that imports one that is waiting",
      {
        "root.mjs": esm(["a.cjs", "b.cjs", "c.cjs"]),
        "a.cjs": cjs("a", `require("./required.mjs");` + slow),
        "required.mjs": esm(["c.cjs"]),
        "b.cjs": cjs("b"),
        "c.cjs": cjs("c"),
      },
      "a,c,b",
    ],
    [
      "among ES modules",
      {
        "root.mjs": esm(["first.mjs", "a.cjs", "second.mjs", "b.cjs", "third.mjs"], says("root")),
        "first.mjs": says("first") + slow,
        "second.mjs": says("second"),
        "third.mjs": says("third"),
        "a.cjs": cjs("a"),
        "b.cjs": cjs("b"),
      },
      "first,a,second,b,third,root",
    ],
    [
      "among ES modules further down",
      {
        "root.mjs": esm(["first.mjs", "second.mjs"], says("root")),
        "first.mjs": esm(["leaf.mjs"], says("first")),
        "second.mjs": esm(["leaf.mjs", "inner.mjs", "a.cjs"], says("second")),
        "leaf.mjs": says("leaf") + slow,
        "inner.mjs": says("inner"),
        "a.cjs": cjs("a"),
      },
      "leaf,first,inner,a,second,root",
    ],
    [
      "behind a cycle of ES modules",
      {
        "root.mjs": esm(["first.mjs", "a.cjs"], says("root")),
        "first.mjs": esm(["second.mjs"], says("first")),
        "second.mjs": esm(["first.mjs"], says("second")),
        "a.cjs": cjs("a"),
      },
      "second,first,a,root",
    ],
    [
      "and export what they make of a global that an ES module has set",
      {
        "root.mjs": `import "./sets.mjs"; import { a } from "./a.cjs"; import { b } from "./barrel.mjs"; order.push(a, b);`,
        "barrel.mjs": `import "./sets-again.mjs"; export * from "./b.cjs";`,
        "sets.mjs": `order.material = "clay"; export {};`,
        "sets-again.mjs": `order.material = "wood"; export {};`,
        "a.cjs": `exports.a = order.material;`,
        "b.cjs": `exports.b = order.material;`,
      },
      "clay,wood",
    ],
    [
      "and export what they had when their turn was over",
      {
        "root.mjs": `import { level } from "./config.cjs"; import "./changes.cjs"; order.push(level);`,
        "config.cjs": `exports.level = "info";`,
        "changes.cjs": `exports.x = require("./config.cjs").level = "debug";`,
      },
      "info",
    ],
    [
      "when one requires an ES module ahead of its turn",
      {
        "root.mjs": esm(["a.cjs", "second.mjs"], says("root")),
        "a.cjs": cjs("a", `require("./second.mjs"); order.push("a ends");`),
        "second.mjs": says("second"),
      },
      "a,second,a ends,root",
    ],
    [
      "and give the rest of their exports to a module that imported them while they ran",
      {
        "root.mjs": `import * as a from "./a.cjs"; order.push(order.read(), a.x, a.y);`,
        "a.cjs": `exports.x = "early"; require("./reads.mjs"); exports.x = "late"; exports.y = "added";`,
        "reads.mjs": `import { x } from "./a.cjs"; order.push(x); order.read = () => x;`,
      },
      "early,late,late,added",
    ],
    [
      "when one has caught what another threw ahead of its turn",
      {
        "root.mjs": `import "./a.cjs"; import { x } from "./flaky.cjs"; order.push(x);`,
        "a.cjs": `try { require("./flaky.cjs"); } catch (error) { order.push(error.message); }`,
        "flaky.cjs": `if (!order.length) throw new Error("first run"); exports.x = "second run";`,
      },
      "first run,second run",
    ],
    [
      "when one writes a file that is imported behind it",
      {
        "root.mjs": esm(["a.cjs", "written.mjs"], says("root")),
        "a.cjs": cjs(
          "a",
          `require("fs").writeFileSync(__dirname + "/written.mjs", ${JSON.stringify(says("written"))});`,
        ),
      },
      "a,written,root",
    ],
    [
      "up to an import that is missing",
      {
        "root.mjs": esm(["a.cjs", "missing.mjs", "b.cjs"], says("root")),
        "a.cjs": cjs("a", slow),
        "b.cjs": cjs("b"),
      },
      "a,ERR_MODULE_NOT_FOUND",
    ],
    [
      "up to an ES module that throws",
      {
        "root.mjs": esm(["throws.mjs", "a.cjs"]),
        "throws.mjs": `throw new Error("threw"); export {};`,
        "a.cjs": cjs("a"),
      },
      "threw",
    ],
    [
      "up to one that throws",
      {
        "root.mjs": esm(["first.mjs", "a.cjs", "second.mjs", "b.cjs"]),
        "first.mjs": says("first"),
        "second.mjs": says("second"),
        "a.cjs": `exports.x = 1; throw new Error("a threw");` + slow,
        "b.cjs": cjs("b"),
      },
      "first,a threw",
    ],
    [
      "and the first one to throw fails the import",
      {
        "root.mjs": esm(["a.cjs", "b.cjs"]),
        "a.cjs": `throw new Error("a threw"); exports.x = 1;` + slow,
        "b.cjs": `throw new Error("b threw"); exports.x = 1;`,
      },
      "a threw",
    ],
    [
      "and of two files that do not parse the first one fails the import",
      { "root.mjs": esm(["a.mjs", "b.mjs"]), "a.mjs": slow + `\nlet a, a;`, "b.mjs": `let b, b;` },
      `"a" has already been declared`,
    ],
    [
      "and a file that does not parse fails the import ahead of a missing one further up",
      { "root.mjs": esm(["above.mjs", "missing.mjs"]), "above.mjs": esm(["a.mjs"]), "a.mjs": slow + `\nlet a, a;` },
      `"a" has already been declared`,
    ],
  ];
  const waits = `order.push("begins"); await 0; order.push("ends");`;
  const asynchronous: Case[] = [
    [
      "beside a module that awaits",
      { "root.mjs": esm(["waits.mjs", "a.cjs"], says("root")), "waits.mjs": waits, "a.cjs": cjs("a") },
      "begins,a,ends,root",
    ],
    [
      "beside a module that imports one that awaits",
      {
        "root.mjs": esm(["above.mjs", "a.cjs"], says("root")),
        "above.mjs": esm(["waits.mjs"], says("above")),
        "waits.mjs": waits,
        "a.cjs": cjs("a"),
      },
      "begins,a,ends,above,root",
    ],
    [
      "and the jobs that they queue run behind their importer",
      {
        "root.mjs": esm(["a.cjs", "b.cjs"], `order.push("root"); await order.job;`),
        "a.cjs": cjs("a", `order.job = Promise.resolve().then(() => order.push("job"));`),
        "b.cjs": cjs("b", slow),
      },
      "a,b,root,job",
    ],
    [
      "and an import() below a require() loads behind the require()",
      {
        "root.mjs": esm(["a.cjs"], `await order.call; order.push("root");`),
        "a.cjs": `require("./calls.mjs"); order.push("required");`,
        "calls.mjs": `order.call = import("./called.mjs");` + says("calls"),
        "called.mjs": says("called"),
      },
      "calls,required,called,root",
    ],
    [
      "when one turns the event loop until its own imports have loaded",
      {
        "root.mjs": esm(["a.cjs", "b.mjs", "c.cjs"]),
        // Bun.build() returns when setup() has settled.
        "a.cjs": cjs(
          "a",
          `const setup = () => Promise.all([import("./late.cjs"), import("./b.mjs")]);
           Bun.build({ entrypoints: [__filename], plugins: [{ name: "waits", setup }] });
           order.push("waited");` + slow,
        ),
        "b.mjs": `export {};`,
        "c.cjs": cjs("c"),
        "late.cjs": cjs("late"),
      },
      "a,late,waited,c",
    ],
  ];

  describe.each<["import" | "require", Case[]]>([
    ["import", [...synchronous, ...asynchronous]],
    ["require", synchronous],
  ])("under %s()", (load, cases) => {
    test.each(cases)("%s", async (_, files, order) => {
      expect(await run({ ...inRounds(files), "main.mjs": loadEveryRound(load) }, "main.mjs")).toEqual({
        orders: rounds.map(() => "order: " + order),
        exitCode: 0,
      });
    });
  });

  describe.each(["import", "require"] as const)(
    "a plugin answers for what %s() loads behind the file that registers it",
    load => {
      test.each([
        ["onResolve", `build.onResolve({ filter: /target/ }, () => ({ path: __dirname + "/given.mjs" }));`],
        [
          "onLoad",
          `build.onLoad({ filter: /target/ }, () => ({ contents: ${JSON.stringify(says("given"))}, loader: "js" }));`,
        ],
      ])("%s", async (_, setup) => {
        const files = {
          "root.mjs": esm(["registers.cjs", "above.mjs"], says("root")),
          "registers.cjs": `Bun.plugin.clearAll(); Bun.plugin({ name: "gives", setup(build) { ${setup} } });`,
          "above.mjs": esm(["target.mjs"]),
          "target.mjs": says("target"),
          "given.mjs": says("given"),
        };
        expect(await run({ ...inRounds(files), "main.mjs": loadEveryRound(load) }, "main.mjs")).toEqual({
          orders: rounds.map(() => "order: given,root"),
          exitCode: 0,
        });
      });
    },
  );

  test.each(["", "async"])("beside files that an onLoad gives: %j", async async => {
    const files = {
      "root.mjs": esm(["first.mjs", "given.mjs", "a.cjs", "given-b.cjs"]),
      "first.mjs": esm(["c.cjs"]),
      "given.mjs": esm(["given-d.cjs", "e.cjs"]),
      "a.cjs": cjs("a"),
      "given-b.cjs": cjs("b"),
      "c.cjs": cjs("c"),
      "given-d.cjs": cjs("d"),
      "e.cjs": cjs("e"),
    };
    const plugin = `Bun.plugin({ name: "gives", setup(build) {
      build.onLoad({ filter: /given/ }, ${async} ({ path }) => {
        ${async && "await 0;"}
        return { contents: require("fs").readFileSync(path, "utf8"), loader: "js" };
      });
    } });`;
    expect(await run({ ...inRounds(files), "main.mjs": plugin + everyRound }, "main.mjs")).toEqual({
      orders: rounds.map(() => "order: c,d,e,a,b"),
      exitCode: 0,
    });
  });

  describe.each(["--isolate", "--isolate=modules"])("beside files that an earlier test file loaded, %s", flag => {
    test.each([
      [esm(["a.cjs", "b.cjs", "c.cjs"]), "a,b,c"],
      [esm(["imports-a.mjs", "imports-b.mjs"]), "a,b"],
      [`await import("./imports-both.mjs");`, "a,b"],
      // What needs no thread does not wait for another import().
      [`await Promise.all([import("./a.cjs"), import("./b.cjs")]);`, "b,a"],
      [`await Promise.all([import("./a.cjs"), import("./imports-b.mjs")]);`, "b,a"],
    ])("%s", async (loads, order) => {
      const files = {
        "a.cjs": cjs("a"),
        "b.cjs": cjs("b"),
        "c.cjs": cjs("c"),
        "imports-a.mjs": esm(["a.cjs"]),
        "imports-b.mjs": esm(["b.cjs"]),
        "imports-both.mjs": esm(["a.cjs", "imports-b.mjs"]),
        "1.test.mjs": `import "./imports-b.mjs"; import { test } from "bun:test"; test("loads one", () => {});`,
        "2.test.mjs": `${loads} console.log("order:", order.join());`,
      };
      expect(await run(files, "test", flag, "./1.test.mjs", "./2.test.mjs")).toEqual({
        orders: ["order: " + order],
        exitCode: 0,
      });
    });
  });

  test("and a macro can import one while others wait", async () => {
    const files = {
      "root.mjs": esm(["slow.mjs", "a.cjs", "calls-macro.mjs"]),
      "slow.mjs": `export {};` + slow,
      "a.cjs": cjs("a"),
      "calls-macro.mjs": `import { macro } from "./macro.mjs" with { type: "macro" }; order.push(macro());`,
      "macro.mjs": `import given from "./given.cjs"; export const macro = () => given.x;`,
      "given.cjs": `exports.x = "macro";`,
    };
    const plugin = `Bun.plugin({ name: "gives", setup(build) {
      build.onLoad({ filter: /given/ }, ({ path }) => ({ contents: require("fs").readFileSync(path, "utf8"), loader: "js" }));
    } });`;
    expect(await run({ ...inRounds(files), "main.mjs": plugin + everyRound }, "main.mjs")).toEqual({
      orders: rounds.map(() => "order: a,macro"),
      exitCode: 0,
    });
  });

  test.each(["shared.cjs", "shared.mjs"])(
    "and a macro can import %s, which its caller's importer imports",
    async shared => {
      const files = {
        "root.mjs": esm([shared, "calls-macro.mjs"]),
        "calls-macro.mjs": `import { macro } from "./macro.mjs" with { type: "macro" }; order.push(macro());`,
        "macro.mjs": `import { x } from "./${shared}"; export const macro = () => x;`,
        "shared.cjs": `exports.x = "macro";` + slow,
        "shared.mjs": `export const x = "macro";` + slow,
      };
      // With an onLoad in place the macro runs on the thread of the program.
      const plugin = `Bun.plugin({ name: "idle", setup(build) { build.onLoad({ filter: /[.]nothing$/ }, () => {}); } });`;
      expect(await run({ ...inRounds(files), "main.mjs": plugin + everyRound }, "main.mjs")).toEqual({
        orders: rounds.map(() => "order: macro"),
        exitCode: 0,
      });
    },
  );

  test("and a worker can be terminated while some wait", async () => {
    const files = {
      "worker.mjs": esm(["a.cjs", "slow.mjs", "b.cjs", "c.cjs"]),
      "a.cjs": cjs("a", `postMessage("a ran");`),
      "slow.mjs": `export {};` + slow,
      "b.cjs": cjs("b", `for (;;);`),
      "c.cjs": cjs("c"),
      "main.mjs": `
        const worker = new Worker(import.meta.dir + "/worker.mjs");
        const { data } = await new Promise(resolve => (worker.onmessage = resolve));
        const closed = new Promise(resolve => worker.addEventListener("close", resolve));
        worker.terminate();
        await closed;
        console.log("order:", data);
      `,
    };
    expect(await run(files, "main.mjs")).toEqual({ orders: ["order: a ran"], exitCode: 0 });
  });
});

describe.concurrent("a load ends", () => {
  async function run(files: Record<string, string>) {
    using dir = tempDir("a-load-ends", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { lines: stdout.trim().split("\n"), stderr, exitCode };
  }

  test("when a module that waited for an await requires one that waits beside it", async () => {
    expect(
      await run({
        "main.mjs": `await import("./top.mjs"); console.log((await import("./required.mjs")).x);`,
        "top.mjs": `import "./requires.mjs"; import "./beside.mjs"; console.log("top");`,
        "requires.mjs": `import "./waits.mjs"; try { require("./required.mjs"); } catch (error) { console.log(error.code); } export {};`,
        "required.mjs": `import "./beside.mjs"; export const x = "required";`,
        "beside.mjs": `import "./waits.mjs"; console.log("beside");`,
        "waits.mjs": `await 0;`,
      }),
    ).toEqual({ lines: ["ERR_REQUIRE_ASYNC_MODULE", "beside", "top", "required"], stderr: "", exitCode: 0 });
  });

  test("when a module turns the event loop for one that was transpiled along with it", async () => {
    const longEnoughToBeCached = `//${Buffer.alloc(8 * 1024, "-")}\n`;
    const names = ["a", "b", "c", "d"];
    using dir = tempDir("transpiled-along", {
      // The threads have transpiled all the files before the event loop hears of the first.
      "main.mjs": `
        import { readdirSync } from "node:fs";
        globalThis.loads = new Map(${JSON.stringify(names)}.map(name => [name, import("./" + name + ".mjs")]));
        while (readdirSync("cache").filter(name => name.endsWith(".pile")).length < loads.size);
        await Promise.all(loads.values());
        console.log("done");
      `,
      ...Object.fromEntries(
        names.map(name => [
          `${name}.mjs`,
          `${longEnoughToBeCached}
           const setup = () => Promise.all([...loads].filter(([name]) => name !== "${name}").map(([, load]) => load));
           if ((globalThis.first ??= "${name}") === "${name}")
             Bun.build({ entrypoints: [import.meta.path], plugins: [{ name: "waits", setup }] });`,
        ]),
      ),
      "cache/.keep": "",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(String(dir), "cache") },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "done\n", stderr: "", exitCode: 0 });
  });
});
