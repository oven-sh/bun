// Runs alone: under root it changes and restores the mode of TMPDIR, which the files of a parallel batch share.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

// One row for each kind of fact that the resolver caches about the disk and each way that fact changes: something is
// created, removed or replaced. A row makes its files ("setup"), looks modules up ("prime"), changes the disk
// ("apply") and looks modules up again ("probes"), through require.resolve() and through Bun.build(). The answer to
// expect after the change is the one of a new process, which makes the same files and the same change before its
// first lookup.
//
// A lookup that misses runs once more and checks each cached fact that it reads against the disk, and a build checks
// each cached fact that it reads once, so both answer as a new process does. A require.resolve() that finds its
// module makes no file-system call: where a row changes what such a lookup finds, the probe pins the answer that
// stays (`stale`) until a lookup that misses reads that part of the cache again. Node keeps the same answer in each
// of these rows that it can run. Only a lookup that found its module before the change can have such an answer. A
// cell that answers something else than this table says is a change in the resolver to understand, not a line to
// update.
//
// An answer is "OK" and the file, from the root of the row ("(does not open)" when nothing is there to read), "MISS"
// for a module that was not found, or "ERROR" and the reason.

type Op =
  // A file and the directories above it. Without a text it is a module that exports "@@<file>@@".
  | [op: "write", file: string, text?: string]
  | [op: "mkdir" | "rm", at: string]
  // "link" names a directory and "filelink" a file. The target is relative to the link.
  | [op: "link" | "filelink", target: string, at: string]
  | [op: "rename", from: string, to: string]
  | [op: "chmod", at: string, mode: number];
type Change = "created" | "removed" | "replaced";
type Row = {
  // "<kind of fact>/<what changes>"
  id: string;
  change: Change;
  setup: Op[];
  // The answer before the change.
  prime: [from: string, specifier: string, before: string][];
  apply: Op[];
  // The answer of a new process, and the answer that require.resolve() keeps where it is another.
  probes: [from: string, specifier: string, fresh: string, stale?: string][];
  // Bun.build() starts from a file in the importing directory. A directory that a link names later gets one too.
  entriesAlso?: [from: string, dir: string][];
  // The prime lookups run until one reads no listing again, so the change meets listings that are kept.
  keptFirst?: true;
};

const json = (value: unknown) => JSON.stringify(value);
const tsconfig = (paths: Record<string, string[]>) => json({ compilerOptions: { baseUrl: ".", paths } });
const exportsIndexOnly = json({ name: "p", exports: { ".": "./i.js" } });

