// Stores by key as the well-known merging libraries do: one `object[key] = value` for every object and every name of the program.
function baseAssignValue(object, key, value) {
  if (key == "__proto__") Object.defineProperty(object, key, { configurable: true, enumerable: true, value, writable: true });
  else object[key] = value;
}
function eq(a, b) { return a === b || (a !== a && b !== b); }
function assignMergeValue(object, key, value) {
  if ((value !== undefined && !eq(object[key], value)) || (value === undefined && !(key in object))) baseAssignValue(object, key, value);
}
function safeGet(object, key) {
  if (key === "constructor" && typeof object[key] === "function") return;
  if (key == "__proto__") return;
  return object[key];
}
function isObject(value) { const type = typeof value; return value != null && (type == "object" || type == "function"); }
function keysIn(object) { const keys = []; for (const key in object) keys.push(key); return keys; }
function baseFor(object, iteratee) {
  const keys = keysIn(object);
  for (let i = 0; i < keys.length; i++) iteratee(object[keys[i]], keys[i]);
}
function baseMerge(object, source, customizer, depth) {
  if (object === source) return;
  baseFor(source, (sourceValue, key) => {
    const present = safeGet(object, key);
    let value = customizer ? customizer(present, sourceValue, key + "", object, source) : undefined;
    if (value === undefined) {
      if (isObject(sourceValue) && !Array.isArray(sourceValue) && typeof sourceValue != "function" && depth < 4) {
        value = isObject(present) ? present : {};
        baseMerge(value, sourceValue, customizer, depth + 1);
      } else value = sourceValue;
    }
    assignMergeValue(object, key, value);
  });
}
export function mergeWith(object, ...sources) {
  const customizer = typeof sources[sources.length - 1] == "function" ? sources.pop() : undefined;
  for (const source of sources) if (source) baseMerge(object, source, customizer, 0);
  return object;
}
export function assignAll(object, source) {
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i++) baseAssignValue(object, keys[i], source[keys[i]]);
  return object;
}
export function set(object, key, value) { object[key] = value; return object; }
export function makeTheirs(i) { const object = { a: i, b: "s" + i }; if (i & 1) object.c = { d: i }; return object; }
export class Theirs { constructor(i) { this.a = i; if (i & 1) this.b = "b"; this.nested = {}; } }
const packageDefaults = { a: 1, b: "b", flag: false, n: 0 };
export const copiers = {
  copy: object => ({ ...object }),
  overDefaults: object => ({ ...packageDefaults, ...object }),
  underDefaults: object => ({ ...object, ...packageDefaults }),
  assign: object => Object.assign({ n: 0 }, object),
  assignTwo: object => Object.assign({}, packageDefaults, object),
  rest: object => { const { a, ...others } = object; return [a, others]; },
  entries: object => Object.fromEntries(Object.entries(object)),
};
export const packageText = "text of the package";
export const packageTextReadAboveFirst = "nobody in the package reads this";
export let packageMode = "one";
export function setPackageMode(mode) { packageMode = mode; }
// Validators and the like make code out of text at run time.
export const codeFromText = (parameters, body) => new Function(...parameters, body);
// Loaders of plugins and of configuration are handed the path of a file.
import { createRequire } from "node:module";
const requireFromThePackage = createRequire(import.meta.url);
export const importByPath = path => import(path);
export const requireByPath = path => requireFromThePackage(path);
// A payload as a validator library hands it round, and what reads it.
export const payloadOfThePackage = value => ({ value, issues: [] });
export const readPayloadInThePackage = payload => [payload.value, payload.issues.length, Object.keys(payload).join()];
export class StaticsOfThePackage { static limit = 3; static label = "package"; static twice() { return this.limit * 2; } }
