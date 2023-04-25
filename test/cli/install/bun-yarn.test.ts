import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { access, mkdir, mkdtemp, readlink, realpath, rm, writeFile } from "fs/promises";
import { join, relative } from "path";
import { tmpdir } from "os";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  readdirSorted,
  requested,
  root_url,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

let add_dir: string;

beforeEach(async () => {
  add_dir = await mkdtemp(join(await realpath(tmpdir()), "bun-yarn.test"));
  await dummyBeforeEach();
});

afterEach(async () => {
  await rm(add_dir, { force: true, recursive: true });
  await dummyAfterEach();
});

async function command(...args: Array<string>) {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), ...args],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  return { err, out };
}

const getYarnLockContents = () => file(join(package_dir, "yarn.lock")).text().then(s => s.replaceAll(root_url, "localhost"));
const makeBasicPackageJSON = () => writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.0", dependencies: {}, devDependencies: {} }));

it("should wrap package title names that begin with true or false in quotes.", async () => {
  for (const [pkg_name, pkg_ver] of [
    ["true", "0.0.4"],
    ["false", "0.0.4"],
    ["falsetto", "0.2.5"],
    ["true-case-path", "2.2.1"],
  ]) {
    const urls: string[] = [];
    setHandler(dummyRegistry(urls, { [pkg_ver]: {} }));
    await makeBasicPackageJSON();
    const { err, out } = await command("install", pkg_name, "-y");
    expect(err).toContain("Saved yarn.lock");
    expect(out).toContain(`installed ${pkg_name}@${pkg_ver}`);
    expect(await getYarnLockContents()).toMatchSnapshot();
  }
});
