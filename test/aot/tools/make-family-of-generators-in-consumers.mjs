// make-family.mjs <folder>: one program for each generator, consumer and front. Each prints what happened, in order, one line a call.
// A generator: its text, and the call that makes one, with LIMIT where a number is handed over. A consumer: CALL stands where the generator is made, PRE in front of it. A front: what stands in front of the consumer.
import { mkdirSync, writeFileSync } from "node:fs";

const out = process.argv[2];
mkdirSync(out, { recursive: true });

const generators = {
  "counts-up": [`function* steps(limit) { for (let i = 0; i < limit; i++) yield i; }`, `steps(LIMIT)`, 5],
  "two-yields-a-turn": [`function* steps(limit) { for (let i = 0; i < limit; i++) { yield i; note("between " + i); yield -i; } }`, `steps(LIMIT)`, 3],
  "three-in-a-row": [`function* steps(first) { yield first; note("one"); yield first * 2; note("two"); yield first * 3; note("three"); }`, `steps(LIMIT)`, 7],
  "yields-nothing": [`function* steps(limit) { note("ran"); if (limit > 100) yield limit; }`, `steps(LIMIT)`, 5],
  "finally-round-the-loop": [`function* steps(limit) { try { for (let i = 0; i < limit; i++) yield i; note("ran out"); } finally { note("cleaned up"); } }`, `steps(LIMIT)`, 4],
  "finally-in-the-loop": [`function* steps(limit) { for (let i = 0; i < limit; i++) { try { yield i; note("behind " + i); } finally { note("cleaned " + i); } } }`, `steps(LIMIT)`, 4],
  "two-finallys": [`function* steps(limit) { try { note("outer"); for (let i = 0; i < limit; i++) { try { yield i; } finally { note("inner " + i); } } } finally { note("outer done"); } }`, `steps(LIMIT)`, 3],
  "catch-round-the-yield": [`function* steps(limit) { for (let i = 0; i < limit; i++) { try { yield i; if (i === 1) throw new Error("own " + i); } catch (error) { note("caught " + error.message); yield 100 + i; } } }`, `steps(LIMIT)`, 4],
  "yield-in-finally": [`function* steps(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { note("last words"); yield 99; note("behind last words"); } }`, `steps(LIMIT)`, 3],
  "finally-throws": [`function* steps(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { note("about to throw"); throw new Error("from finally"); } }`, `steps(LIMIT)`, 3],
  "finally-returns": [`function* steps(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { note("returns"); return 55; } }`, `steps(LIMIT)`, 3],
  "finally-goes-on": [`function* steps(limit) { for (let i = 0; i < limit; i++) { try { yield i; } finally { note("on " + i); continue; } } note("end"); }`, `steps(LIMIT)`, 3],
  "finally-with-a-loop": [`function* steps(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { let sum = 0; for (let j = 0; j < limit; j++) sum += j; note("summed " + sum); } }`, `steps(LIMIT)`, 4],
  "throws-midway": [`function* steps(limit) { for (let i = 0; i < limit; i++) { if (i === 2) throw new Error("midway"); yield i; } }`, `steps(LIMIT)`, 5],
  "throws-at-once": [`function* steps(limit) { note("started"); throw new Error("at once"); yield limit; }`, `steps(LIMIT)`, 5],
  "over-a-list": [`function* steps(list, change) { for (const item of list) yield change(item); }`, `steps([3, 1, 4, 1, 5], item => item * 2)`],
  "over-a-set-with-a-test": [`function* steps(wanted, have) { for (const name of wanted) { if (name === 0) continue; if (!have.has(name)) yield name; else if (name === 7) yield -name; } }`, `steps([0, 1, 7, 2, 9, 3], new Set([1, 7, 3]))`],
  "over-a-generator": [`function* inner(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { note("inner cleaned"); } }
function* steps(limit) { for (const value of inner(limit)) { note("passing " + value); yield value * 10; } note("outer end"); }`, `steps(LIMIT)`, 4],
  "delegates-to-a-generator": [`function* inner(limit) { try { for (let i = 0; i < limit; i++) yield i; return "inner result"; } finally { note("inner cleaned"); } }
function* steps(limit) { note("before"); const result = yield* inner(limit); note("got " + result); yield 50; }`, `steps(LIMIT)`, 3],
  "delegates-to-a-list": [`function* steps(list) { yield* list; note("list done"); yield* [8, 9]; }`, `steps([1, 2, 3])`],
  "delegates-twice-deep": [`function* lowest(limit) { for (let i = 0; i < limit; i++) yield i; }
function* middle(limit) { yield* lowest(limit); yield* lowest(2); }
function* steps(limit) { yield* middle(limit); note("top done"); }`, `steps(LIMIT)`, 2],
  "a-list-round-a-generator": [`function* inner(limit, first) { for (let i = 0; i < limit; i++) yield first + i; }
function* steps(firsts, limit) { for (const first of firsts) { for (const value of inner(limit, first)) yield value; } }`, `steps([10, 20], LIMIT)`, 2],
  "a-list-round-a-generator-over-a-list": [`function* inner(names, start) { for (const name of names) if (name.startsWith(start)) yield name; }
function* steps(starts, names) { for (const start of starts) { for (const name of inner(names, start)) yield name; } }`, `steps(["a", "b"], ["a1", "b1", "a2", "c1", "b2"])`],
  "a-finally-round-a-generator": [`function* inner(limit) { for (let i = 0; i < limit; i++) yield i; }
function* steps(limit) { try { for (const value of inner(limit)) yield value; } finally { note("outer cleaned"); } }`, `steps(LIMIT)`, 4],
  "a-catch-round-a-generator-that-throws": [`function* inner(limit) { for (let i = 0; i < limit; i++) { if (i === 2) throw new Error("inner " + i); yield i; } }
function* steps(limit) { try { for (const value of inner(limit)) yield value; } catch (error) { note("caught " + error.message); yield -1; } }`, `steps(LIMIT)`, 4],
  "three-loops-deep-with-continue": [`function* inner(names, start) { for (const name of names) if (name.startsWith(start)) yield name; }
function* steps(shelf, keys, skipped, own) { for (const key of keys) { for (const start of shelf.get(key) ?? []) { if (skipped.includes(start)) continue; for (const name of inner(["a1", "b1", "a2", "c1", "b2"], start)) { if (!own.has(name)) yield name; } } } }`, `steps(new Map([["x", ["a", "b"]], ["z", ["c"]]]), ["x", "y", "z"], ["q"], new Set(["a2"]))`],
  "two-finallys-round-two-generators": [`function* innermost(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { note("innermost cleaned"); } }
function* inner(limit) { try { for (const value of innermost(limit)) yield value * 2; } finally { note("inner cleaned"); } }
function* steps(limit) { try { for (const value of inner(limit)) yield value + 1; } finally { note("outer cleaned"); } }`, `steps(LIMIT)`, 3],
  "a-yield-on-one-arm-then-a-throw": [`function* steps(first) { yield first; if (round & 1) yield first * 10; throw "stop"; }`, `steps(LIMIT)`, 1],
  "a-yield-on-each-arm-then-a-throw": [`function* steps(first) { if (round & 1) yield first * 10; else yield first * 20; throw "stop"; }`, `steps(LIMIT)`, 1],
  "as-many-turns-as-the-round-then-a-throw": [`function* steps(first) { for (let i = 0; i < round; i++) yield first + i; throw "stop"; }`, `steps(LIMIT)`, 5],
  "a-yield-on-one-arm-then-goes-on": [`function* steps(first) { yield first; if (round & 1) yield first * 10; note("joined"); yield first * 100; }`, `steps(LIMIT)`, 1],
  "an-arm-without-a-yield": [`function* steps(first) { if (round & 1) note("no yield"); else yield first; yield first + 1; if (round & 2) return; yield first + 2; }`, `steps(LIMIT)`, 5],
  "throws-where-the-round-says": [`function* steps(limit) { for (let i = 0; i < limit; i++) { yield i; if (i === round) throw "stop at " + i; } }`, `steps(LIMIT)`, 3],
  "a-nameless-catch-round-a-generator-that-throws": [`function* inner(first) { yield first; if (round & 1) yield first * 10; throw "stop"; }
function* steps(first) { try { for (const value of inner(first)) yield value; } catch { yield first * 100; } }`, `steps(LIMIT)`, 1],
  "a-nameless-catch-round-the-yield": [`function* steps(limit) { for (let i = 0; i < limit; i++) { try { yield i; if (i === round) throw "own"; } catch { note("caught at " + i); yield 100 + i; } } }`, `steps(LIMIT)`, 3],
  "a-finally-that-yields-out-of-a-generator": [`function* rest() { yield 71; yield 72; }
function* steps(first) { try { yield first; yield first + 1; } finally { for (const value of rest()) yield value; } }`, `steps(LIMIT)`, 1],
  "a-finally-that-loops-over-a-generator": [`function* rest() { yield 71; if (round & 1) yield 72; }
function* steps(first) { try { yield first; yield first + 1; } finally { for (const value of rest()) note("rest " + value); } }`, `steps(LIMIT)`, 1],
  "returns-on-one-arm": [`function* steps(limit) { for (let i = 0; i < limit; i++) { if (i === round) return "early"; yield i; } }`, `steps(LIMIT)`, 3],
  "walks-a-tree": [`const tree = { left: { left: null, value: 1, right: { left: null, value: 2, right: null } }, value: 3, right: { left: null, value: 4, right: null } };
function* steps(node) { if (node === null) return; yield* steps(node.left); yield node.value; yield* steps(node.right); }`, `steps(tree)`],
  "loops-over-its-own-function": [`function* steps(depth) { yield depth; if (depth > 0) for (const below of steps(depth - 1)) yield below; }`, `steps(LIMIT)`, 3],
  "a-method-with-this": [`class Shelf { constructor() { this.books = [10, 20, 30]; this.bonus = 1; } *each(extra) { for (let i = 0; i < this.books.length; i++) yield this.books[i] + this.bonus + extra; } }
const shelf = new Shelf();`, `shelf.each(LIMIT)`, 2],
  "reads-arguments": [`function* steps() { for (let i = 0; i < arguments.length; i++) yield arguments[i]; note("count " + arguments.length); }`, `steps(6, LIMIT, 4)`, 5],
  "rest-and-defaults": [`function* steps(first, second = (note("default"), first + 1), ...others) { yield first; yield second; for (const other of others) yield other; }`, `steps(LIMIT, undefined, 7, 8)`, 1],
  "default-throws": [`function* steps(first = (() => { throw new Error("no first"); })()) { yield first; }`, `steps()`],
  "pattern-parameter": [`function* steps({ from, to }) { note("from " + from); for (let i = from; i < to; i++) yield i; }`, `steps({ from: 2, to: LIMIT })`, 5],
  "endless": [`function* steps() { for (let i = 0; ; i++) yield i; }`, `steps()`],
  "endless-with-finally": [`function* steps() { try { for (let i = 0; ; i++) yield i; } finally { note("stopped"); } }`, `steps()`],
  "returns-a-value": [`function* steps(limit) { for (let i = 0; i < limit; i++) yield i; return "the end"; }`, `steps(LIMIT)`, 2],
  "takes-what-is-sent": [`function* steps(limit) { let sum = 0; for (let i = 0; i < limit; i++) { const sent = yield sum; note("sent " + sent); sum += i; } }`, `steps(LIMIT)`, 3],
  "closures-over-its-locals": [`function* steps(limit) { for (let i = 0; i < limit; i++) { const own = i * 10; yield () => own + i; } }`, `steps(LIMIT)`, 3],
  "yields-texts-and-numbers": [`function* steps() { yield 1; yield "two"; yield 3.5; yield null; yield undefined; yield 2 ** 40; }`, `steps()`],
  "two-loops-one-behind-the-other": [`function* steps(limit) { for (let i = 0; i < limit; i++) yield i; note("half"); for (let j = limit; j > 0; j--) yield j * 100; }`, `steps(LIMIT)`, 2],
  "a-loop-in-a-loop": [`function* steps(limit) { for (let i = 0; i < limit; i++) { for (let j = 0; j <= i; j++) yield i * 10 + j; note("row " + i); } }`, `steps(LIMIT)`, 3],
  "a-loop-without-a-yield-inside": [`function* steps(limit) { for (let i = 0; i < limit; i++) { let sum = 0; for (let j = 0; j <= i; j++) sum += j; yield sum; } }`, `steps(LIMIT)`, 4],
  "a-switch-of-yields": [`function* steps(limit) { for (let i = 0; i < limit; i++) { switch (i % 3) { case 0: yield "zero"; break; case 1: yield "one"; default: yield "other " + i; } } }`, `steps(LIMIT)`, 5],
  "changes-an-object-of-the-caller": [`const shared = { count: 0 };
function* steps(limit) { for (let i = 0; i < limit; i++) { shared.count += 10; yield shared.count; } }`, `steps(LIMIT)`, 3],
};

