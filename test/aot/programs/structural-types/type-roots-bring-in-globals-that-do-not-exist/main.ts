function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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

function plusOne(n: number): number {
  return n + 1;
}

attempt("typeof each", () => [typeof BUILD_ID, typeof requestCount, typeof featureFlags, typeof track, typeof Widget, typeof Vendor, typeof Mode]);
attempt("a constant", () => BUILD_ID + "!");
attempt("a variable", () => requestCount + 1);
attempt("a store to a variable", () => {
  requestCount = 1;
  return "stored";
});
attempt("a var", () => featureFlags.fast);
attempt("a var through globalThis", () => [globalThis.featureFlags, typeof globalThis.featureFlags]);
attempt("a member of a var through globalThis", () => globalThis.featureFlags.level + 1);
attempt("a function", () => track("start") + 1);
attempt("a class", () => new Widget(1).grow());
attempt("a subclass", () => {
  class Wide extends Widget {}
  return new Wide(1).width;
});
attempt("instanceof", () => ({}) instanceof Widget);
attempt("a namespace", () => Vendor.version + 1);
attempt("an enum", () => Mode.On + 1);
attempt("a method of every list", () => [1, 2].last());
attempt("a method of every list, asked for", () => [typeof [1, 2].last, "last" in []]);
attempt("a method of every text", () => "a".shout());
attempt("a member of every number", () => [(5).doubled, (5).doubled + 1, plusOne((5).doubled)]);

Reflect.set(globalThis, "featureFlags", "no object");
Reflect.set(globalThis, "BUILD_ID", 7);
Reflect.set(globalThis, "requestCount", "many");
Reflect.set(globalThis, "track", (event: string) => event + "!");
Reflect.set(globalThis, "Widget", function () {
  return { width: "wide", grow: () => "grown" };
});
Reflect.set(globalThis, "Vendor", { version: "one" });
Reflect.set(globalThis, "Mode", { On: "on" });

attempt("now they exist: typeof each", () => [typeof BUILD_ID, typeof requestCount, typeof featureFlags, typeof track, typeof Widget, typeof Vendor, typeof Mode]);
attempt("now they exist: a constant", () => [BUILD_ID + "!", BUILD_ID.length]);
attempt("now they exist: a variable", () => [requestCount + 1, plusOne(requestCount)]);
attempt("now they exist: a store", () => {
  requestCount = 5;
  return [requestCount + 1, Reflect.get(globalThis, "requestCount")];
});
attempt("now they exist: a var", () => [featureFlags.fast, featureFlags.level, featureFlags.level + 1]);
attempt("now they exist: a function", () => [track("start"), track("start") + 1, plusOne(track("start"))]);
attempt("now they exist: a class", () => [new Widget(1).width, new Widget(1).width + 1, new Widget(1).grow(), new Widget(1) instanceof Widget]);
attempt("now they exist: a namespace", () => [Vendor.version + 1, plusOne(Vendor.version)]);
attempt("now they exist: a function of the namespace", () => Vendor.ping());
attempt("now they exist: an enum", () => [Mode.On, Mode.On + 1, Mode.Off, Mode.On === 1]);

export {};
