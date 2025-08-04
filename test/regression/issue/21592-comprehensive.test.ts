import { describe, test, expect } from "bun:test";
import { itBundled } from "../../bundler/expectBundled";

describe("bundler", () => {
  // https://github.com/oven-sh/bun/issues/21592
  test("minify-identifiers should not generate $ variable that conflicts with global usage", () => {
    itBundled("minify/NoConflictingDollarVariable", {
      files: {
        "/entry.js": /* js */ `
          // Create many variables to force minifier to use all available names
          ${Array.from({ length: 60 }, (_, i) => `var variable${i} = ${i};`).join('\n')}
          
          // Test that no minified variable conflicts with global $ usage
          if (typeof $ !== 'undefined' && $.actions && $.actions.MessageCreate) {
            $.actions.MessageCreate.handle();
            console.log('Global $ accessed successfully');
          } else {
            console.log('Global $ is undefined or missing actions');
          }
          
          // Use all variables to prevent dead code elimination
          console.log('Variables sum:', ${Array.from({ length: 60 }, (_, i) => `variable${i}`).join(' + ')});
        `,
      },
      minifyIdentifiers: true,
      target: "bun",
      onAfterBundle(api) {
        const content = api.readFile("out.js");
        // Verify that $ is not used as a minified variable name
        const variablePattern = /var \$/g;
        const matches = content.match(variablePattern);
        expect(matches).toBeNull(); // Should not find any "var $" declarations
      },
      run: {
        stdout: /Global .* is undefined or missing actions[\s\S]*Variables sum:/,
      },
    });
  });

  test("minify-identifiers does not use reserved names as variable names", () => {
    itBundled("minify/ReservedNamesNotUsed", {
      files: {
        "/entry.js": /* js */ `
          // Create enough variables to potentially use reserved names
          ${Array.from({ length: 100 }, (_, i) => `var var${i} = ${i};`).join('\n')}
          
          console.log('All variables defined');
        `,
      },
      minifyIdentifiers: true,
      target: "bun",
      onAfterBundle(api) {
        const content = api.readFile("out.js");
        
        // Check that reserved names are not used as variable names
        const reservedNames = ['$', 'Promise', 'Require', 'exports', 'module'];
        
        for (const name of reservedNames) {
          const pattern = new RegExp(`var ${name.replace('$', '\\$')} =`, 'g');
          const matches = content.match(pattern);
          expect(matches).toBeNull(); // Should not find any "var [reserved] =" declarations
        }
      },
    });
  });

  test("specific Discord.js pattern that was reported to fail", () => {
    itBundled("minify/DiscordJSSpecificPattern", {
      files: {
        "/index.ts": /* js */ `
          // Simulate Discord.js-like structure
          const { Client, Events, GatewayIntentBits } = require('discord.js');
          
          // Create client
          const client = new Client({ intents: [GatewayIntentBits.Guilds] });
          
          // Simulate the failing pattern - many variables that might force $ usage
          ${Array.from({ length: 55 }, (_, i) => `const temp${i} = ${i};`).join('\n')}
          
          // The specific pattern that was failing
          const $ = {
            actions: {
              MessageCreate: {
                handle: function() {
                  console.log('MessageCreate handler called');
                }
              }
            }
          };
          
          // This was the line causing the error
          $.actions.MessageCreate.handle();
          
          client.once(Events.ClientReady, (c) => {
            console.log('Ready! Logged in as ' + c.user.tag);
          });
        `,
        "/node_modules/discord.js/package.json": `{
          "name": "discord.js",
          "version": "14.0.0",
          "main": "index.js"
        }`,
        "/node_modules/discord.js/index.js": `
          exports.Client = class Client {
            constructor(options) {
              this.options = options;
            }
            once(event, callback) {
              // Mock implementation
              if (event === 'ready') {
                setTimeout(() => callback({ user: { tag: 'TestBot#1234' } }), 0);
              }
            }
          };
          exports.Events = { ClientReady: 'ready' };
          exports.GatewayIntentBits = { Guilds: 1 };
        `,
      },
      minifyIdentifiers: true,
      target: "bun",
      onAfterBundle(api) {
        const content = api.readFile("out.js");
        // Ensure $ is not used as a variable name
        expect(content).not.toMatch(/var \\$/);
        expect(content).not.toMatch(/let \\$/);
        expect(content).not.toMatch(/const \\$/);
      },
      run: {
        stdout: "MessageCreate handler called\nReady! Logged in as TestBot#1234",
      },
    });
  });
});