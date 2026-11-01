import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The runner's native code rules most values out by the kind of their cell before it looks at them. An object that compiled code makes has a kind of its own.
const files = {
  "package.json": `{ "name": "p" }`,
  "a.test.js": `import { test, expect } from "bun:test";
const says = (name, check) => {
  let got = "passes";
  try { check(); } catch (error) { got = "fails: " + String(error.message).replace(/\\s+/g, " ").slice(0, 90); }
  console.log("SEEN", name + ":", got);
};
// As jsdom and happy-dom have it: a node is an instance of a class.
class HTMLParagraphElement {
  nodeType = 1;
  tagName = "P";
  attributes = [{ name: "class", value: "x" }];
  childNodes = [];
}
class Node {
  constructor(id, noise) { this.id = id; this.noise = noise; }
  get nodeType() { return 1; }
  get nodeName() { return "P"; }
  isEqualNode(other) { return this.id === other.id; }
}
class Even { asymmetricMatch(value) { return value % 2 === 0; } }
test.each([[new HTMLParagraphElement()]])("title %p", () => {});
test("asks", () => {
  says("a node in a message", () => expect(new HTMLParagraphElement()).toBe(1));
  says("a node in a snapshot", () => expect(new HTMLParagraphElement()).toMatchInlineSnapshot(\`
    <p
      class="x"
    />
  \`));
  says("nodes that isEqualNode() calls equal", () => expect(new Node(1, "a")).toEqual(new Node(1, "b")));
  says("the same, strictly", () => expect(new Node(1, "a")).toStrictEqual(new Node(1, "b")));
  says("the same, inside an object", () => expect({ el: new Node(1, "a") }).toEqual({ el: new Node(1, "b") }));
  says("nodes that it calls different", () => expect(new Node(1, "a")).toEqual(new Node(2, "a")));
  says("a matcher of a class", () => expect({ a: 2 }).toEqual({ a: new Even() }));
  says("a matcher that is a literal", () => expect({ a: 2 }).toEqual({ a: { asymmetricMatch: value => value === 2 } }));
  says("a matcher at the top", () => expect(4).toEqual(new Even()));
  says("a matcher that says no", () => expect({ a: 3 }).toEqual({ a: new Even() }));
  says("not, where the matcher says yes", () => expect({ a: 2 }).not.toEqual({ a: new Even() }));
  says("a getter of that name is not called", () => expect({ a: 2 }).toEqual({ a: { get asymmetricMatch() { throw new Error("called"); } } }));
});
`,
};
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN") || line.includes("title "));

test("bun test --aot prints and compares them as bun test does", async () => {
  using dir = tempDir("aot-runner-sees-compiled-objects", files);
  const plain = await run([bunExe(), "test"], String(dir), bunEnv);
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  const timeless = (lines: string[]) => lines.map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  expect(timeless(seenIn(plain.stdout + plain.stderr))).toContain(`(pass) title <p class="x" />`);
  expect(timeless(seenIn(plain.stdout + plain.stderr))).toContain("SEEN a matcher of a class: passes");
  expect(timeless(seenIn(compiled.stdout + compiled.stderr))).toEqual(timeless(seenIn(plain.stdout + plain.stderr)));
  expect(compiled.exitCode).toBe(plain.exitCode);
});