const show = `(typeof value === "function" ? "f" + value() : String(value))`;
const consumers = {
  "sums-all": [true, `function consume() { PRE let sum = 0; let turns = 0; for (const value of CALL) { sum += typeof value === "number" ? value : 1000; if (++turns > 12) break; } return sum + " in " + turns; }`],
  "lists-all": [true, `function consume() { PRE let turns = 0; for (const value of CALL) { note("got " + ${show}); if (++turns > 12) break; } return turns; }`],
  "breaks-at-the-second": [true, `function consume() { PRE let turns = 0; for (const value of CALL) { note("got " + ${show}); if (++turns === 2) break; } return turns; }`],
  "breaks-at-once": [true, `function consume() { PRE for (const value of CALL) { note("got " + ${show}); break; } return "left"; }`],
  "returns-the-first": [true, `function consume() { PRE for (const value of CALL) return "first " + ${show}; return "none"; }`],
  "returns-the-third": [true, `function consume() { PRE let turns = 0; for (const value of CALL) { if (++turns === 3) return "third " + ${show}; } return "fewer"; }`],
  "throws-in-the-second-turn": [true, `function consume() { PRE let turns = 0; for (const value of CALL) { note("got " + ${show}); if (++turns === 2) throw new Error("from the turn"); } return turns; }`],
  "catches-in-the-turn": [true, `function consume() { PRE let turns = 0; for (const value of CALL) { try { if (++turns === 2) throw new Error("inside"); note("got " + ${show}); } catch (error) { note("turn caught " + error.message); } if (turns > 12) break; } return turns; }`],
  "catch-leaves-the-loop": [true, `function consume() { PRE let turns = 0; let last; for (const value of CALL) { try { last = value; if (++turns === 2) throw new Error("inside"); } catch (error) { note("leaving with " + typeof last); break; } if (turns > 12) break; } return turns + " " + typeof last; }`],
  "finally-in-the-turn": [true, `function consume() { PRE let turns = 0; for (const value of CALL) { try { if (++turns === 3) break; note("got " + ${show}); } finally { note("turn done " + turns); } } return turns; }`],
  "continues": [true, `function consume() { PRE let turns = 0; let kept = 0; for (const value of CALL) { if (++turns > 12) break; if (turns % 2) continue; kept++; note("kept " + ${show}); } return kept + " of " + turns; }`],
  "catch-round-the-loop-reads-the-sum": [true, `function consume() { PRE let sum = 0; let turns = 0; try { for (const value of CALL) { sum += typeof value === "number" ? value : 1000; if (++turns === 3) throw new Error("third"); } } catch (error) { return "caught " + error.message + " at " + sum; } return sum; }`],
  "fills-an-object-made-in-front": [true, `function consume() { PRE const tally = { sum: 0, turns: 0 }; for (const value of CALL) { tally.sum += typeof value === "number" ? value : 1000; if (++tally.turns > 12) break; } return tally.sum + " in " + tally.turns; }`],
  "fills-a-list-made-in-front": [true, `function consume() { PRE const seen = []; for (const value of CALL) { seen.push(typeof value); if (seen.length > 12) break; } return seen.length + ": " + seen.join(); }`],
  "joins-a-text": [true, `function consume() { PRE let text = ""; let turns = 0; for (const value of CALL) { text += typeof value === "number" ? value : "?"; if (++turns > 12) break; } return text; }`],
  "loop-in-a-loop": [true, `function consume() { PRE let pairs = 0; let outer = 0; for (const first of CALL) { let inner = 0; for (const second of CALL) { pairs++; if (++inner === 2) break; } if (++outer === 3) break; } return pairs + " " + outer; }`],
  "leaves-two-loops": [true, `function consume() { PRE let seen = 0; both: for (const first of CALL) { for (const second of CALL) { if (++seen === 3) break both; } } return seen; }`],
  "many-rounds": [true, `function consume() { PRE let sum = 0; for (let round = 0; round < 50; round++) { let turns = 0; for (const value of CALL) { sum += typeof value === "number" ? value : 1; if (++turns > 6) break; } silent = true; } silent = false; return sum; }`],
  "spreads": [true, `function consume() { PRE if (isEndless) return "endless"; const all = [...CALL]; return all.length + ": " + all.map(value => typeof value).join(); }`],
  "spreads-between-others": [true, `function consume() { PRE if (isEndless) return "endless"; const all = [-1, ...CALL, -2, ...CALL]; return all.length + ": " + all.map(value => typeof value).join(); }`],
  "spreads-into-a-call": [true, `function consume() { PRE if (isEndless) return "endless"; const count = (...values) => values.length + ": " + values.map(value => typeof value).join(); return count(0, ...CALL, 0); }`],
  "in-a-generator": [true, `function* relay() { PRE let turns = 0; for (const value of CALL) { yield "relayed " + ${show}; if (++turns > 12) break; } note("relay done"); }
function consume() { const held = relay(); const seen = []; for (let i = 0; i < 4; i++) { const step = held.next(); seen.push(String(step.value)); } held.return(); return seen.join(); }`],
  "takes-two-by-a-pattern": [false, `function consume() { PRE const [first, second] = CALL; return typeof first + " " + typeof second; }`],
  "takes-the-rest-by-a-pattern": [false, `function consume() { PRE if (isEndless) return "endless"; const [first, ...others] = CALL; return typeof first + " | " + others.length; }`],
  "second-name": [false, `function consume() { PRE const held = CALL; let turns = 0; for (const value of held) { note("got " + ${show}); if (++turns === 2) break; } const after = held.next(); return typeof after.value + " " + after.done; }`],
  "named-in-the-head-of-the-loop": [false, `function consume() { PRE let held; let turns = 0; for (const value of (held = CALL)) { note("got " + ${show}); if (++turns === 2) break; } const after = held.next(); return typeof after.value + " " + after.done; }`],
  "named-in-the-spread": [false, `function consume() { PRE if (isEndless) return "endless"; let held; const all = [...(held = CALL)]; const after = held.next(); return all.length + " " + after.done; }`],
  "second-name-right-in-front": [false, `function consume() { PRE let turns = 0; const held = CALL; for (const value of held) { note("got " + ${show}); if (++turns === 2) break; } const after = held.next(); return typeof after.value + " " + after.done; }`],
  "second-name-right-in-front-of-a-spread": [false, `function consume() { PRE if (isEndless) return "endless"; const held = CALL; const all = [...held]; const after = held.next(); return all.length + " " + after.done; }`],
  "nameless-catch-round-the-loop-reads-the-sum": [true, `function consume() { PRE let sum = 0, turns = 0; try { for (const value of CALL) { sum += (typeof value === "number" ? value : 1000); if (++turns === 6) break; } } catch { return "caught at " + sum; } return "ended at " + sum; }`],
  "nameless-catch-in-the-turn": [true, `function consume() { PRE let sum = 0, turns = 0; for (const value of CALL) { try { if (turns === round) throw "mine"; sum += (typeof value === "number" ? value : 1000); } catch { sum += 100000; } if (++turns === 6) break; } return sum; }`],
  "nameless-catch-round-the-loop-in-a-loop": [true, `function consume() { PRE let total = 0; for (let again = 0; again < 2; again++) { let sum = again, turns = 0; try { for (const value of CALL) { sum += (typeof value === "number" ? value : 1000); if (++turns === 6) break; } total += 1; } catch { total += sum * 10; } } return total; }`],
  "finally-round-the-loop-reads-the-sum": [true, `function consume() { PRE let sum = 0, turns = 0; try { for (const value of CALL) { sum += (typeof value === "number" ? value : 1000); if (++turns === 6) break; } } finally { note("sum " + sum); } return sum; }`],
  "nameless-catch-round-a-spread": [true, `function consume() { PRE if (isEndless) return "endless"; let before = round; try { const all = [before, ...CALL]; before += all.length; } catch { return "caught at " + before; } return "ended at " + before; }`],
  "breaks-where-the-round-says": [true, `function consume() { PRE let sum = 0, turns = 0; for (const value of CALL) { if (turns++ === round) break; sum += (typeof value === "number" ? value : 1000); } return sum + " in " + turns; }`],
  "returns-where-the-round-says": [true, `function consume() { PRE let sum = 0, turns = 0; for (const value of CALL) { if (turns++ === round) return "left at " + sum; sum += (typeof value === "number" ? value : 1000); if (turns === 6) break; } return sum + " in " + turns; }`],
  "two-sums-one-on-each-arm": [true, `function consume() { PRE let even = 0, odd = 0, turns = 0; try { for (const value of CALL) { if ((turns + round) & 1) odd += (typeof value === "number" ? value : 1000); else even += (typeof value === "number" ? value : 1000); if (++turns === 6) break; } } catch { return "caught " + even + " " + odd; } return even + " " + odd; }`],
  "handed-on": [false, `function drain(items) { let turns = 0; for (const value of items) { note("got " + ${show}); if (++turns > 12) break; } return turns; }
function consume() { PRE return drain(CALL); }`],
  "kept-in-a-list": [false, `const kept = [];
function consume() { PRE const held = CALL; kept.push(held); let turns = 0; for (const value of held) { if (++turns === 2) break; } return turns + " " + String(kept[kept.length - 1].next().done); }`],
  "one-of-two-by-a-ternary": [false, `function consume() { PRE let turns = 0; for (const value of flag ? CALL : []) { note("got " + ${show}); if (++turns > 12) break; } return turns; }`],
  "stepped-once-in-front": [false, `function consume() { PRE const held = CALL; const first = held.next(); note("first " + typeof first.value + " " + first.done); let turns = 0; for (const value of held) { note("got " + ${show}); if (++turns > 12) break; } return turns; }`],
  "stepped-by-hand": [false, `function consume() { PRE const held = CALL; let turns = 0; for (;;) { const step = held.next(turns); if (step.done) { note("done with " + String(step.value)); break; } note("got " + typeof step.value); if (++turns > 12) break; } return turns; }`],
  "returned-by-hand": [false, `function consume() { PRE const held = CALL; const first = held.next(); const closed = held.return("mine"); const after = held.next(); return [typeof first.value, first.done, typeof closed.value, closed.done, after.value, after.done].map(String).join(); }`],
  "thrown-into-by-hand": [false, `function consume() { PRE const held = CALL; const first = held.next(); let answer; try { const thrown = held.throw(new Error("sent in")); answer = "gave " + typeof thrown.value + " " + thrown.done; } catch (error) { answer = "threw " + error.message; } return typeof first.value + " " + answer; }`],
  "asks-for-its-class": [false, `function consume() { PRE const held = CALL; const isGenerator = Object.prototype.toString.call(held); let turns = 0; for (const value of held) { if (++turns === 2) break; } return isGenerator + " " + turns; }`],
  "awaits-in-the-turn": [true, `async function consume() { PRE let turns = 0; for (const value of CALL) { await null; note("got " + ${show}); if (++turns === 3) break; } return turns; }`],
  "awaits-and-throws": [true, `async function consume() { PRE let turns = 0; for (const value of CALL) { await Promise.resolve(1); if (++turns === 2) throw new Error("late"); } return turns; }`],
  "for-await-over-it": [false, `async function consume() { PRE let turns = 0; for await (const value of CALL) { note("got " + ${show}); if (++turns === 3) break; } return turns; }`],
};

