import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// CSS sources whose bytes are not valid UTF-8. The bundler must decode them
// (invalid sequences become U+FFFD) instead of tokenizing the raw bytes,
// which used to crash with `panic: unreachable` once an unresolvable
// `@import` specifier containing the raw byte reached the error formatter.
//
// 0xE2 is a three-byte UTF-8 lead with no continuation bytes after it.
const importWithInvalidByte = Buffer.concat([
  Buffer.from('@import url("./x'),
  Buffer.from([0xe2]),
  Buffer.from('y.css");\n'),
]);

describe("css with invalid utf-8", () => {
  test.concurrent("unresolvable @import reports a resolve error", async () => {
    using dir = tempDir("css-invalid-utf8-import", {});
    writeFileSync(join(String(dir), "in.css"), importWithInvalidByte);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./in.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The invalid byte is replaced with U+FFFD, exactly as a browser decodes
    // the stylesheet, so the import fails to resolve like any other typo.
    expect(stderr).toContain('Could not resolve: "./x\uFFFDy.css"');
    expect(stdout).not.toContain("Bundled");
    expect(exitCode).toBe(1);
  });

  test.concurrent("Bun.build reports the failure on a ResolveMessage", async () => {
    using dir = tempDir("css-invalid-utf8-api", {
      "build.js": `
        const result = await Bun.build({ entrypoints: ["./in.css"], throw: false });
        const log = result.logs[0];
        console.log(JSON.stringify({ success: result.success, message: log.message, specifier: log.specifier }));
      `,
    });
    writeFileSync(join(String(dir), "in.css"), importWithInvalidByte);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "./build.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Only the ASCII affixes of the specifier are asserted here: the
    // ResolveMessage getters mis-decode non-ASCII text today (reproducible
    // on its own with `import "./café.js"`), which is a separate issue.
    const log = JSON.parse(stdout);
    expect(log.success).toBe(false);
    expect(log.message).toStartWith('Could not resolve: "./x');
    expect(log.specifier).toStartWith("./x");
    expect(log.specifier).toEndWith("y.css");
    expect(exitCode).toBe(0);
  });

  test.concurrent("url() token in an at-rule prelude reports a resolve error", async () => {
    using dir = tempDir("css-invalid-utf8-url", {});
    writeFileSync(
      join(String(dir), "in.css"),
      Buffer.concat([Buffer.from("@-x url(a"), Buffer.from([0xe2]), Buffer.from("b) tok;\n")]),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./in.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain('Could not resolve: "a\uFFFDb"');
    expect(exitCode).toBe(1);
  });

  test.concurrent("invalid bytes outside an import become U+FFFD in the output", async () => {
    using dir = tempDir("css-invalid-utf8-content", {});
    // `content: "caf<0xE9>"` (latin-1 "café"): the build succeeds and the
    // emitted stylesheet is well-formed UTF-8, matching how a browser would
    // have decoded the input.
    writeFileSync(
      join(String(dir), "in.css"),
      Buffer.concat([Buffer.from('a { content: "caf'), Buffer.from([0xe9]), Buffer.from('"; }\n')]),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./in.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const out = new Uint8Array(await Bun.file(join(String(dir), "out", "in.css")).arrayBuffer());
    expect(Buffer.from(out).includes(Buffer.from('content: "caf\uFFFD"'))).toBe(true);
    expect(Buffer.from(out).includes(0xe9)).toBe(false);
  });
});
