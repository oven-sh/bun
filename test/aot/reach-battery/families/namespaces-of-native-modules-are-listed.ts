// node:process, bun and node:module mirror an object that exists without them, and an export whose value Bun's own JavaScript makes is made when somebody first asks for it. Whoever lists such a
// namespace asks for all of them: Object.keys() wants the descriptor of each name to see whether it is listed, and the descriptor of an export holds its value. Once the build kept what the program
// named, and the list ended the executable: "process.allowedNodeEnvironmentFlags was left out of the executable".
// Every way of listing, told over the modules and over how the namespace is come by.
// A file that exports such a module again (`export * from "node:process"`) hands the same names to whoever lists its own namespace, and there no code of the program names the module:
// the program is a folder then, and hands-on.mjs is that file. So does a file that hands on one member by its name (`export { $ } from "bun"`): once the executable of
// `import * as utils from "./hands-on.mjs"; typeof utils.$` ended with "Bun.$ was left out of the executable", where a named import of the same file, or `Bun.$` written anywhere, ran.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const modules: Record<string, string> = {
  process: "node:process",
  bun: "bun",
  module: "node:module",
  buffer: "node:buffer",
  console: "node:console",
};

/** Prints something that does not hang on the version of Bun. */
const ways: Record<string, string> = {
  "keys": `console.log(Object.keys(held).length > 3);`,
  "values": `console.log(Object.values(held).length > 3);`,
  "entries": `console.log(Object.entries(held).every(([name]) => typeof name === "string"));`,
  "descriptors": `console.log(Object.keys(Object.getOwnPropertyDescriptors(held)).length > 3);`,
  "one-descriptor-each": `console.log(Reflect.ownKeys(held).every(name => typeof Reflect.getOwnPropertyDescriptor(held, name) === "object"));`,
  "own-keys": `console.log(Reflect.ownKeys(held).length > 3, Object.getOwnPropertyNames(held).length > 3);`,
  "for-in": `let count = 0;\nfor (const name in held) count++;\nconsole.log(count > 3);`,
  "a-read-of-each": `let count = 0;\nfor (const name in held) count += typeof held[name] === "symbol" ? 0 : 1;\nconsole.log(count > 3);`,
  "a-spread": `console.log(Object.keys({ ...held }).length > 3);`,
  "a-rest": `const { default: first, ...rest } = held;\nconsole.log(typeof first, Object.keys(rest).length > 3);`,
  "assign": `console.log(Object.keys(Object.assign({}, held)).length > 3);`,
  "is-enumerable": `console.log(Reflect.ownKeys(held).filter(name => Object.prototype.propertyIsEnumerable.call(held, name)).length > 3);`,
  "is-frozen": `console.log(Object.isFrozen(held), Object.isSealed(held));`,
};

const roads: Record<string, (name: string) => string> = {
  "a-star": name => `import * as held from ${JSON.stringify(name)};\n`,
  "an-import-awaited": name => `const held = await import(${JSON.stringify(name)});\n`,
};

// The same namespaces behind a file that exports the module again: what is listed is the namespace of that file.
const roadsOverAFile: Record<string, string> = {
  "a-star-of-a-file-that-hands-it-on": `import * as held from "./hands-on.mjs";\n`,
  "an-import-awaited-of-a-file-that-hands-it-on": `const held = await import("./hands-on.mjs");\n`,
};

// One member handed on by its name, and what the program does with it: `taken` holds the member. The first names of each module are made by Bun's own JavaScript when they are first read,
// or call it; the last is made by native code alone, and says that the road itself is sound.
const handedOnByName: Record<string, Record<string, string>> = {
  bun: {
    $: "typeof taken",
    sql: "typeof taken",
    SQL: "typeof taken",
    postgres: "typeof taken",
    peek: "taken(Promise.resolve(7))",
    Glob: `[...new taken("*.none").scanSync(".")].length`,
    file: "typeof taken",
  },
  process: {
    nextTick: "typeof taken",
    allowedNodeEnvironmentFlags: "typeof taken.has",
    finalization: "typeof taken.register",
    argv: "Array.isArray(taken)",
  },
  module: {
    _cache: "typeof taken",
    wrapper: "taken.length",
    createRequire: "typeof taken",
  },
};

/** How the program comes by the member that hands-on.mjs exports again. The last lists the namespace of that file and names no member. */
const roadsToOneName: Record<string, (member: string, use: string) => string> = {
  "read-off-a-star": (member, use) =>
    `import * as held from "./hands-on.mjs";\nconst taken = held.${member};\nconsole.log(${use});\n`,
  "taken-out-of-an-import-awaited": (member, use) =>
    `const { ${member}: taken } = await import("./hands-on.mjs");\nconsole.log(${use});\n`,
  "taken-out-of-what-require-answers": (member, use) =>
    `const { ${member}: taken } = require("./hands-on.mjs");\nconsole.log(${use});\n`,
  "listed": () => `import * as held from "./hands-on.mjs";\nconsole.log(Object.keys(held).join());\n`,
};

// A call of process.exit() is company enough to change what the build holds: with it the list was refused by an error, without it the executable died.
const ends: Record<string, string> = { "ends-by-itself": "", "exits": "process.exit(0);\n" };

// A module that is written in JavaScript may put a member in place when it is first read, and a list of its namespace is such a read in plain Bun. Which members are still accessors behind the list?
const written = "tty fs stream crypto dns readline timers util events http zlib worker_threads".split(" ");
const stillAccessors = `Object.keys(held);
console.log(
  Object.entries(Object.getOwnPropertyDescriptors(held.default))
    .filter(([, found]) => found.get)
    .map(([name]) => name)
    .sort()
    .join(),
);
`;

/** A program of two files: main.mjs, and the file that exports again. */
function writeBehindAFile(folder: string, program: string, handsOn: string, main: string) {
  mkdirSync(join(folder, program));
  writeFileSync(join(folder, program, "hands-on.mjs"), handsOn);
  writeFileSync(join(folder, program, "main.mjs"), main);
}

export default function write(folder: string) {
  for (const [module, name] of Object.entries(modules))
    for (const [way, text] of Object.entries(ways))
      for (const [road, come] of Object.entries(roads))
        for (const [end, last] of Object.entries(ends))
          writeFileSync(join(folder, `${module}--${way}--${road}--${end}.mjs`), `${come(name)}${text}\n${last}`);
  for (const [module, name] of Object.entries(modules))
    for (const [way, text] of Object.entries(ways))
      for (const [road, come] of Object.entries(roadsOverAFile))
        for (const [end, last] of Object.entries(ends))
          writeBehindAFile(
            folder,
            `${module}--${way}--${road}--${end}`,
            `export * from ${JSON.stringify(name)};\n`,
            `${come}${text}\n${last}`,
          );
  for (const [module, members] of Object.entries(handedOnByName))
    for (const [member, use] of Object.entries(members))
      for (const [road, come] of Object.entries(roadsToOneName))
        writeBehindAFile(
          folder,
          `${module}--one-name-handed-on--${member.replace("$", "dollar")}--${road}`,
          `export { ${member} } from ${JSON.stringify(modules[module])};\n`,
          come(member, use),
        );
  for (const module of [...written, "process", "module"])
    for (const [road, come] of Object.entries(roads))
      writeFileSync(
        join(folder, `${module}--what-a-list-leaves-behind--${road}.mjs`),
        come(`node:${module}`) + stillAccessors,
      );
}
