// A program asks whether a name is there: `word in Bun`, Object.hasOwn(process, word), a descriptor. It reads nothing, so the compiler keeps nothing of the member.
// An object of Bun makes some members at the first look of any kind, and the makers of a few run Bun's own JavaScript (Bun.sql, Bun.$, process.nextTick, the cache of node:module).
// The executable answers as plain Bun does, for every name of every holder, in every way of asking. Once such a look ended the process: the maker asked for code that the executable lacks.
// The names come in on the command line: a program that lists the names of a holder itself keeps all its members.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const written = [
  "Bun",
  "process",
  "globalThis",
  "console",
  "crypto",
  "performance",
  "navigator",
  "Intl",
  "WebAssembly",
  "JSON",
  "Reflect",
  "Math",
  "Atomics",
  "Object",
  "Promise",
  "Array.prototype",
  "String.prototype",
  "Buffer",
  "Buffer.prototype",
  "setTimeout",
  "setImmediate",
  "fetch",
  "Bun.inspect",
  "process.versions",
  "process.release",
  "process.stdout",
];
const modules = [
  "node:child_process",
  "node:crypto",
  "node:events",
  "node:fs",
  "node:http",
  "node:module",
  "node:os",
  "node:path",
  "node:stream",
  "node:timers",
  "node:util",
  "node:worker_threads",
];
const holders: [name: string, head: string, holder: string][] = [
  ...written.map((text): [string, string, string] => [text, "", text]),
  ...modules.map((name): [string, string, string] => [
    name,
    `const held = require(${JSON.stringify(name)});\n`,
    "held",
  ]),
];

const ways: Record<string, (holder: string) => string> = {
  in: holder => `word in ${holder}`,
  "reflect-has": holder => `Reflect.has(${holder}, word)`,
  "has-own": holder => `Object.hasOwn(${holder}, word)`,
  "has-own-property": holder => `${holder}.hasOwnProperty(word)`,
  "has-own-property-call": holder => `Object.prototype.hasOwnProperty.call(${holder}, word)`,
  "is-enumerable": holder => `Object.prototype.propertyIsEnumerable.call(${holder}, word)`,
  descriptor: holder => `Object.getOwnPropertyDescriptor(${holder}, word) !== undefined`,
  "reflect-descriptor": holder => `Reflect.getOwnPropertyDescriptor(${holder}, word) !== undefined`,
};

// An executable has no ShadowRealm.
const listsNames = (head: string, holder: string) => `${head}const names = new Set();
for (let o = ${holder}; o && o !== Object.prototype && o !== Function.prototype; o = Object.getPrototypeOf(o))
  for (const key of Reflect.ownKeys(o)) if (typeof key === "string" && /^[A-Za-z_$][\\w$]*$/.test(key)) names.add(key);
${holder === "globalThis" ? `names.delete("ShadowRealm");\n` : ""}console.log([...names].sort().join("\\n"));
`;
const asks = (head: string, look: string) => `${head}for (const word of process.argv.slice(2)) {
  let answer;
  try {
    answer = ${look};
  } catch (error) {
    answer = error.name;
  }
  console.log(word, answer);
}
`;

export default function write(folder: string) {
  for (const [name, head, holder] of holders) {
    const file = name
      .replace(/[:._]/g, "-")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase();
    writeFileSync(join(folder, `names--${file}.js`), listsNames(head, holder));
    for (const [way, look] of Object.entries(ways))
      writeFileSync(
        join(folder, `${file}--${way}.js`),
        `// Arguments by: names--${file}.js\n// Arguments: nothingOfTheKind\n${asks(head, look(holder))}`,
      );
  }
}
