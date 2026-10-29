// By which roads does a program come to a member of Bun, of the global object, of process or of a node: module? Whatever the road, the list that --trim goes by keeps the code behind the member.
// Each road is a program of its own: in one program a road that is followed would hide one that is not.
import { describe, expect, test } from "bun:test";
import { unsupported } from "./harness/compiler";
import { runtimeUse } from "./runtime-use-harness";

const roads: [keptFeature: string, extension: "mjs" | "cjs", text: string][] = [
  ["Bun.Glob", "mjs", `console.log(new (globalThis["Bun"].Glob)("*.js").match("a.js"));`],
  ["Bun.Glob", "cjs", `console.log(new (module.require("bun").Glob)("*.js").match("a.js"));`],
  ["Bun.Glob", "mjs", `import * as b from "bun"; console.log(new b.Glob("*.js").match("a.js"));`],
  ["Bun.Glob", "mjs", `import("bun").then(b => console.log(new b.Glob("*.js").match("a.js")));`],
  ["Bun.Glob", "mjs", `console.log(Reflect.construct(Bun.Glob, ["*.js"]).match("a.js"));`],
  ["Bun.Glob", "mjs", `class X extends Bun.Glob {} console.log(new X("*.js").match("a.js"));`],
  ["Bun.Glob", "mjs", `console.log(new (new Proxy(Bun, {}).Glob)("*.js").match("a.js"));`],
  [
    "BroadcastChannel",
    "mjs",
    `console.log(new (Object.getOwnPropertyDescriptors(globalThis).BroadcastChannel.value)("x").close());`,
  ],
  ["process.memoryUsage", "mjs", `const [b] = await Promise.all([process]); console.log(b.memoryUsage().rss > 0);`],
  ["process.memoryUsage", "mjs", `console.log(([process].reduce((a, b) => b, 0).memoryUsage)().rss > 0);`],
  [
    "MessageChannel",
    "cjs",
    `const wt = require("node:worker_threads"); with (wt) { console.log(new MessageChannel().port1.close()); }`,
  ],
];

(unsupported ? describe.skip : describe.concurrent)("a member is kept whatever the road to it", () => {
  test.each(roads)(
    "%s: %s: %s",
    async (keptFeature, extension, text) => {
      const entryPoint = `main.${extension}`;
      const use = await runtimeUse({ [entryPoint]: text + "\n" }, undefined, entryPoint);
      const kept = use.lines.filter(line => line.startsWith("kept ") && line.includes(keptFeature));
      expect({ exitCode: use.exitCode, isKept: kept.length > 0 }).toEqual({ exitCode: 0, isKept: true });
    },
    120_000,
  );
});
