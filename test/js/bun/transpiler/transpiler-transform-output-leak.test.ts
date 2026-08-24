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
    const warmups = 100, iterations = 128;
    let rejected = 0;
    async function once(s) { try { await t.transform(s); } catch { rejected++; } }
    // A small source warms the JIT and the work pool without the lexing cost.
    for (let i = 0; i < warmups; i++) await once(warm);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < iterations; i++) await once(src);
    Bun.gc(true);
    if (rejected !== warmups + iterations) throw new Error("expected every transform() to reject, got " + rejected);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: at least 32 MiB (128 resident copies of the 256 KiB output).
  // Fixed: under 3 MiB of allocator slack.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 16, debug: 20 });
});
