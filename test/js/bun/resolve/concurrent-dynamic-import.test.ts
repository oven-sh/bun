import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

// A repeated import() starts from the source its module was first made from. When the module has
// left the registry by the time that import() goes on, it is made again from that source.
test("import() of a data module that is removed while the import() is queued gets the file's own value", async () => {
  const values = {
    "object.json": { a: 1, b: { c: [1, 2, 3] } },
    "array.json": [1, { a: 2 }, "three"],
    "string.json": "a string of its own",
    "data.jsonc": { a: 1, b: { c: [1, 2, 3] } },
    "data.toml": { a: 1, b: { c: [1, 2, 3] } },
    "data.yaml": { a: 1, b: { c: [1, 2, 3] } },
  };
  using dir = tempDir("data-module-removed-in-flight", {
    "object.json": JSON.stringify(values["object.json"]),
    "array.json": JSON.stringify(values["array.json"]),
    "string.json": JSON.stringify(values["string.json"]),
    "data.jsonc": `// comment\n{ "a": 1, "b": { "c": [1, 2, 3] } }`,
    "data.toml": `a = 1\n[b]\nc = [1, 2, 3]\n`,
    "data.yaml": `a: 1\nb:\n  c: [1, 2, 3]\n`,
    "entry.mjs": `
      import { join } from "node:path";
      const names = ${JSON.stringify(Object.keys(values))};
      await (async () => { for (const name of names) await import("./" + name); })();
      await new Promise(resolve => setImmediate(resolve));

      const again = names.map(name => import("./" + name));
      for (const name of names) delete require.cache[join(import.meta.dir, name)];

      // Nothing else holds the values now. What is allocated next takes the place of any that died.
      Bun.gc(true);
      const others = [];
      for (let i = 0; i < 100_000; i++) others.push({ x: i, y: i }, [i, i], "s" + i);

      const namespaces = await Promise.all(again);
      console.log(JSON.stringify(Object.fromEntries(names.map((name, i) => [name, namespaces[i].default]))));
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
  expect(JSON.parse(stdout)).toEqual(values);
  expect(exitCode).toBe(0);
});

// Of two import()s that start together only one source becomes a module.
test("a realm that imported a data module twice at once is collected", async () => {
  using dir = tempDir("data-module-realm-collected", {
    "data.json": `{ "a": 1 }`,
    "entry.mjs": `
      import { heapStats } from "bun:jsc";
      const realms = () => (Bun.gc(true), heapStats().objectTypeCounts.GlobalObject);
      const before = realms();
      for (let i = 0; i < 20; i++) {
        const realm = new ShadowRealm();
        await Promise.all([realm.importValue("./data.json", "a"), realm.importValue("./data.json", "a")]);
      }
      await new Promise(resolve => setImmediate(resolve));
      console.log(realms() - before < 20 ? "collected" : "kept all 20");
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
  expect(stdout.trim()).toBe("collected");
  expect(exitCode).toBe(0);
});
