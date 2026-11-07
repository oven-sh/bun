import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isMacOS, isWindows } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawned, unsupported } from "../aot/harness/commands";
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
  // A mapping has no page resident until it is read. Each is unmapped as soon as it has been read, so the pages of one count at a time, however many
  // mappings a slow build leaves time for and however many pages the system maps for one that is read.
  for (const bytes of mappings) {
    if (bytes[0] !== 7 || bytes[bytes.length - 1] !== 7) throw new Error("a mapping changed");
    bytes.buffer.transfer(0);
  }
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

test.skipIf(!!unsupported || !isMacOS)("Bun.build with compile: { aot: true } embeds macos.infoPlist", async () => {
  const infoPlist = `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>sh.bun.test.aot-build-api</string></dict></plist>`;
  using dir = tempDirForAotBuilds("compile-aot-info-plist-build-api", {
    "hello.ts": `console.log("hello world");`,
    "embedded.plist": infoPlist,
    "build.ts": `await Bun.build({ entrypoints: ["hello.ts"], compile: { outfile: "hello", aot: true, macos: { infoPlist: "embedded.plist" } } });`,
  });
  const folder = String(dir);
  const hello = join(folder, "hello");
  const saysHello = { stdout: "hello world\n", stderr: "", exitCode: 0 };

  expect(await spawned([bunExe(), "build.ts"], folder, bunEnv)).toMatchObject({
    stdout: "",
    exitCode: 0,
    signal: null,
  });
  expect(readFileSync(hello).includes(infoPlist)).toBe(true);
  expect(await spawned([hello], folder, bunEnv)).toMatchObject(saysHello);
  if (isArm64) {
    expect(await spawned(["codesign", "--verify", hello], folder, bunEnv)).toMatchObject({ stderr: "", exitCode: 0 });
    const described = await spawned(["codesign", "--display", "--verbose=2", hello], folder, bunEnv);
    expect(described.stderr).toContain("Info.plist entries=1");
  }
  // Bun does not sign an executable for x64.
  expect(await spawned(["codesign", "--force", "--sign", "-", hello], folder, bunEnv)).toMatchObject({ exitCode: 0 });
  const signed = await spawned(["codesign", "--display", "--verbose=2", hello], folder, bunEnv);
  expect(signed.stderr).toContain("Identifier=sh.bun.test.aot-build-api");
  expect(signed.stderr).toContain("Info.plist entries=1");
  expect(await spawned([hello], folder, bunEnv)).toMatchObject(saysHello);
});
