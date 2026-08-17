import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";

// Temporary: compares process startup of this build (links Metal + Foundation)
// against the bun installed on the agent (does not). Output is read from the
// CI job log; the test itself never fails on the numbers.
test.skipIf(!isMacOS)("startup cost of the linked frameworks (informational)", async () => {
  const systemBun = Bun.which("bun");
  const candidates: Record<string, string> = { thisBuild: bunExe() };
  if (systemBun) candidates.installedBun = systemBun;

  async function timeOne(exe: string): Promise<number> {
    const start = Bun.nanoseconds();
    await using proc = Bun.spawn({ cmd: [exe, "-e", "0"], env: bunEnv, stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return (Bun.nanoseconds() - start) / 1e6;
  }

  const samples: Record<string, number[]> = Object.fromEntries(Object.keys(candidates).map(k => [k, []]));
  for (const name of Object.keys(candidates)) await timeOne(candidates[name]);
  for (let i = 0; i < 40; i++) {
    for (const [name, exe] of Object.entries(candidates)) samples[name].push(await timeOne(exe));
  }

  const summary: Record<string, unknown> = {
    arch: process.arch,
    release: (await Bun.$`sw_vers -productVersion`.text()).trim(),
  };
  for (const [name, times] of Object.entries(samples)) {
    times.sort((a, b) => a - b);
    summary[name] = {
      exe: candidates[name],
      version: (await Bun.$`${candidates[name]} --version`.text()).trim(),
      dylibs: (await Bun.$`otool -L ${candidates[name]}`.text()).trim().split("\n").length - 1,
      min: +times[0].toFixed(2),
      median: +times[times.length >> 1].toFixed(2),
    };
  }
  console.log("WEBGPU_STARTUP " + JSON.stringify(summary));
  expect(samples.thisBuild.length).toBe(40);
});
