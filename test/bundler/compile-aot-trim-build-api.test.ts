import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";
import { spawned, unsupported } from "../aot/run-programs";
import { canTrim, tempDirForAotBuilds } from "./compile-trim-features";

const buildsWhileMappingFiles = `
import { join } from "node:path";

const folder = import.meta.dir;
const mappedFile = join(folder, "mapped");
await Bun.write(mappedFile, Buffer.alloc(4 << 20, 7));

const build = (outfile: string) =>
  Bun.build({ entrypoints: [join(folder, "hello.ts")], compile: { outfile: join(folder, outfile), aot: true, trim: true } });

for (const outfiles of [["first"], ["first"], ["first", "second"], ["first"]]) {
  let isBuilding = true;
  const builds = Promise.all(outfiles.map(build)).finally(() => (isBuilding = false));
  const mappings: Uint8Array[] = [];
  while (isBuilding) {
    if (mappings.length < 4000) mappings.push(Bun.mmap(mappedFile, { shared: false }), Bun.mmap(mappedFile, { shared: false }));
    await Bun.sleep(1);
  }
  await builds;
  for (const bytes of mappings) if (bytes[0] !== 7 || bytes[bytes.length - 1] !== 7) throw new Error("a mapping changed");
  mappings.length = 0;
  Bun.gc(true);
}
console.log("built");
`;

test.skipIf(!!unsupported || !canTrim || isWindows)(
  "Bun.build with compile: { aot: true, trim: true } leaves the memory of other threads mapped",
  async () => {
    using dir = tempDirForAotBuilds("compile-aot-trim-build-api", {
      "hello.ts": `console.log("hello world");`,
      "builds.ts": buildsWhileMappingFiles,
    });
    const folder = String(dir);
    expect(await spawned([bunExe(), "builds.ts"], folder, bunEnv)).toMatchObject({
      stdout: "built\n",
      exitCode: 0,
      signal: null,
    });
    for (const outfile of ["first", "second"])
      expect(await spawned([join(folder, outfile)], folder, bunEnv)).toMatchObject({
        stdout: "hello world\n",
        stderr: "",
        exitCode: 0,
      });
  },
  240_000,
);
