// A program lays an accessor on an object of the host, and the getter answers `this`: the object itself, by a road on which the compiler does not follow it. What the program then uses off it is made late, by
// Bun's own JavaScript. Every way to come by the descriptor, told over every way to lay it, over four objects, at the top of the file and in a function.
// Once a descriptor of constant data that got its `get` by a store behind it counted as data, and `globalThis.whole.process.nextTick(..)` ended the process.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const holders: Record<string, [holder: string, use: string]> = {
  "the-global-object": ["globalThis", `globalThis.whole.process.nextTick(() => console.log("ticked"));`],
  process: ["process", `process.whole.nextTick(() => console.log("ticked"));`],
  bun: ["Bun", `console.log(typeof Bun.whole.sql.connect);`],
  console: ["console", `console.log(typeof new console.whole.Console(process.stdout).log);`],
};

const descriptors: Record<string, [before: string, descriptor: string]> = {
  "in-place": ["", `{ configurable: true, get() { return this; } }`],
  "in-a-variable": [`const descriptor = { configurable: true, get() { return this; } };\n`, "descriptor"],
  "filled-by-a-store": [
    `const descriptor = { configurable: true };\ndescriptor.get = function () { return this; };\n`,
    "descriptor",
  ],
  "filled-under-a-made-key": [
    `const descriptor = { configurable: true };\ndescriptor[["g", "et"].join("")] = function () { return this; };\n`,
    "descriptor",
  ],
  "filled-by-assign": [
    `const descriptor = Object.assign({ configurable: true }, { get() { return this; } });\n`,
    "descriptor",
  ],
  "out-of-a-function": [
    `function describe() {\n  return { configurable: true, get() { return this; } };\n}\n`,
    "describe()",
  ],
};

const layers: Record<string, (holder: string, descriptor: string) => string> = {
  "define-property": (holder, descriptor) => `Object.defineProperty(${holder}, "whole", ${descriptor});`,
  "define-properties": (holder, descriptor) => `Object.defineProperties(${holder}, { whole: ${descriptor} });`,
  "reflect-define-property": (holder, descriptor) => `Reflect.defineProperty(${holder}, "whole", ${descriptor});`,
  "define-getter": (holder, descriptor) => `${holder}.__defineGetter__("whole", (${descriptor}).get);`,
};
// An executable does not let the prototype of a built-in object be changed, and says so. The global object lets nobody change it anywhere.
const layersAbove: typeof layers = {
  "set-prototype-of": (holder, descriptor) =>
    `Object.setPrototypeOf(${holder}, Object.create(Object.getPrototypeOf(${holder}), { whole: ${descriptor} }));`,
  "a-store-of-proto": (holder, descriptor) =>
    `${holder}.__proto__ = Object.create(${holder}.__proto__, { whole: ${descriptor} });`,
};

const places: Record<string, (text: string) => string> = {
  "at-the-top": text => text,
  "in-a-function": text => `function lay() {\n${text.replace(/^(?=.)/gm, "  ")}}\nlay();\n`,
};

export default function write(folder: string) {
  for (const [name, [holder, use]] of Object.entries(holders))
    for (const [place, put] of Object.entries(places)) {
      const program = (way: string, head: string, text: string) =>
        writeFileSync(join(folder, `${name}--${way}--${place}.js`), `${head}${put(text)}${use}\n`);
      for (const [how, [before, descriptor]] of Object.entries(descriptors)) {
        for (const [layer, lay] of Object.entries(layers))
          program(`${how}--${layer}`, "", `${before}${lay(holder, descriptor)}\n`);
        if (holder !== "globalThis")
          for (const [layer, lay] of Object.entries(layersAbove))
            program(
              `${how}--${layer}`,
              "// Refused: Cannot change the prototype of\n",
              `${before}${lay(holder, descriptor)}\n`,
            );
      }
      for (const [layer, lay] of Object.entries(layers))
        if (layer !== "define-getter")
          program(
            `the-store-stands-behind-the-call-in-a-loop--${layer}`,
            "",
            `const descriptor = { configurable: true, value: 1 };\nfor (let turn = 0; turn < 2; turn++) {\n  ${lay(holder, "descriptor")}\n  delete descriptor.value;\n  descriptor.get = function () { return this; };\n}\n`,
          );
    }
}
