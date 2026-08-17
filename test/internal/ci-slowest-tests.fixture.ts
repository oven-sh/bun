// Run by ci-slowest-tests.test.ts with BUN_TEST_SERVICE_mysql_plain set, so
// describeWithContainer resolves the service from the environment (no docker)
// and awaitService prints the `Container ready via docker-compose: ...` line
// the CI log parsers key on.
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("container line fixture", { image: "mysql:8" }, container => {
  test("service comes from the environment", () => {
    expect(container.port).toBe(1);
  });
});
