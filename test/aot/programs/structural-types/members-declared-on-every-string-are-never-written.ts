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

declare global {
  interface String {
    shout(): string;
    width: number;
    tail: string;
  }
}

function shoutOf(s: string): string {
  return s.shout();
}

function widthOf(s: string): number {
  return s.width;
}

function lengthOf(s: string): number {
  return s.length;
}

const word = "word";
show("typeof the method", () => typeof word.shout);
show("called", () => word.shout());
show("called on a literal", () => "abc".shout());
show("called on a template", () => `a${word}`.shout());
show("called on a sum", () => (word + "s").shout());
show("called if there", () => word.shout?.());
show("its result used", () => word.shout().length);
show("through a function", () => shoutOf(word));
show("the number", () => [word.width, typeof word.width]);
show("the number plus one", () => word.width + 1);
show("the number through a function", () => widthOf(word));
show("the number beside the real one", () => widthOf(word) + lengthOf(word));
show("the text", () => word.tail);
show("the text followed by a string", () => word.tail + "!");
show("the length of the text", () => word.tail.length);
show("on a String object", () => [new String("s").width, typeof new String("s").shout]);
show("on the prototype", () => "shout" in String.prototype);
show("what every string really has still works", () => [word.toUpperCase(), lengthOf(word), word.at(-1), word.slice(1)]);

let failures = 0;
let sum = 0;
for (let i = 0; i < 2000; i++) {
  sum += lengthOf(word);
  if (widthOf(word) === undefined) sum++;
  try {
    sum += shoutOf(word).length;
  } catch {
    failures++;
  }
}
show("2000 rounds", () => [sum, failures]);
show("a store to it throws", () => {
  word.width = 5;
  return word.width;
});

export {};
