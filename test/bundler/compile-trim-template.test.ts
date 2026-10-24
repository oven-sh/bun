import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isWindows } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { spawned, unsupported } from "../aot/run-programs";
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
  const build = (folder: string, entry: string, outfile: string, ...flags: string[]) =>
    spawned([bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", outfile], folder, bunEnv);
  const larger: Record<string, number> = {};

  test("is smaller than Bun, and what is built on it is what the same build on Bun gives", async () => {
    using dir = tempDirForAotBuilds("compile-trim-template", files);
    const folder = String(dir);
    const template = join(folder, isWindows ? "template.exe" : "template");
    expect(await build(folder, "empty.ts", "template", "--trim-template")).toMatchObject({ exitCode: 0 });
    // A Bun that carries its debug info keeps all of it, so there the measure is what left the file, not a share of the whole.
    const whole = statSync(bunExe()).size;
    const left = whole - sizeOf(join(folder, "template"));
    expect(Math.max(left / whole, left / 150_000_000)).toBeGreaterThan(0.3);

    const found: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [entry, stdout] of [
      ["hello.ts", "hello\n"],
      ["text.ts", "3 true 1,2,3\n"],
      ["server.ts", "/path\n"],
    ]) {
      for (const flags of [[], ["--trim"]]) {
        const title = `${entry} ${flags}`;
        const onBun = await build(folder, entry, "on-bun", ...flags);
        const onTemplate = await build(folder, entry, "on-template", ...flags, "--compile-executable-path", template);
        const ran = await spawned([join(folder, "on-template"), "1 + 2"], folder, bunEnv);
        found[title] = {
          builds: [onBun.exitCode, onTemplate.exitCode],
          stdout: ran.stdout,
          exitCode: ran.exitCode,
        };
        expected[title] = { builds: [0, 0], stdout, exitCode: 0 };
        larger[title] = sizeOf(join(folder, "on-template")) - sizeOf(join(folder, "on-bun"));
      }
    }
    expect(found).toEqual(expected);
    console.error(`on the template less on Bun, in bytes: ${JSON.stringify(larger)}`);
  }, 900_000);

  // TODO: on Windows x64 what `--trim` builds on the template is more than 256 KiB larger than what it builds on Bun.
  test.todoIf(isWindows && !isArm64)("what is built on it is as small as what the same build on Bun gives", () => {
    expect(Object.keys(larger)).toHaveLength(6);
    // The template's own program takes a few of the places where the file can be cut.
    expect(Object.entries(larger).filter(([, bytes]) => bytes >= 256 * 1024)).toEqual([]);
  });

  test("refuses a program that needs what it no longer has, by name", async () => {
    using dir = tempDirForAotBuilds("compile-trim-template", files);
    const folder = String(dir);
    const template = join(folder, isWindows ? "template.exe" : "template");
    expect(await build(folder, "empty.ts", "template", "--trim-template")).toMatchObject({ exitCode: 0 });
    const refused = await build(folder, "bundles.ts", "bundles", "--compile-executable-path", template);
    expect(refused.stderr).toContain("the Bun executable that this build starts from doesn't have ");
    expect(refused.exitCode).toBe(1);
    expect(await build(folder, "bundles.ts", "bundles", "--trim", "--compile-executable-path", template)).toMatchObject(
      {
        exitCode: 0,
      },
    );
    expect(await spawned([join(folder, "bundles")], folder, bunEnv)).toMatchObject({
      stdout: "function\n",
      exitCode: 0,
    });
  }, 600_000);

  test("can't leave out what a program can use, and an executable that isn't a template can't be cut again", async () => {
    using dir = tempDirForAotBuilds("compile-trim-template", files);
    const folder = String(dir);
    const withoutSqlite = await build(folder, "empty.ts", "template", "--trim-template", "--trim-without=Sqlite");
    expect(withoutSqlite.stderr).toContain(
      "a template keeps everything that a program can use, so it can't leave out ",
    );
    expect(withoutSqlite.exitCode).toBe(1);

    expect(await build(folder, "hello.ts", "hello")).toMatchObject({ exitCode: 0 });
    const hello = join(folder, isWindows ? "hello.exe" : "hello");
    const again = await build(folder, "hello.ts", "again", "--trim", "--compile-executable-path", hello);
    expect(again.stderr).toContain("(AlreadyTrimmed)");
    expect(again.exitCode).toBe(1);
  }, 600_000);
});
