import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// The CSS tokenizer (a port of rust-cssparser) keeps a UTF-16 column adjustment
// in `current_line_start_position` via wrapping_sub(1) for 0xF0..0xFF bytes,
// relying on the three continuation bytes of a valid 4-byte sequence to add it
// back. Bun tokenizes unvalidated bytes, so a lone 0xF0..0xFF byte at the start
// of a line wraps the line-start to usize::MAX. On overflow-checked builds the
// later `position - line_start` subtraction panics the whole process (escaping
// `Bun.build({throw:false})`); on release it double-wraps back to a
// small-but-wrong column past end of file.

async function buildColumn(bytes: number[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  using dir = tempDir("css-invalid-utf8", {});
  const css = join(String(dir), "in.css");
  await Bun.write(css, new Uint8Array(bytes));
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const r = await Bun.build({ entrypoints: [${JSON.stringify(css)}], throw: false });
       const p = r.logs[0]?.position;
       console.log(JSON.stringify({ line: p?.line, column: p?.column }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

test.concurrent("lone 0xF0 byte reports column 2, not 3, and does not panic", async () => {
  const { stdout, stderr, exitCode } = await buildColumn([0xf0]);
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("overflow");
  // One byte in the file: the parse error at EOF is column 2. Previously the
  // wrapped line-start made this column 3 (or panicked on overflow-checks).
  expect(stdout).toBe(`{"line":1,"column":2}`);
  expect(exitCode).toBe(0);
});

test.concurrent("three stray 0xF0 bytes report column 4, not 7", async () => {
  const { stdout, stderr, exitCode } = await buildColumn([0xf0, 0xf0, 0xf0]);
  expect(stderr).not.toContain("panic");
  expect(stdout).toBe(`{"line":1,"column":4}`);
  expect(exitCode).toBe(0);
});

test.concurrent("stray 0xF0 on a non-first line does not skew the column", async () => {
  // "a{}\n" puts the stray byte at the start of line 2 where the true line
  // start is non-zero, exercising the same bookkeeping without the position-0
  // edge case.
  const prefix = [...Buffer.from("a{}\n")];
  const { stdout, stderr, exitCode } = await buildColumn([...prefix, 0xf0]);
  expect(stderr).not.toContain("panic");
  expect(stdout).toBe(`{"line":2,"column":2}`);
  expect(exitCode).toBe(0);
});

test.concurrent("valid 4-byte UTF-8 still counts as two UTF-16 columns", async () => {
  // U+1F600 GRINNING FACE: a well-formed 4-byte sequence is a surrogate pair in
  // UTF-16, so EOF after it is column 3. This must not regress.
  const { stdout, stderr, exitCode } = await buildColumn([0xf0, 0x9f, 0x98, 0x80]);
  expect(stderr).not.toContain("panic");
  expect(stdout).toBe(`{"line":1,"column":3}`);
  expect(exitCode).toBe(0);
});
