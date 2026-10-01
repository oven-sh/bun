import * as lib from "./lib";
import { plain, arrow, expr, Klass, Derived, reassignedAtTop, reassignedLater, reassign, letFunction, reassignDeep, conditional, assignedInBranch, wrapped, Replaced, replaceClass, arity, even, both, table, thrower, firstCallIsDirect, callsWithinModule } from "./lib";
import { ownShadow, between, parameter, shadowedImport, notShadowed, fromBlock } from "./shadow";
import { run, call, target } from "./evalmod";
import { early, useB } from "./cycA";
import { duringB } from "./cycB";
import { renamed, theDefault, helper } from "./reexp";
import anonymous from "./def";
import * as no from "./noobject";
import { ordinary, arrowFn, asyncFn, genFn, Klass2, Sub2, noThis, usesThis, outer, template, whoCalled, viaCallbacks, describe } from "./execs";
import { wantsNumber, wantsString, wantsBoolean, wantsObject, wantsArray, wantsFunction, wantsOptional, wantsNullable, wantsUnion, wantsBigInt, wantsSymbol, returnsNumber, attempt } from "./checks";
import * as R from "./rets";
import { num, dbl, str, bool, undef, nul, obj, arr, fn, big, numOrStr, numOrUndef, viaAny, chain1, mixedChain, fact, pingStr, pongNum, never, callsNever, loops, asy, gen, overflowing, negZero, nan, tryFinally, viaCatch, argsObject, defaulted } from "./rets";

