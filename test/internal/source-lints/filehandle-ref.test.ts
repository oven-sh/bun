import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// A FileHandle operation sees that the descriptor is open and then takes a ref ([kRef]), which makes close() wait
// until the operation settles. Code of the caller that runs between those two steps (a getter of an argument, an
// iterator) can close the handle, and the operation then runs on a number that the handle no longer owns. This lint
// keeps the two steps next to each other in src/js/node/fs.promises.ts:
//
//   A. `throwEBADFIfNecessary(name, fd);` directly follows `const fd = this[kFd];`, and the next statements are
//      `try {` and `this[kRef]();`
//   B. every other `[kRef]();` directly follows `if (handle[kFd] === -1) throw`, or is the first statement of an
//      `...OfHandle(handle, fd, ...)` helper
//   C. a `?.[kFd]` gives its number only to the `...OfHandle` helper, in the next statement, with the handle
const file = "src/js/node/fs.promises.ts";

// Sites that keep another order on purpose: the statement, and why.
const checkWithoutRef: Record<string, string> = {
  'throwEBADFIfNecessary("createReadStream", fd);': "the ReadStream takes the ref when it reads the number",
  'throwEBADFIfNecessary("createWriteStream", fd);': "the WriteStream takes the ref when it reads the number",
};
// readableWebStream() captures no number: each pull goes through handle.read(), which takes its own ref.
const refOfReadableWebStream = 'this.once("close", onFileHandleClose);';

test("a FileHandle operation takes its ref before any code of the caller can run", () => {
  const source = readFileSync(path.resolve(import.meta.dir, "..", "..", "..", file), "utf8");
  // One entry per line of code: line comments and blank lines go, the line numbers stay.
  const lines = source
    .split("\n")
    .map((text, i) => ({ n: i + 1, s: text.replace(/^\s*\/\/.*$/, "").trim() }))
    .filter(line => line.s !== "");
  const at = (i: number) => lines[i]?.s ?? "";

  const isCheck = (s: string) => /^throwEBADFIfNecessary\(.*, fd\);$/.test(s);
  const isRef = (s: string) => /^(this|handle)\[kRef\]\(\);$/.test(s);
  const seesOpenDescriptor = (s: string) => s.startsWith("if (handle[kFd] === -1) throw $ERR_INVALID_STATE(");
  const opensHelper = (s: string) => /^function \w+OfHandle\(handle, fd, .*\) \{$/.test(s);

  const violations: string[] = [];
  const counts = { checks: 0, refs: 0, unwraps: 0 };
  lines.forEach((line, i) => {
    const report = (rule: string) => violations.push(`${file}:${line.n} (rule ${rule}): ${line.s}`);

    if (isCheck(line.s)) {
      counts.checks++;
      if (at(i - 1) !== "const fd = this[kFd];") report("A");
      else if (!(at(i + 1) === "try {" && isRef(at(i + 2))) && !(line.s in checkWithoutRef)) report("A");
    }

    if (isRef(line.s)) {
      counts.refs++;
      // `refAcquired = true;` stands between the check and the ref in the writer's acquireRef().
      const before = at(i - 1) === "refAcquired = true;" ? i - 2 : i - 1;
      const followsCheck = at(before) === "try {" && isCheck(at(before - 1));
      if (
        !followsCheck &&
        !seesOpenDescriptor(at(before)) &&
        !opensHelper(at(before)) &&
        at(i + 1) !== refOfReadableWebStream
      ) {
        report("B");
      }
    }

    if (line.s.includes("?.[kFd]")) {
      counts.unwraps++;
      const handle = /^const fd = (\w+)\?\.\[kFd\];$/.exec(line.s)?.[1];
      let next = "";
      for (let j = i + 1; j < lines.length && !next.endsWith(";"); j++) next += " " + at(j);
      if (handle === undefined || !next.includes(`OfHandle(${handle}, fd,`)) report("C");
    }
  });

  // None at all means the code moved and this lint checks nothing.
  expect(counts.checks).toBeGreaterThan(10);
  expect(counts.refs).toBeGreaterThan(10);
  expect(counts.unwraps).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});
