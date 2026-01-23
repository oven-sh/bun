import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("issue-25675", () => {
    itBundled("issue/25675/SwitchAfterReturn", {
        files: {
            "/entry.ts": /* ts */ `
        const a = 1;
        const f1 = () => {
          return;
          switch (a) {
            case 2: {
              console.log('FAIL'); // Should be removed (dce check)
              break;
            }
          }
        }
        f1();
      `,
        },
        minifySyntax: true,
        dce: true,
        onAfterBundle(api) {
            if (api.readFile("/out.js").includes("switch")) {
                throw new Error("Switch statement was not eliminated");
            }
        },
        run: {
            stdout: "",
        },
    });

    itBundled("issue/25675/IfAfterReturn", {
        files: {
            "/entry.ts": /* ts */ `
        const a = 1;
        const f2 = () => {
          return;
          if (a === 2) {
            console.log('FAIL'); // Should be removed (dce check)
          }
        }
        f2();
      `,
        },
        minifySyntax: true,
        dce: true,
        run: {
            stdout: "",
        },
    });

    itBundled("issue/25675/SwitchSideEffects", {
        files: {
            "/entry.ts": /* ts */ `
        function test() {
          return "early";
          switch (Math.random()) {
            case 0:
              console.log("FAIL");
              break;
            default:
              console.log("FAIL");
          }
        }
        test();
      `,
        },
        minifySyntax: true,
        dce: true,
        onAfterBundle(api) {
            if (api.readFile("/out.js").includes("switch")) {
                throw new Error("Switch statement was not eliminated");
            }
        },
        run: {
            stdout: "",
        },
    });

    itBundled("issue/25675/VarHoistInDeadSwitch", {
        files: {
            "/entry.ts": /* ts */ `
        "use strict";
        function test() {
          if (false) {
            switch(42) {
              case 42: {
                var hello = 123;
                break;
              }
            }
          }
          return hello;
        }
        console.log(typeof test());
      `,
        },
        minifySyntax: true,
        onAfterBundle(api) {
            if (api.readFile("/out.js").includes("123")) {
                throw new Error("Assignment value should be eliminated");
            }
        },
        run: {
            stdout: "undefined",
        },
    });
});
