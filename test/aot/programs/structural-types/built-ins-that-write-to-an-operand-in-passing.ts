function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class Received {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function receiver(): void {
  const o = new Received();
  Reflect.set({}, "value", "text", o);
  attempt("Reflect.set with a receiver, asked", () => (typeof o.value === "number") + " " + typeof o.value + " " + (o.value === undefined));
  attempt("Reflect.set with a receiver, used", () => o.value + 1);
  attempt("Reflect.set with a receiver, its method", () => o.twice());
  attempt("Reflect.set with a receiver, listed", () => JSON.stringify(o));
}

receiver();

class Stack {
  length = 0;
  label = "stack";
  size(): number {
    return this.length + 1;
  }
}

function pushed(): void {
  const o = new Stack();
  Array.prototype.push.call(o, "a", "b");
  attempt("push called on an instance, its length", () => o.length + " " + o.size());
  attempt("push called on an instance, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  Array.prototype.pop.call(o);
  attempt("pop called on it", () => o.length + " " + Object.keys(o).join());
}

pushed();

class Traced {
  id = 1;
  stack?: string;
}

function traced(): void {
  const o = new Traced();
  attempt("before captureStackTrace", () => (o.stack === undefined) + " " + Object.keys(o).join());
  Error.captureStackTrace(o);
  attempt("after captureStackTrace, asked", () => (o.stack === undefined) + " " + typeof o.stack + " " + ("stack" in o));
  attempt("after captureStackTrace, listed", () => Object.keys(o).join() + " " + Object.hasOwn(o, "stack") + " " + o.id);
}

traced();

class Filled {
  0 = 1;
  1 = 2;
  length = 2;
  first(): number {
    return this[0] + 1;
  }
}

function filled(): void {
  const o = new Filled();
  Array.prototype.fill.call(o, "text");
  attempt("fill called on an instance, asked", () => (typeof o[0] === "number") + " " + typeof o[0]);
  attempt("fill called on an instance, used", () => o[0] + o[1]);
  attempt("fill called on an instance, its method", () => o.first());
  attempt("fill called on an instance, listed", () => JSON.stringify(o));
}

filled();

function reversedTuple(): void {
  const pair: [number, string] = [1, "one"];
  Array.prototype.reverse.call(pair);
  attempt("reverse called on a tuple, asked", () => (typeof pair[0] === "number") + " " + (typeof pair[1] === "string") + " " + typeof pair[0]);
  attempt("reverse called on a tuple, used", () => pair[0] + 1);
  attempt("reverse called on a tuple, a method of the string", () => pair[1].length);
}

reversedTuple();

class Source {
  value = 1;
}

class Target {
  value = 2;
  other = 3;
}

function assignedFromAGetter(): void {
  const target = new Target();
  const source = {
    get value(): number {
      Reflect.set(target, "other", "written by the getter");
      return 5;
    },
  };
  Object.assign(target, source);
  attempt("a getter of the source writes to the target, asked", () => (typeof target.other === "number") + " " + typeof target.other + " " + target.value);
  attempt("a getter of the source writes to the target, used", () => target.other + 1);
}

assignedFromAGetter();

function descriptorsOfAnother(): void {
  const o = new Source();
  Object.defineProperties(o, Object.getOwnPropertyDescriptors({ value: "text", added: true }));
  attempt("the descriptors of another object, asked", () => (typeof o.value === "number") + " " + typeof o.value);
  attempt("the descriptors of another object, used", () => o.value + 1);
  attempt("the descriptors of another object, listed", () => JSON.stringify(o));
}

descriptorsOfAnother();

class Proxied {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function throughAProxy(): void {
  const o = new Proxied();
  const view: Proxied = new Proxy(o, {
    set(target, key, value) {
      return Reflect.set(target, key, String(value));
    },
  });
  view.value = 7;
  attempt("a typed store through a proxy that changes the value, asked", () => (typeof o.value === "number") + " " + typeof o.value);
  attempt("a typed store through a proxy that changes the value, used", () => o.value + 1);
  attempt("a typed store through a proxy that changes the value, its method", () => o.twice());
}

throughAProxy();

class Revived {
  value = 1;
}

function reviver(): void {
  const o = new Revived();
  JSON.parse("[1]", function (this: unknown, key: string, value: unknown) {
    Reflect.set(o, "value", key === "" ? "written by the reviver" : undefined);
    return value;
  });
  attempt("a reviver writes to an object it captured, asked", () => (typeof o.value === "number") + " " + typeof o.value);
  attempt("a reviver writes to an object it captured, used", () => o.value + 1);
}

reviver();

export {};
