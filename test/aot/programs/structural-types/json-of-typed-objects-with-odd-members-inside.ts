interface Inner {
  n: number;
  s: string;
}

interface Outer {
  id: number;
  first: Inner;
  second: Inner;
  list: Inner[];
  extra?: Inner;
}

const log: string[] = [];

class Instance {
  s = "instance";
  hidden = true;
  n = 3;
}

function watched(name: string): Inner {
  return {
    get n() {
      log.push(name + ".n");
      return 4;
    },
    get s() {
      log.push(name + ".s");
      return "watched";
    },
  };
}

function withToJSON(name: string): Inner {
  const made = {
    n: 5,
    s: "toJSON",
    toJSON(key: string) {
      log.push(name + ".toJSON(" + key + ")");
      return { replaced: true };
    },
  };
  return made;
}

const defaults: Inner = { n: 0, s: "" };
const holes: Partial<Inner> = { n: undefined };

function forms(name: string): [string, Inner][] {
  const wide = { a: 1, s: "wide", b: [2], n: 2, c: null };
  return [
    ["honest", { n: 1, s: "honest" }],
    ["another order", { s: "flipped", n: 1 }],
    ["wider", wide],
    ["an instance", new Instance()],
    ["getters", watched(name)],
    ["toJSON", withToJSON(name)],
    ["inherited", Object.create({ n: 6, s: "inherited" })],
    ["n is hidden", Object.defineProperty({ n: 7, s: "hidden" }, "n", { enumerable: false })],
    ["n is undefined", { ...defaults, ...holes }],
    ["not a number", { n: NaN, s: "nan" }],
    ["minus zero", { n: -0, s: "zero" }],
    ["infinity", { n: -Infinity, s: "inf" }],
    ["a large number", { n: 1e21, s: "large" }],
    ["a small number", { n: 1.5e-7, s: "small" }],
    ["text to escape", { n: 8, s: "quote \" slash \\ line \n tab \t nul \u0000 del \u007f" }],
    ["half a pair", { n: 9, s: "\ud800 and \udc00" }],
    ["other scripts", { n: 10, s: "é 中 😀  " }],
    ["a proxy", new Proxy({ n: 11, s: "proxy" }, {})],
  ];
}

function stringify(o: Outer): string {
  return JSON.stringify(o);
}

function flush(label: string, value: string): void {
  console.log(label + ": " + value + " [" + log.join(" ") + "]");
  log.length = 0;
}

const honest: Outer = { id: 1, first: { n: 1, s: "a" }, second: { n: 2, s: "b" }, list: [{ n: 3, s: "c" }] };
let length = 0;
for (let i = 0; i < 2000; i++) length += stringify(honest).length;
flush("2000 honest", String(length));

for (const [label, inner] of forms("second")) {
  flush(label + ", after a watched member", stringify({ id: 2, first: watched("first"), second: inner, list: [] }));
}
for (const [label, inner] of forms("first")) {
  flush(label + ", before a watched member", stringify({ id: 3, first: inner, second: watched("second"), list: [] }));
}
for (const [label, inner] of forms("element")) {
  flush(label + ", in the list", stringify({ id: 4, first: honest.first, second: honest.second, list: [honest.first, inner, watched("last")] }));
}
for (const [label, inner] of forms("extra")) {
  flush(label + ", as the optional member", stringify({ id: 5, first: honest.first, second: honest.second, list: [], extra: inner }));
}

flush("the optional member is undefined", stringify({ id: 6, first: honest.first, second: honest.second, list: [], extra: undefined }));
flush("the outer object in another order", stringify({ list: [], second: honest.second, first: honest.first, id: 7 }));
flush("indented", JSON.stringify({ ...honest, second: watched("second") }, null, 1).replaceAll("\n", "~"));
flush("an allow list", JSON.stringify(honest, ["id", "second", "s"]));
flush("a replacer", JSON.stringify(honest, (key, value: unknown) => (key === "n" ? "n!" : value)));

interface Tree {
  name: string;
  kids: Tree[];
}
const tree: Tree = { name: "root", kids: [{ name: "leaf", kids: [] }] };
flush("a tree", JSON.stringify(tree));
tree.kids[0].kids.push(tree);
try {
  flush("a cycle", JSON.stringify(tree));
} catch (error) {
  flush("a cycle", "threw " + (error instanceof Error ? error.constructor.name : typeof error));
}

export {};
