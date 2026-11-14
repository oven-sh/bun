import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const info = (await navigator.gpu.requestAdapter())?.info;
export const hasAdapter = info !== undefined;
// For the report of a failure.
if (info) console.log(`${info.device}, ${info.description}`);

export async function requestDevice(descriptor?: GPUDeviceDescriptor) {
  return (await navigator.gpu.requestAdapter())!.requestDevice(descriptor);
}

/** Chrome comes with a Vulkan loader and with SwiftShader, a driver that runs on the CPU. */
const chrome = ["/opt/google/chrome", "/usr/lib/chromium"].find(directory =>
  ["libvulkan.so.1", "vk_swiftshader_icd.json"].every(file => existsSync(join(directory, file))),
);

/** What gives a process an adapter on this machine, if anything does. */
export const envOfDriver = hasAdapter
  ? {}
  : isLinux && chrome && process.env.LD_LIBRARY_PATH !== chrome
    ? { LD_LIBRARY_PATH: chrome, VK_DRIVER_FILES: join(chrome, "vk_swiftshader_icd.json") }
    : undefined;

/** On a machine without a driver, which skips the tests of `file`. */
export function runWithDriverOfChrome(file: string) {
  if (hasAdapter || !envOfDriver) return;
  test("with the SwiftShader of Chrome", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--timeout=60000", file],
      env: { ...bunEnv, ...envOfDriver },
      stdio: ["ignore", "inherit", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toMatch(/^ [1-9]\d* pass$/m);
    expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  }, 120_000);
}
