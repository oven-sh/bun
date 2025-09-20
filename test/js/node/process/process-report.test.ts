import { describe, expect, it } from "bun:test";
import { isWindows, bunExe, bunEnv, tempDir } from "harness";

describe("process.report", () => {
  it("process.report.getReport() returns a valid report object", () => {
    const report = process.report.getReport();

    expect(report).toBeDefined();
    expect(typeof report).toBe("object");

    // Check header structure
    expect(report.header).toBeDefined();
    expect(report.header.reportVersion).toBe(3);
    expect(report.header.event).toBe("JavaScript API");
    expect(report.header.trigger).toBe("GetReport");
    expect(report.header.filename).toBeNull();
    expect(report.header.dumpEventTime).toBeDefined();
    expect(report.header.dumpEventTimeStamp).toBeDefined();
    expect(report.header.processId).toBe(process.pid);
    expect(report.header.threadId).toBeGreaterThanOrEqual(0);
    expect(report.header.cwd).toBeDefined();
    expect(report.header.commandLine).toBeArray();
    expect(report.header.nodejsVersion).toBeDefined();
    expect(report.header.wordSize).toBe(64);
    expect(report.header.arch).toBeDefined();
    expect(report.header.platform).toBeDefined();
    expect(report.header.componentVersions).toBeDefined();
    expect(report.header.release).toBeDefined();

    if (isWindows) {
      expect(report.header.osName).toBe("Windows_NT");
      expect(report.header.osRelease).toMatch(/^\d+\.\d+\.\d+/);
      expect(report.header.osVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(report.header.osMachine).toMatch(/^(x86_64|i686|aarch64|arm)/);
    } else {
      expect(report.header.osName).toBeDefined();
      expect(report.header.osRelease).toBeDefined();
      expect(report.header.osVersion).toBeDefined();
      expect(report.header.osMachine).toBeDefined();
    }

    expect(report.header.host).toBeDefined();
    expect(report.header.cpus).toBeArray();
    expect(report.header.networkInterfaces).toBeArray();

    // Check JavaScript heap structure
    expect(report.javascriptHeap).toBeDefined();
    expect(typeof report.javascriptHeap.totalHeapSize).toBe("number");
    expect(report.javascriptHeap.totalHeapSize).toBeGreaterThan(0);
    expect(typeof report.javascriptHeap.usedHeapSize).toBe("number");
    expect(report.javascriptHeap.usedHeapSize).toBeGreaterThan(0);
    expect(typeof report.javascriptHeap.heapSizeLimit).toBe("number");
    expect(report.javascriptHeap.heapSizeLimit).toBeGreaterThanOrEqual(0);
    expect(typeof report.javascriptHeap.externalMemory).toBe("number");
    expect(report.javascriptHeap.externalMemory).toBeGreaterThanOrEqual(0);
    expect(report.javascriptHeap.heapSpaceStatistics).toBeDefined();

    // Check JavaScript stack
    expect(report.javascriptStack).toBeDefined();
    expect(typeof report.javascriptStack).toBe("string");

    // Check native stack (may be empty)
    expect(report.nativeStack).toBeArray();

    // Check resource usage
    expect(report.resourceUsage).toBeDefined();
    expect(report.resourceUsage.userCpuSeconds).toBeGreaterThanOrEqual(0);
    expect(report.resourceUsage.kernelCpuSeconds).toBeGreaterThanOrEqual(0);
    expect(report.resourceUsage.maxRss).toBeGreaterThanOrEqual(0);

    // Check UV thread resource usage
    expect(report.uvthreadResourceUsage).toBeDefined();

    // Check libuv handles
    expect(report.libuv).toBeArray();

    // Check workers
    expect(report.workers).toBeArray();

    // Check environment variables
    expect(report.environmentVariables).toBeDefined();
    expect(typeof report.environmentVariables).toBe("object");

    // Check user limits
    expect(report.userLimits).toBeDefined();

    // Check shared objects
    expect(report.sharedObjects).toBeArray();
    if (isWindows) {
      // On Windows, should contain DLLs
      expect(report.sharedObjects.length).toBeGreaterThan(0);
      expect(report.sharedObjects.some(dll => dll.includes(".dll"))).toBe(true);
    }

    // Check CPUs
    expect(report.cpus).toBeArray();
    if (isWindows) {
      expect(report.cpus.length).toBeGreaterThan(0);
      report.cpus.forEach(cpu => {
        expect(cpu.model).toBeDefined();
        expect(cpu.speed).toBeGreaterThanOrEqual(0);
        expect(cpu.times).toBeDefined();
        expect(cpu.times.user).toBeGreaterThanOrEqual(0);
        expect(cpu.times.sys).toBeGreaterThanOrEqual(0);
        expect(cpu.times.idle).toBeGreaterThanOrEqual(0);
      });
    }

    // Check network interfaces
    expect(report.networkInterfaces).toBeArray();
  });

  it("process.report properties are accessible", () => {
    expect(process.report.compact).toBe(false);
    expect(process.report.directory).toBe("");
    expect(process.report.filename).toBe("");
    expect(process.report.reportOnFatalError).toBe(false);
    expect(process.report.reportOnSignal).toBe(false);
    expect(process.report.reportOnUncaughtException).toBeDefined();
    expect(process.report.excludeEnv).toBeDefined();
  });

  it("process.report.getReport() works from spawned process", async () => {
    using dir = tempDir("process-report", {
      "test.js": `
        const report = process.report.getReport();
        console.log(JSON.stringify({
          hasHeader: !!report.header,
          hasHeap: !!report.javascriptHeap,
          hasResourceUsage: !!report.resourceUsage,
          headerProcessId: report.header?.processId,
          osName: report.header?.osName,
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const result = JSON.parse(stdout);
    expect(result.hasHeader).toBe(true);
    expect(result.hasHeap).toBe(true);
    expect(result.hasResourceUsage).toBe(true);
    expect(result.headerProcessId).toBeGreaterThan(0);

    if (isWindows) {
      expect(result.osName).toBe("Windows_NT");
    } else {
      expect(result.osName).toBeDefined();
    }
  });

  it("process.report.writeReport is callable", () => {
    // Just verify the function exists and is callable
    expect(typeof process.report.writeReport).toBe("function");
    // TODO: Implement writeReport functionality
  });
});