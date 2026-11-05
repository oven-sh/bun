import m from "./005_exceptions.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
const b = pythonImport("builtins");
function grab(f) { try { f(); } catch (e) { return e; } }
let e = grab(() => m.fail());
print(e.name, e.message, e instanceof Error, e instanceof b.ValueError, e instanceof b.Exception, e instanceof b.KeyError, e instanceof TypeError, typeof e);
print(String(e), `${e}`, e.toString(), Object.prototype.toString.call(e), e.args.length, e.args[0]);
print(e.stack.split("\n").filter(l => !l.startsWith("    ")).map(l => l.replace(/File ".*\//, 'File "')).join("|"));
e = grab(() => m.fail("app")); print(e.name, e.message, e.code, e instanceof m.AppError, e.constructor === m.AppError, Object.keys(e).join());
e = grab(() => m.fail("key")); print(e.name, e.message, String(e));
e = grab(() => m.fail("zero")); print(e.name, e.message);
e = grab(() => m.fail("own")); print(e.name, e.message);
e = grab(() => m.fail("attr")); print(e.name, e.message);
e = grab(() => m.fail("chain")); print(e.name, e.__cause__.name, e.__cause__ instanceof b.ZeroDivisionError, e.__context__ === e.__cause__, e.cause === e.__cause__, "cause" in e.cause);
// A JS error through Python frames is the same object when it comes out.
const err = new RangeError("js error");
const thrower = () => { throw err; };
print(grab(() => m.call(thrower)) === err);
let log = []; print(grab(() => m.call_finally(thrower, log)) === err, log.join());
log = []; print(grab(() => m.call_with(thrower, log)) === err, log.join());
print(grab(() => m.catch_reraise(thrower)) === err);
print(grab(() => m.call(() => { throw 42; })), grab(() => m.call_finally(() => { throw "str"; }, [])));
// Caught in Python it is a JSError that has it.
const caught = m.catch(thrower);
print(caught.name, caught.message, caught.value === err, caught instanceof b.Exception, caught instanceof Error);
print(m.catch_kind(thrower), "|", m.catch_kind(() => m.fail()), "|", m.catch_kind(() => { throw new b.ValueError("made in js"); }));
// A Python exception through JS frames.
print(m.through(f => f()), m.through(f => { try { f(); } finally { } }), m.through(f => { try { f(); } catch (x) { throw x; } }));
// Made and thrown in JS.
const mine = new b.KeyError("mine"); print(grab(() => { throw mine; }) === mine, mine.stack.trim());
print(m.catch(() => { throw mine; }) === mine);
// Promise rejection, JSON.
Promise.reject(grab(() => m.fail())).catch(x => print("rejected", x.name));
print(JSON.stringify(grab(() => m.fail("app"))));
// The stack has the hints that traceback.py gives.
const hinted = m.Hinted();
for (const f of [() => hinted.name(), () => hinted.attribute(), () => m.misspelt()]) print(grab(f).stack.trim().split("\n").at(-1));
