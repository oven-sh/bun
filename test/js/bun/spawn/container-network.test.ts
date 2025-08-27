import { test, expect } from "bun:test";
import { bunExe, bunEnv, normalizeBunSnapshot } from "harness";

test("container with network namespace creates isolated network", async () => {
  // Skip if not Linux or not running as root
  if (process.platform !== "linux") {
    return;
  }

  const checkRootResult = await Bun.spawn({
    cmd: ["id", "-u"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const uid = parseInt((await checkRootResult.stdout.text()).trim());
  const isRoot = uid === 0;

  // Test with unprivileged user namespace
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      // Check network interfaces
      const ifconfig = Bun.spawnSync(["ip", "link", "show"]);
      console.log("Exit code:", ifconfig.exitCode);
      console.log("Interfaces:", ifconfig.stdout.toString());
      
      // Try to ping loopback (should work if lo is up)
      const ping = Bun.spawnSync(["ping", "-c", "1", "-W", "1", "127.0.0.1"]);
      console.log("Ping loopback exit code:", ping.exitCode);
      
      // Check if we're in a network namespace (should only have lo interface)
      const hasOnlyLoopback = ifconfig.stdout.toString().includes("lo") && 
                              !ifconfig.stdout.toString().includes("eth0") &&
                              !ifconfig.stdout.toString().includes("wlan");
      console.log("Has only loopback:", hasOnlyLoopback);
    `],
    env: bunEnv,
    container: {
      namespace: {
        user: true, // Enable user namespace for unprivileged operation
        network: true, // Enable network namespace
        pid: true, // Enable PID namespace
      },
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(), 
    proc.exited,
  ]);

  // The process should succeed
  expect(exitCode).toBe(0);
  
  // Should have network isolation
  expect(stdout).toContain("Exit code: 0");
  expect(stdout).toContain("lo");
  expect(stdout).toContain("Has only loopback: true");
  
  // Loopback ping should work
  expect(stdout).toContain("Ping loopback exit code: 0");
});

test("container without network namespace shares host network", async () => {
  // Skip if not Linux
  if (process.platform !== "linux") {
    return;
  }

  // Get host network interfaces
  const hostInterfaces = await Bun.spawn({
    cmd: ["ip", "link", "show"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  
  const hostIfaceText = await hostInterfaces.stdout.text();

  // Run container without network namespace
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      const ifconfig = Bun.spawnSync(["ip", "link", "show"]);
      console.log(ifconfig.stdout.toString());
    `],
    env: bunEnv,
    container: {
      namespace: {
        user: true, // Only user namespace, no network isolation
        pid: true,
      },
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should succeed
  expect(exitCode).toBe(0);
  
  // Should see similar interfaces as host (not necessarily identical due to user namespace)
  // But should see more than just loopback
  expect(stdout).toContain("lo");
  // Check if we have any other interface besides lo
  const hasOtherInterfaces = stdout.includes("eth") || stdout.includes("wlan") || 
                             stdout.includes("docker") || stdout.includes("veth") ||
                             stdout.includes("enp") || stdout.includes("wlp");
  expect(hasOtherInterfaces).toBe(true);
});