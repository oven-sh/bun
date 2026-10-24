function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Answer {
  No = 0,
  Yes = "YES",
  Maybe = 2,
  Never = "",
}

function kindOf(answer: Answer): string {
  return typeof answer;
}

function nameOf(answer: Answer): string {
  switch (answer) {
    case Answer.No:
      return "no";
    case Answer.Yes:
      return "yes";
    case Answer.Maybe:
      return "maybe";
    case Answer.Never:
      return "never";
  }
}

function split(answer: Answer): string {
  if (typeof answer === "number") return "number " + show(answer + 1);
  return "string " + show(answer.length);
}

function truthy(answer: Answer): string {
  if (answer) return "truthy " + (answer === Answer.Yes ? "yes" : "maybe " + show(answer));
  return "falsy " + (answer === Answer.No ? "no" : "never " + show(answer));
}

class Vote {
  answer: Answer = Answer.No;
  constructor(answer: Answer) {
    this.answer = answer;
  }
  text(): string {
    return nameOf(this.answer) + ":" + split(this.answer);
  }
}

attempt("keys", () => Object.keys(Answer));
attempt("entries", () => Object.entries(Answer));
attempt("members", () => [Answer.No, Answer.Yes, Answer.Maybe, Answer.Never]);
attempt("reverse", () => [Answer[0], Answer[2], Answer[1]]);

const honest: Answer[] = [Answer.No, Answer.Yes, Answer.Maybe, Answer.Never];
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const answer = honest[i % 4];
  warm += kindOf(answer).length + nameOf(answer).length + split(answer).length + truthy(answer).length + new Vote(answer).text().length;
}
console.log("2000 honest rounds", warm);
for (const answer of honest) attempt("honest " + show(answer), () => [kindOf(answer), nameOf(answer), split(answer), truthy(answer), new Vote(answer).text()]);

const numbers: number[] = [1, 3, -0, 0.5, NaN, 2 ** 31, -1];
for (const n of numbers) {
  const answer: Answer = n;
  const label = show(n);
  attempt(label + " kind", () => kindOf(answer));
  attempt(label + " name", () => nameOf(answer));
  attempt(label + " split", () => split(answer));
  attempt(label + " truthy", () => truthy(answer));
  attempt(label + " in a field", () => new Vote(answer).text());
  attempt(label + " in a list", () => {
    const votes: Answer[] = [Answer.Yes, answer, Answer.Never];
    return [votes, votes.map(nameOf), votes.map(kindOf), votes.indexOf(answer), votes.includes(answer)];
  });
}
