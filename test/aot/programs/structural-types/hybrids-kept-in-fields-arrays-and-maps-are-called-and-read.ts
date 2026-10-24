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

interface Rule {
  (value: number): boolean;
  title: string;
  weight: number;
}

function rule(title: string, weight: number, test: (value: number) => boolean): Rule {
  return Object.assign((value: number) => test(value), { title, weight });
}

const positive = rule("positive", 1, v => v > 0);
const even = rule("even", 2.5, v => v % 2 === 0);
const small = rule("small", 4, v => v < 10);
const boundRule: Rule = Object.assign(positive.bind(null), { title: "bound", weight: 8 });
const proxyRule: Rule = new Proxy(even, {});
function declared(value: number): boolean {
  return value === declared.weight;
}
declared.title = "declared";
declared.weight = 16;

class Checker {
  main: Rule = positive;
  rules: Rule[] = [positive, even, small, boundRule, proxyRule, declared];
  byTitle = new Map<string, Rule>();
  constructor() {
    for (const r of this.rules) this.byTitle.set(r.title, r);
  }
  check(value: number): string {
    return this.rules.map(r => (r(value) ? r.title : "-")).join();
  }
  score(value: number): number {
    let total = 0;
    for (const r of this.rules) if (r(value)) total += r.weight;
    return total;
  }
  one(title: string, value: number): boolean | undefined {
    return this.byTitle.get(title)?.(value);
  }
  mainTitle(): string {
    return this.main.title + " " + this.main(1) + " " + this.main(-1);
  }
}

const checker = new Checker();
show("check 4", () => checker.check(4));
show("check 16", () => checker.check(16));
show("check -3", () => checker.check(-3));
show("score 4", () => checker.score(4));
show("score 16", () => checker.score(16));
show("one even 3", () => checker.one("even", 3));
show("one bound 3", () => checker.one("bound", 3));
show("one missing", () => checker.one("missing", 3));
show("main", () => checker.mainTitle());
checker.main = proxyRule;
show("main is the proxy", () => checker.mainTitle());
checker.main = boundRule;
show("main is the bound one", () => checker.mainTitle());
checker.main = declared;
show("main is the declared one", () => checker.mainTitle());

show("as a method, this is the checker", () => {
  const holder = {
    tag: "holder",
    run: Object.assign(
      function (this: { tag: string } | void): string {
        return this ? this.tag : "no this";
      },
      { title: "uses this" },
    ),
  };
  const bare = holder.run;
  return holder.run() + " " + bare() + " " + holder.run.title;
});
show("filter by a hybrid", () => [-2, -1, 0, 1, 2].filter(positive));
show("filter by the proxy", () => [-2, -1, 0, 1, 2].filter(proxyRule));
show("sorted by weight", () => [...checker.rules].sort((a, b) => b.weight - a.weight).map(r => r.title).join());
show("titles by destructuring", () => checker.rules.map(({ title }) => title).join());
show("names", () => checker.rules.map(r => r.name).join("|"));

even.weight = 100;
show("a store is seen through the proxy", () => proxyRule.weight);
proxyRule.title = "renamed through the proxy";
show("and the other way", () => even.title);

let total = 0;
for (let i = 0; i < 2000; i++) total += checker.score(i % 20);
show("2000 scores", () => total);
