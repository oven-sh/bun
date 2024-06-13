import { expect, test } from "bun:test";
import path from "node:path";
import {} from "harness";

function new_test(name: string) {
  test(name, () => {
    expect([path.join(import.meta.dir, "fixtures", name)]).toRun();
  });
}

new_test("cwd.ts");
