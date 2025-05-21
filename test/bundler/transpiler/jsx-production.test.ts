import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv } from "harness";
import path from "path";

const original_node_env = bunEnv.NODE_ENV;

// https://github.com/oven-sh/bun/issues/3768
describe("jsx", () => {
  for (const node_env of ["production", "development", "test", ""]) {
    for (const child_node_env of ["production", "development", "test", ""]) {
      test(`react-jsxDEV parent: ${node_env} child: ${child_node_env} should work`, async () => {
        bunEnv.NODE_ENV = node_env;
        bunEnv.CHILD_NODE_ENV = child_node_env;
        bunEnv.TSCONFIG_JSX = "react-jsxdev";
        expect([path.join(import.meta.dirname, "jsx-dev", "jsx-dev.tsx")]).toRun(
          "<div>Hello World</div>" + "\n" + "<div>Hello World</div>" + "\n",
        );
      });

      test(`react-jsx parent: ${node_env} child: ${child_node_env} should work`, async () => {
        bunEnv.NODE_ENV = node_env;
        bunEnv.CHILD_NODE_ENV = child_node_env;
        bunEnv.TSCONFIG_JSX = "react-jsx";
        expect([path.join(import.meta.dirname, "jsx-production-entry.ts")]).toRun(
          "<div>Hello World</div>" + "\n" + "<div>Hello World</div>" + "\n",
        );
      });
    }
  }

  afterAll(() => {
    bunEnv.NODE_ENV = original_node_env;
    delete bunEnv.CHILD_NODE_ENV;
    delete bunEnv.TSCONFIG_JSX;
  });
});