const rows: Row[] = [
  // ---- name: whether the listing of a directory has a name
  {
    id: "name/created",
    change: "created",
    setup: [["mkdir", "src"]],
    prime: [["src", "./late.cjs", "MISS"]],
    apply: [["write", "src/late.cjs"]],
    probes: [["src", "./late.cjs", "OK src/late.cjs"]],
  },
  {
    id: "name/removed",
    change: "removed",
    setup: [["write", "src/a.cjs"]],
    prime: [["src", "./a.cjs", "OK src/a.cjs"]],
    apply: [["rm", "src/a.cjs"]],
    // Stale: the lookup finds a.cjs in the listing of src that it read before.
    probes: [["src", "./a.cjs", "MISS", "OK src/a.cjs (does not open)"]],
  },
  {
    id: "name/removed-reveals-next-extension",
    change: "removed",
    setup: [
      ["write", "src/a.js"],
      ["write", "src/a.json", json({ m: "@@src/a.json@@" })],
    ],
    prime: [["src", "./a", "OK src/a.js"]],
    apply: [["rm", "src/a.js"]],
    // Stale: a.js is still in the listing of src and comes before a.json.
    probes: [["src", "./a", "OK src/a.json", "OK src/a.js (does not open)"]],
  },
  // ---- kind: whether an entry is a file, a directory, or a link to one
  {
    id: "kind/dir-to-file",
    change: "replaced",
    setup: [["mkdir", "src/k.cjs"]],
    prime: [["src", "./k.cjs", "MISS"]],
    apply: [
      ["rm", "src/k.cjs"],
      ["write", "src/k.cjs"],
    ],
    probes: [["src", "./k.cjs", "OK src/k.cjs"]],
  },
  {
    id: "kind/file-to-dir",
    change: "replaced",
    setup: [["write", "src/b", ""]],
    prime: [["src", "./b/index.js", "MISS"]],
    apply: [
      ["rm", "src/b"],
      ["write", "src/b/index.js"],
    ],
    probes: [["src", "./b/index.js", "OK src/b/index.js"]],
  },
  {
    id: "kind/dangling-link-gets-target",
    change: "created",
    setup: [
      ["mkdir", "src"],
      ["filelink", "../target/l.cjs", "src/l.cjs"],
    ],
    prime: [["src", "./l.cjs", "MISS"]],
    apply: [["write", "target/l.cjs"]],
    probes: [["src", "./l.cjs", "OK target/l.cjs"]],
  },
  {
    id: "kind/link-loses-target",
    change: "removed",
    setup: [
      ["write", "target/l.cjs"],
      ["mkdir", "src"],
      ["filelink", "../target/l.cjs", "src/l.cjs"],
    ],
    prime: [["src", "./l.cjs", "OK target/l.cjs"]],
    apply: [["rm", "target/l.cjs"]],
    // Stale: the entry of the link remembers the file that the link named.
    probes: [["src", "./l.cjs", "MISS", "OK target/l.cjs (does not open)"]],
  },
  // ---- link: the directory that a link to a package names
  {
    id: "link/created",
    change: "created",
    setup: [
      ["write", "vendor/p/index.js"],
      ["mkdir", "src"],
    ],
    prime: [["src", "p", "MISS"]],
    apply: [["link", "../vendor/p", "node_modules/p"]],
    probes: [["src", "p", "OK vendor/p/index.js"]],
  },
  {
    id: "link/retargeted-after-miss",
    change: "replaced",
    setup: [
      ["write", "store/v1/index.js"],
      ["write", "store/v2/index.js"],
      ["write", "store/v2/feature.js"],
      ["mkdir", "src"],
      ["link", "../store/v1", "node_modules/p"],
    ],
    prime: [["src", "p/feature.js", "MISS"]],
    apply: [
      ["rm", "node_modules/p"],
      ["link", "../store/v2", "node_modules/p"],
    ],
    probes: [["src", "p/feature.js", "OK store/v2/feature.js"]],
  },
  {
    id: "link/retargeted-after-hit",
    change: "replaced",
    setup: [
      ["write", "store/v1/index.js"],
      ["write", "store/v2/index.js"],
      ["mkdir", "src"],
      ["link", "../store/v1", "node_modules/p"],
    ],
    prime: [["src", "p", "OK store/v1/index.js"]],
    apply: [
      ["rm", "node_modules/p"],
      ["link", "../store/v2", "node_modules/p"],
    ],
    // Stale: the directory of the package remembers where the link led.
    probes: [["src", "p", "OK store/v2/index.js", "OK store/v1/index.js"]],
  },
  {
    id: "link/removed-reveals-hoisted",
    change: "removed",
    setup: [
      ["write", "store/v1/index.js"],
      ["write", "node_modules/p/index.js"],
      ["mkdir", "a/node_modules"],
      ["link", "../../store/v1", "a/node_modules/p"],
    ],
    prime: [["a", "p", "OK store/v1/index.js"]],
    apply: [["rm", "a/node_modules/p"]],
    // Stale: the link is still in the listing of a/node_modules, so the nearer package wins.
    probes: [["a", "p", "OK node_modules/p/index.js", "OK store/v1/index.js"]],
  },
  // ---- dir: whether a directory exists
  {
    id: "dir/created",
    change: "created",
    setup: [["mkdir", "src"]],
    prime: [["src", "./newdir/f.cjs", "MISS"]],
    apply: [["write", "src/newdir/f.cjs"]],
    probes: [["src", "./newdir/f.cjs", "OK src/newdir/f.cjs"]],
  },
  {
    id: "dir/created-package",
    change: "created",
    setup: [["mkdir", "src"]],
    prime: [["src", "q", "MISS"]],
    apply: [["write", "node_modules/q/index.js"]],
    probes: [["src", "q", "OK node_modules/q/index.js"]],
  },
  {
    id: "dir/removed",
    change: "removed",
    setup: [["write", "src/d/f.cjs"]],
    prime: [["src", "./d/f.cjs", "OK src/d/f.cjs"]],
    apply: [["rm", "src/d"]],
    // Stale: the lookup finds f.cjs in the listing of src/d that it read before.
    probes: [["src", "./d/f.cjs", "MISS", "OK src/d/f.cjs (does not open)"]],
  },
  {
    id: "dir/removed-reveals-hoisted",
    change: "removed",
    setup: [
      ["write", "a/node_modules/p/package.json", exportsIndexOnly],
      ["write", "a/node_modules/p/i.js"],
      ["write", "node_modules/p/f.js"],
      ["write", "node_modules/p/index.js"],
    ],
    prime: [["a", "p/f.js", "MISS"]],
    apply: [["rm", "a/node_modules/p"]],
    probes: [["a", "p/f.js", "OK node_modules/p/f.js"]],
  },
  {
    id: "dir/replaced-by-rename",
    change: "replaced",
    setup: [["write", "src/d/old.cjs"]],
    prime: [
      ["src", "./d/old.cjs", "OK src/d/old.cjs"],
      ["src", "./d/new.cjs", "MISS"],
    ],
    apply: [
      ["rename", "src/d", "src/d.bak"],
      ["write", "src/d/new.cjs"],
    ],
    // The first probe misses in the cache and reads src/d again, which the second probe then uses.
    probes: [
      ["src", "./d/new.cjs", "OK src/d/new.cjs"],
      ["src", "./d/old.cjs", "MISS"],
    ],
  },
  // ---- listerr: a directory that could not be opened
  {
    id: "listerr/becomes-readable",
    change: "created",
    setup: [
      ["write", "src/locked/a.cjs"],
      ["chmod", "src/locked", 0o000],
    ],
    prime: [["src", "./locked/a.cjs", "MISS"]],
    apply: [["chmod", "src/locked", 0o755]],
    probes: [["src", "./locked/a.cjs", "OK src/locked/a.cjs"]],
  },
  {
    id: "listerr/becomes-unreadable",
    change: "removed",
    setup: [["write", "src/locked/a.cjs"]],
    prime: [["src", "./locked/a.cjs", "OK src/locked/a.cjs"]],
    apply: [["chmod", "src/locked", 0o000]],
    // Stale: the lookup finds a.cjs in the listing that it read while the directory opened.
    probes: [["src", "./locked/a.cjs", "MISS", "OK src/locked/a.cjs (does not open)"]],
  },
  // ---- nm: whether a directory has a node_modules
  {
    id: "nm/created",
    change: "created",
    setup: [["mkdir", "app"]],
    prime: [["app", "r", "MISS"]],
    apply: [["write", "app/node_modules/r/index.js"]],
    probes: [["app", "r", "OK app/node_modules/r/index.js"]],
  },
  {
    id: "nm/removed-reveals-hoisted",
    change: "removed",
    setup: [
      ["write", "app/node_modules/r/index.js"],
      ["write", "node_modules/r/index.js"],
    ],
    prime: [["app", "r", "OK app/node_modules/r/index.js"]],
    apply: [["rm", "app/node_modules"]],
    // Stale: app still counts as having a node_modules, and the directory of the package in it is remembered.
    probes: [["app", "r", "OK node_modules/r/index.js", "OK app/node_modules/r/index.js (does not open)"]],
  },
  {
    id: "nm/removed-after-miss-reveals-hoisted",
    change: "removed",
    setup: [
      ["write", "a/node_modules/p/package.json", exportsIndexOnly],
      ["write", "a/node_modules/p/i.js"],
      ["write", "node_modules/p/f.js"],
      ["write", "node_modules/p/index.js"],
    ],
    prime: [["a", "p/f.js", "MISS"]],
    apply: [["rm", "a/node_modules"]],
    probes: [["a", "p/f.js", "OK node_modules/p/f.js"]],
  },
  {
    id: "nm/replaced-by-link",
    change: "replaced",
    setup: [
      ["write", "app/node_modules/r1/index.js"],
      ["write", "alt/r2/index.js"],
    ],
    prime: [["app", "r2", "MISS"]],
    apply: [
      ["rename", "app/node_modules", "app/nm.bak"],
      ["link", "../alt", "app/node_modules"],
    ],
    probes: [["app", "r2", "OK alt/r2/index.js"]],
  },
  {
    // The directory that holds the link does not change: only what the link names does.
    id: "nm/link-gets-target",
    keptFirst: true,
    change: "created",
    setup: [
      ["mkdir", "app"],
      ["link", "../alt", "app/node_modules"],
    ],
    prime: [["app", "r", "MISS"]],
    apply: [["write", "alt/r/index.js"]],
    probes: [["app", "r", "OK alt/r/index.js"]],
  },
  // ---- pkgjson: the package.json of a directory
  {
    id: "pkgjson/created-in-named-dir",
    change: "created",
    setup: [["write", "src/lib/impl.cjs"]],
    prime: [["src", "./lib", "MISS"]],
    apply: [["write", "src/lib/package.json", json({ main: "./impl.cjs" })]],
    probes: [["src", "./lib", "OK src/lib/impl.cjs"]],
  },
  {
    id: "pkgjson/created-next-to-importer",
    change: "created",
    setup: [["write", "src/impl.cjs"]],
    prime: [["src", "#alias", "MISS"]],
    apply: [["write", "src/package.json", json({ name: "s", imports: { "#alias": "./impl.cjs" } })]],
    probes: [["src", "#alias", "OK src/impl.cjs"]],
  },
  {
    id: "pkgjson/edited-next-to-importer",
    change: "replaced",
    setup: [
      ["write", "src/impl.cjs"],
      ["write", "src/package.json", json({ name: "s", imports: {} })],
    ],
    prime: [["src", "#alias", "MISS"]],
    apply: [["write", "src/package.json", json({ name: "s", imports: { "#alias": "./impl.cjs" } })]],
    probes: [["src", "#alias", "OK src/impl.cjs"]],
  },
  {
    id: "pkgjson/edited-above-importer",
    change: "replaced",
    setup: [
      ["write", "proj/impl.cjs"],
      ["mkdir", "proj/src"],
      ["write", "proj/package.json", json({ name: "s", imports: {} })],
    ],
    prime: [["proj/src", "#alias", "MISS"]],
    apply: [["write", "proj/package.json", json({ name: "s", imports: { "#alias": "./impl.cjs" } })]],
    probes: [["proj/src", "#alias", "OK proj/impl.cjs"]],
  },
  {
    id: "pkgjson/dependency-exports-gets-subpath",
    change: "replaced",
    setup: [
      ["write", "node_modules/p/package.json", exportsIndexOnly],
      ["write", "node_modules/p/i.js"],
      ["write", "node_modules/p/sub.js"],
      ["mkdir", "src"],
    ],
    prime: [["src", "p/sub.js", "MISS"]],
    apply: [
      ["write", "node_modules/p/package.json", json({ name: "p", exports: { ".": "./i.js", "./sub.js": "./sub.js" } })],
    ],
    probes: [["src", "p/sub.js", "OK node_modules/p/sub.js"]],
  },
  {
    id: "pkgjson/dependency-main-edited",
    change: "replaced",
    setup: [
      ["write", "node_modules/p/package.json", json({ name: "p", main: "./a.js" })],
      ["write", "node_modules/p/a.js"],
      ["write", "node_modules/p/b.js"],
      ["mkdir", "src"],
    ],
    prime: [["src", "p", "OK node_modules/p/a.js"]],
    apply: [["write", "node_modules/p/package.json", json({ name: "p", main: "./b.js" })]],
    // Stale: the directory of the package remembers the package.json that it parsed.
    probes: [["src", "p", "OK node_modules/p/b.js", "OK node_modules/p/a.js"]],
  },
  {
    id: "pkgjson/dependency-main-added-after-miss",
    change: "replaced",
    setup: [
      ["write", "node_modules/p/package.json", json({ name: "p" })],
      ["write", "node_modules/p/a.js"],
      ["mkdir", "src"],
    ],
    prime: [["src", "p", "MISS"]],
    apply: [["write", "node_modules/p/package.json", json({ name: "p", main: "./a.js" })]],
    probes: [["src", "p", "OK node_modules/p/a.js"]],
  },
  {
    id: "pkgjson/removed-reveals-file",
    change: "removed",
    setup: [
      ["write", "node_modules/p/package.json", exportsIndexOnly],
      ["write", "node_modules/p/i.js"],
      ["write", "node_modules/p/sub.js"],
      ["mkdir", "src"],
    ],
    prime: [["src", "p/sub.js", "MISS"]],
    apply: [["rm", "node_modules/p/package.json"]],
    probes: [["src", "p/sub.js", "OK node_modules/p/sub.js"]],
  },
  {
    id: "pkgjson/half-written-then-valid",
    change: "replaced",
    setup: [
      ["write", "node_modules/p/package.json", '{"name":"p","main": '],
      ["write", "node_modules/p/i.js"],
      ["mkdir", "src"],
    ],
    prime: [["src", "p", "MISS"]],
    apply: [["write", "node_modules/p/package.json", json({ name: "p", main: "./i.js" })]],
    probes: [["src", "p", "OK node_modules/p/i.js"]],
  },
  {
    id: "pkgjson/link-gets-target",
    keptFirst: true,
    change: "created",
    setup: [
      ["write", "app/impl.cjs"],
      ["filelink", "../cfg/package.json", "app/package.json"],
    ],
    prime: [["app", "#alias", "MISS"]],
    apply: [["write", "cfg/package.json", json({ name: "s", imports: { "#alias": "./impl.cjs" } })]],
    probes: [["app", "#alias", "OK app/impl.cjs"]],
  },
  // ---- tsconfig: the tsconfig.json of a directory and the files that it extends
  {
    id: "tsconfig/created-next-to-importer",
    change: "created",
    setup: [["write", "src/lib/utils.cjs"]],
    prime: [["src", "utils-alias", "MISS"]],
    apply: [["write", "src/tsconfig.json", tsconfig({ "utils-alias": ["./lib/utils.cjs"] })]],
    probes: [["src", "utils-alias", "OK src/lib/utils.cjs"]],
  },
  {
    id: "tsconfig/edited-next-to-importer",
    change: "replaced",
    setup: [
      ["write", "src/lib/utils.cjs"],
      ["write", "src/tsconfig.json", tsconfig({})],
    ],
    prime: [["src", "utils-alias", "MISS"]],
    apply: [["write", "src/tsconfig.json", tsconfig({ "utils-alias": ["./lib/utils.cjs"] })]],
    probes: [["src", "utils-alias", "OK src/lib/utils.cjs"]],
  },
  {
    id: "tsconfig/edited-above-importer",
    change: "replaced",
    setup: [
      ["write", "proj/lib/utils.cjs"],
      ["mkdir", "proj/src"],
      ["write", "proj/tsconfig.json", tsconfig({})],
    ],
    prime: [["proj/src", "utils-alias", "MISS"]],
    apply: [["write", "proj/tsconfig.json", tsconfig({ "utils-alias": ["./lib/utils.cjs"] })]],
    probes: [["proj/src", "utils-alias", "OK proj/lib/utils.cjs"]],
  },
  {
    id: "tsconfig/extends-target-edited",
    change: "replaced",
    setup: [
      ["write", "proj/src/lib/utils.cjs"],
      ["write", "proj/base.json", tsconfig({})],
      ["write", "proj/src/tsconfig.json", json({ extends: "../base.json" })],
    ],
    prime: [["proj/src", "utils-alias", "MISS"]],
    apply: [["write", "proj/base.json", tsconfig({ "utils-alias": ["./src/lib/utils.cjs"] })]],
    probes: [["proj/src", "utils-alias", "OK proj/src/lib/utils.cjs"]],
  },
  {
    id: "tsconfig/alias-retargeted",
    change: "replaced",
    setup: [
      ["write", "src/a.cjs"],
      ["write", "src/b.cjs"],
      ["write", "src/tsconfig.json", tsconfig({ t: ["./a.cjs"] })],
    ],
    prime: [["src", "t", "OK src/a.cjs"]],
    apply: [["write", "src/tsconfig.json", tsconfig({ t: ["./b.cjs"] })]],
    // Stale: the directory remembers the tsconfig.json that it parsed.
    probes: [["src", "t", "OK src/b.cjs", "OK src/a.cjs"]],
  },
  {
    id: "tsconfig/removed-reveals-package",
    change: "removed",
    setup: [
      ["write", "src/a.cjs"],
      ["write", "node_modules/t/index.js"],
      ["write", "src/tsconfig.json", tsconfig({ t: ["./a.cjs"] })],
    ],
    prime: [["src", "t", "OK src/a.cjs"]],
    apply: [["rm", "src/tsconfig.json"]],
    // Stale: the directory remembers the tsconfig.json that it parsed.
    probes: [["src", "t", "OK node_modules/t/index.js", "OK src/a.cjs"]],
  },
  {
    id: "tsconfig/link-gets-target",
    keptFirst: true,
    change: "created",
    setup: [
      ["write", "app/lib/utils.cjs"],
      ["filelink", "../cfg/tsconfig.json", "app/tsconfig.json"],
    ],
    prime: [["app", "utils-alias", "MISS"]],
    apply: [["write", "cfg/tsconfig.json", tsconfig({ "utils-alias": ["../app/lib/utils.cjs"] })]],
    probes: [["app", "utils-alias", "OK app/lib/utils.cjs"]],
  },
  // ---- realpath: the real path of a directory below a link
  {
    id: "realpath/ancestor-link-switched",
    change: "replaced",
    setup: [
      ["write", "releases/1/src/a.cjs"],
      ["write", "releases/2/src/a.cjs"],
      ["write", "releases/2/src/new.cjs"],
      ["link", "releases/1", "current"],
    ],
    entriesAlso: [["current/src", "releases/2/src"]],
    prime: [
      ["current/src", "./a.cjs", "OK releases/1/src/a.cjs"],
      ["current/src", "./new.cjs", "MISS"],
    ],
    apply: [
      ["rm", "current"],
      ["link", "releases/2", "current"],
    ],
    // The first probe misses in the cache and reads the link again, which the second probe then uses.
    probes: [
      ["current/src", "./new.cjs", "OK releases/2/src/new.cjs"],
      ["current/src", "./a.cjs", "OK releases/2/src/a.cjs"],
    ],
  },
  {
    // The package link names its target through a second link, and only that second link changes.
    id: "realpath/link-through-a-switched-link",
    keptFirst: true,
    change: "replaced",
    setup: [
      ["write", "store/v1/p/index.js"],
      ["write", "store/v2/p/index.js"],
      ["write", "store/v2/p/feature.js"],
      ["link", "v1", "store/current"],
      ["mkdir", "src"],
      ["link", "../store/current/p", "node_modules/p"],
    ],
    prime: [["src", "p/feature.js", "MISS"]],
    apply: [
      ["rm", "store/current"],
      ["link", "v2", "store/current"],
    ],
    probes: [["src", "p/feature.js", "OK store/v2/p/feature.js"]],
  },
  // ---- parentlink: a directory whose record points at the record of the directory above it
  {
    id: "parentlink/level-above-read-again",
    change: "replaced",
    setup: [
      ["write", "proj/impl.cjs"],
      ["mkdir", "proj/src"],
      ["write", "proj/package.json", json({ name: "s", imports: {} })],
    ],
    prime: [
      ["proj/src", "#alias", "MISS"],
      ["proj", "./new.cjs", "MISS"],
    ],
    apply: [
      ["write", "proj/new.cjs"],
      ["write", "proj/package.json", json({ name: "s", imports: { "#alias": "./impl.cjs" } })],
    ],
    probes: [
      ["proj", "./new.cjs", "OK proj/new.cjs"],
      ["proj/src", "#alias", "OK proj/impl.cjs"],
    ],
  },
];

