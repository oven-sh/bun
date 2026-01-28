import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("cloudflare/ExportsWorkerdCondition", {
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'; console.log('done');`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "workerd": "./workerd.js",
            "worker": "./worker.js",
            "browser": "./browser.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/workerd.js": `console.log('workerd')`,
      "/Users/user/project/node_modules/pkg/worker.js": `console.log('worker')`,
      "/Users/user/project/node_modules/pkg/browser.js": `console.log('browser')`,
      "/Users/user/project/node_modules/pkg/default.js": `console.log('default')`,
    },
    target: "cloudflare",
    outfile: "/Users/user/project/out.js",
    run: {
      stdout: "workerd\ndone",
    },
  });

  itBundled("cloudflare/ExportsWorkerFallback", {
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'; console.log('done');`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "worker": "./worker.js",
            "browser": "./browser.js",
            "node": "./node.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/worker.js": `console.log('worker')`,
      "/Users/user/project/node_modules/pkg/browser.js": `console.log('browser')`,
      "/Users/user/project/node_modules/pkg/node.js": `console.log('node')`,
      "/Users/user/project/node_modules/pkg/default.js": `console.log('default')`,
    },
    target: "cloudflare",
    outfile: "/Users/user/project/out.js",
    run: {
      stdout: "worker\ndone",
    },
  });

  itBundled("cloudflare/ExportsBrowserFallback", {
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'; console.log('done');`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "browser": "./browser.js",
            "node": "./node.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/browser.js": `console.log('browser')`,
      "/Users/user/project/node_modules/pkg/node.js": `console.log('node')`,
      "/Users/user/project/node_modules/pkg/default.js": `console.log('default')`,
    },
    target: "cloudflare",
    outfile: "/Users/user/project/out.js",
    run: {
      stdout: "browser\ndone",
    },
  });

  itBundled("cloudflare/ExportsFallbackToDefault", {
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'; console.log('done');`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "node": "./node.js",
            "deno": "./deno.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/node.js": `console.log('node')`,
      "/Users/user/project/node_modules/pkg/deno.js": `console.log('deno')`,
      "/Users/user/project/node_modules/pkg/default.js": `console.log('default')`,
    },
    target: "cloudflare",
    outfile: "/Users/user/project/out.js",
    run: {
      stdout: "default\ndone",
    },
  });

  itBundled("cloudflare/ExportsPriorityOrder", {
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'; console.log('done');`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "workerd": "./workerd.js",
            "worker": "./worker.js",
            "browser": "./browser.js",
            "node": "./node.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/workerd.js": `console.log('workerd')`,
      "/Users/user/project/node_modules/pkg/worker.js": `console.log('worker')`,
      "/Users/user/project/node_modules/pkg/browser.js": `console.log('browser')`,
      "/Users/user/project/node_modules/pkg/node.js": `console.log('node')`,
      "/Users/user/project/node_modules/pkg/default.js": `console.log('default')`,
    },
    target: "cloudflare",
    outfile: "/Users/user/project/out.js",
    run: {
      stdout: "workerd\ndone",
    },
  });

  itBundled("cloudflare/MainFieldsPreferModule", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./main.esm.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        module.exports = function() {
          return 'cjs'
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.esm.js": /* js */ `
        export default function() {
          return 'esm'
        }
      `,
    },
    target: "cloudflare",
    run: {
      stdout: "esm",
    },
  });

  itBundled("cloudflare/IsServerSide", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        // Cloudflare should behave like a server-side target
        console.log(typeof process !== 'undefined' ? 'server' : 'client')
      `,
    },
    target: "cloudflare",
    run: {
      stdout: "server",
    },
  });

  itBundled("cloudflare/MultiplePackagesWithDifferentConditions", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg2'
        import 'pkg3'
        console.log('done')
      `,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "workerd": "./workerd.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/workerd.js": `console.log('pkg1:workerd')`,
      "/Users/user/project/node_modules/pkg1/default.js": `console.log('pkg1:default')`,
      "/Users/user/project/node_modules/pkg2/package.json": /* json */ `
        {
          "exports": {
            "worker": "./worker.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg2/worker.js": `console.log('pkg2:worker')`,
      "/Users/user/project/node_modules/pkg2/default.js": `console.log('pkg2:default')`,
      "/Users/user/project/node_modules/pkg3/package.json": /* json */ `
        {
          "exports": {
            "browser": "./browser.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg3/browser.js": `console.log('pkg3:browser')`,
      "/Users/user/project/node_modules/pkg3/default.js": `console.log('pkg3:default')`,
    },
    target: "cloudflare",
    outfile: "/Users/user/project/out.js",
    run: {
      stdout: "pkg1:workerd\npkg2:worker\npkg3:browser\ndone",
    },
  });

  itBundled("cloudflare/NestedExportsWithConditions", {
    files: {
      "/Users/user/project/src/entry.js": `import { foo } from 'pkg/sub'; console.log(foo);`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "./sub": {
              "workerd": "./sub-workerd.js",
              "default": "./sub-default.js"
            }
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/sub-workerd.js": `export const foo = 'workerd'`,
      "/Users/user/project/node_modules/pkg/sub-default.js": `export const foo = 'default'`,
    },
    target: "cloudflare",
    outfile: "/Users/user/project/out.js",
    run: {
      stdout: "workerd",
    },
  });
});
