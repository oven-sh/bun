import { test } from "bun:test";
import { expectRssDeltaBelow } from "harness";

// transform() runs on the work pool and keeps the printed output until the
// promise settles. When the parse log holds a warning, the promise rejects
// without handing that output to JS, so the task itself must release it.
test("transform() reject path does not leak the printed output", async () => {
  const code = /* js */ `
    const t = new Bun.Transpiler({ loader: "js" });
    const payload = Buffer.alloc(256 * 1024, "a").toString();
    // "-->" at the start of a line is the legacy HTML close comment. The lexer
    // logs a warning, so parse and print succeed and transform() rejects.
    const src = 'var big = "' + payload + '";\\n--> trailing\\nbig;\\n';
    let rejected = 0;
    async function once() { try { await t.transform(src); } catch { rejected++; } }
    for (let i = 0; i < 20; i++) await once();
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 400; i++) await once();
    Bun.gc(true);
    if (rejected !== 420) throw new Error("expected every transform() to reject, got " + rejected);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: ~100 MiB. Fixed: allocator slack only.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 40, debug: 55 });
});
