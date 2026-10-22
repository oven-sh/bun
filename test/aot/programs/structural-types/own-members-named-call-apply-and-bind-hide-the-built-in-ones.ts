function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function base(n: number): number {
  return n + 1;
}

const withCall = Object.assign((n: number): number => n + 1, {
  call(): string {
    return "own call";
  },
});
const withApply = Object.assign((n: number): number => n + 1, {
  apply(): string {
    return "own apply";
  },
});
const withBind = Object.assign((n: number): number => n + 1, {
  bind(): () => string {
    return () => "own bind";
  },
});
const withToString = Object.assign((n: number): number => n + 1, {
  toString(): string {
    return "own toString";
  },
});

show("plain call", () => base.call(undefined, 1));
show("own call", () => withCall.call());
show("own call: still callable", () => withCall(1));
show("own apply", () => withApply.apply());
show("own apply: still callable", () => withApply(1));
show("own bind", () => withBind.bind()());
show("own toString", () => String(withToString));
show("own toString in a template", () => `${withToString}`);
show("Reflect.apply goes past an own apply", () => Reflect.apply(withApply, undefined, [1]));
show("the built-in call on one with its own", () => Function.prototype.call.call(withCall, undefined, 1));
show("map", () => [1, 2].map(withCall));

show("assigning name throws", () => Object.assign((n: number): number => n, { name: "given" }));
show("assigning length throws", () => Object.assign((n: number): number => n, { length: 9 }));

const named = (n: number): number => n;
Object.defineProperty(named, "name", { value: "renamed" });
Object.defineProperty(named, "length", { value: 9 });
show("a defined name", () => named.name);
show("a defined length", () => named.length);

function lengthOf(o: { length: number }): number {
  return o.length;
}
function nameOf(o: { name: string }): string {
  return o.name;
}
show("length of a function", () => lengthOf(base));
show("length of the redefined one", () => lengthOf(named));
show("length of a string", () => lengthOf("four"));
show("length of an array", () => lengthOf([1, 2]));
show("name of a function", () => nameOf(base));
show("name of a class", () => nameOf(class Named {}));
show("name of an object", () => nameOf({ name: "object" }));
show("name of the redefined one", () => nameOf(named));

function viaCall(f: { call(thisArg: undefined, n: number): number }): number {
  return f.call(undefined, 1);
}
show("an object with only a call method", () => viaCall({ call: (thisArg: undefined, n: number) => n * 100 }));
show("a function at the same place", () => viaCall(base));
