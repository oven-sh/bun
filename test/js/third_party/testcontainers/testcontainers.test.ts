import { test, expect, describe } from "bun:test";
import { GenericContainer } from "testcontainers";

describe("testcontainers", () => {
  test("should start a container with PostgreSQL", async () => {
    await using container = await new GenericContainer("postgres:alpine")
      .withExposedPorts(5432)
      .withEnvironment({
        POSTGRES_USER: "test",
        POSTGRES_PASSWORD: "test",
        POSTGRES_DB: "test",
      })
      .start();

    const port = container.getMappedPort(5432);
    expect(port).toBeGreaterThan(0);
  }, 120_000);
});
