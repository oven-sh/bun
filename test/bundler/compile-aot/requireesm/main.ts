import { createRequire } from "node:module";
const order = process.argv[2] ?? "a";
if (order === "a") {           // required first, imported afterwards
  const { viaRequire } = await import("./other.ts");
  console.log(viaRequire());
  const lib = await import("./lib.ts");
  console.log(lib.bump(), lib.count);
} else if (order === "b") {    // imported first, required afterwards
  const lib = await import("./lib.ts");
  console.log(lib.bump());
  const { viaRequire } = await import("./other.ts");
  console.log(viaRequire(), lib.count);
} else if (order === "c") {    // being imported (not awaited yet) while it is required
  const pending = import("./lib.ts");
  const { viaRequire } = await import("./other.ts");
  console.log(viaRequire());
  console.log((await pending).count);
} else if (order === "d") {    // only ever required
  const { lazy } = await import("./lazy.ts");
  console.log(lazy(), lazy());
} else if (order === "e") {    // required twice, by two requires
  const r = createRequire(import.meta.url);
  const { lazy } = await import("./lazy.ts");
  console.log(lazy());
  try { console.log(Object.keys(r(import.meta.dir + "/" + "nothing-there.js"))); } catch (e: any) { console.log("threw", e.code ?? e.name); }
}
