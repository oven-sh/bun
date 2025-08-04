import { describe, test, expect } from "bun:test";
import { itBundled } from "../../bundler/expectBundled";

describe("bundler", () => {
  // https://github.com/oven-sh/bun/issues/21592
  test("minify-identifiers should not break Discord.js patterns", () => {
    itBundled("minify/DiscordJSPattern", {
      files: {
        "/entry.js": /* js */ `
          // Pattern similar to Discord.js that was failing
          const $ = {
            actions: {
              MessageCreate: {
                handle: function() {
                  console.log("MessageCreate handler called");
                }
              }
            }
          };
          
          // This pattern was failing with: TypeError: undefined is not an object (evaluating '$.actions.MessageCreate.handle')
          function processEvent() {
            $.actions.MessageCreate.handle();
          }
          
          processEvent();
          console.log("Success");
        `,
      },
      minifyIdentifiers: true,
      target: "bun",
      run: {
        stdout: "MessageCreate handler called\nSuccess",
      },
    });
  });

  test("minify-identifiers should preserve $ when used as a global identifier", () => {
    itBundled("minify/PreserveGlobalDollar", {
      files: {
        "/entry.js": /* js */ `
          // Test that $ as a common global identifier isn't incorrectly minified in contexts where it should be preserved
          if (typeof $ !== 'undefined') {
            console.log("$ is defined");
          } else {
            console.log("$ is undefined");
          }
          
          // Create our own $ for testing
          var $ = {
            test: "value"
          };
          
          console.log($.test);
        `,
      },
      minifyIdentifiers: true,
      target: "bun",
      run: {
        stdout: "$ is undefined\nvalue",
      },
    });
  });

  test("minify-identifiers should handle $ in complex module patterns", () => {
    itBundled("minify/ComplexDollarPattern", {
      files: {
        "/entry.js": /* js */ `
          import { handler } from './module.js';
          handler();
        `,
        "/module.js": /* js */ `
          const $ = {
            actions: {
              MessageCreate: {
                handle() {
                  console.log("Module handler called");
                }
              }
            }
          };
          
          export function handler() {
            // This is the pattern that was breaking
            $.actions.MessageCreate.handle();
          }
        `,
      },
      minifyIdentifiers: true,
      target: "bun",
      run: {
        stdout: "Module handler called",
      },
    });
  });
});