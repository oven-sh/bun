function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + String(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof TypeError ? "TypeError" : error instanceof Error ? "Error" : typeof error));
  }
}

function byReflectApply(n: number): string {
  return "reached with " + n;
}
function byCall(n: number): string {
  return "reached with " + n;
}
function byApply(n: number): string {
  return "reached with " + n;
}
function byBind(n: number): string {
  return "reached with " + n;
}
function byMap(n: number): string {
  return "reached with " + n;
}
function asADefault(): string {
  return "reached";
}
function throughATable(): string {
  return "reached";
}
function throughAList(): string {
  return "reached";
}
function asAnArgument(): string {
  return "reached";
}
function asAResult(): string {
  return "reached";
}
function byAPromise(n: number): string {
  return "reached with " + n;
}
function asATag(strings: TemplateStringsArray): string {
  return "reached with " + strings.length;
}
function asAGetter(): string {
  return "reached";
}
function throughAProxy(): string {
  return "reached";
}
function asAFunctionObject(): string {
  return "reached";
}

class Made {
  label = "made";
}
class MadeByAnAlias {
  label = "made by an alias";
}

class Host {
  byComputedName(): string {
    return "reached";
  }
  byOptionalCall(): string {
    return "reached";
  }
  byAnInterface(): string {
    return "reached";
  }
  detached(): string {
    return "reached";
  }
  toString(): string {
    return "reached by a conversion";
  }
  valueOf(): number {
    return 42;
  }
  toJSON(): string {
    return "reached by JSON";
  }
  [Symbol.toPrimitive](hint: string): string {
    return "reached with the hint " + hint;
  }
  static fixed(): string {
    return "reached";
  }
  get read(): string {
    return "reached";
  }
  set written(value: string) {
    console.log("a setter: reached with " + value);
  }
}

class Plain {
  toString(): string {
    return "reached by a conversion";
  }
  valueOf(): number {
    return 42;
  }
}

interface HasOptional {
  byOptionalCall?(): string;
}
interface HasMethod {
  byAnInterface(): string;
}

const host = new Host();
const name: string = ["by", "Computed", "Name"].join("");

attempt("Reflect.apply", () => Reflect.apply(byReflectApply, undefined, [1]));
attempt("call", () => byCall.call(undefined, 1));
attempt("apply", () => byApply.apply(undefined, [1]));
attempt("bind", () => byBind.bind(undefined, 1)());
attempt("map", () => [1].map(byMap).join());
attempt("a default value", () => ((f: () => string = asADefault) => f())());
attempt("a table", () => {
  const table: { [key: string]: () => string } = { entry: throughATable };
  return table["en" + "try"]();
});
attempt("a list", () => [throughAList][0]());
attempt("an argument", () => ((f: () => string) => f())(asAnArgument));
attempt("a result", () => ((): (() => string) => asAResult)()());
attempt("a tag", () => asATag`x`);
attempt("a getter that was defined", () => {
  const target: { value?: string } = {};
  Object.defineProperty(target, "value", { get: asAGetter });
  return target.value;
});
attempt("a proxy", () => new Proxy(throughAProxy, {})());
attempt("typed as Function", () => {
  const f: Function = asAFunctionObject;
  return f();
});
attempt("Reflect.construct", () => Reflect.construct(Made, []).label);
attempt("an alias of a class", () => {
  const Alias: new () => { label: string } = MadeByAnAlias;
  return new Alias().label;
});
attempt("a computed name", () => {
  const method: unknown = Reflect.get(host, name);
  return typeof method === "function" ? method.call(host) : "not a function";
});
attempt("an optional call", () => {
  const view: HasOptional = host;
  return view.byOptionalCall?.();
});
attempt("an interface", () => {
  const view: HasMethod = host;
  return view.byAnInterface();
});
attempt("detached", () => {
  const { detached } = host;
  return detached();
});
attempt("a static method through a view", () => {
  const view: { fixed(): string } = Host;
  return view.fixed();
});
attempt("a getter through a view", () => {
  const view: { readonly read: string } = host;
  return view.read;
});
attempt("a setter through a view", () => {
  const view: { written: string } = host;
  view.written = "text";
  return "stored";
});
attempt("a template", () => `${host}`);
attempt("JSON", () => JSON.stringify([host]));
attempt("toString by concatenation", () => "" + new Plain());
attempt("toString by String", () => String(new Plain()));
attempt("valueOf by arithmetic", () => +new Plain() + 1);

console.log("a promise: " + (await Promise.resolve(1).then(byAPromise)));

export {};
