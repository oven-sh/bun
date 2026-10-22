function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

interface AsNumber {
  as: "number";
}
interface AsText {
  as: "text";
}
interface AsList {
  as: "list";
}

function convert(value: string, how: AsNumber): number;
function convert(value: string, how: AsText): string;
function convert(value: string, how: AsList): string[];
function convert(value: string, how: AsNumber | AsText | AsList): number | string | string[] {
  switch (how.as) {
    case "number":
      return Number(value);
    case "text":
      return value + "!";
    case "list":
      return value.split("");
  }
}

const toNumber: AsNumber = { as: "number" };
const toText: AsText = { as: "text" };
const toList: AsList = { as: "list" };

attempt("honest number", () => convert("12", toNumber) + 1);
attempt("honest text", () => convert("12", toText).length);
attempt("honest list", () => convert("12", toList).join("+"));

let warm = 0;
for (let i = 0; i < 2000; i++) warm += convert("3", toNumber) + convert("ab", toText).length + convert("abc", toList).length;
console.log("2000 honest rounds: " + warm);

const loose: { as: string } = toNumber;

loose.as = "text";
attempt("typed number, really text", () => text(convert("12", toNumber)));
attempt("plus one", () => convert("12", toNumber) + 1);
attempt("times two", () => convert("12", toNumber) * 2);
attempt("toFixed", () => convert("12", toNumber).toFixed(1));

loose.as = "list";
attempt("typed number, really a list", () => text(convert("12", toNumber)));
attempt("plus one", () => convert("12", toNumber) + 1);
attempt("kept in a number[]", () => {
  const kept: number[] = [convert("12", toNumber), 1];
  return kept.map(n => typeof n).join() + " " + JSON.stringify(kept);
});

loose.as = "nothing the switch knows";
attempt("typed number, really nothing", () => text(convert("12", toNumber)));
attempt("plus one", () => convert("12", toNumber) + 1);

loose.as = "number";
attempt("back to a number", () => convert("12", toNumber) + 1);

function flagged(raw: true): number[];
function flagged(raw: false): string;
function flagged(raw: boolean): number[] | string {
  return raw ? [1, 2] : "text";
}
attempt("true", () => flagged(true).length);
attempt("false", () => flagged(false).toUpperCase());

function level(n: 0): "off";
function level(n: 1): "on";
function level(n: 0 | 1): "off" | "on" {
  return n === 0 ? "off" : "on";
}
const levels: { n: 0 } = { n: 0 };
const looseLevels: { n: number } = levels;
looseLevels.n = 1;
attempt("a numeric literal was changed", () => {
  const result: "off" = level(levels.n);
  return result + " " + (result === "off");
});
looseLevels.n = 0.5;
attempt("to a fraction", () => level(levels.n));

type Route = `/${string}`;
function open(route: Route): string;
function open(route: number): number;
function open(route: Route | number): string | number {
  return typeof route === "number" ? route + 1 : route.slice(1);
}
const routes: { home: Route } = { home: "/home" };
const looseRoutes: { home: string } = routes;
looseRoutes.home = "no slash";
attempt("a template literal type was changed", () => open(routes.home));
