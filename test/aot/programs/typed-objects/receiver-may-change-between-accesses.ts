// An access through a type that admits objects from outside tests whether the receiver is laid out as the type says. Once it has passed, the next access to that receiver need not test again, UNLESS something ran in between that can change what the object is. Here it does: a getter of an object from outside, run by an access between two accesses to a record, redefines, deletes or retypes a member of that record. The functions are called directly out of loops (in code that is taken for rarely run an access is by name alone and tests nothing), and Object.defineProperty() is never called on a value of the type itself (then the type is given up whole, and nothing here would be a record).
interface T { a: number; b: number; c: number; d: number }
function make(i: number): T { return { a: i + 1.5, b: i + 2.5, c: i + 3.5, d: i + 4.5 } }
let run: () => void = () => {};
function outside(): T { const made: any = { b: 20.5, c: 30.5, d: 40.5 }; Object.defineProperty(made, "a", { get() { run(); return 10.5; }, enumerable: true, configurable: true }); return made; }
function between(o: T, p: T): number { return o.a + p.a + o.b }
function betweenTwice(o: T, p: T): number { return o.a + p.a + o.b + p.a + o.c }
function sameReceiver(p: T): number { return p.a + p.b + p.a + p.c }
function storeBehind(o: T, p: T): number { const x = o.a + p.a; o.b = x; return o.b + o.c }
function fourThenFour(o: T, p: T): number { return o.a + o.b + o.c + o.d + p.a + o.a + o.b + o.c + o.d }
function inLoop(o: T, p: T): number { let s = 0; for (let i = 0; i < 3; i++) s += o.a + p.a + o.b; return s }
function inBranches(o: T, p: T): number { if (o.a > 100) return 1; if (p.a > 100) return 2; if (o.b > 100) return 3; return o.c }
// b holds whatever is stored to it, as any property does; a, c and d hold the bits of a number. An object that is a record no more holds its properties in the same places, so a read of b in place would be right by luck: these two read c.
function betweenNumbers(o: T, p: T): number { return o.a + p.a + o.c }
function inBranchesNumbers(o: T, p: T): number { if (o.a > 100) return 1; if (p.a > 100) return 2; if (o.c > 100) return 3; return o.d }
const kept = [betweenNumbers, inBranchesNumbers, between, betweenTwice, sameReceiver, storeBehind, fourThenFour, inLoop, inBranches];
(globalThis as { kept?: unknown }).kept = kept;
function change(kind: number, o: T): void {
  if (kind === 1) { const untyped: any = o; Object.defineProperty(untyped, "b", { get() { return 1000.5 }, configurable: true, enumerable: true }) }
  else if (kind === 2) delete (o as { b?: number }).b;
  else if (kind === 3) { Object.setPrototypeOf(o, { b: 5000.5 }); delete (o as { b?: number }).b }
  else if (kind === 4) Object.freeze(o);
}
// A call by name is copied into the loop, where the record is known from its birth. Through this table the functions themselves run.
const table: ((o: T, p: T) => number)[] = [between, betweenTwice, storeBehind, fourThenFour, inLoop, inBranches, betweenNumbers, inBranchesNumbers];
const names = ["nothing", "an accessor in the place of b", "b deleted", "another prototype, b deleted", "frozen"];
const lines: string[] = [];
for (let turn = 0; turn < 3; turn++) {
  for (let kind = 0; kind < 5; kind++) {
    for (let which = 0; which < 8; which++) {
      const o = make(turn), p = outside();
      let n = 0, text = "";
      run = () => { n++; if (which === 1 ? n === 2 : which === 4 ? n === 2 : n === 1) change(kind, o) };
      try {
        if (which === 0) text = "between " + between(o, p);
        else if (which === 1) text = "between twice " + betweenTwice(o, p);
        else if (which === 2) text = "a store behind " + storeBehind(o, p) + " " + o.a + " " + o.b + " " + o.c;
        else if (which === 3) text = "four, then four " + fourThenFour(o, p);
        else if (which === 4) text = "in a loop " + inLoop(o, p);
        else if (which === 5) text = "in branches " + inBranches(o, p);
        else if (which === 6) text = "between, numbers " + betweenNumbers(o, p);
        else text = "in branches, numbers " + inBranchesNumbers(o, p);
      } catch (e) { text = "which " + which + " " + (e as Error).name }
      lines.push(turn + " " + names[kind] + ": " + text);
      const o2 = make(turn), p2 = outside();
      n = 0;
      run = () => { n++; if (which === 1 ? n === 2 : which === 4 ? n === 2 : n === 1) change(kind, o2) };
      try { text = "through the table " + which + " " + table[which](o2, p2) } catch (e) { text = "through the table " + which + " " + (e as Error).name }
      lines.push(turn + " " + names[kind] + ": " + text);
    }
  }
  const q = outside(); let m = 0;
  run = () => { if (m++ === 0) q.b = 7.5 };
  lines.push(turn + " the receiver from outside changes itself: " + sameReceiver(q));
  run = () => {};
  lines.push(turn + " two records: " + between(make(turn), make(turn + 5)) + " " + sameReceiver(make(turn)));
}
console.log(lines.join("\n"));
