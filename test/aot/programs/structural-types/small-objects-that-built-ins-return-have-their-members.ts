function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

attempt("a proxy that can be revoked", () => {
  const made = Proxy.revocable({ x: 1 }, {});
  const before = [typeof made.proxy, typeof made.revoke, made.proxy.x + 1, Object.keys(made).join()];
  made.revoke();
  return before;
});
attempt("a proxy that was revoked", () => {
  const { proxy, revoke } = Proxy.revocable({ x: 1 }, {});
  revoke();
  return proxy.x;
});
attempt("the result of exec", () => {
  const match = /(?<first>a)(b)?/d.exec("xa");
  if (match === null) return "no match";
  return [match.index + 1, match.input.length, match.length, match[0], match[2], match.groups?.first, match.indices?.[0], match.indices?.[2], match.indices?.groups?.first, Object.keys(match).join()];
});
attempt("iterator results", () => {
  const list = [1].values();
  const first = list.next();
  const last = list.next();
  const map = new Map([["a", 1]]).entries().next();
  const text = "ab"[Symbol.iterator]().next();
  return [first.value, first.done, last.value, last.done, Object.keys(first).join(), map.value, text.value];
});
attempt("what a generator hands out", () => {
  function* make(): Generator<number, string, boolean> {
    const sent = yield 1;
    return sent ? "yes" : "no";
  }
  const g = make();
  const first = g.next();
  const last = g.next(true);
  const after = g.next(false);
  return [first.value, first.done, last.value, last.done, after.value, after.done];
});
attempt("the capability of a promise", () => {
  const capability = Promise.withResolvers<number>();
  return [typeof capability.promise.then, typeof capability.resolve, typeof capability.reject, Object.keys(capability).join()];
});
attempt("descriptors", () => {
  const data = Object.getOwnPropertyDescriptor({ a: 1 }, "a");
  const accessor = Object.getOwnPropertyDescriptor({ get a() { return 1; } }, "a");
  const length = Object.getOwnPropertyDescriptor([1, 2], "length");
  const none = Object.getOwnPropertyDescriptor({}, "a");
  return [data && Object.keys(data).join(), data?.value, data?.writable, accessor && Object.keys(accessor).join(), typeof accessor?.get, accessor?.set, length?.value, length?.enumerable, none];
});
attempt("bound functions", () => {
  function add(this: { base: number }, a: number, b: number): number {
    return this.base + a + b;
  }
  const bound = add.bind({ base: 10 }, 1);
  return [bound(2), bound.name, bound.length, "prototype" in bound, typeof bound];
});
attempt("errors", () => {
  const cause = new RangeError("inner");
  const error = new Error("outer", { cause });
  const many = new AggregateError([cause, "text"], "many");
  return [error.message, error.cause === cause, Object.keys(error).join(), Object.hasOwn(error, "cause"), many.errors.length, many.errors[1], typeof error.stack, error instanceof Error, String(cause)];
});
attempt("a stack of things to dispose", () => {
  const log: string[] = [];
  const stack = new DisposableStack();
  const used = stack.use({ name: "used", [Symbol.dispose]: () => log.push("used") });
  const adopted = stack.adopt({ name: "adopted" }, value => log.push(value.name));
  stack.defer(() => log.push("deferred"));
  const moved = stack.move();
  const before = [used.name, adopted.name, stack.disposed, moved.disposed];
  moved.dispose();
  return [before, log, moved.disposed];
});
attempt("using", () => {
  const log: string[] = [];
  {
    using first = { name: "first", [Symbol.dispose]: () => log.push("first gone") };
    using second = { name: "second", [Symbol.dispose]: () => log.push("second gone") };
    log.push(first.name + second.name);
  }
  return log;
});
attempt("weak references", () => {
  const target = { n: 1 };
  const ref = new WeakRef(target);
  return [ref.deref()?.n, ref.deref() === target];
});
attempt("boxes", () => {
  const n = new Number(5);
  const s = new String("ab");
  const b = new Boolean(false);
  return [n.valueOf() + 1, typeof n, s.length, s[1], s.valueOf() + "!", Object.keys(s).join(), b.valueOf(), b ? "truthy" : "falsy", Object(1n).valueOf() + 1n, typeof Object(Symbol.iterator)];
});
attempt("dates", () => {
  const date = new Date(Date.UTC(2020, 1, 29, 12));
  return [date.getTime(), date.toISOString(), date.toJSON(), date.getUTCDay(), new Date(NaN).getTime(), new Date(NaN).toJSON(), JSON.stringify({ date }), +date === date.valueOf()];
});
attempt("numbers and lists as words", () => [
  new Intl.NumberFormat("en-US").format(1234.5),
  new Intl.NumberFormat("en-US").formatToParts(1234.5).map(part => part.type + ":" + part.value),
  new Intl.ListFormat("en-US").format(["a", "b", "c"]),
  new Intl.PluralRules("en-US").select(1),
  new Intl.NumberFormat("en-US").resolvedOptions().locale,
  Intl.getCanonicalLocales("EN-us"),
  [...new Intl.Segmenter("en-US", { granularity: "word" }).segment("a b")].map(part => part.segment + part.index),
  new Intl.Locale("en-US").language,
]);

export {};
