import { indexOfLine } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("indexOfLine handles non-number offset", () => {
  // Regression test: passing a non-number offset should not crash
  expect(indexOfLine(new Uint8ClampedArray(), {})).toBe(-1);
  expect(indexOfLine(new Uint8Array(), {})).toBe(-1);

  // Various non-number offsets should coerce properly
  expect(indexOfLine(new Uint8Array(), null)).toBe(-1);
  expect(indexOfLine(new Uint8Array(), undefined)).toBe(-1);
  expect(indexOfLine(new Uint8Array(), NaN)).toBe(-1);

  // With actual content
  const buf = new Uint8Array([104, 101, 108, 108, 111, 10, 119, 111, 114, 108, 100]); // "hello\nworld"
  expect(indexOfLine(buf, {})).toBe(5); // {} coerces to NaN -> 0
  expect(indexOfLine(buf, "2")).toBe(5); // "2" coerces to 2, newline is at 5
});

test("indexOfLine", () => {
  const source = `
        const a = 1;

        const b = 2;

        😋const c = 3; // handles unicode

        😋 Get Emoji — All Emojis to ✂️

        const b = 2;

        const c = 3;
`;
  var i = 0;
  var j = 0;
  const buffer = Buffer.from(source);
  var nonEmptyLineCount = 0;
  while (i < buffer.length) {
    const prev = j;
    j = source.indexOf("\n", j);
    i = indexOfLine(buffer, i);

    const delta = Buffer.byteLength(source.slice(0, j), "utf8") - j;
    console.log(source.slice(prev + 1, j));
    if (i === -1) {
      expect(j).toBe(-1);
      expect(nonEmptyLineCount).toBe(6);
      break;
    }
    expect(i++ - delta).toBe(j++);
    nonEmptyLineCount++;
  }
});

// A single byte >=0x80 late in the buffer used to trigger an O(n^2) rescan.
// Size chosen so the quadratic loop cannot complete inside the spawn timeout
// while the linear scan finishes in well under a second.
test("indexOfLine is linear on large input with a non-ASCII byte", async () => {
  const n = 500_000;
  const fixture = `
    const n = ${n};
    const buf = Buffer.alloc(n + 3, "a");
    buf[n] = 0xc3; buf[n + 1] = 0xa9; // 'é'
    buf[n + 2] = 0x0a;                // '\\n'
    const i = Bun.indexOfLine(buf);
    console.log(JSON.stringify({ i, len: buf.length }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr: /error|panic|assert|abort/i.test(stderr) ? stderr : "", exitCode }).toEqual({
    stdout: JSON.stringify({ i: n + 2, len: n + 3 }),
    stderr: "",
    exitCode: 0,
  });
  expect(proc.signalCode).toBeNull();
}, 60_000);

test("indexOfLine skips multi-byte sequences correctly", () => {
  // ascii prefix, multi-byte char, ascii, newline
  const buf = Buffer.from("abé d\n");
  expect(indexOfLine(buf)).toBe(buf.length - 1);
  // newline immediately after a multi-byte char
  const buf2 = Buffer.from("é\n");
  expect(indexOfLine(buf2)).toBe(2);
  // search starting mid-buffer with non-ASCII before the offset
  const buf3 = Buffer.from("é\nabc\néé\n");
  expect(indexOfLine(buf3, 3)).toBe(6);
  expect(indexOfLine(buf3, 7)).toBe(11);
});

test("indexOfLine does not read a buffer detached by the offset coercion", () => {
  const ab = new ArrayBuffer(6);
  const buf = new Uint8Array(ab);
  buf.set(new TextEncoder().encode("hello\n"));
  const evilOffset = {
    valueOf() {
      ab.transfer();
      return 0;
    },
  };
  // The view is re-derived after the coercion, so the detached buffer
  // reads as empty instead of scanning freed memory.
  expect(indexOfLine(buf, evilOffset as any)).toBe(-1);
});
