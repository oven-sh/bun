interface Themed {
  name: string;
  color?: string;
  weight?: number;
}

class Button {
  name = "button";
}

class Link {
  name = "link";
  color?: string;
}

function color(t: Themed): string {
  return t.color ?? "no color";
}

function weight(t: Themed): number {
  return (t.weight ?? 0) + 1;
}

function facts(t: Themed): string {
  return [color(t), weight(t), "color" in t, Object.hasOwn(t, "color"), Object.keys(t).join("+"), JSON.stringify(t), JSON.stringify({ ...t })].join(" | ");
}

const button = new Button();
const link = new Link();
const literal: Themed = { name: "literal" };
const bare: Themed = Object.assign(Object.create(null), { name: "bare" });

function all(label: string): void {
  console.log(label + ", button: " + facts(button));
  console.log(label + ", link: " + facts(link));
  console.log(label + ", literal: " + facts(literal));
  console.log(label + ", no prototype: " + facts(bare));
}

let length = 0;
for (let i = 0; i < 2000; i++) length += color(button).length + weight(button) + color(literal).length;
console.log("2000 reads that find nothing: " + length);
all("at first");

Object.assign(Button.prototype, { color: "red", weight: 5 });
all("Button.prototype has them");

Object.assign(Link.prototype, { color: "blue" });
all("Link.prototype has one, under an own undefined");

Reflect.deleteProperty(Button.prototype, "color");
all("taken away again");

Object.defineProperty(Button.prototype, "weight", {
  get() {
    return 40;
  },
  configurable: true,
});
all("a getter on Button.prototype");

const themedButton: Themed = button;
themedButton.color = "own";
console.log("an own one: " + facts(button));
delete themedButton.color;
console.log("deleted: " + facts(button));

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

attempt("a store under a getter without a setter", () => {
  themedButton.weight = 1;
  return weight(button);
});

Object.setPrototypeOf(literal, { color: "adopted", weight: 2 });
console.log("the literal got a prototype: " + facts(literal));

export {};
