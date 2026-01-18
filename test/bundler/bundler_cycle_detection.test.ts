import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Test basic cycle detection (uses array scan path, < 8 depth)
  itBundled("bundler/ShallowCycleDetection", {
    files: {
      "/entry.js": /* js */ `
        export {a as b} from './entry'
        export {b as c} from './entry'
        export {c as d} from './entry'
        export {d as a} from './entry'
      `,
    },
    bundleErrors: {
      "/entry.js": [
        `Detected cycle while resolving import "a"`,
        `Detected cycle while resolving import "b"`,
        `Detected cycle while resolving import "c"`,
        `Detected cycle while resolving import "d"`,
      ],
    },
  });

  // Test deep cycle detection (should use hash set path, >= 8 depth)
  itBundled("bundler/DeepCycleDetection", {
    files: {
      "/entry.js": /* js */ `
        export {a as b} from './entry'
        export {b as c} from './entry'
        export {c as d} from './entry'
        export {d as e} from './entry'
        export {e as f} from './entry'
        export {f as g} from './entry'
        export {g as h} from './entry'
        export {h as i} from './entry'
        export {i as j} from './entry'
        export {j as k} from './entry'
        export {k as a} from './entry'
      `,
    },
    bundleErrors: {
      "/entry.js": [
        `Detected cycle while resolving import "a"`,
        `Detected cycle while resolving import "b"`,
        `Detected cycle while resolving import "c"`,
        `Detected cycle while resolving import "d"`,
        `Detected cycle while resolving import "e"`,
        `Detected cycle while resolving import "f"`,
        `Detected cycle while resolving import "g"`,
        `Detected cycle while resolving import "h"`,
        `Detected cycle while resolving import "i"`,
        `Detected cycle while resolving import "j"`,
        `Detected cycle while resolving import "k"`,
      ],
    },
  });

  // Test deep chain without cycle (should work correctly)
  itBundled("bundler/DeepChainNoCycle", {
    files: {
      "/entry.js": /* js */ `
        import { x } from './a.js';
        console.log(x);
      `,
      "/a.js": /* js */ `
        import { x } from './b.js';
        export { x };
      `,
      "/b.js": /* js */ `
        import { x } from './c.js';
        export { x };
      `,
      "/c.js": /* js */ `
        import { x } from './d.js';
        export { x };
      `,
      "/d.js": /* js */ `
        import { x } from './e.js';
        export { x };
      `,
      "/e.js": /* js */ `
        import { x } from './f.js';
        export { x };
      `,
      "/f.js": /* js */ `
        import { x } from './g.js';
        export { x };
      `,
      "/g.js": /* js */ `
        import { x } from './h.js';
        export { x };
      `,
      "/h.js": /* js */ `
        export const x = 42;
      `,
    },
    run: {
      stdout: "42",
    },
  });

  // Test cross-file cycle detection with deep chain
  itBundled("bundler/DeepCrossFileCycle", {
    files: {
      "/entry.js": /* js */ `
        export {a as b} from './foo1'
        export {b as c} from './foo1'
      `,
      "/foo1.js": /* js */ `
        export {c as d} from './foo2'
        export {d as e} from './foo2'
      `,
      "/foo2.js": /* js */ `
        export {e as f} from './foo3'
        export {f as g} from './foo3'
      `,
      "/foo3.js": /* js */ `
        export {g as h} from './foo4'
        export {h as i} from './foo4'
      `,
      "/foo4.js": /* js */ `
        export {i as j} from './entry'
        export {j as a} from './entry'
      `,
    },
    bundleErrors: {
      "/entry.js": [`Detected cycle while resolving import "a"`, `Detected cycle while resolving import "b"`],
    },
  });
});
