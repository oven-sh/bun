/**
 * scripts/runner.node.ts runs the test suites of the packages in test/vendor.json,
 * each checked out at the commit its entry names.
 */
import { expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutVendor } from "../../scripts/vendor-checkout.ts";
import vendors from "../vendor.json";

const config = tempDir("vendor-checkout-config", { gitconfig: "" });
const env = {
  ...bunEnv,
  GIT_CONFIG_GLOBAL: join(String(config), "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "a",
  GIT_AUTHOR_EMAIL: "a@example.com",
  GIT_COMMITTER_NAME: "a",
  GIT_COMMITTER_EMAIL: "a@example.com",
};

async function git(...args: string[]): Promise<string> {
  await using proc = Bun.spawn({ cmd: ["git", ...args], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
  return stdout.trim();
}

const run = async (...args: string[]) => void (await git(...args));

/** A repository whose file says which of its commits is checked out. */
async function commits(repository: string, ...texts: string[]): Promise<string[]> {
  await run("init", "--quiet", repository);
  const hashes: string[] = [];
  for (const text of texts) {
    await Bun.write(join(repository, "text"), text);
    await run("-C", repository, "add", "text");
    await run("-C", repository, "commit", "--quiet", "-m", text);
    hashes.push(await git("-C", repository, "rev-parse", "HEAD"));
  }
  return hashes;
}

test("checks out the commit it is given", async () => {
  using dir = tempDir("vendor-checkout", {});
  const repository = join(String(dir), "repository");
  const vendorPath = join(String(dir), "vendor", "package");
  const [first, second] = await commits(repository, "first", "second");
  const text = () => readFileSync(join(vendorPath, "text"), "utf8");

  await checkoutVendor({ repository, commit: first!, vendorPath }, run);
  expect(text()).toBe("first");

  // Over an earlier checkout.
  await checkoutVendor({ repository, commit: second!, vendorPath }, run);
  expect(text()).toBe("second");
  expect(await git("-C", vendorPath, "rev-parse", "HEAD")).toBe(second!);
});

test("takes nothing but the full hash of a commit", async () => {
  using dir = tempDir("vendor-checkout", {});
  const repository = join(String(dir), "repository");
  const vendorPath = join(String(dir), "vendor", "package");
  const [first] = await commits(repository, "first");
  await run("-C", repository, "tag", "1.0.0");
  for (const commit of ["1.0.0", "HEAD", first!.slice(0, 12), ""]) {
    await expect(checkoutVendor({ repository, commit, vendorPath }, run)).rejects.toThrow("expected the full hash");
  }
});

test("every entry of test/vendor.json names a commit", () => {
  expect(vendors.length).toBeGreaterThan(0);
  for (const { commit } of vendors) {
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
  }
});
