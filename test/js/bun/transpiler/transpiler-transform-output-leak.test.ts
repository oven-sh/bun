import { test } from "bun:test";
import { expectRssDeltaBelow } from "harness";

// transform() runs on the work pool and keeps the printed output until the
// promise settles. When the parse log holds a warning, the promise rejects
// without handing that output to JS, so the task itself must release it.
test("transform() reject path does not leak the printed output", async () => {
  const code = /* js */ `
    const t = new Bun.Transpiler({ loader: "js" });
    // "-->" at the start of a line is the legacy HTML close comment. The lexer
    // logs a warning, so parse and print succeed and transform() rejects.
    const source = kib => 'var big = "' + Buffer.alloc(kib * 1024, "a").toString() + '";\\n--> trailing\\nbig;\\n';
    const warm = source(4), src = source(256);
    // Only that warning may reject. Any other error is a different bug, and a
    // resolve means the source no longer takes the reject path.
    async function once(s) {
      try {
        await t.transform(s);
      } catch (e) {
        if (String(e.message).includes("legacy HTML single-line comment")) return;
        throw e;
      }
      throw new Error("expected transform() to reject on the legacy HTML comment warning");
    }
    // A small source warms the JIT and the work pool without the lexing cost.
    for (let i = 0; i < 100; i++) await once(warm);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 128; i++) await once(src);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: at least 32 MiB (128 resident copies of the 256 KiB output).
  // Fixed: under 3 MiB of allocator slack.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 16, debug: 20 });
});
