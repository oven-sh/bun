import { expect, test } from "bun:test";
import { isLinux, isMacOS, randomPort, VerdaccioRegistry } from "harness";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// A registry that outlives its test file keeps its port bound for the rest of
// the CI job. The node test suite binds fixed ports (common.PORT, 12346-12349),
// so a leaked listener on one of them fails an unrelated test with EADDRINUSE.
test("VerdaccioRegistry.stop() terminates the registry process and frees its port", async () => {
  const registry = new VerdaccioRegistry();
  await registry.start();
  const proc = registry.process!;
  expect(proc.exitCode).toBeNull();
  expect(proc.signalCode).toBeNull();

  await registry.stop();

  expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
  using listener = Bun.listen({ hostname: "127.0.0.1", port: registry.port, socket: { data() {} } });
  expect(listener.port).toBe(registry.port);
});

test("VerdaccioRegistry.start() rejects when the registry exits before it listens", async () => {
  using occupied = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const registry = new VerdaccioRegistry();
  registry.port = occupied.port;
  const outcome = await registry.start().then(
    () => "started",
    (error: Error) => error.message,
  );
  expect(outcome).toContain("verdaccio exited before it started listening");
});

function ephemeralPortRange(): [number, number] | undefined {
  if (isLinux) {
    const [low, high] = readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/);
    return [Number(low), Number(high)];
  }
  if (isMacOS) {
    const first = execSync("sysctl -n net.inet.ip.portrange.first", { encoding: "utf8" });
    const last = execSync("sysctl -n net.inet.ip.portrange.last", { encoding: "utf8" });
    return [Number(first), Number(last)];
  }
}

const range = ephemeralPortRange();

test.skipIf(!range)("randomPort() hands out distinct ports from the kernel's ephemeral range", () => {
  const [low, high] = range!;
  const ports = Array.from({ length: 200 }, randomPort);
  expect(new Set(ports).size).toBe(ports.length);
  expect(ports.filter(port => port < low || port > high)).toEqual([]);
});
