function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

type Scores = Record<"home" | "away", number>;

function total(s: Scores): number {
  return s.home + s.away;
}

function report(title: string, s: Scores): void {
  console.log(title + ": " + typeof s.home + " " + show(s.home) + ", " + typeof s.away + " " + show(s.away) + ", keys " + Object.keys(s).join() + ", " + JSON.stringify(s));
  attempt("  total", () => total(s));
  attempt("  home * 2", () => s.home * 2);
  attempt("  away.toFixed(1)", () => s.away.toFixed(1));
  attempt("  'away' in it", () => "away" in s);
}

const scores: Scores = { home: 1, away: 2 };
let sum = 0;
for (let i = 0; i < 2000; i++) {
  scores.home = i;
  scores.away = i / 2;
  sum += total(scores);
}
console.log("2000 honest rounds: " + sum);
report("honest", scores);

const wider: Record<string, number | string> = scores;
wider.home = "text";
report("a string through a wider record", scores);
wider["away"] = "3";
report("and another by a computed name", scores);
wider.extra = 9;
report("a key the type never had", scores);
delete wider.away;
report("a required key is deleted", scores);
wider.away = 4;
wider.home = 5;
report("both are stored again: another order", scores);

const byNumber: Record<string, number> = scores;
for (const key in byNumber) byNumber[key] += 0.5;
report("every member through an index signature", scores);
for (const key of ["home", "away", "missing"]) byNumber[key]++;
report("and one that is not there", scores);

const optional: Partial<Scores> = scores;
optional.home = undefined;
report("undefined through a partial view", scores);
delete optional.home;
report("deleted through a partial view", scores);

export {};
