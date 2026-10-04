declare const process: { env: Record<string, string | undefined> };
declare function $$t(value: unknown, mask: number, type: number): void;
Reflect.set(globalThis, "$$t", () => {});

interface Task { a: number; b: number; c: number; d: number }
interface Other { x: string; y: number }
const tasks: Task[] = [{ a: 1, b: 2, c: 3, d: 4 }, { a: 5, b: 6, c: 7, d: 8 }];
function step(at: number, here: number) { if (at === here) throw new Error("at " + here); }

function checksFirst(t: Task, at: number) { try { $$t(t, 512, 3); step(at, 1); return t.a + t.b; } catch (e) { return "caught " + t.d; } }
function checksFirstWithoutHandler(t: Task, at: number) { $$t(t, 512, 3); step(at, 3); return t.a + t.b + t.d; }
function checksAfterRead(t: Task, at: number) { try { const a = t.a; $$t(t, 512, 3); step(at, 1); return a + t.b; } catch (e) { return "caught " + t.d; } }
function checksAfterReadWithoutHandler(t: Task, at: number) { const a = t.a; $$t(t, 512, 3); step(at, 3); return a + t.b; }
function checksInHandler(t: Task, at: number) { try { step(at, 1); return "none"; } catch (e) { $$t(t, 512, 3); return "caught " + t.a; } }
function checksThenReassigns(t: Task, at: number) { try { $$t(t, 512, 3); const a = t.a; t = tasks[1]; step(at, 1); return a + t.a; } catch (e) { return "caught " + t.d; } }
function checksInLoop(t: Task, at: number) { let sum = 0; for (let i = 0; i < 3; i++) { try { $$t(t, 512, 3); sum += t.a; step(at, i); } catch (e) { sum += 100 * t.d; } } return sum; }
function checksOnly(t: Task, at: number) { try { $$t(t, 512, 3); step(at, 1); return "passed"; } catch (e) { return "caught " + typeof t; } }
function neverChecks(t: Task, at: number) { try { step(at, 1); return t.a + t.b; } catch (e) { return "caught " + t.d; } }
const functions = [checksFirst, checksFirstWithoutHandler, checksAfterRead, checksAfterReadWithoutHandler, checksInHandler, checksThenReassigns, checksInLoop, checksOnly, neverChecks];

for (const f of functions) console.log(f.name + ": " + [0, 1, 2].flatMap(at => [f(tasks[0], at), f(tasks[1], at)]).join(", "));

if (process.env.BREAK_TYPES) {
  const other: Other = { x: "w", y: 1 };
  const values: [string, unknown][] = [
    ["an object of another type", other],
    ["an object that lacks a property", { a: 1, b: 2, c: 3 }],
    ["an object that is not extensible", Object.freeze({ a: 1, b: 2, c: 3, d: 4 })],
    ["an object with the properties in another order", { d: 4, c: 3, b: 2, a: 1 }],
  ];
  for (const [label, value] of values) {
    for (const f of functions) {
      for (const at of [0, 1]) {
        let result: unknown;
        try { result = Reflect.apply(f, undefined, [value, at]); } catch (e) { result = e; }
        console.log(`${label}, ${f.name}, ${at}: ${result}`);
      }
    }
  }
}
export {};
