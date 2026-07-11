# npm-registry

An in-process, spec-compliant npm registry for bun's test suite. It replaces
verdaccio and the hand-rolled mock registries that used to live in
`test/cli/install/`.

It is a plain `Bun.serve({ routes })` server plus an in-memory package store.
Starting one costs a socket bind and nothing else, so the intended usage is one
registry per test or per `describe`, not a shared singleton. Nothing it does
ever touches disk except reading fixtures, so concurrent tests never interfere
with each other and there is never anything to clean up.

```ts
import { NpmRegistry } from "npm-registry";

await using registry = await new NpmRegistry().start();
registry.define("left-pad", { "1.3.0": {} });
// write registry.url into a bunfig.toml / .npmrc, then `bun install`
```

Tests under `test/` should usually go through the thin wrapper in
`test/harness.ts`, which adds the bun-specific conveniences (writing a
`bunfig.toml`, creating a temp project directory). This package deliberately
knows nothing about any of that.

## Defining packages in code

`registry.define(name, versions)` is the whole API. Each version is its
package.json, written inline; `name` and `version` are filled in for you.
The registry packs the tarball, hashes it, and derives the packument. You
never write a `.tgz`, an integrity string, or a packument by hand.

```ts
registry.define("say-hi", {
  "1.0.0": {},
  "2.0.0": {
    description: "says hi",
    dependencies: { "left-pad": "^1.0.0" },
    bin: { "say-hi": "cli.js" },
    scripts: { postinstall: "node -e \"console.log('installed')\"" },
    tarball: {
      "cli.js": "#!/usr/bin/env node\nconsole.log('hi');\n",
      "lib/greet.js": "module.exports = () => 'hi';\n",
    },
  },
});
```

Two keys of a version spec are interpreted by the registry instead of being
copied into package.json:

- `tarball` — what to serve as the tarball.
  - omitted: a tarball containing only the generated `package.json`.
  - a `{ path: contents }` map: those files plus the generated
    `package.json`. `bin` targets are packed at mode 0755, everything
    else at 0644; write an entry as `{ contents, mode }` to override.
  - a `Uint8Array`: served verbatim, for malformed-archive tests.
  - `null`: the version appears in the packument but its tarball 404s.
- `dist` — overrides for the registry-computed `dist` object. Setting
  `dist: { integrity: "sha512-nope" }` makes the registry lie about the
  bytes it serves, which is how integrity-verification failures are tested.

`registry.defineFallback(versions)` makes _every_ otherwise-unknown name
resolve to those versions, each with its own correctly-named package. A
test that installs five throwaway names needs one line, not five.

Tarballs are built with a deterministic tar writer (fixed mtime, uid 0,
sorted entries), so a defined package has the same `dist.integrity` on
every run and on every platform. It is safe to snapshot a lockfile that
contains one.

## Defining packages on disk

