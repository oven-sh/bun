function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

type Options = { a: number; b?: string; c?: number; d?: { e: number }; f?: boolean; g?: number[] };

function merge(into: Options, from: any): Options {
  return Object.assign(into, from);
}
function mergeTyped(into: Options, from: Partial<Options>): Options {
  return Object.assign(into, from);
}
function show(options: Options) {
  return [Object.keys(options).join(), options];
}

say("all that is optional, in the order of the source", () => show(merge({ a: 1 }, { d: { e: 4 }, c: 3, b: "x", a: 2 })));
say("in the order of the type", () => show(merge({ a: 1 }, { a: 2, b: "x", c: 3, d: { e: 4 }, f: true, g: [1] })));
say("some are there", () => show(merge({ a: 1, c: 9 }, { b: "x", c: 3, d: { e: 4 } })));
say("a typed source", () => show(mergeTyped({ a: 1 }, { c: 3, b: "y" })));
say("a typed source that lacks what it may lack", () => {
  const from: Partial<Options> = { b: "z" };
  return [show(mergeTyped({ a: 1 }, from)), show(mergeTyped({ a: 1, f: false }, { f: undefined, c: undefined }))];
});
say("numbers of all kinds", () => [0.5, -0, NaN, 2 ** 31, -(2 ** 31), 2 ** 53, 1e300, -1, 1073741824, -1073741825].map((c) => {
  const made = merge({ a: 1 }, { c });
  return [Object.keys(made).join(), Object.is(made.c, c), String(made.c)];
}));
say("undefined and null", () => [show(merge({ a: 1 }, { b: undefined, d: undefined })), "b" in merge({ a: 1 }, { b: undefined })]);
say("many, in four orders", () => {
  const sources: any[] = [
    { b: "p", c: 1 },
    { c: 2, b: "q" },
    { d: { e: 5 }, b: "r", f: false },
    { g: [1, 2], a: 7 },
  ];
  const seen: Record<string, number> = {};
  let total = 0;
  for (let i = 0; i < 4000; i++) {
    const made = merge(i & 4 ? { a: i, c: 0 } : { a: i }, sources[i & 3]);
    const keys = Object.keys(made).join();
    seen[keys] = (seen[keys] ?? 0) + 1;
    total += made.a + (made.c ?? 0) + (made.b?.length ?? 0) + (made.d?.e ?? 0) + (made.g?.length ?? 0);
  }
  return [seen, total];
});
say("twice onto the same object", () => {
  const made: Options = { a: 1 };
  merge(made, { c: 1 });
  merge(made, { b: "b", c: 2 });
  merge(made, { d: { e: 1 }, b: "c" });
  return show(made);
});
say("deleted and created again", () => {
  const made = merge({ a: 1 }, { b: "x", c: 3 });
  delete made.b;
  merge(made, { b: "again" });
  return show(made);
});
say("not extensible, sealed, frozen", () => {
  const results: unknown[] = [];
  for (const close of [Object.preventExtensions, Object.seal, Object.freeze]) {
    const made: Options = { a: 1, c: 2 };
    close(made);
    try {
      merge(made, { c: 3, b: "x" });
      results.push("stored");
    } catch (error) {
      results.push((error as Error).constructor.name);
    }
    results.push(show(made));
  }
  return results;
});
say("an object that others inherit from", () => {
  const base: Options = { a: 1 };
  const heir = Object.create(base);
  const before = [heir.b, heir.c];
  merge(base, { b: "inherited", c: 5 });
  return [before, heir.b, heir.c, Object.keys(heir).length, show(base)];
});

interface Holder {
  view?: boolean;
  note?: string;
}
class Holder {
  name = "h";
  rank?: number;
  log: string[] = [];
  take(given: any) {
    Object.assign(this, given);
  }
}
Holder.prototype.toString = function () {
  return "holder";
};
say("fields of an interface merged with the class", () => {
  const holder = new Holder();
  holder.take({ note: "n", view: true, rank: 3 });
  return [Object.keys(holder).join(), holder.note, holder.view, holder.rank];
});
say("a setter that has come onto the prototype takes what is absent, not what is there", () => {
  const first = new Holder();
  first.take({ view: false });
  Object.defineProperty(Holder.prototype, "view", {
    set(this: Holder, value: boolean) {
      this.log.push("view " + value);
    },
    get() {
      return undefined;
    },
    configurable: true,
  });
  const second = new Holder();
  first.take({ view: true, note: "first" });
  second.take({ view: true, note: "second" });
  const result = [Object.keys(first).join(), first.view, first.log, Object.keys(second).join(), second.view, second.log];
  delete (Holder.prototype as any).view;
  second.take({ view: false });
  return [result, Object.keys(second).join(), second.view];
});
say("what is read only on the prototype refuses", () => {
  Object.defineProperty(Holder.prototype, "note", { value: "fixed", writable: false, configurable: true });
  const holder = new Holder();
  let refused = "no";
  try {
    holder.take({ rank: 1, note: "mine", view: true });
  } catch (error) {
    refused = (error as Error).constructor.name;
  }
  const result = [refused, Object.keys(holder).join(), holder.note, holder.rank, holder.view];
  delete (Holder.prototype as any).note;
  holder.take({ note: "mine" });
  return [result, Object.keys(holder).join(), holder.note];
});
say("kept over collections", () => {
  const kept: Options[] = [];
  for (let i = 0; i < 30000; i++) {
    const made = merge({ a: i }, { d: { e: i }, b: "s" + i, g: [i] });
    if (i % 6000 === 0) kept.push(made);
  }
  return kept;
});

class Late {
  first = 1;
  late!: { x: number };
  other!: string;
  more!: number[];
  last = 2;
  take(given: any) {
    Object.assign(this, given);
  }
}
say("fields without initializer are filled where they stand", () => {
  const late = new Late();
  const before = Object.keys(late).join();
  late.take({ more: [1], late: { x: 1 } });
  const between = [Object.keys(late).join(), late.late, late.other, late.more];
  late.take({ other: "o", late: { x: 2 }, more: undefined });
  return [before, between, Object.keys(late).join(), late.late, late.other, late.more];
});
say("one of them deleted, then assigned", () => {
  const late = new Late();
  delete (late as any).late;
  delete (late as any).other;
  const without = Object.keys(late).join();
  late.take({ other: "back", late: { x: 3 } });
  return [without, Object.keys(late).join(), late.late, late.other];
});
say("many of them", () => {
  let total = 0;
  for (let i = 0; i < 3000; i++) {
    const late = new Late();
    if (i % 7 === 0) delete (late as any).late;
    late.take(i & 1 ? { late: { x: i }, other: "s" } : { more: [i, i], late: { x: 1 } });
    total += late.late.x + (late.other?.length ?? 0) + (late.more?.length ?? 0) + Object.keys(late).indexOf("late");
  }
  return total;
});
