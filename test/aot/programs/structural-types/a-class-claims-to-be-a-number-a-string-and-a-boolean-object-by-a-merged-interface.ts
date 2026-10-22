function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Amount extends Number {}
class Amount {
  id: number = 1;
}

interface Word extends String {}
class Word {
  id: number = 2;
}

interface Flag extends Boolean {}
class Flag {
  id: number = 3;
}

function valueOf(n: Number): number {
  return n.valueOf();
}

function fixed(n: Number): string {
  return n.toFixed(1);
}

function lengthOf(s: String): number {
  return s.length;
}

function upper(s: String): string {
  return s.toUpperCase();
}

function textOf(s: String): string {
  return s.valueOf();
}

function truth(b: Boolean): boolean {
  return b.valueOf();
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += valueOf(i) + fixed(i).length + lengthOf("ab") + upper("ab").length + textOf("c").length + (truth(true) ? 1 : 0);
show("2000 honest rounds", () => warm);

const amount = new Amount();
show("valueOf is typed number", () => typeof valueOf(amount));
show("valueOf is the object itself", () => Object.is(valueOf(amount), amount));
show("valueOf plus one", () => valueOf(amount) + 1);
show("valueOf times two", () => valueOf(amount) * 2);
show("toFixed", () => fixed(amount));
show("toString", () => amount.toString());
show("toLocaleString", () => amount.toLocaleString());

const word = new Word();
show("length", () => lengthOf(word));
show("length plus one", () => lengthOf(word) + 1);
show("toUpperCase", () => upper(word));
show("valueOf is typed string", () => typeof textOf(word));
show("valueOf followed by a string", () => textOf(word) + "!");
show("the length of valueOf", () => textOf(word).length);
show("first character", () => word[0]);
show("iterated", () => [...word]);

const flag = new Flag();
show("valueOf is typed boolean", () => typeof truth(flag));
show("valueOf as a condition", () => (truth(flag) ? "yes" : "no"));
show("valueOf equals true", () => truth(flag) === true);
show("honest again", () => [valueOf(5), fixed(5), lengthOf("abc"), upper("abc"), textOf("abc"), truth(false)]);
