import { describe } from "bun:test";
import { bunEnv } from "harness";
import { itBundled } from "./expectBundled";

const env = {
  ...bunEnv,
  // Deflake these tests that check import evaluation order is consistent.
  BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
};

describe("bundler", () => {
  itBundled("splitting/DynamicImportCSSFile", {
    files: {
      "/client.tsx": `import('./test')`,
      "/test.ts": `
        import './test.css'
        console.log('test.ts loaded')
      `,
      "/test.css": `.aaa { color: red; }`,
    },
    entryPoints: ["/client.tsx"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/client.js",
      env,
      stdout: "test.ts loaded",
    },
  });

  itBundled("splitting/DynamicImportMultipleCSSImports", {
    files: {
      "/entry.js": `
        import('./module1').then(() => console.log('module1 loaded'));
        import('./module2').then(() => console.log('module2 loaded'));
      `,
      "/module1.js": `
        import './styles1.css'
        console.log('module1.js executed')
      `,
      "/module2.js": `
        import './styles2.css'
        console.log('module2.js executed')
      `,
      "/styles1.css": `.class1 { color: red; }`,
      "/styles2.css": `.class2 { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "module1.js executed\nmodule2.js executed\nmodule1 loaded\nmodule2 loaded",
    },
  });

  itBundled("splitting/StaticAndDynamicCSSImports", {
    files: {
      "/entry.js": `
        import './static.css';
        import('./dynamic').then(() => console.log('dynamic module loaded'));
      `,
      "/dynamic.js": `
        import './dynamic.css'
        console.log('dynamic.js executed')
      `,
      "/static.css": `.static { color: green; }`,
      "/dynamic.css": `.dynamic { color: purple; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "dynamic.js executed\ndynamic module loaded",
    },
  });

  itBundled("splitting/NestedDynamicImportWithCSS", {
    files: {
      "/entry.js": `
        import('./level1').then(() => console.log('level1 loaded'));
      `,
      "/level1.js": `
        import './level1.css'
        console.log('level1.js executed')
        import('./level2').then(() => console.log('level2 loaded from level1'));
      `,
      "/level2.js": `
        import './level2.css'
        console.log('level2.js executed')
      `,
      "/level1.css": `.level1 { color: red; }`,
      "/level2.css": `.level2 { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "level1.js executed\nlevel1 loaded\nlevel2.js executed\nlevel2 loaded from level1",
    },
  });

  itBundled("splitting/SharedCSSBetweenChunks", {
    files: {
      "/entry.js": `
        import('./moduleA').then(() => console.log('moduleA loaded'));
        import('./moduleB').then(() => console.log('moduleB loaded'));
      `,
      "/moduleA.js": `
        import './shared.css'
        import './moduleA.css'
        console.log('moduleA.js executed')
      `,
      "/moduleB.js": `
        import './shared.css'
        import './moduleB.css'
        console.log('moduleB.js executed')
      `,
      "/shared.css": `.shared { color: green; }`,
      "/moduleA.css": `.moduleA { color: red; }`,
      "/moduleB.css": `.moduleB { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "moduleA.js executed\nmoduleB.js executed\nmoduleA loaded\nmoduleB loaded",
    },
  });

  itBundled("splitting/DynamicImportChainWithCSS", {
    files: {
      "/entry.js": `
        const chain = () => import('./chain1')
          .then(() => {
            console.log('chain1 loaded');
            return import('./chain2');
          })
          .then(() => {
            console.log('chain2 loaded');
            return import('./chain3');
          })
          .then(() => {
            console.log('chain3 loaded');
          });
        chain();
      `,
      "/chain1.js": `
        import './chain1.css'
        console.log('chain1.js executed')
      `,
      "/chain2.js": `
        import './chain2.css'
        console.log('chain2.js executed')
      `,
      "/chain3.js": `
        import './chain3.css'
        console.log('chain3.js executed')
      `,
      "/chain1.css": `.chain1 { color: red; }`,
      "/chain2.css": `.chain2 { color: green; }`,
      "/chain3.css": `.chain3 { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "chain1.js executed\nchain1 loaded\nchain2.js executed\nchain2 loaded\nchain3.js executed\nchain3 loaded",
    },
  });

  itBundled("splitting/ConditionalDynamicImportWithCSS", {
    files: {
      "/entry.js": `
        const condition = true;
        if (condition) {
          import('./moduleTrue').then(() => console.log('true branch loaded'));
        } else {
          import('./moduleFalse').then(() => console.log('false branch loaded'));
        }
      `,
      "/moduleTrue.js": `
        import './true.css'
        console.log('moduleTrue.js executed')
      `,
      "/moduleFalse.js": `
        import './false.css'
        console.log('moduleFalse.js executed')
      `,
      "/true.css": `.true { color: green; }`,
      "/false.css": `.false { color: red; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "moduleTrue.js executed\ntrue branch loaded",
    },
  });

  itBundled("splitting/MultipleEntryPointsWithSharedCSS", {
    files: {
      "/entry1.js": `
        import './shared.css'
        import './entry1.css'
        console.log('entry1.js executed')
      `,
      "/entry2.js": `
        import './shared.css'
        import './entry2.css'
        console.log('entry2.js executed')
      `,
      "/shared.css": `.shared { font-size: 16px; }`,
      "/entry1.css": `.entry1 { color: red; }`,
      "/entry2.css": `.entry2 { color: blue; }`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: [
      {
        file: "/out/entry1.js",
        env,
        stdout: "entry1.js executed",
      },
      {
        file: "/out/entry2.js",
        env,
        stdout: "entry2.js executed",
      },
    ],
  });

  itBundled("splitting/DynamicImportWithOnlyCSSNoJS", {
    files: {
      "/entry.js": `
        import('./styles.css').then(() => console.log('CSS import succeeded')).catch(err => console.log('CSS import failed:', err.message));
      `,
      "/styles.css": `.styles { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "CSS import succeeded",
    },
  });

  itBundled("splitting/CircularDynamicImportsWithCSS", {
    files: {
      "/entry.js": `
        import('./a').then(module => {
          console.log('a loaded from entry');
          return import('./b');
        }).then(module => {
          console.log('b loaded from entry, value:', module.bValue);
        });
      `,
      "/a.js": `
        import './a.css'
        console.log('a.js executed')
      `,
      "/b.js": `
        import './b.css'
        console.log('b.js executed')
        export const bValue = 'B';
        // Import a to create circular dependency
        import * as A from './a';
        console.log('b.js imports a', A);
      `,
      "/a.css": `.a { color: red; }`,
      "/b.css": `.b { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "a.js executed\na loaded from entry\nb.js executed\nb.js imports a {}\nb loaded from entry, value: B",
    },
  });
});