Pass `fixtures: <dir>` to serve a directory of packages. The layout is the
one every registry (and npm's cache) uses: one directory per package, with
scoped packages under their `@scope` directory.

```
fixtures/
  left-pad/
    1.3.0/
      package.json
      index.js
  @my-scope/
    thing/
      1.0.0/
        package.json
      thing-2.0.0.tgz        # a prebuilt tarball also works
    thing/_registry.json     # optional registry metadata
```

Inside a package directory each version is either

- `<version>/` — a directory with a `package.json` at its root. The
  registry packs it on first request. **This is the format to use for new
  fixtures**: readable, diffable, no binary blobs in git.
- `<basename>-<version>.tgz` — a prebuilt tarball. Its packument entry is
  read out of its own `package.json` and its integrity is computed from
  the bytes. This exists so the fixtures that predate this package (whose
  exact bytes are pinned by checked-in lockfiles and snapshots) keep
  working; don't add new ones.

Everything a registry would normally compute — the packument, `dist-tags`,
`dist.integrity`, `hasInstallScript`, `time` — is derived. The registry also
applies the normalization `npm publish` would have (the string form of `bin`
becomes a map, a `binding.gyp` with no install script gets the implicit
`node-gyp rebuild`), so a fixture's `package.json` is written the way an
author would write it, not the way a registry stores it. The only thing a
fixture can't express in its package.jsons is registry-level state, which
goes in an optional `_registry.json` next to the versions:

```json
{ "dist-tags": { "latest": "1.5.0", "next": "2.0.0-beta.1" } }
```

`latest` defaults to the highest non-prerelease version when you don't set
it, which is what nearly every fixture wants.

Three things to know when adding one:

- **A file's execute bit in the packed tarball comes from being a `bin`
  target** (not `directories.bin`; `npm pack` only reads `pkg.bin`) or
  from being named in `_registry.json`'s `executable` map (see
  `test-native-binlink-altpath-target` for a file that is the target
  of *another* package's bin), never from its on-disk mode.
  `statSync().mode` has no execute bit on Windows, so consulting it
  would give the same fixture a different `dist.integrity` per platform.
  A fixture that needs a specific non-default mode (e.g. a 0644 bin,
  the way real packages published from Windows ship) stays as a kept
  `.tgz`.

- **A fixture that ships a `node_modules` of its own** (a bundled-dependency
  package) needs nothing special here, but the repo's top-level
  `.gitignore` rule for `node_modules` would silently keep its files out of
  your commit: your local tree has them so every local run passes, and CI's
  checkout doesn't. `.gitignore` already carries a negation for this whole
  tree; if `git status` doesn't show a fixture file you just created,
  that's why.
- **Never let a formatter touch this tree.** The packed tarball's
  `dist.integrity` is a hash of these bytes; reformatting a fixture changes
  it, and anything that recorded the old hash (a snapshot, a checked-in
  lockfile) breaks. The tree is `-text` in `.gitattributes` for the same
  reason: a CRLF conversion on checkout would change the hash per platform.

## Observing and perturbing requests

The registry records every request. Assert on that from the test instead
of asserting inside a server handler, where a failed expectation turns
into a confusing 500.

```ts
expect(registry.paths).toEqual(["/left-pad", "/left-pad/-/left-pad-1.3.0.tgz"]);
expect(registry.requests[0].headers.get("npm-auth-type")).toBeNull();
```

Interceptors replace responses before routing. `simulateFailures` is the
common case, prebuilt:

```ts
// Each URL 500s four times, then works. `bun install` must retry.
registry.simulateFailures({ timesPerUrl: 4, status: 500 });

// Anything at all.
registry.intercept(req =>
  req.url.endsWith(".tgz") ? new Response("nope", { status: 403 }) : undefined,
);
```

## Auth, publishing, 2FA

```ts
const token = registry.addUser({ name: "alice", password: "hunter2" });
// a user with 2FA enabled:
registry.addUser({ name: "bob", password: "x", otp: "123456" });
```

- `authorization: Bearer <token>` and `authorization: Basic <user:pass>`
  both work; `PUT /-/user/org.couchdb.user:<name>` (npm login) issues
  tokens over HTTP.
- `access` rules gate reads and writes per package-name glob:
  `new NpmRegistry({ access: { "@secret/*": "authenticated" } })`.
- `bun publish` / `npm publish` against the registry works end to end:
  the tarball is decoded, its integrity verified against what the client
  claimed, and the published version is immediately installable.
  Republishing an existing version is a 403, like the real registry.
- A write by a user with `otp` configured and no valid `npm-otp` header
  gets the real registry's 401 challenge: a `www-authenticate: OTP`
  header, the exact "one-time pass" message npm clients match, and an
  `authUrl`/`doneUrl` pair implementing npm's web-authentication flow.
  Polling the `doneUrl` hands back the user's one-time password, so a
  non-interactive `bun publish` completes the whole 2FA round trip on its
  own (clients default to `--auth-type=web`). `registry.otpChallenge` is a
  mutable field that shapes the challenge for the edge cases `bun publish`
  handles: no `www-authenticate` header, an `npm-notice` login URL, a
  cached response (`x-local-cache`), a code the registry never accepts.

Everything a publish creates lives in this instance's memory. Nothing to
`rm -rf` afterwards, and two tests publishing the same name to their own
registries cannot see each other.

## HTTP caching

Packument responses carry `ETag`, `Last-Modified`, and `Vary: Accept`, and
answer a matching `If-None-Match` / `If-Modified-Since` with a 304.

`cacheControl` lets the registry send a `Cache-Control` header the way
registry.npmjs.org does (`public, max-age=300`). **bun does not read this
header**: its warm-manifest gate is an on-disk cache entry younger than a
hardcoded 300 s (`src/install/npm.rs`), independent of what the registry
sent. The option exists so a test can assert bun tolerates what
registry.npmjs.org sends, not to drive bun's cache behaviour. To actually
drive warm vs cold, point two installs at the same vs a fresh
`BUN_INSTALL_CACHE_DIR` inside the 300 s window.

`test/cli/install/registry-resolver-matrix.test.ts` does exactly that
across both linkers and requires every cell to produce the same lockfile.

## Running it standalone

```
bun test/npm-registry/cli.ts --verbose --fixtures test/cli/install/registry/packages
```

prints a URL you can point a scratch project's `bunfig.toml` at.

## Layout

| file                   | responsibility                                           |
| ---------------------- | -------------------------------------------------------- |
| `src/registry.ts`      | the `NpmRegistry` class: routing, lifecycle, composition |
| `src/package-store.ts` | the in-memory model: records, versions, lazy tarballs    |
| `src/packument.ts`     | full + abbreviated packument serialization               |
| `src/normalize.ts`     | the manifest normalization `npm publish` applies         |
| `src/publish.ts`       | `PUT /:name`: publish, deprecate, unpublish              |
| `src/auth.ts`          | users, tokens, access rules, OTP and its web-auth flow   |
| `src/fixtures.ts`      | the on-disk fixture loader                               |
| `src/define.ts`        | the in-code `VersionSpec` → record conversion            |
| `src/tar.ts`           | the deterministic `.tgz` writer + reader                 |
| `src/observe.ts`       | request recording and interception                       |
| `src/audit.ts`         | the bulk-advisory endpoint                               |
| `src/integrity.ts`     | `dist.integrity` / `dist.shasum`                         |
| `src/errors.ts`        | the npm `{"error": "..."}` response envelope             |
| `src/types.ts`         | the npm registry document shapes                         |
