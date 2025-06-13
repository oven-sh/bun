import { describe, expect } from "bun:test";
import { join } from "node:path";
import { itBundled } from "./expectBundled";
const fixturePath = join(import.meta.dir, "fixtures/hello.txt");
const macros = /* js */ String.raw`
  export function identity(arg: any) {
    return arg;
  }

  export function file(): Promise<string> {
    return Bun.file(${JSON.stringify(fixturePath)}).text();
  }
`;

describe("bundler", () => {
  itBundled("identity macro", {
    files: {
      "/entry.ts": /* js */ `
        import {identity} from "./macros.ts" with {type: "macro"};
        console.log(identity(100));
      `,
      "/macros.ts": macros,
    },
    run: {
      stdout: "100",
    },
  });

  itBundled("file macro", {
    files: {
      "/entry.ts": /* js */ `
        import {file} from "./macros.ts" with {type: "macro"};
        console.log(file());
      `,
      "/macros.ts": macros,
    },
    run: {
      stdout: "hello world\n123456\n",
    },
  });
});
