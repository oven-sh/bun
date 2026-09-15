import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, libcPathForDlopen } from "harness";
import path from "node:path";

// The fixture uses mmap/mprotect via bun:ffi to place source bytes immediately
// before a PROT_NONE guard page, so any read past the end of the input faults
// deterministically. The fixture only knows the mmap flags for Linux (glibc +
// musl) and macOS; libcPathForDlopen() supplies the right shared-object path.
describe.skipIf(!(isLinux || isMacOS))("Bun.Transpiler.transformSync with truncated UTF-8 at end of buffer", () => {
  test("does not read past the end of the input buffer", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "transpiler-truncated-utf8-fixture.ts")],
      env: { ...bunEnv, BUN_TEST_LIBC_PATH: libcPathForDlopen() },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On failure the subprocess segfaults before printing DONE and exits
    // with a non-zero code / SIGSEGV signal.
    expect({
      stdout: stdout.trim().split("\n"),
      stderr,
      exitCode,
      signalCode: proc.signalCode,
    }).toEqual({
      stdout: [
        expect.stringContaining("ok: 1@ + 4-byte lead"),
        expect.stringContaining("ok: 1@ + 3-byte lead"),
        expect.stringContaining("ok: 1@ + 2-byte lead"),
        expect.stringContaining("ok: 4-byte lead + 1 continuation"),
        expect.stringContaining("ok: 4-byte lead + 2 continuations"),
        expect.stringContaining("ok: sourceMappingURL pragma + 4-byte lead"),
        expect.stringContaining("ok: block comment terminated at buffer end"),
        expect.stringContaining("ok: unterminated block comment at buffer end"),
        expect.stringContaining("ok: unterminated block comment + 4-byte lead"),
        expect.stringContaining("ok: unterminated block comment + '*'"),
        "DONE",
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

test("Bun.Transpiler reads source bytes that are not UTF-8 the way TextDecoder does", async () => {
  const transpiler = new Bun.Transpiler({ loader: "js" });
  // \xA9 cannot start a sequence. \xE9 and \xE2\x82 start one that the next byte
  // does not continue. \xED\xA0\x80 is an encoded surrogate.
  const source = Buffer.from(
    '/*! \xA9 */ console.log("s\xA9 caf\xE9", /^r\xA9$/, "\xED\xA0\x80", "p\xE2\x82q");\n',
    "latin1",
  );
  const expected = '/*! \uFFFD */\nconsole.log("s\uFFFD caf\uFFFD", /^r\uFFFD$/, "\uFFFD\uFFFD\uFFFD", "p\uFFFDq");\n';
  expect(transpiler.transformSync(source)).toBe(expected);
  expect(await transpiler.transform(source)).toBe(expected);
  // U+FFFD that is really in the text is not a decoding error.
  expect(transpiler.transformSync('console.log("ok \uFFFD \u00E9", /\uFFFD/);')).toBe(
    'console.log("ok \uFFFD \u00E9", /\uFFFD/);\n',
  );
});

// The lexer is what notices that a file is not UTF-8, so every kind of ill-formed
// sequence has to be noticed when it is the only one in the file.
test("a string literal holds what TextDecoder gives for each kind of byte sequence", () => {
  const transpiler = new Bun.Transpiler({ loader: "js" });
  const decoder = new TextDecoder();
  // One lead byte from each class: continuation bytes, overlong leads, 2-byte, the
  // 3-byte leads with a restricted second byte (E0, ED), 4-byte (F0, F4), too big.
  const leads = [
    0x80, 0xa9, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf3, 0xf4, 0xf5, 0xf7,
    0xf8, 0xff,
  ];
  const mismatches: string[] = [];
  for (const lead of leads) {
    for (const second of [0x41, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf]) {
      for (const rest of [[], [0x80], [0x80, 0x80], [0xbf, 0x41]]) {
        const bytes = Buffer.from([lead, second, ...rest]);
        const source = Buffer.concat([Buffer.from('globalThis.literal = "'), bytes, Buffer.from('";')]);
        (0, eval)(transpiler.transformSync(source));
        if ((globalThis as any).literal !== decoder.decode(bytes)) mismatches.push(bytes.toString("hex"));
      }
    }
  }
  expect(mismatches).toEqual([]);
});