// bun fact-table-fixture.cjs <warm | cold> <resolve | build>, started next to rows.json. Each row has the directory
// <warm | cold>/<row> for itself.
// warm: the files of every row, then for each row its lookups, its change, and its lookups after the change.
// cold: the files and the change of every row, then for each row its lookups after the change.
const fixture = /* js */ `
  const fs = require("node:fs");
  const path = require("node:path");
  const { createRequire } = require("node:module");

  const [phase, surface] = process.argv.slice(2);
  const rows = JSON.parse(fs.readFileSync("rows.json", "utf8"));
  const base = path.join(fs.realpathSync(process.cwd()), phase);
  const rootOf = row => path.join(base, row.dir);

  function run(root, ops) {
    for (const [op, a, b] of ops) {
      const at = path.join(root, op === "link" || op === "filelink" ? b : a);
      if (op === "write" || op === "link" || op === "filelink") fs.mkdirSync(path.dirname(at), { recursive: true });
      if (op === "write") fs.writeFileSync(at, b ?? 'module.exports = "@@' + a + '@@";');
      else if (op === "mkdir") fs.mkdirSync(at, { recursive: true });
      // The type is for Windows, where a link to a directory is a junction.
      else if (op === "link") fs.symlinkSync(a, at, "junction");
      else if (op === "filelink") fs.symlinkSync(a, at, "file");
      else if (op === "rename") fs.renameSync(at, path.join(root, b));
      else if (op === "chmod") fs.chmodSync(at, b);
      // "rm": a link goes away alone, whatever it names.
      else if (fs.lstatSync(at).isSymbolicLink()) fs.unlinkSync(at);
      else fs.rmSync(at, { recursive: true });
    }
  }

  // Bun.build() starts from a file that imports the specifier: one for each lookup of a row, in the importing
  // directory.
  function lookupsOf(row) {
    const lookups = [];
    for (const [from, specifier] of [...row.prime, ...row.probes]) {
      if (!lookups.some(l => l[0] === from && l[1] === specifier)) lookups.push([from, specifier]);
    }
    return lookups;
  }
  const entryOf = (row, from, specifier) =>
    "__entry" + lookupsOf(row).findIndex(l => l[0] === from && l[1] === specifier) + ".cjs";
  function writeEntries(row, from, dir) {
    for (const [f, specifier] of lookupsOf(row)) {
      if (f !== from) continue;
      const text = "module.exports = require(" + JSON.stringify(specifier) + ");";
      run(rootOf(row), [["write", path.join(dir, entryOf(row, f, specifier)), text]]);
    }
  }

  function setup(row) {
    // With a node_modules in sight, a lookup that misses does not ask the registry for the package.
    run(rootOf(row), [
      ["write", "node_modules/.keep", ""],
      ["write", "package.json", JSON.stringify({ name: "fixture", private: true })],
      ...row.setup,
    ]);
    // Through a link, a file lands in the directory that the link names now.
    for (const from of new Set(lookupsOf(row).map(l => l[0]))) writeEntries(row, from, from);
    for (const [from, dir] of row.entriesAlso ?? []) writeEntries(row, from, dir);
  }

  function resolveLookup(row, from, specifier) {
    const root = rootOf(row);
    let found;
    try {
      found = createRequire(path.join(root, from, "__importer.cjs")).resolve(specifier);
    } catch (e) {
      return e.code === "MODULE_NOT_FOUND" ? "MISS" : "ERROR " + (e.code ?? e.message);
    }
    const file = path.relative(root, found).split(path.sep).join("/");
    try {
      fs.closeSync(fs.openSync(found, "r"));
      return "OK " + file;
    } catch {
      return "OK " + file + " (does not open)";
    }
  }

  async function buildLookup(row, from, specifier) {
    const root = rootOf(row);
    const entrypoints = [path.join(root, from, entryOf(row, from, specifier))];
    const result = await Bun.build({ entrypoints, target: "bun", throw: false });
    if (!result.success) {
      const messages = result.logs.map(log => log.message);
      if (messages.some(message => message.startsWith("Could not resolve: "))) return "MISS";
      return "ERROR " + messages.join(" | ").replaceAll(root, "<root>");
    }
    // Each module of a row exports a marker that names its file.
    const marker = (await result.outputs[0].text()).match(/@@(.+?)@@/);
    return "OK " + (marker ? marker[1] : "(no marker)");
  }

  const lookup = (row, [from, specifier]) =>
    surface === "build" ? buildLookup(row, from, specifier) : resolveLookup(row, from, specifier);

  // A listing that was read right after its directory was made is read once more. Windows keeps none.
  async function untilListingsAreKept(row) {
    if (process.platform === "win32") return;
    const { getCounters } = require("bun:internal-for-testing");
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      const before = getCounters().resolver.refills;
      for (const l of row.prime) await lookup(row, l);
      if (getCounters().resolver.refills === before) return;
    }
  }

  (async () => {
    const answers = {};
    try {
      for (const row of rows) {
        setup(row);
        if (phase === "cold") run(rootOf(row), row.apply);
      }
      for (const row of rows) {
        const answer = (answers[row.id] = { before: [], after: [] });
        if (phase === "warm") {
          for (const l of row.prime) answer.before.push(await lookup(row, l));
          if (row.keptFirst) await untilListingsAreKept(row);
          run(rootOf(row), row.apply);
        }
        for (const l of row.probes) answer.after.push(await lookup(row, l));
      }
    } finally {
      console.log(JSON.stringify(answers));
    }
  })();
`;

