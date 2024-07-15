import { itBundled } from "./expectBundled";
import { describe, expect } from "bun:test";

const fakeReactNodeModules = {
  "/node_modules/react/index.js": /* js */ `
    module.exports = { react: "react" }
  `,
  "/node_modules/react/package.json": /* json */ `
    {
      "name": "react",
      "version": "2.0.0",
      "main": "index.js"
    }
  `,
};

describe("bundler", () => {
  itBundled("cjs2esm/ModuleExportsFunction", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo());
      `,
      "/node_modules/lib/index.js": /* js */ `
        module.exports.foo = function() {
          return 'foo';
        }
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("cjs2esm/ImportNamedFromExportStarCJSModuleRef", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from './foo';
        console.log(foo);
      `,
      "/foo.js": /* js */ `
        export * from './bar.cjs';
      `,
      "/bar.cjs": /* js */ `
        module.exports.foo = 'bar';
      `,
    },
    run: {
      stdout: "bar",
    },
  });
  itBundled("cjs2esm/ImportNamedFromExportStarCJS", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from './foo';
        console.log(foo);
      `,
      "/foo.js": /* js */ `
        export * from './bar.cjs';
      `,
      "/bar.cjs": /* js */ `
        exports.foo = 'bar';
      `,
    },
    run: {
      stdout: "bar",
    },
  });
  itBundled("cjs2esm/BadNamedImportNamedReExportedFromCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import {bad} from './foo';
        console.log(bad);
      `,
      "/foo.js": /* js */ `
        export {bad} from './bar.cjs';
      `,
      "/bar.cjs": /* js */ `
        exports.foo = 'bar';
      `,
    },
    run: {
      stdout: "undefined",
    },
  });
  itBundled("cjs2esm/ExportsFunction", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo());
      `,
      "/node_modules/lib/index.js": /* js */ `
        exports.foo = function() {
          return 'foo';
        }
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("cjs2esm/ModuleExportsFunctionTreeShaking", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo());
      `,
      "/node_modules/lib/index.js": /* js */ `
        module.exports.foo = function() {
          return 'foo';
        }
        module.exports.bar = function() {
          return 'remove_me';
        }
      `,
    },
    cjs2esm: true,
    dce: true,
    treeShaking: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("cjs2esm/ModuleExportsEqualsRequire", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo);
      `,
      "/node_modules/lib/index.js": /* js */ `
        // bundler should see through this
        module.exports = require('./library.js')
      `,
      "/node_modules/lib/library.js": /* js */ `
        module.exports.foo = 'bar';
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "bar",
    },
  });
  itBundled("cjs2esm/ModuleExportsBasedOnNodeEnvProduction", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo);
      `,
      "/node_modules/lib/index.js": /* js */ `
        // bundler should see through this
        if (process.env.NODE_ENV === 'production') {
          module.exports = require('./library.prod.js')
        } else {
          module.exports = require('./library.dev.js')
        }
      `,
      "/node_modules/lib/library.prod.js": /* js */ `
        module.exports.foo = 'production';
      `,
      "/node_modules/lib/library.dev.js": /* js */ `
        module.exports.foo = 'FAILED';
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    env: {
      NODE_ENV: "production",
    },
    run: {
      stdout: "production",
    },
  });
  itBundled("cjs2esm/ModuleExportsBasedOnNodeEnvDevelopment", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo);
      `,
      "/node_modules/lib/index.js": /* js */ `
        if (process.env.NODE_ENV === 'production') {
          module.exports = require('./library.prod.js')
        } else {
          module.exports = require('./library.dev.js')
        }
      `,
      "/node_modules/lib/library.prod.js": /* js */ `
        module.exports.foo = 'FAILED';
      `,
      "/node_modules/lib/library.dev.js": /* js */ `
        module.exports.foo = 'development';
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    env: {
      NODE_ENV: "development",
    },
    run: {
      stdout: "development",
    },
  });
  itBundled("cjs2esm/ModuleExportsEqualsRuntimeCondition", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo);
      `,
      "/node_modules/lib/index.js": /* js */ `
        // if the branch is unknown, we have to include both.
        if (globalThis.USE_PROD) {
          module.exports = require('./library.prod.js')
        } else {
          module.exports = require('./library.dev.js')
        }
      `,
      // these should have the cjs transform
      "/node_modules/lib/library.prod.js": /* js */ `
        module.exports.foo = 'production';
      `,
      "/node_modules/lib/library.dev.js": /* js */ `
        module.exports.foo = 'development';
      `,
    },
    cjs2esm: {
      unhandled: [
        "/node_modules/lib/index.js",
        "/node_modules/lib/library.prod.js",
        "/node_modules/lib/library.dev.js",
      ],
    },
    run: {
      stdout: "development",
    },
  });
  itBundled("cjs2esm/UnwrappedModuleRequireAssigned", {
    files: {
      "/entry.js": /* js */ `
        const react = require("react");
        console.log(react.react);
        
        const react1 = (console.log(require("react").react), require("react"));
        console.log(react1.react);
        
        const react2 = (require("react"), console.log(require("react").react));
        console.log(react2);
        
        let x = {};
        x.react = require("react");
        console.log(x.react.react);
        
        console.log(require("react").react);
        
        let y = {};
        y[require("react")] = require("react");
        console.log(y[require("react")].react);

        let r = require("react");
        console.log(r.react);
        r = require("react");
        console.log(r.react);

        let n = 1;
        n = require("react");
        console.log(n.react);

        let m = 1,
          o = require("react");
        console.log(m, o.react);

        let h = Math.random() > 0.5;
        let p = require(h ? "react" : "react");
        console.log(p.react);

        console.log(require(h ? "react" : "react").react);
      `,
      ...fakeReactNodeModules,
    },
    onAfterBundle: api => {
      const code = api.readFile("out.js");
      expect(code).toContain("__toESM(");
    },
    run: {
      stdout: "react\nreact\nreact\nreact\nundefined\nreact\nreact\nreact\nreact\nreact\nreact\n1 react\nreact\nreact",
    },
  });
});
