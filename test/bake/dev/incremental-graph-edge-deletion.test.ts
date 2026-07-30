import { expect } from "bun:test";
import { devTest } from "../bake-harness";

// Regression test for disconnectEdgeFromDependencyList: when an edge at the
// head of an imported file's dependency list is removed but still has a
// next_dependency, the head must advance to that next edge instead of being
// cleared. The old code cleared it and tripped an assertion on the next
// rebuild. https://github.com/oven-sh/bun/issues/20529
devTest("incremental graph handles edge deletion with next dependency", {
  files: {
    "index.html": `<html>
<head><title>Test</title></head>
<body>
  <div id="root"></div>
  <script src="/index.js" type="module"></script>
</body>
</html>`,
    "index.js": `
import { a } from './a.js';
import { b } from './b.js';
import { c } from './c.js';

console.log('index', a, b, c);
    `.trim(),
    "a.js": `
import { util } from './util.js';
export const a = 'A' + util;
console.log('a.js loaded');
    `.trim(),
    "b.js": `
import { util } from './util.js';
export const b = 'B' + util;
console.log('b.js loaded');
    `.trim(),
    "c.js": `
import { util } from './util.js';
export const c = 'C' + util;
console.log('c.js loaded');
    `.trim(),
    "util.js": `
export const util = '!';
console.log('util.js loaded');
    `.trim(),
  },
  async test(dev) {
    // Populate the module graph. The assertion this covers fires server-side
    // in finalizeBundle, so a browser client is unnecessary; fetching the
    // page is enough to bundle index.js and its three util.js importers.
    const scriptSrc = (await dev.fetch("/").text()).match(/src="(\/_bun\/client\/[^"]+\.js)"/)![1];
    await dev.fetch(scriptSrc).expect.toInclude(`"A" + `);

    // util.js now has three dependents (a, b, c). Repeatedly drop and
    // re-add the a→util edge; whichever dependent is currently at the head
    // of util.js's list exercises the prev=null, next!=null unlink path.
    await dev.stressTest(async () => {
      for (let i = 0; i < 10; i++) {
        await Bun.write(dev.join("util.js"), "");
        await Bun.sleep(10);

        await Bun.write(
          dev.join("util.js"),
          `
export const util = '!';
console.log('util.js loaded');
        `.trim(),
        );
        await Bun.sleep(10);

        await Bun.write(dev.join("a.js"), "");
        await Bun.sleep(10);

        await Bun.write(
          dev.join("a.js"),
          `
import { util } from './util.js';
export const a = 'A' + util;
console.log('a.js loaded');
        `.trim(),
        );
        await Bun.sleep(10);
      }
    });

    // After the churn the graph must still be intact: a synchronized write
    // to util.js should rebundle cleanly and the new value should reach the
    // client bundle through all three importers.
    await dev.write("util.js", `export const util = '-after-stress';`);
    const newScriptSrc = (await dev.fetch("/").text()).match(/src="(\/_bun\/client\/[^"]+\.js)"/)![1];
    const bundle = await dev.fetch(newScriptSrc).text();
    expect(bundle).toInclude(`"A" + `);
    expect(bundle).toInclude(`"B" + `);
    expect(bundle).toInclude(`"C" + `);
    expect(bundle).toInclude(`"-after-stress"`);
  },
});
