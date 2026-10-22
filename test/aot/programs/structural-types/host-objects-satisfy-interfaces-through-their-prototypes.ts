function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function listing(o: object): string {
  const walked: string[] = [];
  for (const key in o) walked.push(key);
  return "keys[" + Object.keys(o).join() + "] for-in[" + walked.join() + "] json " + JSON.stringify(o) + " spread " + JSON.stringify({ ...o });
}

interface Located {
  host: string;
  pathname: string;
}

function where(l: Located): string {
  return l.host + l.pathname;
}

function moveTo(l: Located, host: string): string {
  l.host = host;
  return l.host;
}

const plainLocation: Located = { host: "plain", pathname: "/p" };
const url = new URL("http://example.test/a/b?c=1");
let length = 0;
for (let i = 0; i < 2000; i++) length += where(plainLocation).length;
console.log("2000 plain: " + length);
console.log("a URL: " + where(url) + " own " + Object.hasOwn(url, "host") + " in " + ("host" in url));
console.log("a URL listed: keys[" + Object.keys(url).join() + "] json " + JSON.stringify(url) + " spread " + JSON.stringify({ ...url }));
console.log("a URL stored to: " + moveTo(url, "other.test") + " " + url.href);
attempt("an object that inherits from a URL", () => where(Object.create(url)));

interface Sized {
  size: number;
}

function size(s: Sized): number {
  return s.size;
}

const sized: [string, Sized][] = [
  ["plain", { size: 1 }],
  ["a map", new Map([[1, 2], [3, 4]])],
  ["a set", new Set([1, 2, 3])],
  ["a blob", new Blob(["abcd"])],
  ["inherits from a map", Object.create(new Map())],
  ["inherits from Map.prototype", Object.create(Map.prototype)],
];
for (const [label, s] of sized) {
  attempt(label + ", size", () => size(s));
  attempt(label + ", own", () => Object.hasOwn(s, "size") + " " + ("size" in s));
  attempt(label + ", stored", () => {
    s.size = 9;
    return size(s);
  });
}

interface Failure {
  name: string;
  message: string;
}

function headline(f: Failure): string {
  return f.name + ": " + f.message;
}

class Custom extends Error {
  name = "Custom";
}

const failures: [string, Failure][] = [
  ["plain", { name: "plain", message: "m" }],
  ["an error", new Error("e")],
  ["a range error", new RangeError("r")],
  ["a subclass with a name field", new Custom("c")],
  ["an error without a message", new Error()],
];
for (const [label, f] of failures) {
  console.log(label + ": " + headline(f) + " own " + Object.hasOwn(f, "name") + " " + Object.hasOwn(f, "message"));
  console.log(label + ": keys[" + Object.keys(f).join() + "] json " + JSON.stringify(f) + " spread " + JSON.stringify({ ...f }));
}
const renamed: Failure = new TypeError("t");
renamed.name = "Renamed";
console.log("a name stored on an error: " + headline(renamed) + " " + Object.hasOwn(renamed, "name") + " " + new TypeError("u").name + " " + String(renamed));

interface Labeled {
  name: string;
  length: number;
}

function label(l: Labeled): string {
  return l.name + "/" + l.length;
}

function two(a: number, b: number): number {
  return a + b;
}

const labeled: [string, Labeled][] = [
  ["plain", { name: "plain", length: 1 }],
  ["a function", two],
  ["a class", class Named { constructor(a: number) { void a; } }],
  ["an arrow", (a: number) => a],
  ["a bound function", two.bind(null, 1)],
];
for (const [name, l] of labeled) {
  console.log(name + ": " + label(l) + " " + listing(l));
  attempt(name + ", name stored", () => {
    l.name = "stored";
    return l.name;
  });
  attempt(name + ", length stored", () => {
    l.length = 5;
    return l.length;
  });
}

interface Matched {
  index: number;
  input: string;
  0: string;
}
const match = /b(c)/.exec("abcd");
if (match !== null) {
  const m: Matched = match;
  console.log("a match: " + m.index + " " + m.input + " " + m[0] + " " + Object.keys(m).join() + " " + JSON.stringify(m));
}

export {};
