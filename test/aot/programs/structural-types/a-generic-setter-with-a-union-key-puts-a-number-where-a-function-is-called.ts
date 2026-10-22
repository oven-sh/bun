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

interface Button {
  width: number;
  title: string;
  press: () => number;
  rename: (title: string) => string;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function describe(b: Button): string {
  return typeof b.width + " " + show(b.width) + ", " + typeof b.title + " " + show(b.title) + ", " + typeof b.press + ", " + typeof b.rename + ", keys " + Object.keys(b).join() + ", " + JSON.stringify(b);
}

function pressIt(b: Button): number {
  return b.press();
}

function pressTwice(b: Button): number {
  const press = b.press;
  return press() + press();
}

const yes: boolean = process.argv.length > 0;

const button: Button = { width: 10, title: "ok", press: () => 1, rename: title => title + "!" };
console.log("before: " + describe(button) + " " + pressIt(button) + " " + pressTwice(button));

set(button, yes ? "press" : "width", 5);
console.log("a number is pressed: " + describe(button));
attempt("press()", () => button.press());
attempt("pressIt", () => pressIt(button));
attempt("pressTwice", () => pressTwice(button));
attempt("press.call", () => button.press.call(undefined));
attempt("press.name", () => button.press.name);
attempt("press.length", () => button.press.length);
attempt("press?.()", () => button.press?.());
attempt("handed to map", () => [1, 2].map(button.press));

set(button, yes ? "press" : "title", "text");
console.log("a string is pressed: " + describe(button));
attempt("press()", () => button.press());
attempt("pressIt", () => pressIt(button));
attempt("press.length", () => button.press.length);

set(button, yes ? "press" : "rename", title => title + "?");
console.log("the other function is pressed: " + describe(button));
attempt("press()", () => button.press());
attempt("press() + 1", () => button.press() + 1);
attempt("pressIt", () => pressIt(button));
attempt("pressTwice", () => pressTwice(button));

set(button, yes ? "width" : "press", () => 9);
console.log("a function is the width: " + describe(button));
attempt("width * 2", () => button.width * 2);
attempt("typeof (width + 1)", () => typeof (button.width + 1));
attempt("width.toFixed", () => button.width.toFixed(0));
attempt("width === width", () => button.width === button.width);

set(button, "press", () => 2);
set(button, "width", 3);
console.log("honest again: " + describe(button) + " " + pressIt(button) + " " + pressTwice(button) + " " + button.width * 2);

export {};
