import "./declarations.ts";
import { install, installHonest, remove } from "./setup.ts";
import { limitPlusOne, pointSum, titleLength, twiceOf } from "./uses.ts";

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

function all(label: string): void {
  show(label + ": typeof", () => [typeof sharedLimit, typeof sharedTitle, typeof sharedPoint, typeof sharedTwice, typeof sharedNever]);
  show(label + ": the number by name", () => sharedLimit);
  show(label + ": the number through globalThis", () => globalThis.sharedLimit);
  show(label + ": the number plus one", () => limitPlusOne());
  show(label + ": the length of the text", () => titleLength());
  show(label + ": the point", () => pointSum());
  show(label + ": the function", () => [twiceOf(2), typeof twiceOf(2)]);
  show(label + ": the one nobody sets, by name", () => sharedNever);
  show(label + ": the one nobody sets, through globalThis", () => [globalThis.sharedNever, globalThis.sharedNever + 1]);
}

all("before");
installHonest();
all("honest");
let sum = 0;
for (let i = 0; i < 2000; i++) sum += limitPlusOne() + titleLength() + pointSum() + twiceOf(i);
show("2000 honest rounds", () => sum);
install();
all("other types");
remove();
all("removed");
installHonest();
all("honest again");