type Surface = "resolve" | "build";
// What the lookups of a row answered: the prime lookups, then the probes in the process that made the prime lookups
// and in a new process.
type Answers = { before: string[]; sameProcess: string[]; newProcess: string[] };

const folderOf = (row: Row) => row.id.replace("/", "-");
const lockedDirsOf = (row: Row) => [...row.setup, ...row.apply].flatMap(op => (op[0] === "chmod" ? [op[1]] : []));
// A directory that does not open is for require.resolve() only, and Windows has no such mode.
const rowsOf = (surface: Surface) =>
  rows.filter(row => lockedDirsOf(row).length === 0 || (surface === "resolve" && !isWindows));

// One cell for each probe of a row, under the kind of change: what its lookup answered before the change, and after
// it in the same process and in a new one.
function tableOf(surface: Surface, answersOf: (row: Row) => Answers) {
  const table: Record<Change, Record<string, { before: string; sameProcess: string; newProcess: string }>> = {
    created: {},
    removed: {},
    replaced: {},
  };
  for (const row of rowsOf(surface)) {
    const { before, sameProcess, newProcess } = answersOf(row);
    row.probes.forEach(([from, specifier], i) => {
      table[row.change][row.probes.length > 1 ? `${row.id}#${i + 1}` : row.id] = {
        before: before[row.prime.findIndex(lookup => lookup[0] === from && lookup[1] === specifier)],
        sameProcess: sameProcess[i],
        newProcess: newProcess[i],
      };
    });
  }
  return table;
}

