interface Slot {
  n: number;
  s: string;
  maybe: number | null;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const makers: [string, () => Slot][] = [
  ["open", () => ({ n: 1, s: "s", maybe: null })],
  ["frozen", () => Object.freeze({ n: 1, s: "s", maybe: null })],
  [
    "not writable",
    () =>
      Object.defineProperties({ n: 1, s: "s", maybe: null }, {
        n: { writable: false },
        s: { writable: false },
        maybe: { writable: false },
      }),
  ],
  [
    "getters only",
    () => ({
      get n() {
        return 1;
      },
      get s() {
        return "s";
      },
      get maybe() {
        return null;
      },
    }),
  ],
  ["inherited from a frozen object", () => Object.create(Object.freeze({ n: 1, s: "s", maybe: null }))],
];

const stores: [string, (o: Slot) => unknown][] = [
  ["=", o => (o.n = 2)],
  ["= the same value", o => (o.n = 1)],
  ["+=", o => (o.n += 2)],
  ["-=", o => (o.n -= 2)],
  ["*=", o => (o.n *= 2)],
  ["|=", o => (o.n |= 2)],
  ["prefix ++", o => ++o.n],
  ["postfix ++", o => o.n++],
  ["postfix --", o => o.n--],
  ["string +=", o => (o.s += "t")],
  ["||= on a truthy member", o => (o.n ||= 5)],
  ["&&= on a truthy member", o => (o.n &&= 5)],
  ["??= on a number", o => (o.n ??= 5)],
  ["??= on null", o => (o.maybe ??= 5)],
  ["||= on null", o => (o.maybe ||= 5)],
  ["&&= on null", o => (o.maybe &&= 5)],
  ["array pattern", o => ([o.n] = [7])],
  ["object pattern", o => ({ n: o.n } = { n: 8 })],
  ["pattern with a default", o => ([o.n = 9] = [])],
  [
    "for-of target",
    o => {
      for (o.n of [10, 11]);
      return o.n;
    },
  ],
  [
    "for-in target",
    o => {
      for (o.s in { key: 1 });
      return o.s;
    },
  ],
  ["computed name", o => (o["n"] = 12)],
  ["Object.assign", o => Object.assign(o, { n: 13 }).n],
  ["Reflect.set", o => Reflect.set(o, "n", 14)],
];

for (const [kind, make] of makers) {
  for (const [name, store] of stores) {
    const o = make();
    attempt(kind + ", " + name, () => store(o));
    console.log("  holds " + o.n + " " + o.s + " " + o.maybe + " own " + Object.keys(o).join());
  }
}

export {};