function show(...values: unknown[]) { console.log(values.join(" ")); }
show("first", firstCallIsDirect(41)());
show("plain", plain(1, 2), arrow(3), expr(4), new Klass(5).get(), new Derived(6).get());
show("top", reassignedAtTop());
show("later", reassignedLater()); reassign(); show("later", reassignedLater(), lib.reassignedLater());
show("let", letFunction()); reassignDeep()(); show("let", letFunction());
show("two", conditional(), assignedInBranch(), wrapped());
show("class", new Replaced().name()); replaceClass(); show("class", new Replaced().name());
show("within", callsWithinModule());
show("arity", arity(), arity(1), arity(1, 2, 3), (arity as any)(1, 2, 3, 4, 5));
show("recursion", even(10), even(7), even(1001));
show("both", both(1), table.both(2), [1, 2].map(both).join(), both === table.both, both === lib.both);
try { thrower(); } catch (e: any) { show("caught", e.message, e.stack.split("\n").slice(0, 3).map((l: string) => l.trim().replace(/\(.*[\\/]/, "(")).join(" | ")); }
show("shadow", ownShadow(), between(), parameter(() => "argument"), shadowedImport(), notShadowed(), fromBlock);
show("eval", call(), target()); run(); show("eval", call(), target());
show("cycle", early, useB(), duringB);
show("reexport", renamed(5, 6), theDefault(1), anonymous(2), helper());
function loop() { let t = 0; for (let i = 0; i < 100000; i++) t = plain(t, arrow(i) - expr(i)); return t; }
show("loop", loop());
function deep(n: number): number { return n === 0 ? 0 : 1 + deep(n - 1); }
show("deep", deep(5000)); try { (function forever(): number { return plain(forever(), 1); })(); } catch (e: any) { show("overflow", e instanceof RangeError); }
show("ret arith", num() + num(), num() + dbl(), num() * 2, num() / 2, num() % 5, -num(), num() | 0, dbl() | 0, num() + 1 + str(), str() + num(), str() + str(), bool() + 1, undef() + 1, (nul() as any) + 1, big() + 1n);
show("ret compare", num() === 41, num() == ("41" as any), num() < dbl(), str() < "t", str() === "s", undef() === undefined, nul() === null, (nul() as any) == undef(), bool() === true, typeof num(), typeof str(), typeof undef(), typeof nul(), typeof obj(), typeof fn(), typeof big());
show("ret objects", obj().a, arr().length, arr()[1], fn()(), Array.isArray(arr()), obj() === obj());
show("ret unions", numOrStr(2) + 1, numOrStr(-2) + 1, numOrUndef(2) + 1, numOrUndef(-2) + 1, viaAny(1) + 1, viaAny("1") + 1, viaAny(undefined) + 1, viaAny(null) + 1, viaAny({ valueOf() { return 5; } }) + 1);
show("ret chains", chain1() + 1, mixedChain(5) + 1, mixedChain(2) + 1, mixedChain(0) + 1, fact(10), fact(20), fact(25));
show("ret cycles", pingStr(4) + 1, pingStr(3) + 1, pongNum(4) + 1, pongNum(3) + 1);
for (const f of [never, () => callsNever(1), loops]) { try { show("unreachable", (f as any)() + 1); } catch (e: any) { show("ret never", e.message); } }
show("ret never", callsNever(0) + 1);
show("ret edge", overflowing() + 1, overflowing() + overflowing(), overflowing() * overflowing(), 1 / negZero(), Object.is(negZero(), -0), nan() === nan(), nan() + 1, negZero() + 0);
show("ret control", tryFinally(0), tryFinally(1), tryFinally(2), viaCatch({ y: { z: 9 } }) + 1, viaCatch(null) + 1, (argsObject as any)(4) + 1, argsObject() + 1, defaulted(), defaulted(2), defaulted(2, 3), defaulted(undefined, 4));
show("ret namespace", R.num() + 1, R.str() + 1, R.numOrStr(-1) + 1);
asy().then(v => show("ret async", v + 1, asy() instanceof Promise)); show("ret gen", [...gen()].join(), gen().next().value + 1);
function retLoop() { let t = 0; for (let i = 0; i < 100000; i++) t += num() + fact(3) + (numOrStr(i & 1) === "neg" ? 1 : 0); return t; }
show("ret loop", retLoop());
const all: unknown[] = [1, 1.5, "s", true, undefined, null, {}, [], () => 1, 1n, Symbol.iterator, new Map(), new Uint8Array(1), class {}, new Proxy({}, {}), new Proxy(function () { return 2; }, {}), NaN, -0, new Date(0), /x/];
show("check number", attempt(v => wantsNumber(v, 1), all)); show("check number 2", attempt(v => wantsNumber(1, v), all));
show("check string", attempt(wantsString, all)); show("check boolean", attempt(wantsBoolean, all));
show("check object", attempt(wantsObject, all)); show("check array", attempt(wantsArray, all)); show("check function", attempt(wantsFunction, all.filter(v => !String(typeof v === "function" ? v : "").startsWith("class"))));
show("check optional", attempt(wantsOptional, all)); show("check nullable", attempt(wantsNullable, all)); show("check union", attempt(wantsUnion, all));
show("check bigint", attempt(wantsBigInt, all)); show("check symbol", attempt(wantsSymbol, all)); show("check return", attempt(returnsNumber, all));
show("exec describe", [ordinary, arrowFn, asyncFn, genFn, Klass2, Sub2, Klass2.s, Klass2.prototype.m, outer, outer(1), outer(1)(2), new Klass2().field].map(describe).join(" ; "));
show("exec getter", describe(Object.getOwnPropertyDescriptor(Klass2.prototype, "g")!.get!));
show("exec calls", ordinary(1), ordinary(1, 5, 6, 7), viaCallbacks(), outer(1)(2)(), new Klass2().p(), new Klass2().field(), new Sub2().m(4), ordinary.call(null, 1), ordinary.apply(null, [1, 2, 3]), ordinary.bind(null, 5)(), Reflect.apply(arrowFn, null, [1]));
if (!process.env.NO_LATE_CODE) show("exec new", JSON.stringify(new (noThis as any)(1)), JSON.stringify(new (usesThis as any)(2)), new (noThis as any)(3) instanceof noThis, new (usesThis as any)(3) instanceof usesThis, JSON.stringify(Reflect.construct(noThis, [4])), JSON.stringify(new (outer(1) as any)(2)) === undefined);
// (Code that the build did not generate is generated on demand and stored in objects that the build created, which one test mode does not allow.)
for (const f of [...(process.env.NO_LATE_CODE ? [] : [() => (Klass2 as any)()]), () => new (arrowFn as any)(), () => new (asyncFn as any)(), () => new (Klass2.prototype.m as any)()]) { try { f(); show("exec no error"); } catch (e: any) { show("exec error", e.constructor.name); } }
show("exec template", template() === template(), template().raw.join(), Object.isFrozen(template()));
show("exec stack", whoCalled());
show("exec identity", outer(1) !== outer(1), outer(1).toString() === outer(2).toString(), Object.getPrototypeOf(asyncFn) !== Function.prototype, genFn(3).next().value);
setTimeout(arrowFn, 0, 1); queueMicrotask(() => show("exec microtask", arrowFn(1))); Promise.resolve(2).then(arrowFn).then(v => show("exec then", v)); asyncFn(3).then(v => show("exec async", v));
show("noobj basics", no.plain(1, 2), no.fewer(1), no.fewer(1, 2), no.fewer(1, 2, 4), (no.more as any)(1, 2, 3), no.makesClosure(1)(), no.bump(), no.makesClosure(1)(), no.callsOthers(5), no.arrow(2), no.usesArrow(3));
show("noobj errors", no.catches(), no.callsTrims(), no.callsAnonymousTrims(), no.catchesOverflow());
show("noobj sites", no.callsSites());
show("noobj misc", no.deep(1000), no.asValue(), (no.usesArguments as any)(1, 2), no.selfReference(), no.tail(10), [...no.generatorOne(1)].join(), no.early(), no.beforeInit, no.beforeInitNew, no.beforeInitMessage, typeof new no.NotYetClass(), no.notYet(5), no.withThis(), no.gc(), no.imports());
no.asyncOne(1).then(v => show("noobj async", v));
Bun.gc(true); show("after gc", plain(1, 2), new Derived(1).get(), even(4));
import("./nofunctions").then(m => show("no functions", m.justData.join(), m.more.a));
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
worker.onmessage = e => { show("worker", e.data); worker.terminate(); };
