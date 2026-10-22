function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Point {
  x: number;
  y: number;
  label = "point";
  visible = true;
  tags: string[] = ["first"];
  origin: { id: number } = { id: 7 };
  note?: string;
  #secret = 42;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
  secret(): number {
    return this.#secret;
  }
  static isPoint(value: object): boolean {
    return #secret in value;
  }
}

function make(x: number, y: number): Point {
  return new Proxy(new Point(x, y), {});
}

function inAParameter(p: Point): unknown {
  return [p.x + p.y, p.label.length];
}

function calledInAParameter(p: Point): number {
  return p.norm();
}

function inALocal(odd: boolean): unknown {
  const local: Point = odd ? make(3, 4) : new Point(3, 4);
  return [local.x + local.y, local.label.length];
}

function calledInALocal(odd: boolean): number {
  const local: Point = odd ? make(3, 4) : new Point(3, 4);
  return local.norm();
}

function asAResult(odd: boolean): Point {
  return odd ? make(3, 4) : new Point(3, 4);
}

class Holder {
  before = 1;
  point: Point;
  after = 2.5;
  constructor(point: Point) {
    this.point = point;
  }
  read(): unknown {
    return [this.before, this.point.x + this.point.y, this.point.label.length, this.after];
  }
  call(): number {
    return this.point.norm();
  }
  move(): number {
    this.point.x += 1;
    return this.point.x;
  }
}

function sumOfElements(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += points[i].x + points[i].y;
  return total;
}

function normsOfElements(points: Point[]): number[] {
  const norms: number[] = [];
  for (const point of points) norms.push(point.norm());
  return norms;
}

function captured(start: Point): { read(): number; call(): number; put(next: Point): void } {
  let held = start;
  return {
    read: () => held.x + held.y,
    call: () => held.norm(),
    put(next) {
      held = next;
    },
  };
}

function inAMap(points: Map<string, Point>, key: string): unknown {
  const point = points.get(key);
  return point === undefined ? "missing" : [point.x + point.y, typeof point.norm];
}

function orNothing(point: Point | null): number {
  return point === null ? -1 : point.x + point.y;
}

function generic<T extends Point>(point: T): number {
  return point.x + point.y;
}

function honestCallerOne(): unknown {
  return [inAParameter(new Point(1, 2)), calledInAParameter(new Point(3, 4))];
}
function honestCallerTwo(): unknown {
  const point = new Point(5, 12);
  return [inAParameter(point), calledInAParameter(point)];
}
function oddCaller(): unknown {
  return inAParameter(make(3, 4));
}
function oddCallerThatCalls(): number {
  return calledInAParameter(make(3, 4));
}

const table = { inAParameter, calledInAParameter };
const reusedHolder = new Holder(new Point(0, 0));
const reusedCapture = captured(new Point(0, 0));

attempt("the odd caller comes first", oddCaller);
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Point(i, 0.5);
  reusedHolder.point = honest;
  reusedCapture.put(honest);
  honestCallerOne();
  honestCallerTwo();
  inALocal(false);
  inAMap(new Map([["k", honest]]), "k");
  warm += calledInALocal(false) + asAResult(false).x + reusedHolder.call() + reusedHolder.move() + new Holder(honest).call() + sumOfElements([honest, honest]) + normsOfElements([honest]).length;
  warm += reusedCapture.read() + reusedCapture.call() + orNothing(honest) + orNothing(null) + generic(honest);
}
console.log("after 2000 honest points", warm);

attempt("a parameter", oddCaller);
attempt("a parameter, called", oddCallerThatCalls);
attempt("a local", () => inALocal(true));
attempt("a local, called", () => calledInALocal(true));
attempt("a result", () => [asAResult(true).x + asAResult(true).y, typeof asAResult(true).norm]);
attempt("a result, called", () => asAResult(true).norm());
attempt("a field of a new object", () => new Holder(make(3, 4)).read());
attempt("a field of a new object, called", () => new Holder(make(3, 4)).call());
attempt("a field of a new object, stored through", () => new Holder(make(3, 4)).move());
attempt("a field of an old object", () => {
  reusedHolder.point = make(3, 4);
  return [reusedHolder.read(), reusedHolder.move()];
});
attempt("a field of an old object, called", () => reusedHolder.call());
attempt("elements", () => sumOfElements([new Point(1, 1), make(3, 4), new Point(1, 1)]));
attempt("elements, called", () => normsOfElements([new Point(3, 4), make(3, 4), new Point(3, 4)]));
attempt("one among 3000 elements", () => {
  const points: Point[] = [];
  for (let i = 0; i < 3000; i++) points.push(i === 1500 ? make(3, 4) : new Point(1, 1));
  return sumOfElements(points);
});
attempt("a captured variable", () => {
  reusedCapture.put(make(3, 4));
  return [reusedCapture.read(), captured(make(3, 4)).read()];
});
attempt("a captured variable, called", () => reusedCapture.call());
attempt("a map value", () => inAMap(new Map([["k", make(3, 4)]]), "k"));
attempt("beside null", () => orNothing(make(3, 4)));
attempt("a generic", () => generic(make(3, 4)));
attempt("call, apply, bind", () => [inAParameter.call(undefined, make(3, 4)), inAParameter.apply(undefined, [make(3, 4)]), inAParameter.bind(undefined, make(3, 4))()]);
attempt("handed to map", () => [new Point(1, 2), make(3, 4), new Point(5, 6)].map(inAParameter));
attempt("handed to map, called", () => [new Point(3, 4), make(3, 4)].map(calledInAParameter));
attempt("read from a literal", () => table.inAParameter(make(3, 4)));
attempt("sorted with honest points", () => [new Point(9, 9), make(3, 4), new Point(1, 1)].toSorted((a, b) => a.x - b.x).map(point => point.x));
attempt("honest again", () => [honestCallerOne(), honestCallerTwo(), new Holder(new Point(3, 4)).call()]);
