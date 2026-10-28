// Texts that would pass the longest text there can be are made in functions with declared types, and nobody reads them.
function double(text: string, times: number): string {
  for (let i = 0; i < times; i++) text += text;
  return text;
}
const half: string = double("x", 30);
function say(name: string, make: (a: string, b: string) => void): void {
  let seen = "";
  for (let turn = 0; turn < 2; turn++) {
    try {
      make(half, half);
      seen += " no error";
    } catch (error) {
      seen += " " + (error as Error).constructor.name;
    }
  }
  console.log(name + seen);
}
function plus(a: string, b: string): string {
  return a + b;
}
function template(a: string, b: string): string {
  return `${a}|${b}`;
}
function concat(a: string, b: string): string {
  return a.concat(b);
}
function join(a: string, b: string): string {
  return [a, b].join("");
}
function joinList(list: string[]): string {
  return list.join(",");
}
class Pair {
  constructor(
    public first: string,
    public second: string,
  ) {}
  get both(): string {
    return this.first + this.second;
  }
  text(): string {
    return this.first + ":" + this.second;
  }
}
say("plus", (a, b) => {
  plus(a, b);
});
say("template", (a, b) => {
  template(a, b);
});
say("concat", (a, b) => {
  concat(a, b);
});
say("join", (a, b) => {
  join(a, b);
});
say("join of a list", (a, b) => {
  joinList([a, b]);
});
say("getter", (a, b) => {
  new Pair(a, b).both;
});
say("method", (a, b) => {
  new Pair(a, b).text();
});
say("statement plus", (a, b) => {
  a + b;
});
say("statement concat", (a, b) => {
  a.concat(b);
});
say("statement join", (a, b) => {
  [a, b].join("");
});
say("statement template", (a, b) => {
  `${a}${b}`;
});
say("statement String.raw", (a, b) => {
  String.raw`${a}${b}`;
});
say("statement replace", (a, b) => {
  "<>".replace("<", a).replace(">", b);
});
say("statement replaceAll", (a, b) => {
  "<><>".replaceAll("<", a);
});
say("statement repeat", (a, b) => {
  a.repeat(2);
});
say("statement padEnd", (a, b) => {
  a.padEnd(2 ** 31, b);
});
say("statement anchor", (a, b) => {
  a.anchor(b);
});
say("one character too many", (a, b) => {
  const text: string = a + b.slice(1) + "ab";
});
say("as long as a text may be", (a, b) => {
  const text: string = a + b.slice(1);
});
