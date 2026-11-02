import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { spawned, unsupported } from "../aot/harness/commands";
import { inTurn } from "../aot/harness/shared-builds";
import { copyWithoutDebugInformation, withoutDebugInformation } from "../aot/harness/without-debug-information";
import { canTrim, tempDirForAotBuilds } from "./compile-trim-features";

const files = {
  "empty.ts": "",
  "hello.ts": `console.log("hello");`,
  "text.ts": `console.log(new Function("return " + process.argv[2])(), /a+/u.test("aa"), [3, 1, 2].toSorted().join());`,
  "server.ts": `const server = Bun.serve({ port: 0, fetch: request => new Response(new URL(request.url).pathname) });
console.log(await (await fetch(new URL("/path", server.url))).text());
server.stop(true);`,
  "bundles.ts": `console.log(typeof Bun.build);
if (process.argv.length > 5) await Bun.build({ entrypoints: [process.argv[5]] });`,
};
const sizeOf = (executable: string) => statSync(isWindows ? executable + ".exe" : executable).size;

describe.skipIf(!canTrim || !!unsupported)("a template made with --trim-template", () => {
  const dir = tempDirForAotBuilds("compile-trim-template", files);
  afterAll(() => dir[Symbol.dispose]());
  const folder = String(dir);
  // A build that names no executable to start from starts from this Bun, without its debug information.
  const build = (entry: string, outfile: string, ...flags: string[]) =>
    inTurn(() =>
      spawned(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          ...flags,
          ...(flags.includes("--compile-executable-path") ? [] : withoutDebugInformation),
          entry,
          "--outfile",
          outfile,
        ],
        folder,
        bunEnv,
      ),
    );
  const larger: Record<string, number> = {};
  const template = join(folder, isWindows ? "template.exe" : "template");
  let templateIsBuilt: ReturnType<typeof build> | undefined;
  const buildTemplate = () => (templateIsBuilt ??= build("empty.ts", "template", "--trim-template"));

  test("is smaller than Bun, and what is built on it is what the same build on Bun gives", async () => {
    expect(await buildTemplate()).toMatchObject({ exitCode: 0 });
    // A Bun that carries its debug info keeps all of it, so there the measure is what left the file, not a share of the whole.
    const whole = statSync(copyWithoutDebugInformation ?? bunExe()).size;
    const left = whole - sizeOf(join(folder, "template"));
    expect(Math.max(left / whole, left / 150_000_000)).toBeGreaterThan(0.3);

    const found: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    const rows = [
      ["hello.ts", "hello\n"],
      ["text.ts", "3 true 1,2,3\n"],
      ["server.ts", "/path\n"],
    ].flatMap(([entry, stdout]) => [[], ["--trim"]].map(flags => ({ entry, stdout, flags })));
    await Promise.all(
      rows.map(async ({ entry, stdout, flags }, index) => {
        const title = `${entry} ${flags}`;
        const [onBun, onTemplate] = await Promise.all([
          build(entry, `on-bun-${index}`, ...flags),
          build(entry, `on-template-${index}`, ...flags, "--compile-executable-path", template),
        ]);
        const ran = await spawned([join(folder, `on-template-${index}`), "1 + 2"], folder, bunEnv);
        found[title] = {
          builds: [onBun.exitCode, onTemplate.exitCode],
          stdout: ran.stdout,
          exitCode: ran.exitCode,
        };
        expected[title] = { builds: [0, 0], stdout, exitCode: 0 };
        larger[title] = sizeOf(join(folder, `on-template-${index}`)) - sizeOf(join(folder, `on-bun-${index}`));
      }),
    );
    expect(found).toEqual(expected);
    console.error(`on the template less on Bun, in bytes: ${JSON.stringify(larger)}`);
  }, 900_000);

  test("what is built on it is as small as what the same build on Bun gives", () => {
    expect(Object.keys(larger)).toHaveLength(6);
    // The template's own program takes a few of the places where the file can be cut.
    expect(Object.entries(larger).filter(([, bytes]) => bytes >= 256 * 1024)).toEqual([]);
  });

  test("refuses a program that needs what it no longer has, by name", async () => {
    expect(await buildTemplate()).toMatchObject({ exitCode: 0 });
    const refused = await build("bundles.ts", "bundles", "--compile-executable-path", template);
    expect(refused.stderr).toContain("the Bun executable that this build starts from doesn't have ");
    expect(refused.exitCode).toBe(1);
    expect(await build("bundles.ts", "bundles", "--trim", "--compile-executable-path", template)).toMatchObject({
      exitCode: 0,
    });
    expect(await spawned([join(folder, "bundles")], folder, bunEnv)).toMatchObject({
      stdout: "function\n",
      exitCode: 0,
    });
  }, 600_000);

  test("can't leave out what a program can use, and an executable that isn't a template can't be cut again", async () => {
    const withoutSqlite = await build("empty.ts", "no-template", "--trim-template", "--trim-without=Sqlite");
    expect(withoutSqlite.stderr).toContain(
      "a template keeps everything that a program can use, so it can't leave out ",
    );
    expect(withoutSqlite.exitCode).toBe(1);

    expect(await build("hello.ts", "hello")).toMatchObject({ exitCode: 0 });
    const hello = join(folder, isWindows ? "hello.exe" : "hello");
    const again = await build("hello.ts", "again", "--trim", "--compile-executable-path", hello);
    expect(again.stderr).toContain("(AlreadyTrimmed)");
    expect(again.exitCode).toBe(1);
  }, 600_000);
});
