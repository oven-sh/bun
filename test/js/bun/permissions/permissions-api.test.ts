import { describe, expect, test } from "bun:test";

describe("Bun.permissions API", () => {
  test("Bun.permissions.query returns permission status", async () => {
    const status = await Bun.permissions.query({ name: "read" });
    expect(status).toBeDefined();
    expect(status.state).toBeDefined();
    expect(["granted", "denied", "prompt"]).toContain(status.state);
  });

  test("Bun.permissions.querySync returns permission status synchronously", () => {
    const status = Bun.permissions.querySync({ name: "write" });
    expect(status).toBeDefined();
    expect(status.state).toBeDefined();
    expect(["granted", "denied", "prompt"]).toContain(status.state);
  });

  test("Bun.permissions.query with path returns permission status", async () => {
    const status = await Bun.permissions.query({ name: "read", path: "/tmp" });
    expect(status).toBeDefined();
    expect(status.state).toBeDefined();
  });

  test("Bun.permissions.query with host returns permission status", async () => {
    const status = await Bun.permissions.query({ name: "net", host: "localhost:3000" });
    expect(status).toBeDefined();
    expect(status.state).toBeDefined();
  });

  test("Bun.permissions.query with variable returns permission status", async () => {
    const status = await Bun.permissions.query({ name: "env", variable: "PATH" });
    expect(status).toBeDefined();
    expect(status.state).toBeDefined();
  });

  test("Bun.permissions.query with command returns permission status", async () => {
    const status = await Bun.permissions.query({ name: "run", command: "/bin/ls" });
    expect(status).toBeDefined();
    expect(status.state).toBeDefined();
  });

  test("Bun.permissions.query supports all permission types", async () => {
    const types = ["read", "write", "net", "env", "sys", "run", "ffi"];
    for (const name of types) {
      const status = await Bun.permissions.query({ name });
      expect(status.state).toBeDefined();
    }
  });

  test("Bun.permissions.query throws on invalid name", () => {
    expect(() => Bun.permissions.query({ name: "invalid" })).toThrow("Unknown permission name");
  });

  test("Bun.permissions.query throws on missing name", () => {
    expect(() => Bun.permissions.query({} as any)).toThrow("'name' property");
  });

  test("Bun.permissions.request returns permission status", async () => {
    const status = await Bun.permissions.request({ name: "read" });
    expect(status).toBeDefined();
    expect(status.state).toBeDefined();
  });

  test("Bun.permissions.revoke returns denied status", async () => {
    const status = await Bun.permissions.revoke({ name: "read", path: "/nonexistent/path/for/test" });
    expect(status).toBeDefined();
    // After revoke, the permission should be denied
    expect(status.state).toBe("denied");
  });
});