// What stands in front of the consumer: [statements in front, the number handed over].
Object.assign(consumers, {
  "a-closure-on-the-way-out": [false, `function consume() { PRE let found = null; for (const value of CALL) { if (typeof value === "number" && value > 1) { const step = (value * 3) | 0; found = () => { let sum = 0; for (let i = 0; i < 4; i++) sum += step; return sum; }; break; } } return found === null ? "none" : found(); }`],
  "a-closure-where-it-returns": [false, `function search() { PRE for (const value of CALL) { if (typeof value === "number" && value > 0) { const step = (value * 5) | 0, isOdd = (value & 1) === 1; return () => step + (isOdd ? 1 : 0); } } return null; }
function consume() { const made = search(); return made === null ? "none" : made(); }`],
  "a-closure-behind-the-loop": [false, `function consume() { PRE let last = 0, turns = 0; for (const value of CALL) { last = Number(value) | 0; if (++turns > 6) break; } const kept = (last * 2) | 0; const read = () => kept + 1; return read(); }`],
  "a-closure-in-each-turn": [false, `function consume() { PRE const made = []; for (const value of CALL) { const twice = (Number(value) * 2) | 0; made.push(() => twice); if (made.length > 5) break; } return made.map(one => one()).join(); }`],
  "a-closure-in-front-of-the-loop": [false, `function consume() { PRE const base = (pick(4) * 2) | 0; const read = () => base; let sum = 0; for (const value of CALL) { sum += read(); if (sum > 40) break; } return sum; }`],
  "a-closure-under-a-catch-on-the-way-out": [false, `function consume() { PRE let found = null; try { for (const value of CALL) { if (typeof value === "number" && value > 1) { const step = (value * 7) | 0; found = () => step; throw new Error("out"); } } } catch (error) { note("caught " + error.message); } return found === null ? "none" : found(); }`],
});

