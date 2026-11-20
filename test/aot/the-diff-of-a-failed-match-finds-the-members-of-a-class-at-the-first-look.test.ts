// toMatchObject() that fails prints a diff, and the diff does not flag a matcher that passed after the first mismatch (https://github.com/oven-sh/bun/issues/9089).
// For that it looks a received property up without a read, also up the prototypes. A compiled class at module scope gives its prototype the members only when
// somebody looks at them, and until then that prototype is of a kind that the diff does not read. So the diff asks for the members before it judges the prototype.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const said = `
import { expect, test } from "bun:test";

class Account { get email() { return "ada@example.com"; } greet() {} }
class Stored { get id() { return 7; } }
class Member extends Stored { get email() { return "ada@example.com"; } }
class Node { nodeType = 1; nodeName = "DIV"; when; constructor(when) { this.when = when; } isEqualNode() { return true; } }
let asked = 0;
const counted = () => expect.any(class Counted { static [Symbol.hasInstance]() { asked++; return true; } });
const flagged = (received, pattern) => {
  try { expect(received).toMatchObject(pattern); } catch (error) { return Bun.stripANSI(error.message).split("\\n").filter(line => /^[-+] {3}/.test(line)); }
  return ["did not throw"];
};

test("says", () => {
  // The first failed match with each class, and the second.
  for (let call = 0; call < 2; call++) {
    console.log("SAID", JSON.stringify(flagged(new Account(), { id: 8, email: expect.stringContaining("@"), greet: expect.any(Function) })));
    console.log("SAID", JSON.stringify(flagged(new Member(), { wrong: 1, email: expect.stringContaining("@"), id: expect.any(Number) })));
    flagged({ a: 1, pair: new Node(1) }, { a: 2, pair: new Node(counted()) });
    console.log("SAID", JSON.stringify({ asked }));
  }
});
`;

test("the first diff with a class at module scope is as the second", async () => {
  using dir = tempDir("aot-diff-of-a-failed-match", { "said.test.js": said });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "said.test.js"], String(dir), {
    ...bunEnv,
    BUN_AOT_VERBOSE: "1",
  });
  expect(stderr).toContain("[aot] module: ");
  // `id` of Member is a getter of the class above it. The two nodes both have an isEqualNode(), which the comparison
  // leaves them to: the diff finds that method in their class, and asks no matcher in them.
  const ofOneCall = [['-   "id": 8,'], ['-   "wrong": 1,'], { asked: 0 }];
  expect({
    said: stdout
      .split("\n")
      .filter(line => line.startsWith("SAID "))
      .map(line => JSON.parse(line.slice(5))),
    exitCode,
  }).toEqual({ said: [...ofOneCall, ...ofOneCall], exitCode: 0 });
});
