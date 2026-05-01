import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Regression test for SmallList.tryGrow() over-allocation in the CSS parser.
//
// When a SmallList spills to the heap and then grows again, the realloc
// branch passed `new_cap * @sizeOf(T)` as the *element* count (instead of
// `new_cap`), over-allocating by a factor of @sizeOf(T) on every heap→heap
// grow. It also passed `ptr[0..len]` instead of `ptr[0..cap]` as the old
// slice. mimalloc tolerates the wrong old size, so there was no crash — just
// a large peak-memory waste during parsing.
//
// SelectorList = SmallList(Selector, 1), so any rule with ≥10 selectors hits
// the realloc branch. A rule with 100 selectors reallocs four times and ends
// up holding roughly @sizeOf(Selector)× more memory than it needs. Real-world
// CSS like Bootstrap's grid selectors hits this.

test("CSS bundler doesn't over-allocate SmallList when growing past the first heap spill", async () => {
  // 3000 rules × 100 selectors each. Each rule's selector list grows
  // 1→9→21→39→66→107, i.e. four heap→heap reallocs.
  const numRules = 3000;
  const selectorsPerRule = 100;
  let css = "";
  for (let r = 0; r < numRules; r++) {
    let rule = ".r" + r + "-s0";
    for (let s = 1; s < selectorsPerRule; s++) rule += ",.r" + r + "-s" + s;
    css += rule + "{color:red}\n";
  }

  using dir = tempDir("css-small-list-grow", {
    "wide.css": css,
  });

  const firstSel = ".r0-s0";
  const lastSel = `.r${numRules - 1}-s${selectorsPerRule - 1}`;

  const fixture = /* js */ `
    const baseline = process.memoryUsage.rss();
    const result = await Bun.build({
      entrypoints: [${JSON.stringify(path.join(String(dir), "wide.css"))}],
    });
    if (!result.success) {
      console.error(result.logs.join("\\n"));
      process.exit(1);
    }
    const out = await result.outputs[0].text();
    Bun.gc(true);
    const after = process.memoryUsage.rss();
    console.log(JSON.stringify({
      deltaMB: (after - baseline) / 1024 / 1024,
      hasFirst: out.includes(${JSON.stringify(firstSel)}),
      hasLast: out.includes(${JSON.stringify(lastSel)}),
    }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Surface subprocess failure before we try to parse anything.
  expect({ exitCode, stderr, stdout }).toMatchObject({ exitCode: 0 });

  const { deltaMB, hasFirst, hasLast } = JSON.parse(stdout.trim());

  // Selectors from both ends of the last rule's list survive the grow path.
  expect({ hasFirst, hasLast }).toEqual({ hasFirst: true, hasLast: true });

  // Before the fix the RSS delta here was ~570 MB (release) / ~700 MB
  // (debug ASAN). After the fix it's ~115 MB in debug ASAN and well under
  // that in release. 300 MB gives generous headroom on both sides.
  expect(deltaMB).toBeLessThan(300);
}, 120_000);
