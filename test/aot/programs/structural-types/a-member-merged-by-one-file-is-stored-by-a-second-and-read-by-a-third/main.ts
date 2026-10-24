import { Account } from "./account.ts";
import { half, opened } from "./fill.ts";
import { balanceOf, line } from "./report.ts";

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

show("the first call gets a bare one", () => balanceOf(new Account(1)));
let sum = 0;
for (let i = 0; i < 2000; i++) sum += balanceOf(opened(i)) + line(opened(i)).length;
show("2000 that were filled", () => sum);

show("a filled one", () => [balanceOf(opened(2)), line(opened(2)), Object.keys(opened(2))]);
show("a bare one: balance", () => balanceOf(new Account(1)));
show("a bare one: line", () => line(new Account(1)));
show("a bare one: keys", () => Object.keys(new Account(1)));
show("a half filled one: balance", () => balanceOf(half(1)));
show("a half filled one: line", () => line(half(1)));
show("a half filled one: keys", () => Object.keys(half(1)));
show("balances of three", () => [opened(2), new Account(3), half(4)].map(balanceOf));
show("balances added", () => [opened(2), new Account(3), half(4)].reduce((total, account) => total + balanceOf(account), 0));
show("JSON of three", () => JSON.stringify([opened(2), new Account(3), half(4)]));
show("a filled one again", () => [balanceOf(opened(4)), line(opened(4))]);
