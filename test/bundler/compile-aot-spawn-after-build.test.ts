import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDirWithBunTypes } from "harness";
import { join } from "node:path";
import { unsupported } from "../aot/harness/compiler";
import { raiseDefaultTimeout } from "../aot/harness/default-timeout";

raiseDefaultTimeout(120_000);

// Linux doesn't start a file that is open for writing anywhere (ETXTBSY). Bun.build writes the executable on another thread, and a
// child that the main thread starts in the meantime gets a copy of the descriptor. Without O_CLOFORK, it has that copy until its exec
// is done, and the more descriptors there are to close, the longer that takes after vfork() returned.
test.skipIf(!isLinux || unsupported !== undefined)(
  "the executable that Bun.build has written can be started while other children are starting",
  async () => {
    const builds = isASAN || isDebug ? 4 : 10;
    using dir = tempDirWithBunTypes("compile-aot-spawn-after-build", {
      "tsconfig.json": `{ "compilerOptions": { "types": ["bun"] } }`,
      "hello.ts": `console.log("hello world");`,
      "build-and-spawn.ts": `
        import { closeSync, openSync } from "node:fs";
        import { join } from "node:path";

        const open: number[] = [];
        try {
          while (open.length < 50_000) open.push(openSync("/dev/null"));
        } catch {
          for (const fd of open.splice(-200)) closeSync(fd);
        }

        let isBuilding = true;
        async function spawnOthers() {
          const cmd = [Bun.which("true")!];
          while (isBuilding) await Bun.spawn({ cmd, stdio: ["ignore", "ignore", "ignore"] }).exited;
        }
        const others = [spawnOthers(), spawnOthers()];

        const outfile = join(import.meta.dir, "hello");
        for (let build = 0; build < ${builds}; build++) {
          await Bun.build({ entrypoints: [join(import.meta.dir, "hello.ts")], compile: { outfile, aot: true } });
          try {
            await using child = Bun.spawn({ cmd: [outfile], stdio: ["ignore", "pipe", "inherit"] });
            process.stdout.write(await child.stdout.text());
          } catch (error) {
            console.log((error as NodeJS.ErrnoException).code);
          }
        }
        isBuilding = false;
        await Promise.all(others);
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "build-and-spawn.ts")],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "hello world\n".repeat(builds), stderr: "", exitCode: 0 });
  },
);