const fronts = {
  "": limit => ["", String(limit)],
  "behind-a-ternary": limit => [`const extra = flag ? 1 : 2; note("extra " + extra);`, `(flag ? ${limit} : ${limit - 1})`],
  "behind-a-join": limit => [`let limit; if (flag) limit = ${limit}; else limit = ${limit - 1}; note("limit " + limit);`, `limit`],
  "behind-an-early-return": limit => [`if (!flag) return "early"; if (box.limit === -1) return "earlier";`, String(limit)],
  "behind-a-guess": limit => [`note("box " + box.name.length);`, `(box.limit + ${limit})`],
  "behind-a-call-that-branches": limit => [`note("picked " + pick(3));`, `pick(${limit})`],
};

const head = isEndless => `const notes = [];
let silent = false;
let round = 0;
const isEndless = ${isEndless};
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
`;
const tail = `async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 4; call++) { round = call; notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }
`;

const tailOfOneCall = `async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
round = 1; const answer = await attempt(); console.log(answer + " | " + notes.join("; "));
`;

let count = 0;
for (const [generator, [text, call, limit]] of Object.entries(generators)) {
  const isEndless = generator.startsWith("endless");
  for (const [consumer, [takesFronts, use]] of Object.entries(consumers)) {
    writeFileSync(`${out}/${generator}--${consumer}--called-once.mjs`, head(isEndless) + text + "\n" + use.replaceAll("PRE", "").replaceAll("CALL", call.replaceAll("LIMIT", String(limit ?? 0))) + "\n" + tailOfOneCall);
    count++;
    for (const [front, make] of Object.entries(fronts)) {
      if (front && !takesFronts)
        continue;
      const [pre, handedOver] = make(limit ?? 0);
      const program = head(isEndless) + text + "\n" + use.replaceAll("PRE", pre).replaceAll("CALL", call.replaceAll("LIMIT", handedOver)) + "\n" + tail;
      writeFileSync(`${out}/${generator}--${consumer}${front ? "--" + front : ""}.mjs`, program);
      count++;
    }
  }
}

