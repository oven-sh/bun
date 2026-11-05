// A call hands back an object that the compiler knows by another name: process.getBuiltinModule("bun") is `Bun`, require.main.require("node:process") is `process`. What the program then reads off it is a
// member like any other, and some members are made by Bun's own JavaScript at the first read. Once `typeof give("process").finalization` said "function" for "object": the build had left the maker out,
// and something that only stands for the member answered the read.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const givers: Record<string, (name: string) => string> = {
  "get-builtin-module": name => `process.getBuiltinModule(${JSON.stringify(name)})`,
  require: name => `require(${JSON.stringify(name)})`,
  "created-require": name => `require("node:module").createRequire(__filename)(${JSON.stringify(name)})`,
  "main-require": name => `require.main.require(${JSON.stringify(name)})`,
  "import-meta-require": name => `import.meta.require(${JSON.stringify(name)})`,
};
const looks: Record<string, Record<string, string>> = {
  bun: {
    sql: `typeof held.sql, typeof held.sql.connect`,
    shell: `typeof held.$, typeof held.$.escape`,
    "sql-class": `typeof held.SQL, typeof held.SQL.prototype`,
    version: `typeof held.version`,
    "made-key": `typeof held[JSON.parse('"sql"')]`,
    same: `held === Bun`,
  },
  "node:process": {
    "next-tick": `typeof held.nextTick`,
    finalization: `typeof held.finalization, typeof held.finalization.register`,
    flags: `typeof held.allowedNodeEnvironmentFlags, held.allowedNodeEnvironmentFlags.has("--made-up")`,
    "made-key": `typeof held[JSON.parse('"finalization"')]`,
    same: `held === process`,
  },
  "node:buffer": {
    from: `held.Buffer.from("hi").length`,
    same: `held.Buffer === Buffer`,
    "made-key": `typeof held[JSON.parse('"Buffer"')].from`,
  },
  "node:console": {
    log: `typeof held.log, typeof held.Console`,
    same: `held === console`,
    "console-class": `typeof new held.Console(process.stdout).log`,
  },
  "node:timers": {
    promisified: `typeof held.setTimeout[REQUIRE("node:util").promisify.custom]`,
    same: `held.setTimeout === setTimeout`,
  },
  "node:module": {
    "made-key": `typeof held[JSON.parse('"_cache"')]`,
  },
  "node:util": {
    format: `held.format("%s", 1)`,
    inspect: `held.inspect({ a: 1 })`,
    "made-key": `held[JSON.parse('"format"')]("%d", 2)`,
  },
};
const others: Record<string, string> = {
  "binding-util": `const held = process.binding("util");\nconsole.log(typeof held);\n`,
  "binding-fs": `let held;\ntry {\n  held = process.binding("fs");\n} catch (error) {\n  held = error.name;\n}\nconsole.log(typeof held);\n`,
  "binding-constants": `const held = process.binding("constants");\nconsole.log(typeof held.os, typeof held.fs);\n`,
  "binding-buffer": `let held;\ntry {\n  held = process.binding("buffer");\n} catch (error) {\n  held = error.name;\n}\nconsole.log(typeof held);\n`,
  "main-module-constructor": `const Made = process.mainModule.constructor;\nconsole.log(typeof Made._cache, typeof Made.createRequire, Made === require("node:module"));\n`,
  "global-of-global": `const held = globalThis.globalThis.global;\nconsole.log(typeof held.Bun.sql, typeof held.process.finalization);\n`,
  "function-this": `const held = (function () { return this; })();\nconsole.log(typeof held.Bun.sql);\n`,
  "reflect-apply-get-builtin-module": `const held = Reflect.apply(process.getBuiltinModule, process, ["bun"]);\nconsole.log(typeof held.sql);\n`,
  "get-builtin-module-by-value": `const give = process.getBuiltinModule;\nconsole.log(typeof give("bun").sql, typeof give("process").finalization);\n`,
  "get-builtin-module-through-map": `console.log(["bun", "process"].map(process.getBuiltinModule).map(held => typeof (held.sql ?? held.finalization)).join());\n`,
  "structured-pair": `const [held] = [process.getBuiltinModule("bun")];\nconsole.log(typeof held.sql);\n`,
};

export default function write(folder: string) {
  for (const [giver, give] of Object.entries(givers))
    for (const [subject, asked] of Object.entries(looks))
      for (const [look, text] of Object.entries(asked)) {
        const isModule = giver === "import-meta-require";
        writeFileSync(
          join(folder, `${giver}--${subject.replace("node:", "")}--${look}.${isModule ? "mjs" : "cjs"}`),
          `const held = ${give(subject)};\nconsole.log(${text.replace("REQUIRE", isModule ? "import.meta.require" : "require")});\nconsole.log("end");\n`,
        );
      }
  for (const [name, text] of Object.entries(others))
    writeFileSync(join(folder, `other--${name}.cjs`), `${text}console.log("end");\n`);
}
