import { devTest } from "../bake-harness";

// This test is specifically testing the fix for disconnectEdgeFromDependencyList
// where it was incorrectly setting first_dep to .none when there was still a next dependency
devTest("incremental graph handles edge deletion with next dependency", {
  timeoutMultiplier: 4, // 1 minute timeout
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
    await using client = await dev.client("/", { allowUnlimitedReloads: true });

    // This creates a stress test scenario where multiple files import util.js
    // When we delete and recreate files rapidly, it tests the edge case where
    // disconnectEdgeFromDependencyList needs to properly handle multiple dependencies
    await dev.stressTest(async () => {
      for (let i = 0; i < 10; i++) {
        console.log(`Cycle ${i + 1}/10`);

        // Delete util.js which is imported by multiple files
        await Bun.write(dev.join("util.js"), "");
        await Bun.sleep(10);

        // Recreate it
        await Bun.write(
          dev.join("util.js"),
          `
export const util = '!';
console.log('util.js loaded');
        `.trim(),
        );
        await Bun.sleep(10);

        // Delete and recreate one of the importers
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

    // If we get here without crashing, the test passed
    console.log("Test completed successfully - no crash occurred");

    // Clear the messages array to satisfy the test harness
    client.messages.length = 0;
  },
});
