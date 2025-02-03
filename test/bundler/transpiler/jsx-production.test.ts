import { describe, expect, test, afterAll } from "bun:test";
import path from "path";
import { bunExe, bunEnv } from "harness";

const original_node_env = bunEnv.NODE_ENV;

// https://github.com/oven-sh/bun/issues/3768
describe("jsx", () => {
  for (const node_env of ["production", "development", "test", ""]) {
    for (const child_node_env of ["production", "development", "test", ""]) {
      test(`parent: ${node_env} child: ${child_node_env} should work`, async () => {
        bunEnv.NODE_ENV = node_env;
        bunEnv.CHILD_NODE_ENV = child_node_env;
        expect([path.join(import.meta.dirname, "jsx-production-entry.ts")]).toRun(
          "<div>Hello World</div>" + "\n" + "<div>Hello World</div>" + "\n",
        );
      });
    }
  }

  afterAll(() => {
    bunEnv.NODE_ENV = original_node_env;
    delete bunEnv.CHILD_NODE_ENV;
  });
});
