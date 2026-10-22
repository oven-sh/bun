function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

type Kind = "number" | "word";

class Token {
  constructor(
    public kind: Kind,
    public text: string,
  ) {}
  value(): number {
    return this.kind === "number" ? Number(this.text) : this.text.length;
  }
}

class Leaf {
  readonly kind = "leaf";
  constructor(public value: number) {}
}

class Branch {
  readonly kind = "branch";
  constructor(
    public left: Tree,
    public right: Tree,
  ) {}
}

type Tree = Leaf | Branch;

function sum(t: Tree): number {
  return t.kind === "leaf" ? t.value : sum(t.left) + sum(t.right);
}

function describe(t: Token): string {
  switch (t.kind) {
    case "number":
      return "number " + t.value();
    case "word":
      return "word " + t.value();
  }
}

function otherKind(): Kind {
  const box: { kind: Kind } = { kind: "word" };
  const open: { kind: string } = box;
  open.kind = "other";
  return box.kind;
}

attempt("honest", () => [describe(new Token("number", "12")), describe(new Token("word", "abc")), sum(new Branch(new Leaf(1), new Branch(new Leaf(2), new Leaf(3))))]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += new Token(i & 1 ? "number" : "word", "12").value() + describe(new Token("word", "ab")).length + sum(new Branch(new Leaf(i), new Leaf(1)));
console.log("2000 honest rounds", warm);

attempt("stored to by its own type", () => {
  const t = new Token("number", "12");
  const before = describe(t);
  t.kind = "word";
  return [before, describe(t), JSON.stringify(t)];
});
attempt("stored to in a loop", () => {
  const t = new Token("number", "12");
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    t.kind = i & 1 ? "word" : "number";
    seen.push(describe(t));
  }
  return seen;
});
attempt("constructed with a tag outside the type", () => {
  const t = new Token(otherKind(), "12");
  return [t.kind, t.value(), describe(t), JSON.stringify(t)];
});
attempt("stored a tag outside the type", () => {
  const t = new Token("number", "12");
  t.kind = otherKind();
  return [t.kind, t.value(), describe(t)];
});
attempt("retagged by Reflect.set", () => {
  const t = new Token("number", "12");
  Reflect.set(t, "kind", "word");
  return describe(t);
});
attempt("retagged by Object.assign", () => describe(Object.assign(new Token("number", "12"), { kind: "word" })));
attempt("the tag becomes a getter", () => {
  const t = new Token("number", "12");
  let reads = 0;
  Object.defineProperty(t, "kind", { get: () => (reads++ & 1 ? "word" : "number") });
  return [describe(t), describe(t), t.value(), t.value()];
});
attempt("the tag is deleted", () => {
  const t = new Token("number", "12");
  Reflect.deleteProperty(t, "kind");
  return [t.kind, t.value(), describe(t), Object.keys(t)];
});
attempt("a read-only tag is stored to through a view", () => {
  const leaf = new Leaf(5);
  const open: { kind: string } = leaf;
  open.kind = "branch";
  return [leaf.kind, JSON.stringify(leaf)];
});
attempt("a leaf that says it is a branch", () => {
  const leaf = new Leaf(5);
  const open: { kind: string } = leaf;
  open.kind = "branch";
  return sum(leaf);
});
attempt("a branch that says it is a leaf", () => {
  const branch = new Branch(new Leaf(1), new Leaf(2));
  const open: { kind: string } = branch;
  open.kind = "leaf";
  return [sum(branch), typeof sum(branch)];
});
attempt("deep in a tree", () => {
  const odd = new Leaf(5);
  const tree = new Branch(new Leaf(1), new Branch(odd, new Leaf(2)));
  const before = sum(tree);
  const open: { kind: string } = odd;
  open.kind = "twig";
  let after: unknown;
  try {
    after = sum(tree);
  } catch (error) {
    after = error instanceof Error ? error.constructor.name : "other";
  }
  return [before, after];
});
attempt("a literal stands for a leaf and for a branch", () => {
  const fakeLeaf: Leaf = { kind: "leaf", value: 10 };
  const fakeBranch: Branch = { kind: "branch", left: fakeLeaf, right: new Leaf(1) };
  return [sum(fakeLeaf), sum(fakeBranch), fakeLeaf instanceof Leaf];
});
attempt("a subclass with the same tag", () => {
  class Heavy extends Leaf {
    weight = 100;
  }
  return sum(new Branch(new Heavy(1), new Leaf(2)));
});
attempt("honest again", () => [describe(new Token("number", "12")), describe(new Token("word", "abc")), sum(new Branch(new Leaf(1), new Leaf(3)))]);
