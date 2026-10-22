// `e as T` refuses no object (a function is one) and neither `undefined` nor `null`, whatever `T` is, and the place that receives the value admits it: a parameter, a variable, a field, a result, and the place after that. Nothing is copied. `x!` checks nothing. An untyped value that enters a written place is tested as ever, and so is a primitive of the wrong kind under a cast: a test that fails throws nothing, and the program goes on as under `bun run`.
declare const console: { log(...values: unknown[]): void };
type Attribute = boolean | string | number;
type Name = "a" | "b";
interface Point { x: number }
type Callback = () => void;
const hide = (value: unknown): unknown => value;
function describe(value: unknown): string { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function attempt(label: string, action: () => unknown): void {
    try { console.log(label, describe(action())); } catch (error) { console.log(label, (error as Error).constructor.name); }
}
function show(label: string, action: () => unknown): void {
    try { console.log(label, String(action())); } catch (error) { console.log(label, (error as Error).constructor.name); }
}

class Holder { attribute: Attribute = 0; name: Name = "a"; point: Point = { x: 1 }; callback: Callback = () => {}; }
function takesAttribute(value: Attribute): unknown { return value; }
function takesName(value: Name): unknown { return value; }
function takesPoint(value: Point): unknown { return value; }
function takesCallback(value: Callback): unknown { return value; }
function givesAttribute(value: unknown): Attribute { return value as Attribute; }
function givesName(value: unknown): Name { return value as Name; }
function givesPoint(value: unknown): Point { return value as Point; }
function givesCallback(value: unknown): Callback { return value as Callback; }
function storesAttribute(holder: Holder, value: Attribute): unknown { holder.attribute = value; return holder.attribute; }
function passesOn(value: Attribute): unknown { const kept: Attribute = value; return takesAttribute(kept); }

const values: [string, unknown][] = [["a function", () => 1], ["an array", [1]], ["an object", { y: 1 }], ["null", null], ["undefined", undefined]];
for (const [label, value] of values) {
    attempt(label + " as primitives", () => value as Attribute);
    attempt(label + " as literals", () => value as Name);
    attempt(label + " as an object type", () => value as Point);
    attempt(label + " as a function type", () => value as Callback);
    attempt(label + " through unknown", () => value as unknown as Attribute);
    attempt(label + " through any", () => value as any as Attribute);

    attempt(label + " as primitives, into a parameter", () => takesAttribute(value as Attribute));
    attempt(label + " as literals, into a parameter", () => takesName(value as Name));
    attempt(label + " as an object type, into a parameter", () => takesPoint(value as Point));
    attempt(label + " as a function type, into a parameter", () => takesCallback(value as Callback));

    attempt(label + " as primitives, into a variable", () => { const kept: Attribute = value as Attribute; return kept; });
    attempt(label + " as literals, into a variable", () => { const kept: Name = value as Name; return kept; });
    attempt(label + " as an object type, into a variable", () => { const kept: Point = value as Point; return kept; });
    attempt(label + " as a function type, into a variable", () => { const kept: Callback = value as Callback; return kept; });

    attempt(label + " as primitives, into a field", () => { const holder = new Holder(); holder.attribute = value as Attribute; return holder.attribute; });
    attempt(label + " as literals, into a field", () => { const holder = new Holder(); holder.name = value as Name; return holder.name; });
    attempt(label + " as an object type, into a field", () => { const holder = new Holder(); holder.point = value as Point; return holder.point; });
    attempt(label + " as a function type, into a field", () => { const holder = new Holder(); holder.callback = value as Callback; return holder.callback; });

    attempt(label + " as primitives, as a result", () => givesAttribute(value));
    attempt(label + " as literals, as a result", () => givesName(value));
    attempt(label + " as an object type, as a result", () => givesPoint(value));
    attempt(label + " as a function type, as a result", () => givesCallback(value));

    attempt(label + " from a parameter on into a field", () => storesAttribute(new Holder(), value as Attribute));
    attempt(label + " from a parameter on into a variable and a parameter", () => passesOn(value as Attribute));
}

const callback = () => 1;
const list = [1];
show("the same function through a parameter", () => takesAttribute(callback as unknown as Attribute) === callback);
show("the same function as a result", () => givesAttribute(callback) === (callback as unknown));
show("the same array through a field", () => storesAttribute(new Holder(), list as unknown as Attribute) === list);

function double(n: number): number { return n * 2; }
attempt("a right primitive under a cast", () => hide(2) as number);
attempt("an untyped string into a number parameter", () => double("4" as any));
attempt("an untyped object into a number parameter", () => double({} as any));
attempt("an untyped function into a string variable", () => { const text: string = hide(callback) as any; return text; });
attempt("a string cast to number", () => hide("2") as number);
attempt("a string cast to number through unknown", () => "2" as unknown as number);
attempt("a number cast to literals", () => hide(1) as Name);
attempt("an element of the right kind, read through a cast", () => (hide(["a"]) as string[])[0]);
attempt("an element of the wrong kind, read through a cast", () => (hide([1]) as string[])[0]);
attempt("a property of the right kind, read through a cast", () => (hide({ x: 1 }) as Point).x);
attempt("a property of the wrong kind, read through a cast", () => (hide({ x: "1" }) as Point).x);
attempt("x! on a value", () => (hide("a") as string | null)!);
attempt("x! on null", () => (hide(null) as string | null)!);
attempt("x! on undefined", () => (hide(undefined) as string | undefined)!);
show("a member of x! on null throws as in plain Bun", () => { try { return (hide(null) as string | null)!.length; } catch (error) { return error instanceof TypeError && !error.message.startsWith("expected "); } });
function countOf(list: string[]): number { return list.length; }
function lastOf(list: string[]): unknown { return list[list.length - 1]; }
function grown(list: string[]): number { list.push("more"); return list.length; }
const mixed: (string | number)[] = ["a", "b", "c"];
show("a slice cast to an array type, into an array parameter", () => countOf(mixed.slice(0, 2) as string[]));
show("a map cast to an array type, into an array parameter", () => lastOf(mixed.map(item => item) as string[]));
show("a filter cast to an array type, into an array parameter", () => countOf(mixed.filter(item => item !== "b") as string[]));
show("a concat cast to an array type, into an array parameter", () => grown(mixed.concat(["d"]) as string[]));
show("an array cast through unknown[] to another array type", () => lastOf(mixed.slice(1) as unknown[] as string[]));
show("an array behind any, into an array parameter", () => countOf((hide(["x"]) as any) as string[]));
show("an array behind unknown, into an array parameter", () => countOf(hide(["x", "y"]) as string[]));
show("an array-like object behind unknown, into an array parameter", () => countOf(hide({ length: 7 }) as string[]));
show("an array-like object behind any, into an array parameter", () => countOf((hide({ length: 8 }) as any) as string[]));
show("an array-like object behind never, into an array parameter", () => countOf(hide({ length: 9 }) as never as string[]));
show("a function cast to another function type, then called", () => ((() => "called") as (count: number) => string)(1));

