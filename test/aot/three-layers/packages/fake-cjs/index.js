"use strict";
const helper = require("./helper.js");
function lodashish(value) { return new Wrapper(value); }
function Wrapper(value) { this.__wrapped__ = value; this.__actions__ = []; }
Wrapper.prototype.map = function (f) { this.__actions__.push(list => list.map(f)); return this; };
Wrapper.prototype.filter = function (f) { this.__actions__.push(list => list.filter(f)); return this; };
Wrapper.prototype.value = function () { return this.__actions__.reduce((value, action) => action(value), this.__wrapped__); };
lodashish.get = function (object, path, fallback) {
  const parts = Array.isArray(path) ? path : String(path).replace(/\[(\w+)\]/g, ".$1").split(".");
  let at = object;
  for (const part of parts) { if (at == null) return fallback; at = at[part]; }
  return at === undefined ? fallback : at;
};
lodashish.set = function (object, path, value) {
  const parts = String(path).split(".");
  let at = object;
  parts.slice(0, -1).forEach(part => { if (typeof at[part] !== "object" || at[part] === null) at[part] = {}; at = at[part]; });
  at[parts[parts.length - 1]] = value;
  return object;
};
lodashish.cloneDeep = function cloneDeep(value, seen = new Map()) {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) { const out = new Map(); seen.set(value, out); value.forEach((v, k) => out.set(cloneDeep(k, seen), cloneDeep(v, seen))); return out; }
  if (value instanceof Set) { const out = new Set(); seen.set(value, out); value.forEach(v => out.add(cloneDeep(v, seen))); return out; }
  const out = Array.isArray(value) ? new Array(value.length) : Object.create(Object.getPrototypeOf(value));
  seen.set(value, out);
  for (const key of Reflect.ownKeys(value)) out[key] = cloneDeep(value[key], seen);
  return out;
};
lodashish.merge = function merge(target, ...sources) {
  for (const source of sources) for (const key of Object.keys(source)) {
    const from = source[key], to = target[key];
    target[key] = helper.isPlain(from) && helper.isPlain(to) ? merge(to, from) : from;
  }
  return target;
};
lodashish.isEqual = function isEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => isEqual(a[key], b[key]));
};
lodashish.groupBy = function (list, f) { const out = {}; for (const each of list) (out[typeof f === "function" ? f(each) : each[f]] ||= []).push(each); return out; };
lodashish.pick = function (object, ...keys) { const out = {}; for (const key of keys) if (key in object) out[key] = object[key]; return out; };
lodashish.memoize = function (f) { const cache = new Map(); const memoized = function (key) { if (!cache.has(key)) cache.set(key, f.apply(this, arguments)); return cache.get(key); }; memoized.cache = cache; return memoized; };
lodashish.debounce = function (f, ms) { let timer; return function (...args) { clearTimeout(timer); timer = setTimeout(() => f.apply(this, args), ms); }; };
lodashish.isPlain = helper.isPlain;
lodashish.VERSION = "1.0.0";
lodashish.Wrapper = Wrapper;
Object.defineProperty(lodashish, "loads", { get() { return helper.loads; }, enumerable: true });
module.exports = lodashish;