const others = {
  "async-generator-under-for-await": `async function* steps(limit) { try { for (let i = 0; i < limit; i++) { await null; yield i; } } finally { note("cleaned"); } }
async function consume() { let turns = 0; for await (const value of steps(5)) { note("got " + value); if (++turns === 3) break; } return turns; }`,
  "prototype-of-the-function-gets-a-next": `function* steps(limit) { for (let i = 0; i < limit; i++) yield i; }
steps.prototype.next = function () { note("own next"); return { done: true, value: undefined }; };
function consume() { let turns = 0; for (const value of steps(3)) turns++; return turns; }`,
  "prototype-of-the-function-gets-a-return-in-a-turn": `function* steps(limit) { for (let i = 0; i < limit; i++) yield i; }
function consume() { let turns = 0; for (const value of steps(3)) { steps.prototype.return = function () { note("own return"); return {}; }; if (++turns === 2) break; } delete steps.prototype.return; return turns; }`,
  "prototype-is-come-by-through-a-computed-name": `function* steps(limit) { for (let i = 0; i < limit; i++) yield i; }
const name = ["proto", "type"].join("");
function consume() { steps[name].next = function () { note("own next"); return { done: true, value: undefined }; }; let turns = 0; for (const value of steps(3)) turns++; return turns; }`,
  "function-is-replaced-between-calls": `let steps = function* (limit) { for (let i = 0; i < limit; i++) yield i; };
function consume() { let sum = 0; for (const value of steps(3)) sum += value; steps = function* (limit) { yield 100; }; return sum; }`,
  "function-is-handed-to-unseen-code": `function* steps(limit) { for (let i = 0; i < limit; i++) yield i; }
globalThis.handedOut = steps;
function consume() { (0, eval)("handedOut.prototype.next = function () { return { done: true } }"); let turns = 0; for (const value of steps(3)) turns++; return turns; }`,
  "prototype-of-all-generators-gets-a-return": `function* steps(limit) { for (let i = 0; i < limit; i++) yield i; }
const above = Object.getPrototypeOf(function* () {}).prototype;
function consume() { const before = above.return; above.return = function (value) { note("shared return"); return before.call(this, value); }; let turns = 0; try { for (const value of steps(3)) { if (++turns === 2) break; } } finally { above.return = before; } return turns; }`,
  "keys-of-the-prototype-of-all-generators-are-listed-behind-a-loop": `function* steps(limit) { for (let i = 0; i < limit; i++) yield i; }
const above = Object.getPrototypeOf(function* () {}).prototype;
function consume() { let turns = 0; for (const value of steps(3)) { if (++turns === 2) break; } return Reflect.ownKeys(above).map(String).join(); }`,
};
for (const [generator, [text, call, limit]] of Object.entries(generators)) {
  const made = call.replaceAll("LIMIT", String(limit ?? 0));
  writeFileSync(`${out}/${generator}--the-body-of-the-module-consumes.mjs`, head(generator.startsWith("endless")) + text + `
let found = null, turns = 0;
try {
  for (const value of ${made}) { if (++turns > 6) break; if (typeof value === "number" && value > 1) { const step = (value * 3) | 0; found = () => { let sum = 0; for (let i = 0; i < 4; i++) sum += step; return sum; }; break; } }
} catch (error) { note("caught " + (error && error.message)); }
console.log((found === null ? "none" : found()) + " | " + turns + " | " + notes.join("; "));
`);
  count++;
}
for (const [name, text] of Object.entries(others)) {
  writeFileSync(`${out}/${name}.mjs`, head(false) + text + "\n" + tail);
  count++;
}
console.log(count + " programs");
