// https://github.com/oven-sh/bun/issues/12041
// Registry mirrors/CDNs can briefly serve a manifest whose `dist-tags.latest`
// points at a version that has not yet propagated into `versions`. `bun update
// --latest` should fall back to the highest published version rather than
// aborting the whole update.
import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { writeFile } from "fs/promises";
import { bunExe, bunEnv as env } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  root_url,
  setHandler,
} from "../../cli/install/dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

const fixtureDir = join(import.meta.dir, "..", "..", "cli", "install");

async function runUpdateLatest() {
  const proc = spawn({
    cmd: [bunExe(), "update", "--latest", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, exitCode };
}

it("should fall back to the highest version when dist-tags.latest is not in versions", async () => {
  const urls: string[] = [];
  // dist-tags.latest = 0.0.7 but only 0.0.3 and 0.0.5 are in `versions`
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": { bin: { "baz-run": "index.js" } },
      "0.0.5": { bin: { "baz-exec": "index.js" } },
      latest: "0.0.7",
    }),
  );
  await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { baz: "0.0.3" } }));

  const { out, err, exitCode } = await runUpdateLatest();

  expect(err).not.toContain('with tag "latest" not found');
  expect(err).not.toContain("failed to resolve");
  expect(err).toContain("warn:");
  expect(err).toContain("falling back to 0.0.5");
  expect(out).toContain("baz@0.0.5");
  expect(exitCode).toBe(0);

  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    name: "baz",
    version: "0.0.5",
  });
});

it("should fall back to the highest version when the manifest has no dist-tags", async () => {
  setHandler(async request => {
    const url = request.url.replaceAll("%2f", "/");
    if (url.endsWith(".tgz")) {
      return new Response(file(join(fixtureDir, "baz-0.0.3.tgz")));
    }
    const name = url.slice(url.indexOf("/", root_url.length) + 1);
    return new Response(
      JSON.stringify({
        name,
        versions: {
          "0.0.3": {
            name,
            version: "0.0.3",
            bin: { "baz-run": "index.js" },
            dist: { tarball: `${root_url}/${name}-0.0.3.tgz` },
          },
        },
        // no "dist-tags"
      }),
    );
  });
  await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { baz: "0.0.3" } }));

  const { out, err, exitCode } = await runUpdateLatest();

  expect(err).not.toContain('with tag "latest" not found');
  expect(err).not.toContain("failed to resolve");
  expect(err).toContain("falling back to 0.0.3");
  expect(out).toContain("baz@0.0.3");
  expect(exitCode).toBe(0);

  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    name: "baz",
    version: "0.0.3",
  });
});

it("should fall back to the highest prerelease when the manifest has no releases and no dist-tags", async () => {
  setHandler(async request => {
    const url = request.url.replaceAll("%2f", "/");
    if (url.endsWith(".tgz")) {
      return new Response(file(join(fixtureDir, "baz-0.0.3.tgz")));
    }
    const name = url.slice(url.indexOf("/", root_url.length) + 1);
    const pre = (v: string) => ({ name, version: v, dist: { tarball: `${root_url}/${name}-${v}.tgz` } });
    return new Response(
      JSON.stringify({
        name,
        versions: {
          "1.0.0-beta.1": pre("1.0.0-beta.1"),
          "1.0.0-beta.2": pre("1.0.0-beta.2"),
        },
        // no "dist-tags", no stable releases
      }),
    );
  });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", dependencies: { baz: "1.0.0-beta.1" } }),
  );

  const { out, err, exitCode } = await runUpdateLatest();

  expect(err).not.toContain('with tag "latest" not found');
  expect(err).not.toContain("failed to resolve");
  expect(err).toContain("falling back to 1.0.0-beta.2");
  expect(out).toContain("baz@1.0.0-beta.2");
  expect(exitCode).toBe(0);

  expect((await file(join(package_dir, "package.json")).json()).dependencies.baz).toContain("1.0.0-beta.2");
});
