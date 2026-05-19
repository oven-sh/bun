// https://github.com/oven-sh/bun/issues/30693
//
// Regression: `bun update --interactive` against the default npm registry
// emits an OSC 8 hyperlink (`\x1b]8;;URL\x1b\TEXT\x1b]8;;\x1b\`) inside a
// `<r>{TEXT}<r>` bun-format template. The Rust port previously rendered that
// via `Output::pretty(format_args!("<r>{}<r>", hyperlink))`, which substitutes
// the hyperlink *first* then runs the `<tag>`-to-ANSI parser over the result.
// The `\` byte of the OSC 8 ST `ESC \` collides with the parser's `\<` escape
// arm and swallows the opening `<` of the trailing `<r>` reset tag, leaking
// the literal `r` as plain text after the hyperlinked name. A package named
// `ai` rendered as `air`.
//
// The fix routes those call sites through the `pretty!` macro (compile-time
// tag rewrite), matching the Zig `comptime fmt` semantics so substituted
// bytes never pass through the tag parser.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("issue #30693: short package names don't leak trailing 'r' from OSC 8 hyperlink", async () => {
  // `ai` is the canonical repro — short name placed immediately before the
  // `<r>` reset tag so the corruption is one character, fully visible.
  // Use a very old pinned version so the registry reliably reports a newer
  // version as available (the outdated-row renderer is what emits the link).
  using dir = tempDir("issue-30693", {
    "package.json": JSON.stringify({
      name: "issue-30693-repro",
      version: "1.0.0",
      dependencies: {
        "ai": "0.0.1",
      },
    }),
  });

  // Must install first so the manifest is cached and the outdated scan has
  // data to render.
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const installExit = await installProc.exited;
  // Skip if install failed (e.g. offline / registry flake in CI) — the test
  // genuinely needs the default registry to cache a manifest for `ai`.
  if (installExit !== 0) {
    const stderr = await installProc.stderr.text();
    console.warn(`skipping #30693 test — \`bun install\` failed (${installExit}): ${stderr.slice(0, 200)}`);
    return;
  }

  // `FORCE_COLOR=1` is the trigger for `Output::enable_ansi_colors_stdout()`
  // which gates the hyperlink path. Combined with the default npm registry
  // (no bunfig here, so `uses_default_registry == true`), the hyperlink
  // branch of `TerminalHyperlink::Display` emits the ST bytes that collided
  // with the pretty parser.
  await using updateProc = Bun.spawn({
    cmd: [bunExe(), "update", "--interactive", "--dry-run"],
    cwd: String(dir),
    env: { ...bunEnv, FORCE_COLOR: "1" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Exit the interactive prompt cleanly — send ctrl-c so the command
  // returns without writing anything. Output already flushed by then.
  updateProc.stdin.write("\x03");
  updateProc.stdin.end();

  const stdout = await updateProc.stdout.text();
  // Drain stderr so the process exits cleanly under `await using`.
  await updateProc.stderr.text();
  await updateProc.exited;

  // The rendered hyperlink wraps the package name in OSC 8:
  //   ESC ]8;; URL ESC \ TEXT ESC ]8;; ESC \
  // When the pretty parser was run over the substituted bytes, it ate the
  // closing `\` of the ST and leaked the `r` of the trailing `<r>` reset
  // tag, producing `...ESC ]8;; ESC < r` on the wire. Any terminal that
  // closes the OSC on a non-ST delimiter renders the `r` as plain text,
  // so the package name `ai` shows as `air`.
  //
  // Assertion 1: `ai` never appears with a trailing `r` character
  //              immediately after a (possibly empty) hyperlink close.
  expect(stdout).not.toMatch(/\x1b\]8;;\x1b[^\\]r/);

  // Assertion 2: the parser must not have consumed the ST backslash of any
  //              OSC 8 terminator. Every `ESC ]8;;` must end in `ESC \`
  //              (the ST) before the next renderable char, except where
  //              the URL itself is empty and the closer is `ESC ]8;; ESC \`.
  // Find every OSC 8 start and check it's followed by a valid ST within
  // the URL field (no `ESC` appears inside URLs in our renderer).
  const osc8Opens = [...stdout.matchAll(/\x1b\]8;;([^\x1b]*)/g)];
  // Must actually have exercised the hyperlink path — otherwise the
  // terminator checks below vacuously pass and the test no longer
  // regression-gates anything. The default registry + FORCE_COLOR=1
  // setup above is what gates the hyperlink branch of
  // TerminalHyperlink::Display; if this fails the fixture is wrong, not
  // the fix.
  expect(osc8Opens.length).toBeGreaterThan(0);
  for (const match of osc8Opens) {
    const afterUrl = stdout.slice(match.index! + match[0].length);
    // The byte right after the URL must be ESC, and the byte after that
    // must be `\` (0x5C). If the pretty parser ate the `\`, the next byte
    // would be `<` (consumed `<` of `<r>`) — that's the bug signature.
    expect(afterUrl[0]).toBe("\x1b");
    expect(afterUrl[1]).toBe("\\");
  }

  // Assertion 3: after any OSC 8 close (`ESC ]8;; ESC \`), the next byte
  //              must NOT be a bare `r` — the signature of the leaked
  //              `<r>` reset tag when `<` was eaten by the `\<` escape arm.
  expect(stdout).not.toMatch(/\x1b\]8;;\x1b\\r(?!\\)/);
});
