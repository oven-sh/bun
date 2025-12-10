import { test, expect, describe } from "bun:test";
import { GenericContainer } from "testcontainers";

describe("testcontainers", () => {
  test("should start a container with PostgreSQL", async () => {
    console.log("starting container");
    const container = await new GenericContainer("postgres:alpine")
      .withExposedPorts(5432)
      .withEnvironment({
        POSTGRES_USER: "test",
        POSTGRES_PASSWORD: "test",
        POSTGRES_DB: "test",
      })
      .start();

    console.log("container started");

    const port = container.getMappedPort(5432);
    expect(port).toBeGreaterThan(0);

    await container.stop();
    console.log("container stopped");
  }, 120_000);
});
