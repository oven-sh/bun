// `test`, `describe` and `beforeAll` of bun:test for a file whose tests all need `--aot`. Where the Bun under test refuses the
// flag (run-programs.ts asks it, and says so on stderr) every test is skipped, whatever is chained to it, and `beforeAll` does
// nothing.
import { beforeAll as beforeAllAnywhere, describe as describeAnywhere, test as testAnywhere } from "bun:test";
import { unsupported } from "./run-programs";

export { unsupported };

// bun:test refuses `.skipIf()`, `.todo` and the like on what is skipped already.
function alwaysSkipped<T extends object>(skipped: T): T {
  return new Proxy(skipped, {
    get(target, name, self) {
      if (typeof name === "string" && /^(skip|todo|failing|concurrent|serial)?[iI]f$/.test(name)) return () => self;
      if (name === "skip" || name === "todo" || name === "only" || name === "failing") return self;
      const value = Reflect.get(target, name, target);
      if (name === "concurrent" || name === "serial") return alwaysSkipped(value as object);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export const test = unsupported ? alwaysSkipped(testAnywhere.skip) : testAnywhere;
export const describe = unsupported ? alwaysSkipped(describeAnywhere.skip) : describeAnywhere;
export const beforeAll: typeof beforeAllAnywhere = unsupported ? () => {} : beforeAllAnywhere;
