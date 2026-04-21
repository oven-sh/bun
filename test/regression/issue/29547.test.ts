import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/29547
//
// The YARR JIT's parenContextHead-clearing helper (introduced in upstream
// WebKit 37465a721d and extended by 2d16551f69) nulled a frame slot that
// aliased with a different subpattern's returnAddress in a sibling
// alternative, causing an indirect jump to RIP=0 on backtrack.
//
// In the minimal case below, the outer `(?:...)*` has two alternatives:
//   - alt #0: `[abc]+(?:.|b)` — inner Once subpattern at frame 7-8
//   - alt #1: `(?:a)*`         — greedy subpattern at frame 5-8
//
// Slot 8 is inner Once's returnAddress in alt #0 and (?:a)*'s
// parenContextHead in alt #1. The unconditional null broke alt #0.
//
// Real-world trigger: `bunx --bun jscpd *.tsx` (reprism's JSX tag regex
// over a typical TSX file) which we reproduce via a Bun.spawn child so
// the JIT compiles fresh each run.
test.concurrent("issue/29547: YARR JIT parenContextHead alias SEGV", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const r = /(?:[abc]+(?:.|b)|(?:a)*)*>/;
        const result = r.exec(' x="c" ');
        console.log(result === null ? "null" : result[0]);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(stdout).toBe("null\n");
  expect(exitCode).toBe(0);
});

// The original reporter's case: bunx --bun jscpd on TSX files. The specific
// regex that crashes is Prism's JSX tag pattern applied to the raw TSX
// source. Distilled to a direct exec call that matches what the tokenizer
// actually does.
test.concurrent("issue/29547: Prism JSX tag regex on TSX source", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const pattern = /<\\/?[\\w.:-]+\\s*(?:\\s+(?:[\\w.:-]+(?:=(?:("|')(?:\\\\[\\s\\S]|(?!\\1)[^\\\\])*\\1|[^\\s{'">=]+|\\{(?:\\{[^}]*\\}|[^{}])+\\}))?|\\{\\.{3}[a-z_$][\\w$]*(?:\\.[a-z_$][\\w$]*)*\\}))*\\s*\\/?>/gi;
        const src = '              <div\\n                className=\"h-full rounded-full bg-blue-400\"\\n                style={{ width: \\\`\\\${barPct}%\\\` }}\\n              />\\n';
        const m = pattern.exec(src);
        console.log(m ? m[0].slice(0, 20) : "null");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout.trim()).not.toBe("");
});
