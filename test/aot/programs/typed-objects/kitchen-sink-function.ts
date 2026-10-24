// One function allocates, upcasts, casts, forces a cast, guards, takes plain data and `any` into declared types, fills containers, stores callbacks, freezes an object and makes an array with a property. A second function does the same things again in another order, and a third one is never called. The output must match plain Bun.
interface Shape { kind: string; area(): number }
interface Named { name: string }
class Circle implements Shape { kind = "circle"; constructor(public r: number) {} area() { return 3 * this.r * this.r; } }
class Square implements Shape, Named { kind = "square"; name = "sq"; constructor(public s: number) {} area() { return this.s * this.s; } }
type Tagged = Named & { tag: number };
function isNamed(value: unknown): value is Named { return typeof value === "object" && value !== null && "name" in value; }

function everything(input: any, text: string): string[] {
  const out: string[] = [];
  const shapes: Shape[] = [new Circle(1), new Square(2)];
  for (const shape of shapes) out.push(shape.kind + shape.area());
  const named = shapes[1] as Square;
  out.push(named.name);
  const forced = { name: "forced", tag: 1 } as unknown as Tagged;
  out.push(forced.name + forced.tag);
  const parsed: Named = JSON.parse(text);
  out.push(parsed.name);
  const given: Named = input;
  out.push(given.name);
  if (isNamed(input)) out.push("guard " + input.name);
  const list: Named[] = [parsed, given, named];
  out.push(list.map(item => item.name).join());
  const table = new Map<string, Shape>([["c", shapes[0]]]);
  out.push(String(table.get("c")!.area()));
  const callbacks = { run: (shape: Shape) => shape.area() };
  out.push(String(callbacks.run(shapes[0])));
  const frozen = Object.freeze({ name: "frozen" });
  out.push(frozen.name + Object.isFrozen(frozen));
  const array: number[] & { tag?: string } = Object.assign([1, 2], { tag: "t" });
  out.push(array.length + array.tag!);
  return out;
}

function everythingAgain(text: string, input: any): string[] {
  const out: string[] = [];
  const array: number[] & { tag?: string } = Object.assign([3], { tag: "u" });
  out.push(array.length + array.tag!);
  const frozen = Object.freeze({ name: "frozen again" });
  out.push(frozen.name + Object.isFrozen(frozen));
  const callbacks = { run: (shape: Shape) => shape.kind };
  const given: Named = input;
  const parsed: Named = JSON.parse(text);
  const shapes: Shape[] = [new Square(3), new Circle(2)];
  out.push(callbacks.run(shapes[1]));
  const table = new Map<string, Shape>([["s", shapes[0]]]);
  out.push(String(table.get("s")!.area()));
  const named = shapes[0] as Square;
  const list: Named[] = [named, given, parsed];
  out.push(list.map(item => item.name).join());
  if (isNamed(parsed)) out.push("guard " + parsed.name);
  const forced = { name: "forced again", tag: 2 } as unknown as Tagged;
  out.push(forced.name + forced.tag);
  for (const shape of shapes) out.push(shape.kind + shape.area());
  return out;
}

function neverCalled(input: any): Named[] {
  const given: Named = input;
  const forced = input as unknown as Tagged;
  return [given, forced, new Square(9)];
}

console.log(everything({ name: "any", extra: 1 }, '{"name":"parsed"}').join("\n"));
console.log(everythingAgain('{"name":"parsed again"}', { name: "any again" }).join("\n"));
