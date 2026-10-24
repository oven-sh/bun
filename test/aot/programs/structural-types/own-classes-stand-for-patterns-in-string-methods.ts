const log: string[] = [];

class Vowels {
  [Symbol.replace](text: string, replacement: string): string {
    log.push("replace");
    return text
      .split("")
      .map(c => ("aeiou".includes(c) ? replacement : c))
      .join("");
  }
  [Symbol.search](text: string): number {
    log.push("search");
    for (let i = 0; i < text.length; i++) if ("aeiou".includes(text[i])) return i;
    return -1;
  }
  [Symbol.split](text: string, limit?: number): string[] {
    log.push("split " + limit);
    return [text.slice(0, 1), text.slice(1)];
  }
  [Symbol.match](text: string): RegExpMatchArray | null {
    log.push("match");
    return text.match("e");
  }
}

function replaceIn(text: string, v: Vowels): string {
  return text.replace(v, "*");
}

function all(text: string, v: Vowels): string {
  const found = text.match(v);
  return [replaceIn(text, v), text.search(v), text.split(v).join("|"), text.split(v, 1).join("|"), found === null ? "null" : found[0] + "@" + found.index].join(" ");
}

function round(label: string, v: Vowels): void {
  log.length = 0;
  console.log(label + ": " + all("hello", v) + " [" + log.join(", ") + "]");
}

const v = new Vowels();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += replaceIn("hello", v).length + "hello".search(v);
console.log("2000 honest: " + warm);
round("the class's methods", v);

v[Symbol.replace] = (text, replacement) => "own " + text + replacement;
v[Symbol.search] = () => 42;
v[Symbol.split] = () => ["own"];
v[Symbol.match] = () => null;
round("own members", v);
round("another instance", new Vowels());

for (const key of Object.getOwnPropertySymbols(v)) Reflect.deleteProperty(v, key);
round("uncovered", v);

const replace = Vowels.prototype[Symbol.replace];
Vowels.prototype[Symbol.replace] = () => "patched";
round("replace patched on the prototype", v);
Vowels.prototype[Symbol.replace] = replace;
round("put back", v);

class Shouting extends RegExp {
  exec(text: string): RegExpExecArray | null {
    log.push("exec of the subclass");
    return super.exec(text.toLowerCase());
  }
}

function regular(label: string, r: RegExp): void {
  log.length = 0;
  console.log(label + ": " + [r.test("HELLO"), "HELLO".replace(r, "_"), "HELLO".search(r), "HELLO".split(r).join("|"), String("HELLO".match(r))].join(" ") + " [" + log.length + " " + [...new Set(log)].join() + "]");
}

regular("a plain regular expression", /l+/);
regular("a subclass that overrides exec", new Shouting("l+"));

const own = /l+/;
own.exec = text => {
  log.push("own exec");
  return null;
};
regular("an instance with an exec of its own", own);
Reflect.deleteProperty(own, "exec");
regular("removed", own);

const test = /l+/;
test.test = () => {
  log.push("own test");
  return true;
};
regular("an instance with a test of its own", test);

export {};