// A build checks each cached fact that it reads once, so only require.resolve() has an answer that stays.
const expectedTable = (surface: Surface) => ({
  table: tableOf(surface, row => ({
    before: row.prime.map(([, , before]) => before),
    sameProcess: row.probes.map(([, , fresh, stale]) => (surface === "resolve" && stale) || fresh),
    newProcess: row.probes.map(([, , fresh]) => fresh),
  })),
  stderr: ["", ""],
  exitCodes: [0, 0],
});

// Two processes answer: one makes the lookups around the change, and a new one makes them after it.
async function answeredTable(surface: Surface) {
  const list = rowsOf(surface);
  using dir = tempDir("resolver-fact-table", {
    "fact-table-fixture.cjs": fixture,
    "rows.json": json(list.map(row => ({ ...row, dir: folderOf(row) }))),
    // Made before a process starts: each one reads the listing of this directory to find its script.
    "warm": {},
    "cold": {},
  });
  // The mode of a directory does not stop the superuser, so under it the lookups of these rows run as another user.
  const locks = list.some(row => lockedDirsOf(row).length > 0);
  using unprivileged = locks ? unprivilegedSpawnOptions(String(dir)) : null;
  const run = async (phase: "warm" | "cold") => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fact-table-fixture.cjs", phase, surface],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { answers: JSON.parse(stdout || "{}"), stderr: stderr.trim(), exitCode };
  };
  try {
    const [warm, cold] = await Promise.all([run("warm"), run("cold")]);
    return {
      table: tableOf(surface, row => ({
        before: warm.answers[row.id]?.before ?? [],
        sameProcess: warm.answers[row.id]?.after ?? [],
        newProcess: cold.answers[row.id]?.after ?? [],
      })),
      stderr: [warm.stderr, cold.stderr],
      exitCodes: [warm.exitCode, cold.exitCode],
    };
  } finally {
    // The directory of the test can only be removed while each of its directories opens.
    for (const row of list) {
      for (const locked of lockedDirsOf(row)) {
        for (const tree of ["warm", "cold"]) {
          const at = join(String(dir), tree, folderOf(row), locked);
          if (existsSync(at)) chmodSync(at, 0o755);
        }
      }
    }
  }
}

// Each test compares the whole table of its surface: two processes answer every row, and the difference names each
// cell that moved. Only the first test calls `unprivilegedSpawnOptions`, which may change and restore the modes of
// directories above the test's own, so the two tests of this file can run at once. A test of another file that calls
// it under the same TMPDIR cannot: the caller that changed a mode restores it when it ends, while the processes of a
// later caller still need it. The first line of this file keeps it out of such a batch.
describe.concurrent("what the resolver cached, after it changed on disk", () => {
  test("require.resolve() looks up again what it missed, and keeps what it found", async () => {
    expect(await answeredTable("resolve")).toEqual(expectedTable("resolve"));
  });

  test("Bun.build() answers as a new process does", async () => {
    expect(await answeredTable("build")).toEqual(expectedTable("build"));
  });
});
