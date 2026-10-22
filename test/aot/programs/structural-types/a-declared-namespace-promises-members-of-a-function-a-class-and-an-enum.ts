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

function greet(who: string): string {
  return "hello " + who;
}
declare namespace greet {
  const times: number;
  let punctuation: string;
  function loudly(who: string): string;
}

class Engine {
  power: number = 1;
  boosted(): number {
    return this.power * Engine.factor;
  }
}
declare namespace Engine {
  const factor: number;
  const parts: string[];
  function build(): Engine;
}

enum Size {
  Small,
  Large,
}
declare namespace Size {
  const preferred: Size;
  function parse(text: string): Size;
}

function timesOf(): number {
  return greet.times;
}

show("the function: it runs", () => greet("ann"));
show("the function: the number", () => [greet.times, typeof greet.times, timesOf()]);
show("the function: the number plus one", () => [greet.times + 1, timesOf() * 2]);
show("the function: the text", () => greet.punctuation);
show("the function: the length of the text", () => greet.punctuation.length);
show("the function: the helper", () => typeof greet.loudly);
show("the function: the helper called", () => greet.loudly("ann"));
show("the function: keys", () => Object.keys(greet));
show("the function: in", () => "times" in greet);
greet.punctuation = "!";
show("the function: after a store", () => [greet.punctuation, greet.punctuation.length, Object.keys(greet)]);

show("the class: the number", () => [Engine.factor, typeof Engine.factor, Engine.factor + 1]);
show("the class: in a method", () => new Engine().boosted());
show("the class: the list", () => Engine.parts);
show("the class: the length of the list", () => Engine.parts.length);
show("the class: the helper called", () => Engine.build());
show("the class: keys", () => Object.keys(Engine));

show("the enum: the member", () => [Size.preferred, typeof Size.preferred, Size.preferred === Size.Small]);
show("the enum: its name", () => Size[Size.preferred]);
show("the enum: the helper called", () => Size.parse("Small"));
show("the enum: keys", () => Object.keys(Size));
show("the enum: the real members", () => [Size.Small, Size.Large, Size[1]]);

let nans = 0;
for (let i = 0; i < 2000; i++) if (Number.isNaN(new Engine().boosted()) && Number.isNaN(timesOf() + i)) nans++;
show("2000 rounds", () => nans);
