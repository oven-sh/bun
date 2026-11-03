import m from "./010_sharing.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
// The same objects on both sides.
const arr = [1, 2, 3], obj = { a: 1, nested: { b: 2 } }, fn = x => x + 1;
m.keep("arr", arr); m.keep("obj", obj); m.keep("fn", fn);
print(m.get("arr") === arr, m.get("obj") === obj, m.get("fn") === fn, m.is_same("arr", arr), m.is_same("obj", obj), m.registry.arr === arr);
m.append(arr, 4); print(arr.join(), m.length(arr)); arr.push(5); print(m.length(arr), m.show(arr));
m.mutate_all(arr); print(arr.join());
print(m.items === m.items, m.items.length); m.items.push("js"); print(m.show(m.items), m.append(m.items, "py") === m.items, m.items.join());
// JS objects in Python.
print(m.read(obj, "a"), m.read_item(obj, "a"), m.read(m.read(obj, "nested"), "b"), m.has(obj, "a"), m.has(obj, "zz"), m.keys_of(obj).join(), m.length(obj));
m.write(obj, "c", 3); m.write_item(obj, "d", 4.0); print(JSON.stringify(obj), typeof obj.d);
print(m.call_method({ v: 5, get() { return this.v; } }, "get"), m.call_method([3, 1, 2], "sort"), m.call_method("a-b", "upper"));
print(m.call_back(fn, 1), m.apply_twice(fn, 1), m.call_back(Math.max, 1, 7, 3), m.call_back((...a) => a.length, 1, 2, 3));
print(String(m.use_js_global()));
print(m.new_js(Date, 0).getTime(), m.new_js(Map, [[1, 2]]).get(1), m.new_js(class K { constructor(a) { this.a = a; } }, 9).a);
// Python objects held by JS.
const counter = m.make_counter(); counter(); counter(); print(counter());
m.holder.value = obj; print(m.holder.value === obj, m.read(m.holder, "value") === obj);
m.holder.value = m.holder; print(m.holder.value === m.holder, m.holder.value.value.value === m.holder);
const bound = m.holder.__init__; print(typeof bound, m.holder.__class__.__name__);
const map = new Map([[m.holder, 1]]); print(map.get(m.holder), new Set([m.holder, m.holder, m.registry]).size, new WeakMap([[m.holder, "w"]]).get(m.holder));
// Modules.
print(Object.keys(m).filter(k => k.startsWith("k") || k.startsWith("_")).join(), "__name__" in m, m.__name__, m._private, Object.keys(m).includes("__name__"), String(m).startsWith("<module '010_sharing' from"));
// Reflect and friends.
print(Reflect.get(m.holder, "value") === m.holder, Reflect.has(m.holder, "value"), Reflect.set(m.holder, "value", 1), m.holder.value, Reflect.deleteProperty(m.holder, "value"), Reflect.has(m.holder, "value"), Reflect.ownKeys(m.holder).includes("__init__"), Reflect.ownKeys(m.holder).includes("value"));
Object.assign(m.holder, { p: 1, q: 2 }); print(JSON.stringify(m.holder), JSON.stringify(Object.assign({}, m.holder)), JSON.stringify({ ...m.holder, r: 3 }));
const { p, ...others } = m.holder; print(p, JSON.stringify(others));
print(Object.entries(m.holder).join("|"), Object.values(m.holder).join(), Object.getOwnPropertyNames(m.holder).includes("__class__"), Object.isExtensible(m.holder));
const child = Object.create(m.holder); child.own = 1; print(child.p, child.own, m.holder.own, Object.keys(child).join());
(function sloppy() { const t = pythonImport("builtins").tuple([1]); return t; })();
