// Tests for watchedFiles feature in dev plugins
import { devTest, minimalFramework } from "../dev-server-harness";

devTest("onLoad with watchedFiles for non-JS file", {
  framework: minimalFramework,
  pluginFile: `
    import * as fs from 'fs';
    import * as path from 'path';
    
    export default [
      {
        name: 'watchedFiles-plugin',
        setup(build) {
          let fileCounter = 0;
          
          build.onLoad({ filter: /\\.counter\\.js$/ }, (args) => {
            // Read the current value from the data file
            try {
              // Data file is just a plain text file with a number
              const dataPath = path.join(path.dirname(args.path), "counter.txt");
              const absoluteDataPath = path.resolve(dataPath);
              fileCounter++;
              
              // Log to make debugging easier
              console.log("[PLUGIN] Loading counter file. Count:", fileCounter);
              
              try {
                const content = fs.readFileSync(absoluteDataPath, 'utf8');
                const counterValue = content.trim();
                console.log("[PLUGIN] Read counter value:", counterValue);
                
                // We're returning a module that exports both the counter value
                // and the number of times this plugin has been invoked
                return { 
                  contents: \`console.log("[COUNTER MODULE] Loading with value: \${counterValue}, plugin invocation #\${fileCounter}");
                    export default {
                      counterValue: "\${counterValue}",
                      loadCount: \${fileCounter}
                    };\`,
                  loader: 'js',
                  // Add the data file to the watchedFiles array
                  watchedFiles: [absoluteDataPath]
                };
              } catch (err) {
                console.error("[PLUGIN] Error reading counter.txt:", err);
                return {
                  contents: \`export default { counterValue: "error", loadCount: \${fileCounter} };\`,
                  loader: 'js'
                };
              }
            } catch (e) {
              console.error("[PLUGIN] Error in plugin:", e);
              return {
                contents: \`export default { counterValue: "error", loadCount: 0 };\`,
                loader: 'js'
              };
            }
          });
        },
      }
    ];
  `,
  files: {
    // The main file that will be directly loaded by the module graph
    "counter.counter.js": `
      // This content doesn't matter since our plugin intercepts it
      console.log('This should not be loaded');
    `,
    // This is a plain text file containing only a number
    // It's NOT part of the module graph, it's only watched via watchedFiles
    "counter.txt": "1",
    "routes/index.ts": `
      import counter from '../counter.counter.js';

      export default function (req, meta) {
        return new Response(\`Counter value: \${counter.counterValue} (Load count: \${counter.loadCount})\`);
      }
    `,
  },
  async test(dev) {
    // Initial load should show counter value 1
    const response1 = await dev.fetch("/");
    await response1.expect.toMatch(/Counter value: 1/);
    
    // We need to ensure the watcher has time to fully initialize
    await Bun.sleep(1000);

    // Modify the counter.txt file (which is in the watchedFiles array)
    await dev.write("counter.txt", "2", { dedent: false });
    
    // Give the watcher time to detect changes
    await dev.waitForHotReload();
    await Bun.sleep(300);

    // After modifying the watched file, the counter should update
    // and the load count should increase
    const response2 = await dev.fetch("/");
    await response2.expect.toMatch(/Counter value: 2/);
    
    // The loadCount should be 2 because the plugin ran again
    await response2.expect.toMatch(/Load count: 2/);

    // Modify counter.txt again
    await dev.write("counter.txt", "3", { dedent: false });
    
    // Wait for the HMR
    await dev.waitForHotReload();
    await Bun.sleep(300);

    // Value should be updated and loadCount increased again
    const response3 = await dev.fetch("/");
    await response3.expect.toMatch(/Counter value: 3/);
    await response3.expect.toMatch(/Load count: 3/);

    // Modify the main JS file as well to ensure both file
    // types trigger reloads
    await dev.write("counter.counter.js", `
      // Different content, still intercepted
      console.log('Still intercepted');
    `);
    
    // Wait for the HMR
    await dev.waitForHotReload();
    await Bun.sleep(300);

    // Counter value should still be 3, and loadCount increases again
    const response4 = await dev.fetch("/");
    await response4.expect.toMatch(/Counter value: 3/);
    await response4.expect.toMatch(/Load count: 4/);
  },
  // Give the test more time to complete
  timeoutMultiplier: 3
});