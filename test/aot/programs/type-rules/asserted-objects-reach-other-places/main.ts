// An object that went through `as` is admitted by the place it reaches and by the place after that, in this file and in another one: functions, arrow functions in variables, methods, overriding methods, constructors, super(), static methods, accessors, rest parameters, private and static fields, captured variables, results, awaited results, yielded values. A place of the same type that only untyped values reach still tests them.
import { Widget, Panel, Cell, share, shared, forward, untouched, half, later, last, once, same, sameAgain, Taker, mix, type Setting, type Listener } from "./widgets";

function describe(value: unknown): string { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function attempt(label: string, action: () => unknown): void {
  try { console.log(label + ":", describe(action())); } catch (error) { console.log(label + ":", (error as Error).constructor.name); }
}
const hide = (value: unknown): any => value;
const callback = () => 1;
const values: [string, unknown][] = [["a function", callback], ["an array", [1]], ["an object", { y: 1 }], ["a number", 7]];

for (const [label, value] of values) {
  attempt(label + " into a function of another file, a variable there and back", () => share(value as Setting));
  attempt(label + " read from that variable", () => shared);
  attempt(label + " through an arrow function on into a function", () => forward(value as Setting));
  attempt(label + " into a method and out of a field", () => { const widget = new Widget(); widget.put(value as Setting); return widget.get(); });
  attempt(label + " into an overriding method and its super method", () => { const widget: Widget = new Panel(0); widget.put(value as Setting); return widget.get(); });
  attempt(label + " into a constructor", () => new Widget(value as Setting).setting);
  attempt(label + " into a constructor and super()", () => new Panel(value as Setting).get());
  attempt(label + " into a private field", () => new Widget().hide(value as Setting));
  attempt(label + " into a static method and a static field", () => Widget.remember(value as Setting));
  attempt(label + " into a captured variable", () => { let held: Setting = 0; const set = (next: Setting) => { held = next; }; set(value as Setting); return held; });
  attempt(label + " into a function declared in a function", () => { function inner(next: Setting): Setting { return next; } const call = () => inner(value as Setting); return call(); });
  attempt(label + " into a setter and out of a getter", () => { const cell = new Cell(); cell.value = value as Setting; const got: Setting = cell.value; return got; });
  attempt(label + " into a rest parameter", () => last(1, value as Setting));
  attempt(label + " out of a generator", () => { let got: Setting = 0; for (const item of once(value)) got = item; return got; });
  attempt(label + " into one of two functions", () => { const chosen = label.length > 100 ? forward : share; return chosen(value as Setting); });
  attempt(label + " as a function type into a method and a field", () => new Widget().listen(value as Listener));
  attempt(label + " into the overriding method of a class that a mixin made", () => new (mix(Taker))().run(value));
}

for (const [label, value] of values) {
  try { const got: Setting = await later(value); console.log(label + " out of an async function:", describe(got)); } catch (error) { console.log(label + " out of an async function:", (error as Error).constructor.name); }
}

console.log("the same function:", share(callback as unknown as Setting) === (callback as unknown), new Widget(callback as unknown as Setting).get() === (callback as unknown));

attempt("an untyped function into a function no assertion reaches", () => untouched(hide(callback)));
attempt("an untyped object into a number parameter", () => half(hide({})));
attempt("an untyped string into a number parameter", () => half(hide("4")));
attempt("an untyped function into a field no assertion reaches", () => { const widget = new Widget(); widget.untouched = hide(callback); return widget.untouched; });
attempt("a symbol under an assertion", () => share(hide(Symbol.iterator) as Setting));
attempt("an untyped symbol into a place that admits objects", () => share(hide(Symbol.iterator)));
attempt("numbers are still numbers", () => half(8) + half(hide(4)));

// A helper that hands its parameter on admits what one caller passes it under an assertion. The place behind the call of another caller keeps its test.
attempt("an object as an array through a helper into a variable", () => { const got: number[] = same({ y: 1 } as unknown as number[]); return got; });
attempt("an object as an array through two helpers into a variable", () => { const got: number[] = sameAgain({ y: 1 } as unknown as number[]); return got; });
attempt("an array through the same helpers", () => { const got: number[] = sameAgain(same([1, 2])); return got; });
attempt("an untyped object through the helper into a variable no assertion reaches", () => { const got: number[] = same(hide({ y: 1 })); return got; });
attempt("the result of a built-in and of a function under an assertion", () => { const got: string[] = [1, 2].slice(1) as unknown[] as string[]; const more: string[] = same([3]) as unknown[] as string[]; return got.concat(more); });
