import { repositoryUrl } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/28897
//
// `bun add git+ssh://user@host:PORT/path/to/repo.git` used to hang, because:
//   1. `tryHTTPS()` rewrote the scheme to `https://` but kept the port, so
//      bun would speak HTTPS to sshd and wait forever for a response.
//   2. `trySSH()` piped the URL through hosted_git_info.correctUrl() which
//      replaced the `:` in `:PORT/` with `/`, turning the port into a path
//      segment (`ssh://user@host/PORT/...`), so the SSH attempt went to
//      port 22 with a bogus path.
//
// The fix: when a `ssh://` URL already carries a numeric port, trySSH()
// returns it untouched and tryHTTPS() returns null so we skip the HTTPS
// attempt entirely.
test("ssh:// URL with explicit port is not rewritten by trySSH", () => {
  // trySSH() is called after the `git+` prefix has been stripped, so it
  // sees `ssh://...` for git+ssh URLs.
  expect(repositoryUrl.trySSH("ssh://git@example.invalid:9999/myuser/myrepo.git")).toBe(
    "ssh://git@example.invalid:9999/myuser/myrepo.git",
  );
  expect(repositoryUrl.trySSH("ssh://git@[2001:db8::1]:9999/myuser/myrepo.git")).toBe(
    "ssh://git@[2001:db8::1]:9999/myuser/myrepo.git",
  );
  expect(repositoryUrl.trySSH("ssh://user@host:22/path/repo.git")).toBe("ssh://user@host:22/path/repo.git");
  // With a committish
  expect(repositoryUrl.trySSH("ssh://git@host:9999/user/repo.git#main")).toBe("ssh://git@host:9999/user/repo.git#main");
});

test("ssh:// URL with explicit port skips the HTTPS attempt", () => {
  // tryHTTPS() returns null for ssh:// URLs with explicit ports, so the
  // package manager goes straight to SSH instead of speaking HTTPS to sshd.
  expect(repositoryUrl.tryHTTPS("ssh://git@example.invalid:9999/myuser/myrepo.git")).toBeNull();
  expect(repositoryUrl.tryHTTPS("ssh://git@[2001:db8::1]:9999/myuser/myrepo.git")).toBeNull();
  expect(repositoryUrl.tryHTTPS("ssh://user@host:22/path/repo.git")).toBeNull();
});

test("ssh:// URL without an explicit port still gets rewritten to HTTPS", () => {
  // Without an explicit port, the HTTPS optimistic attempt is preserved.
  // (Behavior unchanged from before this fix.)
  expect(repositoryUrl.tryHTTPS("ssh://git@github.com/user/repo.git")).toBe("https://git@github.com/user/repo.git");
});

test("scp-style ssh://host:path (not port) is still corrected", () => {
  // ssh://git@github.com:user/repo is scp-style (the thing after `:` is a
  // path, not a port). hasExplicitPort() returns false because the
  // characters after the colon are letters, not digits, so correctUrl()
  // still runs and rewrites the `:` to `/`.
  const result = repositoryUrl.trySSH("ssh://git@github.com:oven-sh/bun.git");
  expect(result).toBe("ssh://git@github.com/oven-sh/bun.git");
});

test("ssh:// URL with explicit port and scoped-package path in userinfo-free form", () => {
  // Scoped npm packages put `@` in the *path* (e.g. `/@company/pkg`). The
  // RFC 3986 authority ends at the first `/`, so a `@` in the path must
  // NOT be treated as userinfo — otherwise hasExplicitPort walks past the
  // real host:port and misses it, and both original bugs resurface.
  const url = "ssh://registry.company.com:9022/@company/package.git";
  expect(repositoryUrl.trySSH(url)).toBe(url);
  expect(repositoryUrl.tryHTTPS(url)).toBeNull();
});
