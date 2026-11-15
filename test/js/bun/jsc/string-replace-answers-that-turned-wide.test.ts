import { expect, test } from "bun:test";

// String.prototype.replace with a global pattern without groups, a function and a text of 4096 characters or more asks
// each answer of the function for its width when it gets it, and copies the characters when all the calls are done.
test("an answer of a replacer that becomes a key with a 16-bit name is copied whole", () => {
  const wideTwin = (text: string) => Buffer.from(text, "utf16le").toString("utf16le");
  const untouched = (text: string) => Buffer.from(text, "latin1").toString("latin1");
  const nameOf = (i: number) => "quince-tree-number-" + (1000 + (i % 600));
  // The 16-bit text comes first, so it is the name of the property. An equal 8-bit string that is used as a key takes its characters.
  const shelf: Record<string, number> = Object.create(null);
  for (let i = 0; i < 600; i++) shelf[wideTwin(nameOf(i))] = 0;

  let calls = 0;
  let last: string | null = null;
  const out = "#,".repeat(3000).replace(/#/g, () => {
    if (last !== null) shelf[last] += 1;
    last = untouched(nameOf(calls++));
    return last;
  });

  const expected: string[] = [];
  for (let i = 0; i < 3000; i++) expected.push(nameOf(i), ",");
  expect(calls).toBe(3000);
  expect(out.indexOf("\0")).toBe(-1);
  expect(out).toBe(expected.join(""));
});
