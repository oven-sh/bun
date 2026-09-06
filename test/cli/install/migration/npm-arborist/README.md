Copied from npm/cli `workspaces/arborist/test/fixtures` at commit 51c2bf8 (ISC-licensed test data): every lockfileVersion 2/3 `package-lock.json` there, plus the v1 `old-package-lock`.

Each directory holds only what a `package-lock.json -> bun.lock` migration reads: the lockfile, the root `package.json`, and the `package.json` of every workspace / link target the lockfile refers to (no node_modules, tarballs, or test scripts). Files are byte-for-byte copies. Nested arborist fixtures that contain several locked projects are flattened to `parent--child`. When a lockfile points outside its own project (`../x`), the entry directory is the common ancestor and `fixtures.json` carries a `root` field naming the project subdirectory. The only `npm-shrinkwrap.json` in arborist's fixtures (`workspace3/packages/a`) is deliberately not JSON and is not included; `conflict-package-lock` (v2 with git merge-conflict markers) and the remaining v1 lockfiles are not included either.

`fixtures.json` lists every entry as `{ name, root?, lockfile, lockfileVersion, workspaces, notes }` for table-driven tests. Bug ids (B1-B11, #55) refer to the constructs each fixture was picked for.

## Fixtures

- `audit-fix-old-tap` (v2) - 572-entry real tree; `name` on every entry, 66 inBundle, dep-level bundleDependencies, os/cpu, deps duplicated in dependencies+optionalDependencies, 61 same-version copies (dedupe/idempotency)
- `audit-linked-package` (v3) - v3; link entry to a `resolved/` folder target that does not exist on disk; not on disk in arborist either: resolved/electron-test-app/package.json (entry resolved/electron-test-app)
- `audit-omit` (v2) - 751-entry real tree; root peer/optional/dev groups, peerDependenciesMeta, os/cpu, inBundle, 134 same-version nested copies, deps in both dependencies+optionalDependencies
- `bundle-metadep-duplication--x` (v2) - root bundleDependencies with 2 transitive deps and a cycle, all inBundle (B2)
- `carbonium` (v2) - 127-entry real tree; peerDependenciesMeta, bins, 5 same-version nested copies (dedupe/idempotency)
- `cli-750` (v2) - link chain: root -> `app` folder -> `lib` folder, entries with `name` differing from folder
- `dedupe-lockfile` (v2) - nested copy of a dep alongside a different hoisted major
- `dep-installed-without-bin-link` (v2) - two registry deps with bin + engines
- `dep-missing-resolved` (v2) - 235-entry real tree; one registry entry without `resolved`, one stray `{}` entry (B4/B6)
- `edit-package-json--changed` (v2) - root peer + optional + dev groups; package.json edited so it disagrees with the lockfile
- `edit-package-json--ok` (v2) - root peer + optional + dev groups in sync with package.json
- `edit-package-json--removed` (v2) - root peer + optional + dev groups; a dep removed from package.json but still locked
- `edit-package-json--workspaces-changed` (v2, workspaces) - workspaces a/b in the lockfile, workspace c added on disk (stale lockfile)
- `engine-specification` (v2) - registry dep with an unsatisfiable `engines`
- `external-link-dep` (v2, root: `external-link-dep/`) - `file:` specs into a registry package's own folder (aliases of abbrev) plus an out-of-tree link to `../cli-750` (B4); project lives in `external-link-dep/` because the lockfile references paths outside it
- `external-link--root` (v2, root: `root/`) - fsParent `{}` placeholder entries for `../a`, `../i`, `../m` and file: dir targets living inside those parents' node_modules (B6); project lives in `root/` because the lockfile references paths outside it
- `flow-outdated` (v2) - plain registry tree with an outdated dep
- `link-dep-lifecycle-scripts` (v2) - `file:./a` link to an in-tree folder
- `minimist-git-dep` (v2) - single git+ssh resolution on a root dep, root peerDependencies
- `minimist-git-metadep` (v2) - git resolution as a transitive dep next to a stray `{}` entry (B6)
- `old-package-lock` (v1) - lockfileVersion 1 (`dependencies` tree), 2 registry deps (B3)
- `optional-dep-allinstall-fail` (v2) - root optionalDependencies, single optional-flagged entry
- `optional-dep-install-fail` (v2) - root optionalDependencies, single optional-flagged entry
- `optional-dep-postinstall-fail` (v2) - root optionalDependencies, single optional-flagged entry
- `optional-dep-preinstall-fail` (v2) - root optionalDependencies, single optional-flagged entry
- `optional-engine-specification` (v2) - same tree as engine-specification, dep declared optional in package.json
- `peer-dep-cycle-nested-with-sw` (v2) - peer dependency cycle with a nested copy, `name` on entries
- `peer-dep-cycle-with-sw` (v2) - peer dependency cycle between hoisted entries
- `pnpm` (v2) - npm lockfile written over a pnpm `.pnpm/` layout: link entries into `node_modules/.pnpm/...` keys, `{}` entries (link targets live in node_modules and are not copied)
- `prune-lockfile-omit-dev` (v2) - extraneous entries plus a dev-only entry, none with `resolved`
- `prune-lockfile-optional-peer` (v3) - v3; peerDependenciesMeta optional peer that is present in the tree (B8)
- `prune-lockfile` (v2) - single extraneous entry without `resolved`
- `rebuild-foreground-scripts` (v2) - two entries with hasInstallScript and no `resolved`
- `test-package-with-shrinkwrap` (v2) - one registry dep whose tarball ships an npm-shrinkwrap.json (nothing special in the lockfile itself)
- `testing-bundledeps-sw` (v2) - dep-level bundleDependencies: bundler + bundled a/b nested inBundle, unbundled c, codeload tarball resolutions (B9)
- `testing-peer-dep-conflict-chain` (v2) - chain of peerDependencies present in the tree
- `testing-peer-deps-nested` (v2) - peerDependencies satisfied by nested copies, `name` on entries
- `testing-rebuild-bundle-reified` (v2) - dep-level bundleDependencies with an inBundle entry that has hasInstallScript
- `testing-rebuild-bundle--a` (v2) - root bundleDependencies with a single inBundle registry dep (B2)
- `testing-rebuild-bundle` (v2) - dep-level bundleDependencies with an inBundle entry that has hasInstallScript
- `testing-rebuild-bundle--parent` (v2) - dep-level bundleDependencies reached through a parent dep (B9)
- `testing-rebuild-script-env-flags` (v2) - every spec is `""`, no entry has `resolved`, a dep listed in both dependencies+optionalDependencies (B4/B5)
- `two-bundled-deps` (v2) - 422-entry real tree; dep-level bundles, 129 entries without `resolved`, root edges missing from packages[""] (B6)
- `update-exact-version` (v2) - single exactly-pinned registry dep
- `workspaces-add-new-dep` (v2, workspaces) - single workspace `a` at the fixture root, no registry deps
- `workspaces-conflicting-versions-virtual` (v2, workspaces) - two workspaces pinning different versions of the root's dep, nested under each workspace
- `workspaces-ignore-nm-virtual` (v2, workspaces) - workspaces glob `packages/**`
- `workspaces-need-update` (v2, workspaces) - workspaces a/b whose package.json files have no `name` (Bun rejects nameless workspaces)
- `workspaces-non-simplistic` (v2, workspaces) - workspace with a scoped transitive dep chain, minified lockfile, root devDependencies
- `workspaces-not-root` (v2, workspaces) - three workspaces sharing hoisted registry deps, `""` specs, root package.json without a name
- `workspaces-prefer-linking-virtual` (v2, workspaces) - workspace named `abbrev` satisfying another workspace's `abbrev` dep
- `workspaces-shared-deps-virtual` (v2, workspaces) - three workspaces sharing hoisted registry deps, one with a bin
- `workspaces-simple-virtual` (v2, workspaces) - two workspaces at the fixture root
- `workspaces-top-level-link-virtual` (v2, workspaces) - root depends on its own workspace by version range
- `workspaces-transitive-deps-virtual` (v2, workspaces) - workspace plus dev-only registry deps
- `workspaces-version-unsatisfied-virtual` (v2, workspaces) - workspace `abbrev@2` shadowed by a nested registry abbrev@1.1.1 for a workspace that pins =1.1.1
- `workspaces-with-overrides` (v3, workspaces) - v3; package.json `overrides` forcing a version the workspace's range does not ask for (#55)
