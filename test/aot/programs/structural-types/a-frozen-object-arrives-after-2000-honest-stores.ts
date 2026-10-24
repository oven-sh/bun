interface Counter {
  count: number;
  name: string;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function set(c: Counter, value: number): void {
  c.count = value;
}

function increment(c: Counter): number {
  return ++c.count;
}

function rename(c: Counter, name: string): string {
  c.name = name;
  return c.name;
}

function fill(counters: Counter[], value: number): number {
  let done = 0;
  for (const c of counters) {
    c.count = value;
    done++;
  }
  return done;
}

const open: Counter = { count: 0, name: "open" };
for (let i = 0; i < 2000; i++) {
  set(open, i);
  increment(open);
  rename(open, "open");
}
console.log("2000 honest rounds: " + JSON.stringify(open));

const frozen: Counter = Object.freeze({ count: 0, name: "frozen" });
attempt("frozen, store", () => set(frozen, 1));
attempt("frozen, increment", () => increment(frozen));
attempt("frozen, a string store", () => rename(frozen, "thawed"));
console.log("frozen holds: " + JSON.stringify(frozen));
attempt("open again", () => (set(open, 5), increment(open)));
attempt("frozen again", () => set(frozen, 2));

const many: Counter[] = [];
for (let i = 0; i < 2000; i++) many.push({ count: 0, name: "n" + i });
attempt("2000 open elements", () => fill(many, 1));
Object.freeze(many[1500]);
attempt("one of them frozen", () => fill(many, 2));
console.log("around it: " + [1498, 1499, 1500, 1501].map(i => many[i].count).join());

const freezing: Counter = { count: 0, name: "freezing" };
attempt("frozen by a callee in the middle of a loop", () => {
  for (let i = 1; i <= 2000; i++) {
    set(freezing, i);
    if (i === 1000) Object.freeze(freezing);
  }
  return "finished";
});
console.log("it stopped at: " + freezing.count);

const direct: Counter = { count: 0, name: "direct" };
attempt("the same without a callee", () => {
  for (let i = 1; i <= 2000; i++) {
    direct.count = i;
    if (i === 1000) Object.freeze(direct);
  }
  return "finished";
});
console.log("it stopped at: " + direct.count);

function honestCaller(): number {
  const c: Counter = { count: 1, name: "honest" };
  set(c, 2);
  return c.count;
}

function frozenCaller(): number {
  const c: Counter = Object.freeze({ count: 1, name: "frozen" });
  set(c, 2);
  return c.count;
}

attempt("an honest caller", honestCaller);
attempt("a caller with a frozen object", frozenCaller);
attempt("call", () => set.call(undefined, frozen, 3));
attempt("apply", () => set.apply(undefined, [frozen, 3]));
attempt("bind", () => set.bind(undefined, frozen, 3)());
attempt("a built-in calls it", () => [open, frozen, open].forEach(c => set(c, 9)));
console.log("at the end: " + JSON.stringify([open, frozen]));

export {};
