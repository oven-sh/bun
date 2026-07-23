import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `import "./file.txt"` must agree with `Bun.file(f).text()`, `fs.readFileSync(f, "utf8")`
// and `TextDecoder` on files that are not valid UTF-8. Previously the loader widened
// invalid lead bytes to their Latin-1 code point and emitted NUL for other ill-formed
// sequences (over-advancing past following bytes) instead of U+FFFD.
describe("text loader decodes ill-formed UTF-8 as U+FFFD", () => {
  const cases: { name: string; bytes: number[] }[] = [
    { name: "invalid lead bytes", bytes: [0x61, 0xff, 0xfe, 0x62] },
    { name: "lone continuation byte", bytes: [0x61, 0x80, 0x62] },
    { name: "2-byte lead then non-continuation", bytes: [0x61, 0xc2, 0x20, 0x62] },
    { name: "3-byte lead then 1 continuation then ASCII", bytes: [0x61, 0xe0, 0x80, 0x62] },
    { name: "truncated 2-byte sequence at EOF", bytes: [0x61, 0xc2] },
    { name: "overlong 4-byte sequence", bytes: [0x61, 0xf0, 0x80, 0x80, 0x80, 0x62] },
    { name: "surrogate encoded in UTF-8", bytes: [0x61, 0xed, 0xa0, 0x80, 0x62] },
    { name: "valid 2-byte", bytes: [0x61, 0xc3, 0xa9, 0x62] },
    { name: "valid 3-byte", bytes: [0x61, 0xe2, 0x82, 0xac, 0x62] },
    { name: "valid 4-byte", bytes: [0x61, 0xf0, 0x9f, 0x98, 0x80, 0x62] },
  ];

  const files: Record<string, Buffer | string> = {
    "entry.ts": `
      import { readFileSync } from "node:fs";
      const name = process.argv[2];
      const { default: loaded } = await import("./" + name + ".txt");
      const read = readFileSync("./" + name + ".txt", "utf8");
      const blob = await Bun.file("./" + name + ".txt").text();
      const cps = (s: string) => [...s].map(c => c.codePointAt(0));
      console.log(JSON.stringify({ loaded: cps(loaded), read: cps(read), blob: cps(blob) }));
    `,
  };
  for (let i = 0; i < cases.length; i++) {
    files[`c${i}.txt`] = Buffer.from(cases[i].bytes);
  }

  for (let i = 0; i < cases.length; i++) {
    const { name, bytes } = cases[i];
    it.concurrent(name, async () => {
      using dir = tempDir("text-loader-invalid-utf8", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.ts", `c${i}`],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const expected = [...new TextDecoder().decode(Uint8Array.from(bytes))].map(c => c.codePointAt(0));
      expect(JSON.parse(stdout)).toEqual({ loaded: expected, read: expected, blob: expected });
      expect(exitCode).toBe(0);
    });
  }
});
