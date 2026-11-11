// `Bun`, `process`, the global object and node:module make some of their members late. Whatever turns such an object into an ordinary one makes all of them at once: a store of a new name, a definition, a
// list of its keys, a loop over its names. The program reads none of the members, so the build keeps none: and the makers of a few run Bun's own JavaScript. Beside them a dozen everyday lines of that kind.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const holders: Record<string, [head: string, holder: string]> = {
  bun: ["", "Bun"],
  process: ["", "process"],
  "global-this": ["", "globalThis"],
  "the-module-of-modules": [`const held = require("node:module");\n`, "held"],
};
const deeds: Record<string, string> = {
  "a-loop-over-its-names": `let count = 0;
for (const name in HOLDER) count++;
console.log(count > 0);
`,
  "a-name-that-is-not-there-is-deleted": `console.log(delete HOLDER.madeUpName);
`,
  "a-name-that-is-not-there-is-read": `console.log(HOLDER.madeUpName, HOLDER?.madeUpName?.other);
`,
  "a-new-name-is-defined-by-reflect": `console.log(Reflect.defineProperty(HOLDER, "madeUpName", { value: 1, configurable: true }));
`,
  "a-new-name-is-defined": `Object.defineProperty(HOLDER, "madeUpName", { value: 1, configurable: true });
console.log(HOLDER.madeUpName);
`,
  "a-new-name-is-set-by-reflect": `console.log(Reflect.set(HOLDER, "madeUpName", 1));
`,
  "a-new-name-is-stored-under-a-made-key": `const word = JSON.parse('"madeUpName"');
HOLDER[word] = 1;
console.log(HOLDER[word]);
`,
  "a-new-name-is-stored": `HOLDER.madeUpName = 1;
console.log(HOLDER.madeUpName);
`,
  "a-symbol-is-asked-for": `console.log(Symbol.iterator in HOLDER, Symbol.toStringTag in HOLDER, typeof HOLDER[Symbol.toPrimitive]);
`,
  "an-index-is-asked-for": `console.log(0 in HOLDER, HOLDER[0], Object.hasOwn(HOLDER, 0));
`,
  "how-many-keys": `console.log(Object.keys(HOLDER).length > 0);
`,
  "how-many-names": `console.log(Object.getOwnPropertyNames(HOLDER).length > 0);
`,
  "how-many-own-keys": `console.log(Reflect.ownKeys(HOLDER).length > 0);
`,
  "is-it-frozen": `console.log(Object.isFrozen(HOLDER), Object.isSealed(HOLDER), Object.isExtensible(HOLDER));
`,
  "it-is-turned-into-text": `console.log(String(HOLDER).length > 0, Object.prototype.toString.call(HOLDER).length > 0);
`,
  "its-prototype-is-asked-for": `console.log(typeof Object.getPrototypeOf(HOLDER));
`,
  "its-prototype-is-set-to-what-it-is": `console.log(Reflect.setPrototypeOf(HOLDER, Object.getPrototypeOf(HOLDER)));
`,
  "names-are-assigned": `Object.assign(HOLDER, { madeUpName: 1 });
console.log(HOLDER.madeUpName);
`,
};
const everyday: Record<string, string> = {
  "a-global-is-laid": `globalThis.madeUpName = 1;
console.log(madeUpName);
`,
  "a-listener-on-exit": `process.on("exit", code => console.log("exit", code));
`,
  "an-environment-name-is-stored": `process.env.MADE_UP_NAME = "1";
console.log(process.env.MADE_UP_NAME);
`,
  "browser-is-asked-for": `console.log(process.browser, typeof process.versions.node, process.release.name);
`,
  "exit-code-is-stored": `process.exitCode = 0;
console.log(process.exitCode);
`,
  "is-it-bun": `console.log(typeof Bun !== "undefined", "Bun" in globalThis, typeof Bun.version);
`,
  "is-it-node": `const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
console.log(isNode);
`,
  "no-deprecation-is-stored": `process.noDeprecation = true;
console.log(process.noDeprecation);
`,
  "set-immediate-is-asked-for": `console.log(typeof setImmediate, "setImmediate" in globalThis, typeof queueMicrotask);
`,
  "throw-deprecation-is-asked-for": `console.log(process.throwDeprecation, process.traceDeprecation);
`,
  "title-is-stored": `process.title = "made";
console.log(typeof process.title);
`,
  "type-of-members": `console.log(typeof process.nextTick, typeof process.hrtime, typeof process.emitWarning);
`,
};

export default function write(folder: string) {
  for (const [name, [head, holder]] of Object.entries(holders))
    for (const [deed, text] of Object.entries(deeds))
      writeFileSync(
        join(folder, `${name}--${deed}.js`),
        `${head}${text.replaceAll("HOLDER", holder)}console.log("end");\n`,
      );
  for (const [name, text] of Object.entries(everyday))
    writeFileSync(join(folder, `everyday--${name}.js`), `${text}console.log("end");\n`);
}
