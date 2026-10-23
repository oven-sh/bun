// Runs `<root>/<n>/main.<extension>` for each `n` in the arguments and prints what each logged, as JSON.
import { join } from "node:path";

const [root, extension, ...numbers] = process.argv.slice(2);

let lines = [];

function describe(value) {
  if (Array.isArray(value)) return `[${value.map(describe).join(", ")}]`;
  if (typeof value === "function") {
    return (globalThis[value.name] === value ? "" : "local ") + nameOf(value) + (value.tag ? ` (${value.tag})` : "");
  }
  if (typeof value === "object" && value !== null) return `object {${Object.keys(value).slice(0, 4)}}`;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** Each compiler has its own name for `export default class {}`. */
function nameOf(fn) {
  return fn.name.replace(/^(default_1|main_default)$/, "default");
}

function where(target, key) {
  const name = typeof target === "function" ? nameOf(target) : `${nameOf(target.constructor)}.prototype`;
  return key === undefined ? name : `${name}[${typeof key === "symbol" ? key.toString() : JSON.stringify(key)}]`;
}

globalThis.log = line => void lines.push(line);
globalThis.show = (...values) => void lines.push(values.map(describe).join(" "));
globalThis.d = (target, key) => void lines.push(`${where(target, key)} @d`);
globalThis.p = (target, key, index) => void lines.push(`${where(target, key)} @p ${index}`);
Reflect.metadata = (name, value) => (target, key) =>
  void lines.push(`${where(target, key)} ${name} = ${describe(value)}`);

const all = [];
for (const n of numbers) {
  lines = [];
  try {
    await import(join(root, n, `main.${extension}`));
  } catch (error) {
    // The message depends on the engine.
    lines.push(`throws ${error?.name}`);
  }
  all.push(lines);
}
process.stdout.write(JSON.stringify(all));
