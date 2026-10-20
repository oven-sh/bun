import { openatNoSymlinks } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { symlink } from "fs/promises";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { basename, join } from "path";

// `bun_sys::openat_no_symlinks` opens a file and refuses a symlink or a junction in every folder
// of the path. FreeBSD has no such open, and neither has a Linux that refuses `openat2`.
const hasOpen = openatNoSymlinks(import.meta.dir, basename(import.meta.path)) !== null;

const script = `
  import { openatNoSymlinks } from "bun:internal-for-testing";
  import { join } from "path";
  const open = (...path) => {
    try {
      return openatNoSymlinks(process.cwd(), join(...path));
    } catch (error) {
      return error.code;
    }
  };
  console.log(
    JSON.stringify({
      file: open("real", "pkg", "package.json"),
      missing: open("real", "pkg", "missing.json"),
      "in a link": open("real", "link", "package.json"),
      "below a link": open("link", "pkg", "package.json"),
    }),
  );
`;

// Opens each path in a bun that has `more` in its environment.
async function open(more: (root: string) => Record<string, string>) {
  using dir = tempDir("openat-no-symlinks-", {
    real: { pkg: { "package.json": "{}" } },
    system: { bin: { linker64: "" } },
  });
  const root = String(dir);
  // A junction needs no privilege on Windows.
  await symlink(join(root, "real"), join(root, "link"), "junction");
  await symlink(join(root, "real", "pkg"), join(root, "real", "link"), "junction");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    cwd: root,
    env: { ...bunEnv, ...more(root) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stderr, opened: stdout && JSON.parse(stdout), exitCode };
}

test.concurrent.skipIf(!hasOpen)("openat_no_symlinks refuses a link in any folder of the path", async () => {
  expect(await open(() => ({}))).toEqual({
    stderr: "",
    opened: { file: true, missing: "ENOENT", "in a link": "ELOOP", "below a link": "ELOOP" },
    exitCode: 0,
  });
});

// Android answers `openat2` with a signal, not with an error, so bun does not call it there. The
// test host's kernel release isn't Android's, and this environment makes bun detect Android.
test.concurrent.skipIf(!isLinux)("openat_no_symlinks is off on Android", async () => {
  expect(await open(root => ({ ANDROID_ROOT: join(root, "system"), ANDROID_DATA: "/data" }))).toEqual({
    stderr: "",
    opened: { file: null, missing: null, "in a link": null, "below a link": null },
    exitCode: 0,
  });
});
