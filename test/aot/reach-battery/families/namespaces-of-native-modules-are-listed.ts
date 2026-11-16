// node:process, bun and node:module mirror an object that exists without them, and an export whose value Bun's own JavaScript makes is made when somebody first asks for it. Whoever lists such a
// namespace asks for all of them: Object.keys() wants the descriptor of each name to see whether it is listed, and the descriptor of an export holds its value. Once the build kept what the program
// named, and the list ended the executable: "process.allowedNodeEnvironmentFlags was used, but it was not compiled into this executable".
// Every way of listing, told over the modules and over how the namespace is come by.
import { writeFileSync } from "node:fs";
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

export default function write(folder: string) {
  for (const [module, name] of Object.entries(modules))
    for (const [way, text] of Object.entries(ways))
      for (const [road, come] of Object.entries(roads))
        for (const [end, last] of Object.entries(ends))
          writeFileSync(join(folder, `${module}--${way}--${road}--${end}.mjs`), `${come(name)}${text}\n${last}`);
  for (const module of [...written, "process", "module"])
    for (const [road, come] of Object.entries(roads))
      writeFileSync(
        join(folder, `${module}--what-a-list-leaves-behind--${road}.mjs`),
        come(`node:${module}`) + stillAccessors,
      );
}
