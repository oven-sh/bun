import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { installEnv, TestRegistry } from "registry";

// Except for the one install at the end of this file, nothing is installed and no registry is contacted: a project is
// its package.json files and at most one lockfile.
async function sbom(cwd: string, args: string[], env?: Record<string, string | undefined>) {
  await using proc = spawn({
    cmd: [bunExe(), "pm", "sbom", ...args],
    cwd,
    env: { ...bunEnv, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// One run for each format, in the order [cyclonedx, spdx].
const bothFormats = (cwd: string, env?: Record<string, string | undefined>, flags: string[] = []) =>
  Promise.all([
    sbom(cwd, ["--sbom-format", "cyclonedx", ...flags], env),
    sbom(cwd, ["--sbom-format", "spdx", ...flags], env),
  ]);

// The digest of an integrity string in hex, which is how both formats print it.
const hexOf = (sri: string) => Buffer.from(sri.slice(sri.indexOf("-") + 1), "base64").toString("hex");

// An integrity string as bun.lock has it. The same seed gives the same string.
function sri(seed: string, algorithm: "sha1" | "sha256" | "sha384" | "sha512" = "sha512") {
  return `${algorithm}-${createHash(algorithm).update(seed).digest("base64")}`;
}

// A document without what changes between two runs (serial number, time) or two builds (the version of bun).
function stable(text: string) {
  return text
    .replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, "<timestamp>")
    .replace(/("name": "bun",\s*"version": "|"Tool: bun-)[^"]*/g, "$1<version>");
}

type Manifest = {
  name: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: boolean }>;
};

// The bun.lock entry of a registry package. `info` has its dependency groups and `optionalPeers`.
function npm(name: string, version: string, info: object = {}) {
  return [`${name}@${version}`, "", info, sri(`${name}@${version}`)];
}

// Entries, keyed by name, of registry packages at 1.0.0 that depend on nothing.
function leaves(...names: string[]) {
  return Object.fromEntries(names.map(name => [name, npm(name, "1.0.0")]));
}

// What bun.lock keeps of a package.json: the dependency groups, and `optionalPeers` in place of peerDependenciesMeta.
function lockEntry({ peerDependenciesMeta = {}, ...manifest }: Manifest) {
  const optionalPeers = Object.keys(peerDependenciesMeta).filter(name => peerDependenciesMeta[name].optional);
  return optionalPeers.length > 0 ? { ...manifest, optionalPeers } : manifest;
}

// The files of an installed project. `packages` is that section of bun.lock, `workspaces` has each member by directory.
function project(root: Manifest, packages: Record<string, unknown[]>, workspaces: Record<string, Manifest> = {}) {
  const members = Object.entries(workspaces);
  const lock = {
    lockfileVersion: 1,
    workspaces: { "": lockEntry({ ...root, version: undefined }) } as Record<string, object>,
    packages: { ...packages },
  };
  const files: Record<string, string> = {
    "package.json": JSON.stringify(members.length > 0 ? { ...root, workspaces: Object.keys(workspaces) } : root),
  };
  for (const [directory, manifest] of members) {
    files[`${directory}/package.json`] = JSON.stringify(manifest);
    lock.workspaces[directory] = lockEntry(manifest);
    lock.packages[manifest.name] = [`${manifest.name}@workspace:${directory}`];
  }
  files["bun.lock"] = JSON.stringify(lock, null, 2);
  return files;
}

type Run = Awaited<ReturnType<typeof sbom>>;

// A CycloneDX document by package name: the root, the components, their scopes, and what each package depends on.
function readCycloneDx({ stdout, stderr }: Run) {
  expect(stderr).toBe("");
  const bom = JSON.parse(stdout);
  const root = bom.metadata.component;
  const nameOf = new Map<string, string>([[root["bom-ref"], root.name]]);
  const components: Record<string, any> = {};
  const scopes: Record<string, string> = {};
  for (const component of bom.components) {
    nameOf.set(component["bom-ref"], component.name);
    components[component.name] = component;
    scopes[component.name] = component.scope;
  }
  const dependsOn: Record<string, string[]> = {};
  for (const { ref, dependsOn: refs = [] } of bom.dependencies) {
    if (refs.length === 0) continue;
    dependsOn[nameOf.get(ref) ?? ref] = refs.map((to: string) => nameOf.get(to) ?? to).sort();
  }
  return { root, components, scopes, dependsOn };
}

// An SPDX document by package name: the package it describes, the other packages, and each relationship as one line,
// sorted.
function readSpdx({ stdout, stderr }: Run) {
  expect(stderr).toBe("");
  const doc = JSON.parse(stdout);
  const nameOf = new Map<string, string>(doc.packages.map((pkg: any) => [pkg.SPDXID, pkg.name]));
  const name = (id: string) => nameOf.get(id) ?? id;
  const described = doc.relationships.find((row: any) => row.relationshipType === "DESCRIBES")?.relatedSpdxElement;
  const packages: Record<string, any> = {};
  for (const pkg of doc.packages) {
    if (pkg.SPDXID !== described) packages[pkg.name] = pkg;
  }
  const relationships: string[] = doc.relationships
    .map((row: any) => `${name(row.spdxElementId)} ${row.relationshipType} ${name(row.relatedSpdxElement)}`)
    .sort();
  return { root: doc.packages.find((pkg: any) => pkg.SPDXID === described), packages, relationships };
}

// The SPDX relationships, as `readSpdx` has them, of a document that describes `root` and has the edges of `dependsOn`.
const relationshipsOf = (root: string, dependsOn: Record<string, string[]>) =>
  [
    `SPDXRef-DOCUMENT DESCRIBES ${root}`,
    ...Object.entries(dependsOn).flatMap(([from, names]) => names.map(to => `${from} DEPENDS_ON ${to}`)),
  ].sort();

// What an SPDX package has that is the same for every package.
const unasserted = {
  filesAnalyzed: false,
  licenseConcluded: "NOASSERTION",
  licenseDeclared: "NOASSERTION",
  copyrightText: "NOASSERTION",
};

const duplicates = (values: string[]) => values.filter((value, i) => values.indexOf(value) !== i);

// What is wrong with the bom-refs of a CycloneDX document. Two packages cannot share one, `dependencies` can only name
// those that a package has, and it cannot have two rows for one or the same one twice in a `dependsOn`.
function brokenRefs(bom: any): string[] {
  const refs: string[] = [bom.metadata.component, ...bom.components].map(component => component["bom-ref"]);
  const rows: { ref: string; dependsOn?: string[] }[] = bom.dependencies;
  return [
    ...duplicates(refs).map(ref => `${ref} is the bom-ref of two packages`),
    ...duplicates(rows.map(row => row.ref)).map(ref => `${ref} has two rows in dependencies`),
    ...rows.flatMap(({ ref, dependsOn = [] }) => [
      ...[ref, ...dependsOn].filter(to => !refs.includes(to)).map(to => `${to} is in dependencies and is no bom-ref`),
      ...duplicates(dependsOn).map(to => `${ref} depends on ${to} twice`),
    ]),
  ];
}

// The same for the SPDXIDs of an SPDX document, which also have only the characters that SPDX allows.
function brokenIds(doc: any): string[] {
  const ids: string[] = [doc.SPDXID, ...doc.packages.map((pkg: any) => pkg.SPDXID)];
  const rows: { spdxElementId: string; relatedSpdxElement: string }[] = doc.relationships;
  return [
    ...ids.filter(id => !/^SPDXRef-[A-Za-z0-9.-]+$/.test(id)).map(id => `${id} is not an SPDXID`),
    ...duplicates(ids).map(id => `${id} is the SPDXID of two elements`),
    ...[...doc.documentDescribes, ...rows.flatMap(row => [row.spdxElementId, row.relatedSpdxElement])]
      .filter((id: string) => !ids.includes(id))
      .map((id: string) => `${id} is in a relationship and is no SPDXID`),
    ...duplicates(rows.map(row => JSON.stringify(row))).map(row => `${row} is there twice`),
  ];
}

// `stable` replaces a time, which is the time of the run.
const HOUR = 60 * 60 * 1000;
const sinceThen = (timestamp: string) => Math.abs(Date.now() - Date.parse(timestamp));

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

// One package of each kind of resolution, and one dependency of each type. `older-no-deps` is another version of
// no-deps under a second name. @types/no-deps has a peer, and build-meta an optional one.
const kinds = project(
  {
    name: "kinds",
    version: "1.2.3",
    dependencies: {
      "@types/no-deps": "1.0.0",
      "gh-dep": "github:acme/gh-dep#abc1234",
      "git-dep": "git+https://git.example/acme/git-dep.git",
      "no-deps": "1.1.0",
      "older-no-deps": "npm:no-deps@1.0.0",
      "tar-dep": "https://host.example/tar-dep-1.0.0.tgz",
    },
    devDependencies: { "build-meta": "1.0.0+build.5" },
    optionalDependencies: { "opt-dep": "1.0.0" },
  },
  {
    "@types/no-deps": npm("@types/no-deps", "1.0.0", { peerDependencies: { "no-deps": "^1.0.0" } }),
    "build-meta": npm("build-meta", "1.0.0+build.5", {
      peerDependencies: { "opt-dep": "^1.0.0" },
      optionalPeers: ["opt-dep"],
    }),
    "gh-dep": ["gh-dep@github:acme/gh-dep#abc1234", {}, "acme-gh-dep-abc1234", sri("gh-dep")],
    "git-dep": [`git-dep@git+https://git.example/acme/git-dep.git#${COMMIT}`, {}, COMMIT],
    "no-deps": npm("no-deps", "1.1.0"),
    "older-no-deps": npm("no-deps", "1.0.0"),
    "opt-dep": npm("opt-dep", "1.0.0"),
    "tar-dep": ["tar-dep@https://host.example/tar-dep-1.0.0.tgz", {}, sri("tar-dep")],
  },
  { "packages/pkg-a": { name: "pkg-a", version: "0.2.0", dependencies: { "no-deps": "1.1.0" } } },
);

// The hashes that bun.lock has for `kinds`, in the order of a document. A git checkout and a workspace have no tarball.
const kindsHashes = [
  "@types/no-deps@1.0.0",
  "build-meta@1.0.0+build.5",
  "gh-dep",
  "no-deps@1.0.0",
  "no-deps@1.1.0",
  "opt-dep@1.0.0",
  "tar-dep",
].map(seed => hexOf(sri(seed)));

test.concurrent("--sbom-format cyclonedx prints a CycloneDX 1.5 document", async () => {
  using dir = tempDir("sbom-cyclonedx", kinds);
  const { stdout, stderr, exitCode } = await sbom(String(dir), ["--sbom-format", "cyclonedx"]);
  expect(stderr).toBe("");
  const bom = JSON.parse(stdout);
  // What `stable` replaces: a serial number that the CycloneDX schema accepts, the time and the version of this bun.
  expect(bom.serialNumber).toMatch(
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(bom.metadata.timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/);
  expect(sinceThen(bom.metadata.timestamp)).toBeLessThan(HOUR);
  expect(bom.metadata.tools.components).toEqual([{ type: "application", name: "bun", version: Bun.version }]);
  expect(bom.components.flatMap((component: any) => component.hashes ?? [])).toEqual(
    kindsHashes.map(content => ({ alg: "SHA-512", content })),
  );
  expect(brokenRefs(bom)).toEqual([]);
  expect(stable(stdout)).toMatchInlineSnapshot(`
    "{
      "$schema": "http://cyclonedx.org/schema/bom-1.5.schema.json",
      "bomFormat": "CycloneDX",
      "specVersion": "1.5",
      "serialNumber": "urn:uuid:<uuid>",
      "version": 1,
      "metadata": {
        "timestamp": "<timestamp>",
        "lifecycles": [{ "phase": "pre-build" }],
        "tools": {
          "components": [
            { "type": "application", "name": "bun", "version": "<version>" }
          ]
        },
        "component": {
          "type": "library",
          "bom-ref": "kinds@1.2.3",
          "name": "kinds",
          "version": "1.2.3",
          "scope": "required",
          "purl": "pkg:npm/kinds@1.2.3"
        }
      },
      "components": [
        {
          "type": "library",
          "bom-ref": "@types/no-deps@1.0.0",
          "name": "@types/no-deps",
          "version": "1.0.0",
          "scope": "required",
          "purl": "pkg:npm/%40types/no-deps@1.0.0",
          "hashes": [{ "alg": "SHA-512", "content": "be0887a43c2aef649411a7c24baae6a986babe33de128f19803475ac8a7a1f8a75e8235c65aa32fa109e827c698c67c4527bdd3b9be60c6e327fa4bd2c190bd9" }]
        },
        {
          "type": "library",
          "bom-ref": "build-meta@1.0.0+build.5",
          "name": "build-meta",
          "version": "1.0.0+build.5",
          "scope": "excluded",
          "purl": "pkg:npm/build-meta@1.0.0%2Bbuild.5",
          "hashes": [{ "alg": "SHA-512", "content": "74c6af9bc76fded0f4d11a601cce616216b52f79a47da930d2cb6ff23315528395f4ef638188f58cb788292a80782d94e1a5b492008e57d6eafb6c7f86979838" }]
        },
        {
          "type": "library",
          "bom-ref": "gh-dep@github:acme/gh-dep#abc1234",
          "name": "gh-dep",
          "version": "github:acme/gh-dep#abc1234",
          "scope": "required",
          "hashes": [{ "alg": "SHA-512", "content": "65fb9fbe8adc9600f21d762552011f340d0924861c7af5020114ca4e1d591f5c6eecf61c390f8578b788184b6291452f459d44ba965010bf93b79305f0e8d793" }]
        },
        {
          "type": "library",
          "bom-ref": "git-dep@git+https://git.example/acme/git-dep.git#0123456789abcdef0123456789abcdef01234567",
          "name": "git-dep",
          "version": "git+https://git.example/acme/git-dep.git#0123456789abcdef0123456789abcdef01234567",
          "scope": "required"
        },
        {
          "type": "library",
          "bom-ref": "no-deps@1.0.0",
          "name": "no-deps",
          "version": "1.0.0",
          "scope": "required",
          "purl": "pkg:npm/no-deps@1.0.0",
          "hashes": [{ "alg": "SHA-512", "content": "db6448624b93df5851a80029c98a24b86406db0faf731adce4438de956a7b8506f2f6092882c2ec965a335a43e07f5305d3da119417f11e3e6a0c082d386eb1e" }]
        },
        {
          "type": "library",
          "bom-ref": "no-deps@1.1.0",
          "name": "no-deps",
          "version": "1.1.0",
          "scope": "required",
          "purl": "pkg:npm/no-deps@1.1.0",
          "hashes": [{ "alg": "SHA-512", "content": "c104aa0390a6402394d82e30ce6acb04bea2b4b03d53e85b683075afa79c6328dd6405ec0b405ceb1ade8278bc244836726c9a3162b8d2328af55f8004abd1d3" }]
        },
        {
          "type": "library",
          "bom-ref": "opt-dep@1.0.0",
          "name": "opt-dep",
          "version": "1.0.0",
          "scope": "optional",
          "purl": "pkg:npm/opt-dep@1.0.0",
          "hashes": [{ "alg": "SHA-512", "content": "9d51242d9982c9caea3d33c128204c23c5dfaa00864d826fe642cdcee2a66b66c28791d5efa43232c58b64b4b59976daca9c78348a2f2d13ea924cfa9a758c62" }]
        },
        {
          "type": "library",
          "bom-ref": "pkg-a@0.2.0",
          "name": "pkg-a",
          "version": "0.2.0",
          "scope": "required",
          "purl": "pkg:npm/pkg-a@0.2.0"
        },
        {
          "type": "library",
          "bom-ref": "tar-dep",
          "name": "tar-dep",
          "scope": "required",
          "externalReferences": [{ "type": "distribution", "url": "https://host.example/tar-dep-1.0.0.tgz" }],
          "hashes": [{ "alg": "SHA-512", "content": "97919d00fc543119f7d5dc9cb878ddda61bfff85a71383c2cf80b80bc57b1bbcf63bf3863c9f169d2063187f855bd48bf9b8619cd3a8c253ae3874ad1201a9df" }]
        }
      ],
      "dependencies": [
        { "ref": "kinds@1.2.3", "dependsOn": ["@types/no-deps@1.0.0", "build-meta@1.0.0+build.5", "gh-dep@github:acme/gh-dep#abc1234", "git-dep@git+https://git.example/acme/git-dep.git#0123456789abcdef0123456789abcdef01234567", "no-deps@1.0.0", "no-deps@1.1.0", "opt-dep@1.0.0", "pkg-a@0.2.0", "tar-dep"] },
        { "ref": "@types/no-deps@1.0.0", "dependsOn": ["no-deps@1.1.0"] },
        { "ref": "build-meta@1.0.0+build.5", "dependsOn": ["opt-dep@1.0.0"] },
        { "ref": "gh-dep@github:acme/gh-dep#abc1234", "dependsOn": [] },
        { "ref": "git-dep@git+https://git.example/acme/git-dep.git#0123456789abcdef0123456789abcdef01234567", "dependsOn": [] },
        { "ref": "no-deps@1.0.0", "dependsOn": [] },
        { "ref": "no-deps@1.1.0", "dependsOn": [] },
        { "ref": "opt-dep@1.0.0", "dependsOn": [] },
        { "ref": "pkg-a@0.2.0", "dependsOn": ["no-deps@1.1.0"] },
        { "ref": "tar-dep", "dependsOn": [] }
      ]
    }
    "
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("--sbom-format spdx prints an SPDX 2.3 document", async () => {
  using dir = tempDir("sbom-spdx", kinds);
  const { stdout, stderr, exitCode } = await sbom(String(dir), ["--sbom-format", "spdx"]);
  expect(stderr).toBe("");
  const doc = JSON.parse(stdout);
  // What `stable` replaces. SPDX has no fractions of a second.
  expect(doc.creationInfo.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  expect(sinceThen(doc.creationInfo.created)).toBeLessThan(HOUR);
  expect(doc.creationInfo.creators).toEqual([`Tool: bun-${Bun.version}`]);
  expect(doc.packages.flatMap((pkg: any) => pkg.checksums ?? [])).toEqual(
    kindsHashes.map(checksumValue => ({ algorithm: "SHA512", checksumValue })),
  );
  expect(brokenIds(doc)).toEqual([]);
  expect(stable(stdout)).toMatchInlineSnapshot(`
    "{
      "spdxVersion": "SPDX-2.3",
      "dataLicense": "CC0-1.0",
      "SPDXID": "SPDXRef-DOCUMENT",
      "name": "kinds@1.2.3",
      "documentNamespace": "https://spdx.org/spdxdocs/kinds-1.2.3-<uuid>",
      "creationInfo": {
        "created": "<timestamp>",
        "creators": ["Tool: bun-<version>"]
      },
      "documentDescribes": ["SPDXRef-Package-kinds-1.2.3"],
      "packages": [
        {
          "name": "kinds",
          "SPDXID": "SPDXRef-Package-kinds-1.2.3",
          "versionInfo": "1.2.3",
          "primaryPackagePurpose": "LIBRARY",
          "downloadLocation": "NOASSERTION",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION",
          "externalRefs": [{ "referenceCategory": "PACKAGE-MANAGER", "referenceType": "purl", "referenceLocator": "pkg:npm/kinds@1.2.3" }]
        },
        {
          "name": "@types/no-deps",
          "SPDXID": "SPDXRef-Package--types-no-deps-1.0.0",
          "versionInfo": "1.0.0",
          "downloadLocation": "NOASSERTION",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION",
          "externalRefs": [{ "referenceCategory": "PACKAGE-MANAGER", "referenceType": "purl", "referenceLocator": "pkg:npm/%40types/no-deps@1.0.0" }],
          "checksums": [{ "algorithm": "SHA512", "checksumValue": "be0887a43c2aef649411a7c24baae6a986babe33de128f19803475ac8a7a1f8a75e8235c65aa32fa109e827c698c67c4527bdd3b9be60c6e327fa4bd2c190bd9" }]
        },
        {
          "name": "build-meta",
          "SPDXID": "SPDXRef-Package-build-meta-1.0.0-build.5",
          "versionInfo": "1.0.0+build.5",
          "downloadLocation": "NOASSERTION",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION",
          "externalRefs": [{ "referenceCategory": "PACKAGE-MANAGER", "referenceType": "purl", "referenceLocator": "pkg:npm/build-meta@1.0.0%2Bbuild.5" }],
          "checksums": [{ "algorithm": "SHA512", "checksumValue": "74c6af9bc76fded0f4d11a601cce616216b52f79a47da930d2cb6ff23315528395f4ef638188f58cb788292a80782d94e1a5b492008e57d6eafb6c7f86979838" }]
        },
        {
          "name": "gh-dep",
          "SPDXID": "SPDXRef-Package-gh-dep-github-acme-gh-dep-abc1234",
          "versionInfo": "github:acme/gh-dep#abc1234",
          "downloadLocation": "NOASSERTION",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION",
          "checksums": [{ "algorithm": "SHA512", "checksumValue": "65fb9fbe8adc9600f21d762552011f340d0924861c7af5020114ca4e1d591f5c6eecf61c390f8578b788184b6291452f459d44ba965010bf93b79305f0e8d793" }]
        },
        {
          "name": "git-dep",
          "SPDXID": "SPDXRef-Package-git-dep-git-https---git.example-acme-git-dep.git-0123456789abcdef0123456789abcdef01234567",
          "versionInfo": "git+https://git.example/acme/git-dep.git#0123456789abcdef0123456789abcdef01234567",
          "downloadLocation": "NOASSERTION",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION"
        },
        {
          "name": "no-deps",
          "SPDXID": "SPDXRef-Package-no-deps-1.0.0",
          "versionInfo": "1.0.0",
          "downloadLocation": "NOASSERTION",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION",
          "externalRefs": [{ "referenceCategory": "PACKAGE-MANAGER", "referenceType": "purl", "referenceLocator": "pkg:npm/no-deps@1.0.0" }],
          "checksums": [{ "algorithm": "SHA512", "checksumValue": "db6448624b93df5851a80029c98a24b86406db0faf731adce4438de956a7b8506f2f6092882c2ec965a335a43e07f5305d3da119417f11e3e6a0c082d386eb1e" }]
        },
        {
          "name": "no-deps",
          "SPDXID": "SPDXRef-Package-no-deps-1.1.0",
          "versionInfo": "1.1.0",
          "downloadLocation": "NOASSERTION",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION",
          "externalRefs": [{ "referenceCategory": "PACKAGE-MANAGER", "referenceType": "purl", "referenceLocator": "pkg:npm/no-deps@1.1.0" }],
          "checksums": [{ "algorithm": "SHA512", "checksumValue": "c104aa0390a6402394d82e30ce6acb04bea2b4b03d53e85b683075afa79c6328dd6405ec0b405ceb1ade8278bc244836726c9a3162b8d2328af55f8004abd1d3" }]
        },
        {
          "name": "opt-dep",
          "SPDXID": "SPDXRef-Package-opt-dep-1.0.0",
          "versionInfo": "1.0.0",
          "downloadLocation": "NOASSERTION",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION",
          "externalRefs": [{ "referenceCategory": "PACKAGE-MANAGER", "referenceType": "purl", "referenceLocator": "pkg:npm/opt-dep@1.0.0" }],
          "checksums": [{ "algorithm": "SHA512", "checksumValue": "9d51242d9982c9caea3d33c128204c23c5dfaa00864d826fe642cdcee2a66b66c28791d5efa43232c58b64b4b59976daca9c78348a2f2d13ea924cfa9a758c62" }]
        },
        {
          "name": "pkg-a",
          "SPDXID": "SPDXRef-Package-pkg-a-0.2.0",
          "versionInfo": "0.2.0",
          "downloadLocation": "NOASSERTION",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION",
          "externalRefs": [{ "referenceCategory": "PACKAGE-MANAGER", "referenceType": "purl", "referenceLocator": "pkg:npm/pkg-a@0.2.0" }]
        },
        {
          "name": "tar-dep",
          "SPDXID": "SPDXRef-Package-tar-dep",
          "downloadLocation": "https://host.example/tar-dep-1.0.0.tgz",
          "filesAnalyzed": false,
          "licenseConcluded": "NOASSERTION",
          "licenseDeclared": "NOASSERTION",
          "copyrightText": "NOASSERTION",
          "checksums": [{ "algorithm": "SHA512", "checksumValue": "97919d00fc543119f7d5dc9cb878ddda61bfff85a71383c2cf80b80bc57b1bbcf63bf3863c9f169d2063187f855bd48bf9b8619cd3a8c253ae3874ad1201a9df" }]
        }
      ],
      "relationships": [
        { "spdxElementId": "SPDXRef-DOCUMENT", "relatedSpdxElement": "SPDXRef-Package-kinds-1.2.3", "relationshipType": "DESCRIBES" },
        { "spdxElementId": "SPDXRef-Package-kinds-1.2.3", "relatedSpdxElement": "SPDXRef-Package--types-no-deps-1.0.0", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-kinds-1.2.3", "relatedSpdxElement": "SPDXRef-Package-build-meta-1.0.0-build.5", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-kinds-1.2.3", "relatedSpdxElement": "SPDXRef-Package-gh-dep-github-acme-gh-dep-abc1234", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-kinds-1.2.3", "relatedSpdxElement": "SPDXRef-Package-git-dep-git-https---git.example-acme-git-dep.git-0123456789abcdef0123456789abcdef01234567", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-kinds-1.2.3", "relatedSpdxElement": "SPDXRef-Package-no-deps-1.0.0", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-kinds-1.2.3", "relatedSpdxElement": "SPDXRef-Package-no-deps-1.1.0", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-kinds-1.2.3", "relatedSpdxElement": "SPDXRef-Package-opt-dep-1.0.0", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-kinds-1.2.3", "relatedSpdxElement": "SPDXRef-Package-pkg-a-0.2.0", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-kinds-1.2.3", "relatedSpdxElement": "SPDXRef-Package-tar-dep", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package--types-no-deps-1.0.0", "relatedSpdxElement": "SPDXRef-Package-no-deps-1.1.0", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-build-meta-1.0.0-build.5", "relatedSpdxElement": "SPDXRef-Package-opt-dep-1.0.0", "relationshipType": "DEPENDS_ON" },
        { "spdxElementId": "SPDXRef-Package-pkg-a-0.2.0", "relatedSpdxElement": "SPDXRef-Package-no-deps-1.1.0", "relationshipType": "DEPENDS_ON" }
      ]
    }
    "
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("--sbom-format spdx and --sbom-format=spdx print the same document", async () => {
  using dir = tempDir("sbom-equals", kinds);
  const cwd = String(dir);
  const [spaced, joined] = await Promise.all([sbom(cwd, ["--sbom-format", "spdx"]), sbom(cwd, ["--sbom-format=spdx"])]);
  expect(spaced.stderr).toBe("");
  const doc = JSON.parse(spaced.stdout);
  expect(doc.spdxVersion).toBe("SPDX-2.3");
  expect({ ...joined, stdout: stable(joined.stdout) }).toEqual({ ...spaced, stdout: stable(spaced.stdout) });
  // Each run has a namespace of its own, which `stable` replaces.
  expect(JSON.parse(joined.stdout).documentNamespace).not.toBe(doc.documentNamespace);
  expect(spaced.exitCode).toBe(0);
});

// `published` is the registry's package with the root's own name and version, and `twin` is under-score@1.0.0 under a
// second name. under-score and under_score differ in a character that an SPDXID cannot have.
const collisions = project(
  {
    name: "collisions",
    version: "1.0.0",
    dependencies: {
      "published": "npm:collisions@1.0.0",
      "twin": "npm:under-score@1.0.0",
      "under-score": "1.0.0",
      "under_score": "1.0.0",
    },
  },
  {
    "published": npm("collisions", "1.0.0"),
    "twin": npm("under-score", "1.0.0"),
    "under-score": npm("under-score", "1.0.0"),
    "under_score": npm("under_score", "1.0.0"),
  },
);

// The root asks for `both` as a devDependency and as an optional peer, and needs-both as a dependency and as a peer.
const twice = project(
  {
    name: "twice",
    version: "1.0.0",
    dependencies: { "needs-both": "1.0.0" },
    devDependencies: { both: "1.0.0" },
    peerDependencies: { both: "^1.0.0" },
    peerDependenciesMeta: { both: { optional: true } },
  },
  {
    "both": npm("both", "1.0.0"),
    "needs-both": npm("needs-both", "1.0.0", {
      dependencies: { both: "^1.0.0" },
      peerDependencies: { both: "^1.0.0" },
    }),
  },
);

// `member` depends on itself and on the root, which depends on it.
const loops = project(
  { name: "loops", version: "1.0.0", dependencies: { member: "workspace:*" } },
  { loops: ["loops@root:", {}] },
  {
    "packages/member": {
      name: "member",
      version: "1.0.0",
      dependencies: { loops: "workspace:*", member: "workspace:*" },
    },
  },
);

// Each project, what depends on what in it by name, and its SPDX relationships by name.
test.concurrent.each<[string, Record<string, string>, Record<string, string[]>, string[]]>([
  [
    "two packages of one name and version, and two names that make one SPDXID",
    collisions,
    { collisions: ["collisions", "under-score", "under_score"] },
    [
      "SPDXRef-DOCUMENT DESCRIBES collisions",
      "collisions DEPENDS_ON collisions",
      "collisions DEPENDS_ON under-score",
      "collisions DEPENDS_ON under_score",
    ],
  ],
  [
    "two dependencies on one package",
    twice,
    { "twice": ["both", "needs-both"], "needs-both": ["both"] },
    [
      "SPDXRef-DOCUMENT DESCRIBES twice",
      "needs-both DEPENDS_ON both",
      "twice DEPENDS_ON both",
      "twice DEPENDS_ON needs-both",
    ],
  ],
  [
    "a workspace that depends on itself and on the root",
    loops,
    { loops: ["member"], member: ["loops", "member"] },
    [
      "SPDXRef-DOCUMENT DESCRIBES loops",
      "loops DEPENDS_ON member",
      "member DEPENDS_ON loops",
      "member DEPENDS_ON member",
    ],
  ],
])(
  "bom-refs and SPDXIDs are unique and every edge is between declared packages, with %s",
  async (_, files, dependsOn, relationships) => {
    using dir = tempDir("sbom-identifiers", files);
    const [cyclonedx, spdx] = await bothFormats(String(dir));

    expect(readCycloneDx(cyclonedx).dependsOn).toEqual(dependsOn);
    expect(brokenRefs(JSON.parse(cyclonedx.stdout))).toEqual([]);

    expect(readSpdx(spdx).relationships).toEqual(relationships);
    expect(brokenIds(JSON.parse(spdx.stdout))).toEqual([]);

    expect(cyclonedx.exitCode).toBe(0);
    expect(spdx.exitCode).toBe(0);
  },
);

test.concurrent(
  "scope is required, optional or excluded, and a devDependency that is also an optional peer is excluded (#42040)",
  async () => {
    using dir = tempDir(
      "sbom-scope",
      project(
        {
          name: "root",
          version: "1.0.0",
          dependencies: { prod: "1.0.0" },
          devDependencies: { dev: "1.0.0", "dev-and-optional-peer": "1.0.0" },
          optionalDependencies: { opt: "1.0.0" },
          peerDependencies: { "dev-and-optional-peer": "^1.0.0" },
          peerDependenciesMeta: { "dev-and-optional-peer": { optional: true } },
        },
        {
          prod: npm("prod", "1.0.0", {
            dependencies: { "prod-and-dev-need": "^1.0.0", "prod-needs": "^1.0.0" },
            peerDependencies: { "optional-peer-of-prod": "^1.0.0", "peer-of-prod": "^1.0.0" },
            optionalPeers: ["optional-peer-of-prod"],
          }),
          opt: npm("opt", "1.0.0", {
            dependencies: { "opt-and-dev-need": "^1.0.0", "opt-needs": "^1.0.0", "optional-peer-of-prod": "^1.0.0" },
          }),
          dev: npm("dev", "1.0.0", {
            dependencies: { "dev-needs": "^1.0.0", "opt-and-dev-need": "^1.0.0", "prod-and-dev-need": "^1.0.0" },
          }),
          ...leaves(
            "dev-and-optional-peer",
            "dev-needs",
            "opt-and-dev-need",
            "opt-needs",
            "optional-peer-of-prod",
            "peer-of-prod",
            "prod-and-dev-need",
            "prod-needs",
          ),
        },
      ),
    );
    const [everything, production] = await Promise.all([
      sbom(String(dir), ["--sbom-format", "cyclonedx"]),
      sbom(String(dir), ["--sbom-format", "cyclonedx", "--production"]),
    ]);

    const all = readCycloneDx(everything);
    expect(all.scopes).toEqual({
      "dev": "excluded",
      "dev-and-optional-peer": "excluded",
      "dev-needs": "excluded",
      "opt": "optional",
      "opt-and-dev-need": "optional",
      "opt-needs": "optional",
      "optional-peer-of-prod": "optional",
      "peer-of-prod": "required",
      "prod": "required",
      "prod-and-dev-need": "required",
      "prod-needs": "required",
    });
    expect(all.dependsOn).toEqual({
      root: ["dev", "dev-and-optional-peer", "opt", "prod"],
      dev: ["dev-needs", "opt-and-dev-need", "prod-and-dev-need"],
      opt: ["opt-and-dev-need", "opt-needs", "optional-peer-of-prod"],
      prod: ["optional-peer-of-prod", "peer-of-prod", "prod-and-dev-need", "prod-needs"],
    });

    // `bun install --production` installs none of the excluded packages, so none of them is listed.
    const installed = readCycloneDx(production);
    expect(installed.scopes).toEqual({
      "opt": "optional",
      "opt-and-dev-need": "optional",
      "opt-needs": "optional",
      "optional-peer-of-prod": "optional",
      "peer-of-prod": "required",
      "prod": "required",
      "prod-and-dev-need": "required",
      "prod-needs": "required",
    });
    expect(installed.dependsOn).toEqual({
      root: ["opt", "prod"],
      opt: ["opt-and-dev-need", "opt-needs", "optional-peer-of-prod"],
      prod: ["optional-peer-of-prod", "peer-of-prod", "prod-and-dev-need", "prod-needs"],
    });

    expect(everything.exitCode).toBe(0);
    expect(production.exitCode).toBe(0);
  },
);

// The root's devDependency `x` is also what its dependency `a` needs. Every other package has one way in.
const needed = project(
  {
    name: "root",
    version: "1.0.0",
    dependencies: { a: "1.0.0" },
    devDependencies: { "dev-only": "1.0.0", x: "1.0.0" },
    optionalDependencies: { opt: "1.0.0" },
    peerDependencies: { peer: "^1.0.0" },
  },
  { a: npm("a", "1.0.0", { dependencies: { x: "^1.0.0" } }), ...leaves("dev-only", "opt", "peer", "x") },
);

test.concurrent(
  "--production, --prod and --omit=dev keep a devDependency that a dependency needs, without the root's edge to it",
  async () => {
    using dir = tempDir("sbom-production", needed);
    const cwd = String(dir);
    const [everything, production, prod, omitDev, everythingSpdx, productionSpdx] = await Promise.all([
      sbom(cwd, ["--sbom-format", "cyclonedx"]),
      sbom(cwd, ["--sbom-format", "cyclonedx", "--production"]),
      sbom(cwd, ["--sbom-format", "cyclonedx", "--prod"]),
      sbom(cwd, ["--sbom-format", "cyclonedx", "--omit=dev"]),
      sbom(cwd, ["--sbom-format", "spdx"]),
      sbom(cwd, ["--sbom-format", "spdx", "--production"]),
    ]);

    const all = readCycloneDx(everything);
    expect(all.scopes).toEqual({
      a: "required",
      "dev-only": "excluded",
      opt: "optional",
      peer: "required",
      x: "required",
    });
    expect(all.dependsOn).toEqual({ root: ["a", "dev-only", "opt", "peer", "x"], a: ["x"] });
    expect(readSpdx(everythingSpdx).relationships).toEqual([
      "SPDXRef-DOCUMENT DESCRIBES root",
      "a DEPENDS_ON x",
      "root DEPENDS_ON a",
      "root DEPENDS_ON dev-only",
      "root DEPENDS_ON opt",
      "root DEPENDS_ON peer",
      "root DEPENDS_ON x",
    ]);

    const installed = readCycloneDx(production);
    expect(installed.scopes).toEqual({ a: "required", opt: "optional", peer: "required", x: "required" });
    expect(installed.dependsOn).toEqual({ root: ["a", "opt", "peer"], a: ["x"] });
    expect(readSpdx(productionSpdx).relationships).toEqual([
      "SPDXRef-DOCUMENT DESCRIBES root",
      "a DEPENDS_ON x",
      "root DEPENDS_ON a",
      "root DEPENDS_ON opt",
      "root DEPENDS_ON peer",
    ]);

    expect(stable(prod.stdout)).toBe(stable(production.stdout));
    expect(stable(omitDev.stdout)).toBe(stable(production.stdout));

    for (const run of [everything, production, prod, omitDev, everythingSpdx, productionSpdx]) {
      expect(run.exitCode).toBe(0);
    }
  },
);

test.concurrent("--omit=optional and --omit=peer leave out what only those dependency types reach", async () => {
  using dir = tempDir("sbom-omit", needed);
  const cwd = String(dir);
  const [omitOptional, omitPeer, omitAll] = await Promise.all([
    sbom(cwd, ["--sbom-format", "cyclonedx", "--omit=optional"]),
    sbom(cwd, ["--sbom-format", "cyclonedx", "--omit=peer"]),
    sbom(cwd, ["--sbom-format", "cyclonedx", "--production", "--omit=optional", "--omit=peer"]),
  ]);

  const withoutOptional = readCycloneDx(omitOptional);
  expect(withoutOptional.scopes).toEqual({ a: "required", "dev-only": "excluded", peer: "required", x: "required" });
  expect(withoutOptional.dependsOn).toEqual({ root: ["a", "dev-only", "peer", "x"], a: ["x"] });

  const withoutPeer = readCycloneDx(omitPeer);
  expect(withoutPeer.scopes).toEqual({ a: "required", "dev-only": "excluded", opt: "optional", x: "required" });
  expect(withoutPeer.dependsOn).toEqual({ root: ["a", "dev-only", "opt", "x"], a: ["x"] });

  const dependenciesOnly = readCycloneDx(omitAll);
  expect(dependenciesOnly.scopes).toEqual({ a: "required", x: "required" });
  expect(dependenciesOnly.dependsOn).toEqual({ root: ["a"], a: ["x"] });

  for (const run of [omitOptional, omitPeer, omitAll]) {
    expect(run.exitCode).toBe(0);
  }
});

test.concurrent(
  "bunfig install.production, install.dev, install.optional and install.peer apply like the flags",
  async () => {
    using flags = tempDir("sbom-flags", needed);
    using production = tempDir("sbom-bunfig", { ...needed, "bunfig.toml": "[install]\nproduction = true\n" });
    using omits = tempDir("sbom-bunfig", {
      ...needed,
      "bunfig.toml": "[install]\ndev = false\noptional = false\npeer = false\n",
    });
    const [fromProduction, withProduction, fromOmits, withOmits] = await Promise.all([
      sbom(String(production), ["--sbom-format", "cyclonedx"]),
      sbom(String(flags), ["--sbom-format", "cyclonedx", "--production"]),
      sbom(String(omits), ["--sbom-format", "cyclonedx"]),
      sbom(String(flags), ["--sbom-format", "cyclonedx", "--omit=dev", "--omit=optional", "--omit=peer"]),
    ]);

    expect(readCycloneDx(fromProduction).scopes).toEqual({
      a: "required",
      opt: "optional",
      peer: "required",
      x: "required",
    });
    expect(stable(fromProduction.stdout)).toBe(stable(withProduction.stdout));

    expect(readCycloneDx(fromOmits).scopes).toEqual({ a: "required", x: "required" });
    expect(stable(fromOmits.stdout)).toBe(stable(withOmits.stdout));

    for (const run of [fromProduction, withProduction, fromOmits, withOmits]) {
      expect(run.exitCode).toBe(0);
    }
  },
);

test.concurrent("inside a workspace package the document is rooted at that package", async () => {
  using dir = tempDir(
    "sbom-workspace",
    project({ name: "monorepo", version: "1.0.0" }, leaves("a", "b", "c", "dev-tool"), {
      "packages/app": {
        name: "app",
        version: "2.0.0",
        dependencies: { a: "1.0.0", lib: "workspace:*" },
        devDependencies: { "dev-tool": "1.0.0" },
      },
      "packages/lib": { name: "lib", version: "1.5.0", dependencies: { b: "1.0.0" } },
      "packages/other": { name: "other", version: "3.0.0", dependencies: { c: "1.0.0" } },
    }),
  );
  const app = join(String(dir), "packages", "app");
  const [fromRoot, [fromApp, fromAppSpdx]] = await Promise.all([
    sbom(String(dir), ["--sbom-format", "cyclonedx"]),
    bothFormats(app),
  ]);

  const whole = readCycloneDx(fromRoot);
  expect(whole.root).toMatchObject({ type: "library", name: "monorepo", version: "1.0.0" });
  expect(whole.scopes).toEqual({
    a: "required",
    app: "required",
    b: "required",
    c: "required",
    "dev-tool": "excluded",
    lib: "required",
    other: "required",
  });
  expect(whole.dependsOn).toEqual({
    monorepo: ["app", "lib", "other"],
    app: ["a", "dev-tool", "lib"],
    lib: ["b"],
    other: ["c"],
  });

  const member = readCycloneDx(fromApp);
  expect(member.root).toMatchObject({ type: "library", name: "app", version: "2.0.0" });
  expect(member.scopes).toEqual({ a: "required", b: "required", "dev-tool": "excluded", lib: "required" });
  expect(member.dependsOn).toEqual({ app: ["a", "dev-tool", "lib"], lib: ["b"] });
  // Both have a package URL. Only the registry package has a tarball, so the workspace `lib` is listed without a hash.
  expect(member.components.a).toEqual({
    type: "library",
    "bom-ref": "a@1.0.0",
    name: "a",
    version: "1.0.0",
    scope: "required",
    purl: "pkg:npm/a@1.0.0",
    hashes: [{ alg: "SHA-512", content: hexOf(sri("a@1.0.0")) }],
  });
  expect(member.components.lib).toEqual({
    type: "library",
    "bom-ref": "lib@1.5.0",
    name: "lib",
    version: "1.5.0",
    scope: "required",
    purl: "pkg:npm/lib@1.5.0",
  });

  const described = readSpdx(fromAppSpdx);
  expect(described.root).toMatchObject({ name: "app", versionInfo: "2.0.0", primaryPackagePurpose: "LIBRARY" });
  expect(described.relationships).toEqual([
    "SPDXRef-DOCUMENT DESCRIBES app",
    "app DEPENDS_ON a",
    "app DEPENDS_ON dev-tool",
    "app DEPENDS_ON lib",
    "lib DEPENDS_ON b",
  ]);

  for (const run of [fromRoot, fromApp, fromAppSpdx]) {
    expect(run.exitCode).toBe(0);
  }
});

// The root package `lib` has two workspaces. example-a depends on `lib`, and example-b does not.
const examples = project(
  { name: "lib", version: "1.0.0", dependencies: { rootdep: "1.0.0" }, devDependencies: { rootdev: "1.0.0" } },
  { lib: ["lib@root:", {}], ...leaves("adep", "bdep", "rootdep", "rootdev") },
  {
    "examples/a": { name: "example-a", version: "0.0.1", dependencies: { adep: "1.0.0", lib: "workspace:*" } },
    "examples/b": { name: "example-b", version: "0.0.2", dependencies: { bdep: "1.0.0" } },
  },
);

// The directory and the flags of each run, and its document: the package it describes, the other packages in the order
// of the document, and what depends on what.
test.concurrent.each<
  [string, string, string[], { root: string; components: Record<string, object>; dependsOn: Record<string, string[]> }]
>([
  [
    "a workspace that depends on the root package has the root's dependencies and no other workspace",
    "examples/a",
    [],
    {
      root: "example-a",
      components: {
        adep: { scope: "required" },
        lib: { scope: "required", version: "1.0.0", purl: "pkg:npm/lib@1.0.0" },
        rootdep: { scope: "required" },
        rootdev: { scope: "excluded" },
      },
      dependsOn: { "example-a": ["adep", "lib"], lib: ["rootdep", "rootdev"] },
    },
  ],
  [
    "that workspace with --production is without the root's devDependencies",
    "examples/a",
    ["--production"],
    {
      root: "example-a",
      components: { adep: { scope: "required" }, lib: { scope: "required" }, rootdep: { scope: "required" } },
      dependsOn: { "example-a": ["adep", "lib"], lib: ["rootdep"] },
    },
  ],
  [
    "a workspace that does not depend on the root package has its own dependencies only",
    "examples/b",
    [],
    { root: "example-b", components: { bdep: { scope: "required" } }, dependsOn: { "example-b": ["bdep"] } },
  ],
  [
    "the root package has every workspace",
    ".",
    [],
    {
      root: "lib",
      components: {
        adep: { scope: "required" },
        bdep: { scope: "required" },
        "example-a": { scope: "required", version: "0.0.1", purl: "pkg:npm/example-a@0.0.1" },
        "example-b": { scope: "required", version: "0.0.2", purl: "pkg:npm/example-b@0.0.2" },
        rootdep: { scope: "required" },
        rootdev: { scope: "excluded" },
      },
      dependsOn: {
        lib: ["example-a", "example-b", "rootdep", "rootdev"],
        "example-a": ["adep", "lib"],
        "example-b": ["bdep"],
      },
    },
  ],
])("the document of %s", async (_, from, flags, expected) => {
  using dir = tempDir("sbom-member-walk", examples);
  const [cyclonedx, spdx] = await bothFormats(join(String(dir), from), undefined, flags);
  const names = Object.keys(expected.components);

  const bom = readCycloneDx(cyclonedx);
  expect(bom.root.name).toBe(expected.root);
  expect(Object.keys(bom.components)).toEqual(names);
  expect(bom.components).toMatchObject(expected.components);
  expect(bom.dependsOn).toEqual(expected.dependsOn);

  const doc = readSpdx(spdx);
  expect(doc.root.name).toBe(expected.root);
  expect(Object.keys(doc.packages)).toEqual(names);
  expect(doc.relationships).toEqual(relationshipsOf(expected.root, expected.dependsOn));

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

// bun.lock has example-b at 0.0.2, and no version for the root package. Each row has another version in one
// package.json, and the directory of the run.
test.concurrent.each([
  ["a listed workspace", "examples/b/package.json", "0.0.3", "."],
  ["the described workspace", "examples/b/package.json", "0.0.3", "examples/b"],
  ["the root package that a workspace depends on", "package.json", "1.0.1", "examples/a"],
])("%s has the version of its package.json, and a package URL with it", async (_, path, version, from) => {
  const manifest = { ...JSON.parse(examples[path]), version };
  using dir = tempDir("sbom-identity", { ...examples, [path]: JSON.stringify(manifest) });
  const [cyclonedx, spdx] = await bothFormats(join(String(dir), from));
  const name: string = manifest.name;

  // A document says the same of the package that it describes and of one that it lists.
  const bom = readCycloneDx(cyclonedx);
  expect(bom.root.name === name ? bom.root : bom.components[name]).toEqual({
    type: "library",
    "bom-ref": `${name}@${version}`,
    name,
    version,
    scope: "required",
    purl: `pkg:npm/${name}@${version}`,
  });

  const doc = readSpdx(spdx);
  const pkg = doc.root.name === name ? doc.root : doc.packages[name];
  expect(pkg).toMatchObject({
    name,
    SPDXID: `SPDXRef-Package-${name}-${version}`,
    versionInfo: version,
    externalRefs: [
      { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: `pkg:npm/${name}@${version}` },
    ],
  });
  expect(pkg).not.toHaveProperty("checksums");

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

// A Docker layer often has the lockfile and only some of the workspaces.
test.concurrent("a workspace that is not in the checkout has the version that bun.lock has for it", async () => {
  const { "examples/b/package.json": _, ...checkout } = examples;
  using dir = tempDir("sbom-pruned", checkout);
  const [cyclonedx, spdx] = await bothFormats(String(dir));

  const bom = readCycloneDx(cyclonedx);
  expect(bom.components["example-b"]).toEqual({
    type: "library",
    "bom-ref": "example-b@0.0.2",
    name: "example-b",
    version: "0.0.2",
    scope: "required",
    purl: "pkg:npm/example-b@0.0.2",
  });
  expect(bom.dependsOn["example-b"]).toEqual(["bdep"]);

  expect(readSpdx(spdx).packages["example-b"]).toMatchObject({ name: "example-b", versionInfo: "0.0.2" });

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

test.concurrent("a workspace package.json that is there and cannot be read is an error", async () => {
  // A directory in the place of the file: the path exists, and reading it fails.
  const { "examples/b/package.json": _, ...checkout } = examples;
  using dir = tempDir("sbom-unreadable", { ...checkout, "examples/b/package.json/placeholder": "" });
  const [cyclonedx, spdx] = await bothFormats(String(dir));

  for (const run of [cyclonedx, spdx]) {
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("failed to read package.json");
    expect(run.stderr).toContain(join("examples", "b", "package.json"));
    expect(run.exitCode).toBe(1);
  }
});

test.concurrent("a root package.json without a version gives a root without a version or a package URL", async () => {
  const dependencies = { a: "1.0.0" };
  using versioned = tempDir("sbom-root", project({ name: "root", version: "1.2.3", dependencies }, leaves("a")));
  using unversioned = tempDir("sbom-root", project({ name: "root", dependencies }, leaves("a")));
  const [[withVersion, withVersionSpdx], [withoutVersion, withoutVersionSpdx]] = await Promise.all([
    bothFormats(String(versioned)),
    bothFormats(String(unversioned)),
  ]);

  // bun.lock has no version for the root, so this one is read from package.json.
  expect(readCycloneDx(withVersion).root).toMatchObject({
    type: "library",
    name: "root",
    version: "1.2.3",
    purl: "pkg:npm/root@1.2.3",
  });
  expect(readSpdx(withVersionSpdx).root).toMatchObject({
    name: "root",
    versionInfo: "1.2.3",
    primaryPackagePurpose: "LIBRARY",
    externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/root@1.2.3" }],
  });

  const { root, dependsOn } = readCycloneDx(withoutVersion);
  expect(root).toMatchObject({ type: "library", name: "root" });
  expect(root).not.toHaveProperty("version");
  expect(root).not.toHaveProperty("purl");
  expect(dependsOn).toEqual({ root: ["a"] });

  const described = readSpdx(withoutVersionSpdx);
  expect(described.root).toMatchObject({ name: "root", primaryPackagePurpose: "LIBRARY" });
  expect(described.root).not.toHaveProperty("versionInfo");
  expect(described.root).not.toHaveProperty("externalRefs");
  expect(described.relationships).toEqual(["SPDXRef-DOCUMENT DESCRIBES root", "root DEPENDS_ON a"]);

  for (const run of [withVersion, withVersionSpdx, withoutVersion, withoutVersionSpdx]) {
    expect(run.exitCode).toBe(0);
  }
});

test.concurrent("a root package.json without a name gives a root with the name of its directory", async () => {
  using dir = tempDir("sbom-nameless", {
    "package.json": JSON.stringify({ dependencies: { a: "1.0.0" } }),
    "bun.lock": JSON.stringify({
      lockfileVersion: 1,
      workspaces: { "": { dependencies: { a: "1.0.0" } } },
      packages: leaves("a"),
    }),
  });
  const name = basename(String(dir));
  const [cyclonedx, spdx] = await bothFormats(String(dir));

  const bom = readCycloneDx(cyclonedx);
  expect(bom.root).toEqual({ type: "library", "bom-ref": name, name, scope: "required" });
  expect(bom.dependsOn).toEqual({ [name]: ["a"] });

  const doc = readSpdx(spdx);
  expect(doc.root).toMatchObject({ name, primaryPackagePurpose: "LIBRARY" });
  expect(doc.root).not.toHaveProperty("versionInfo");
  expect(doc.root).not.toHaveProperty("externalRefs");
  expect(doc.relationships).toEqual(relationshipsOf(name, { [name]: ["a"] }));

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

test.concurrent("a root with a name that a registry cannot have gives a root without a package URL", async () => {
  using dir = tempDir(
    "sbom-unpublishable",
    project({ name: "my app", version: "1.2.3", dependencies: { a: "1.0.0" } }, leaves("a")),
  );
  const [cyclonedx, spdx] = await bothFormats(String(dir));

  expect(readCycloneDx(cyclonedx).root).toEqual({
    type: "library",
    "bom-ref": "my app@1.2.3",
    name: "my app",
    version: "1.2.3",
    scope: "required",
  });

  const { root } = readSpdx(spdx);
  expect(root).toMatchObject({ name: "my app", SPDXID: "SPDXRef-Package-my-app-1.2.3", versionInfo: "1.2.3" });
  expect(root).not.toHaveProperty("externalRefs");

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

// `kinds` with credentials in the URLs of its git package and of its tarball: before the host, and in a query string.
const kindsWithCredentials = Object.fromEntries(
  Object.entries(kinds).map(([path, text]) => [
    path,
    text
      .replaceAll(
        "https://git.example/acme/git-dep.git",
        "https://x-access-token:secret@git.example/acme/git-dep.git?token=secret",
      )
      .replaceAll(
        "https://host.example/tar-dep-1.0.0.tgz",
        "https://user:secret@host.example/tar-dep-1.0.0.tgz?token=secret",
      ),
  ]),
);

test.concurrent("credentials in a URL of the lockfile are not printed", async () => {
  // Each URL has it twice, and bun.lock has each URL twice: as what the root asks for and as what that resolved to.
  expect(kindsWithCredentials["bun.lock"].match(/secret/g)).toHaveLength(8);

  using plain = tempDir("sbom-credentials", kinds);
  using withCredentials = tempDir("sbom-credentials", kindsWithCredentials);
  const [[cyclonedx, spdx], [plainCyclonedx, plainSpdx]] = await Promise.all([
    bothFormats(String(withCredentials)),
    bothFormats(String(plain)),
  ]);

  expect(cyclonedx.stdout).not.toContain("secret");
  expect(spdx.stdout).not.toContain("secret");
  // Nothing stands in for them either: these are the documents of the project without them.
  expect(stable(cyclonedx.stdout)).toBe(stable(plainCyclonedx.stdout));
  expect(stable(spdx.stdout)).toBe(stable(plainSpdx.stdout));

  for (const { stderr, exitCode } of [cyclonedx, spdx, plainCyclonedx, plainSpdx]) {
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  }
});

// What a host can have for a token in a path. `bun pm ls` prints `***` for a string of either shape.
const UUID_TOKEN = "6f1c2d3e-4a5b-4c6d-8e7f-a0b1c2d3e4f5";
const NPM_TOKEN = "npm_1234567890abcdefghijklmnopqrstuvwxyz";

// The URL that the root asks for and that bun.lock has for the package `tarball`, and that URL in a document.
test.concurrent.each([
  ["braces", "https://host.example/dl/pkg{1}.tgz", "https://host.example/dl/pkg%7B1%7D.tgz"],
  [
    "a space and a letter that is not ASCII",
    "https://host.example/a b/\u00e9.tgz",
    "https://host.example/a%20b/%C3%A9.tgz",
  ],
  ["an escape", "https://host.example/a%20b.tgz", "https://host.example/a%20b.tgz"],
  ["a percent sign that starts no escape", "https://host.example/100%.tgz", "https://host.example/100%25.tgz"],
  ["credentials", "https://user:secret@host.example/t.tgz?token=secret", "https://host.example/t.tgz"],
  ["a UUID", `https://dl.example/${UUID_TOKEN}/pkg.tgz`, "https://dl.example/***/pkg.tgz"],
  ["an npm token", `https://dl.example/${NPM_TOKEN}/pkg.tgz`, "https://dl.example/***/pkg.tgz"],
])(
  "a remote tarball with %s in its URL has the URL in one field, as a URI reference without secrets",
  async (_, url, printed) => {
    using dir = tempDir(
      "sbom-tarball-url",
      project(
        { name: "root", version: "1.0.0", dependencies: { tarball: url } },
        { tarball: [`tarball@${url}`, {}, sri("tarball")] },
      ),
    );
    const [cyclonedx, spdx] = await bothFormats(String(dir));

    expect(readCycloneDx(cyclonedx).components).toEqual({
      tarball: {
        type: "library",
        "bom-ref": "tarball",
        name: "tarball",
        scope: "required",
        externalReferences: [{ type: "distribution", url: printed }],
        hashes: [{ alg: "SHA-512", content: hexOf(sri("tarball")) }],
      },
    });
    expect(readSpdx(spdx).packages).toEqual({
      tarball: {
        name: "tarball",
        SPDXID: "SPDXRef-Package-tarball",
        downloadLocation: printed,
        ...unasserted,
        checksums: [{ algorithm: "SHA512", checksumValue: hexOf(sri("tarball")) }],
      },
    });
    // No identifier and no edge is made of the URL: each document has its host once.
    expect(cyclonedx.stdout.match(/\.example\//g)).toHaveLength(1);
    expect(spdx.stdout.match(/\.example\//g)).toHaveLength(1);

    expect(cyclonedx.exitCode).toBe(0);
    expect(spdx.exitCode).toBe(0);
  },
);

test.concurrent("a token in the URL of a git package is *** in its version and in its bom-ref", async () => {
  const resolved = (token: string) => `git+https://git.example/${token}/git-dep.git#${COMMIT}`;
  using dir = tempDir(
    "sbom-git-token",
    project(
      {
        name: "root",
        version: "1.0.0",
        dependencies: { "git-dep": `git+https://git.example/${UUID_TOKEN}/git-dep.git` },
      },
      { "git-dep": [`git-dep@${resolved(UUID_TOKEN)}`, {}, COMMIT] },
    ),
  );
  const [cyclonedx, spdx] = await bothFormats(String(dir));

  expect(readCycloneDx(cyclonedx).components).toEqual({
    "git-dep": {
      type: "library",
      "bom-ref": `git-dep@${resolved("***")}`,
      name: "git-dep",
      version: resolved("***"),
      scope: "required",
    },
  });
  expect(readSpdx(spdx).packages).toEqual({
    "git-dep": {
      name: "git-dep",
      SPDXID: `SPDXRef-Package-git-dep-git-https---git.example-----git-dep.git-${COMMIT}`,
      versionInfo: resolved("***"),
      downloadLocation: "NOASSERTION",
      ...unasserted,
    },
  });
  expect(cyclonedx.stdout).not.toContain(UUID_TOKEN);
  expect(spdx.stdout).not.toContain(UUID_TOKEN);

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

// The repository that the root asks for, and the version of the package in a document. bun.lock has the `host:path` of
// the second one as `ssh://git@host:path`.
test.concurrent.each([
  ["an ssh URL", "git+ssh://git@github.com/acme/repo.git", "git+ssh://git@github.com/acme/repo.git"],
  ["a host:path", "git+ssh://git@gitlab.com:acme/repo.git", "git+ssh://git@gitlab.com:acme/repo.git"],
  ["another login", "git+ssh://deploy@git.example/acme/repo.git", "git+ssh://git.example/acme/repo.git"],
  ["a password", "git+ssh://git:secret@git.example/acme/repo.git", "git+ssh://git.example/acme/repo.git"],
  ["https", "git+https://git@git.example/acme/repo.git", "git+https://git.example/acme/repo.git"],
])("a git package over ssh keeps the git login: %s", async (_, repository, printed) => {
  using dir = tempDir(
    "sbom-git-login",
    project(
      { name: "root", version: "1.0.0", dependencies: { "git-dep": repository } },
      { "git-dep": [`git-dep@${repository}#${COMMIT}`, {}, COMMIT] },
    ),
  );
  const [cyclonedx, spdx] = await bothFormats(String(dir));

  expect(readCycloneDx(cyclonedx).components["git-dep"]).toEqual({
    type: "library",
    "bom-ref": `git-dep@${printed}#${COMMIT}`,
    name: "git-dep",
    version: `${printed}#${COMMIT}`,
    scope: "required",
  });
  expect(readSpdx(spdx).packages["git-dep"]).toMatchObject({ versionInfo: `${printed}#${COMMIT}` });
  expect(cyclonedx.stdout).not.toContain("secret");
  expect(spdx.stdout).not.toContain("secret");

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

test.concurrent("a folder, a link and a local tarball have their path in the bom-ref, and no version", async () => {
  using dir = tempDir(
    "sbom-paths",
    project(
      {
        name: "root",
        version: "1.0.0",
        dependencies: {
          "folder-dep": "file:vendor/folder-dep",
          "link-dep": "link:./vendor/link-dep",
          "tarball-dep": "./vendor/tarball-dep-1.0.0.tgz",
        },
      },
      {
        "folder-dep": ["folder-dep@file:vendor/folder-dep", {}],
        "link-dep": ["link-dep@link:./vendor/link-dep", {}],
        "tarball-dep": ["tarball-dep@./vendor/tarball-dep-1.0.0.tgz", {}, sri("tarball-dep")],
      },
    ),
  );
  const [cyclonedx, spdx] = await bothFormats(String(dir));

  expect(readCycloneDx(cyclonedx).components).toEqual({
    "folder-dep": {
      type: "library",
      "bom-ref": "folder-dep@file:vendor/folder-dep",
      name: "folder-dep",
      scope: "required",
    },
    "link-dep": {
      type: "library",
      "bom-ref": "link-dep@link:./vendor/link-dep",
      name: "link-dep",
      scope: "required",
    },
    "tarball-dep": {
      type: "library",
      "bom-ref": "tarball-dep@./vendor/tarball-dep-1.0.0.tgz",
      name: "tarball-dep",
      scope: "required",
      hashes: [{ alg: "SHA-512", content: hexOf(sri("tarball-dep")) }],
    },
  });
  expect(readSpdx(spdx).packages).toEqual({
    "folder-dep": {
      name: "folder-dep",
      SPDXID: "SPDXRef-Package-folder-dep-file-vendor-folder-dep",
      downloadLocation: "NOASSERTION",
      ...unasserted,
    },
    "link-dep": {
      name: "link-dep",
      SPDXID: "SPDXRef-Package-link-dep-link-.-vendor-link-dep",
      downloadLocation: "NOASSERTION",
      ...unasserted,
    },
    "tarball-dep": {
      name: "tarball-dep",
      SPDXID: "SPDXRef-Package-tarball-dep-.-vendor-tarball-dep-1.0.0.tgz",
      downloadLocation: "NOASSERTION",
      ...unasserted,
      checksums: [{ algorithm: "SHA512", checksumValue: hexOf(sri("tarball-dep")) }],
    },
  });

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

test.concurrent("a hash has the algorithm of the integrity that bun.lock has for the package", async () => {
  using dir = tempDir(
    "sbom-algorithms",
    project(
      {
        name: "root",
        version: "1.0.0",
        dependencies: { "by-sha1": "1.0.0", "by-sha256": "1.0.0", "by-sha384": "1.0.0", "by-sha512": "1.0.0" },
      },
      {
        "by-sha1": ["by-sha1@1.0.0", "", {}, sri("by-sha1", "sha1")],
        "by-sha256": ["by-sha256@1.0.0", "", {}, sri("by-sha256", "sha256")],
        "by-sha384": ["by-sha384@1.0.0", "", {}, sri("by-sha384", "sha384")],
        "by-sha512": ["by-sha512@1.0.0", "", {}, sri("by-sha512", "sha512")],
      },
    ),
  );
  const [cyclonedx, spdx] = await bothFormats(String(dir));
  // What `sri` hashes for each package is its name.
  const digest = (algorithm: string) => createHash(algorithm).update(`by-${algorithm}`).digest("hex");

  expect(readCycloneDx(cyclonedx).components).toMatchObject({
    "by-sha1": { hashes: [{ alg: "SHA-1", content: digest("sha1") }] },
    "by-sha256": { hashes: [{ alg: "SHA-256", content: digest("sha256") }] },
    "by-sha384": { hashes: [{ alg: "SHA-384", content: digest("sha384") }] },
    "by-sha512": { hashes: [{ alg: "SHA-512", content: digest("sha512") }] },
  });
  expect(readSpdx(spdx).packages).toMatchObject({
    "by-sha1": { checksums: [{ algorithm: "SHA1", checksumValue: digest("sha1") }] },
    "by-sha256": { checksums: [{ algorithm: "SHA256", checksumValue: digest("sha256") }] },
    "by-sha384": { checksums: [{ algorithm: "SHA384", checksumValue: digest("sha384") }] },
    "by-sha512": { checksums: [{ algorithm: "SHA512", checksumValue: digest("sha512") }] },
  });

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

test.concurrent("the optional packages of every platform are listed", async () => {
  // No host installs more than one of these.
  const platforms = {
    "native-darwin-arm64": { os: "darwin", cpu: "arm64" },
    "native-linux-x64-gnu": { os: "linux", cpu: "x64", libc: "glibc" },
    "native-linux-x64-musl": { os: "linux", cpu: "x64", libc: "musl" },
    "native-win32-x64": { os: "win32", cpu: "x64" },
  };
  const names = Object.keys(platforms);
  using dir = tempDir(
    "sbom-platforms",
    project(
      {
        name: "root",
        version: "1.0.0",
        optionalDependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
      },
      Object.fromEntries(Object.entries(platforms).map(([name, platform]) => [name, npm(name, "1.0.0", platform)])),
    ),
  );
  const [cyclonedx, spdx] = await bothFormats(String(dir));

  const bom = readCycloneDx(cyclonedx);
  expect(bom.scopes).toEqual({
    "native-darwin-arm64": "optional",
    "native-linux-x64-gnu": "optional",
    "native-linux-x64-musl": "optional",
    "native-win32-x64": "optional",
  });
  expect(bom.dependsOn).toEqual({ root: names });

  const doc = readSpdx(spdx);
  expect(Object.keys(doc.packages)).toEqual(names);
  expect(doc.relationships).toEqual(relationshipsOf("root", { root: names }));

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

// `inside` is in the tarball of `host`, with `deep`, which it depends on. `shared` is a package of its own, which
// `inside` depends on too. bun.lock marks only `inside`.
test.concurrent("a bundled dependency is listed with the version of bun.lock, and CycloneDX marks it", async () => {
  using dir = tempDir(
    "sbom-bundled",
    project(
      { name: "root", version: "1.0.0", dependencies: { host: "1.0.0" } },
      {
        "host": npm("host", "1.0.0", { dependencies: { inside: "1.0.0", shared: "1.0.0" } }),
        "host/inside": npm("inside", "1.0.0", { bundled: true, dependencies: { deep: "1.0.0", shared: "1.0.0" } }),
        "host/deep": npm("deep", "1.0.0"),
        "shared": npm("shared", "1.0.0"),
      },
    ),
  );
  const [cyclonedx, spdx] = await bothFormats(String(dir));
  const dependsOn = { root: ["host"], host: ["inside", "shared"], inside: ["deep", "shared"] };
  const bundled = [{ name: "cdx:npm:package:bundled", value: "true" }];

  const bom = readCycloneDx(cyclonedx);
  expect(bom.components.inside).toEqual({
    type: "library",
    "bom-ref": "inside@1.0.0",
    name: "inside",
    version: "1.0.0",
    scope: "required",
    purl: "pkg:npm/inside@1.0.0",
    hashes: [{ alg: "SHA-512", content: hexOf(sri("inside@1.0.0")) }],
    properties: bundled,
  });
  expect(bom.components.deep.properties).toEqual(bundled);
  // A package with a tarball of its own has no such property.
  expect(bom.components.host).not.toHaveProperty("properties");
  expect(bom.components.shared).not.toHaveProperty("properties");
  expect(bom.dependsOn).toEqual(dependsOn);

  const doc = readSpdx(spdx);
  expect(Object.keys(doc.packages)).toEqual(["deep", "host", "inside", "shared"]);
  expect(doc.relationships).toEqual(relationshipsOf("root", dependsOn));

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

// What the root and its workspace each ask for, and bun.lock has no package for.
const unresolved = {
  optionalDependencies: { "no-optional": "1.0.0" },
  peerDependencies: { "no-optional-peer": "^1.0.0", "no-peer": "^1.0.0" },
  peerDependenciesMeta: { "no-optional-peer": { optional: true } },
};

test.concurrent("an optional or peer dependency that bun.lock has no package for makes no edge", async () => {
  using dir = tempDir(
    "sbom-unresolved",
    project({ name: "root", version: "1.0.0", dependencies: { present: "1.0.0" }, ...unresolved }, leaves("present"), {
      "packages/member": { name: "member", version: "1.0.0", dependencies: { present: "1.0.0" }, ...unresolved },
    }),
  );
  const [cyclonedx, spdx] = await bothFormats(String(dir));
  const dependsOn = { root: ["member", "present"], member: ["present"] };

  const bom = readCycloneDx(cyclonedx);
  expect(bom.scopes).toEqual({ member: "required", present: "required" });
  expect(bom.dependsOn).toEqual(dependsOn);
  expect(brokenRefs(JSON.parse(cyclonedx.stdout))).toEqual([]);

  const doc = readSpdx(spdx);
  expect(Object.keys(doc.packages)).toEqual(["member", "present"]);
  expect(doc.relationships).toEqual(relationshipsOf("root", dependsOn));
  expect(brokenIds(JSON.parse(spdx.stdout))).toEqual([]);

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

// bun.lock leaves the tarball URL of these registry packages to the configured registry.
test.concurrent("both documents are the same with another BUN_CONFIG_REGISTRY", async () => {
  using dir = tempDir("sbom-machine", kinds);
  const cwd = String(dir);
  const [[cyclonedx, spdx], [otherCyclonedx, otherSpdx]] = await Promise.all([
    bothFormats(cwd, { BUN_CONFIG_REGISTRY: "https://registry.npmjs.org/" }),
    bothFormats(cwd, { BUN_CONFIG_REGISTRY: "https://npm.corp.example/mirror/" }),
  ]);

  // The project does have a package from the registry.
  expect(readCycloneDx(cyclonedx).components).toMatchObject({ "opt-dep": { purl: "pkg:npm/opt-dep@1.0.0" } });
  expect(stable(otherCyclonedx.stdout)).toBe(stable(cyclonedx.stdout));
  expect(stable(otherSpdx.stdout)).toBe(stable(spdx.stdout));

  for (const { stderr, exitCode } of [cyclonedx, spdx, otherCyclonedx, otherSpdx]) {
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  }
});

// What fixtures/bun.lockb.v2 locks: jquery, and is-even -> is-odd -> is-number -> kind-of -> is-buffer.
const locked: [name: string, version: string, integrity: string, dependencies?: Record<string, string>][] = [
  [
    "is-buffer",
    "1.1.6",
    "sha512-NcdALwpXkTm5Zvvbk7owOUSvVvBKDgKP5/ewfXEznmQFfs4ZRmanOeKBTjRVjka3QFoN6XJ+9F3USqfHqTaU5w==",
  ],
  [
    "is-even",
    "1.0.0",
    "sha512-LEhnkAdJqic4Dbqn58A0y52IXoHWlsueqQkKfMfdEnIYG8A1sm/GHidKkS6yvXlMoRrkM34csHnXQtOqcb+Jzg==",
    { "is-odd": "^0.1.2" },
  ],
  [
    "is-number",
    "3.0.0",
    "sha512-4cboCqIpliH+mAvFNegjZQ4kgKc3ZUhQVr3HvWbSh5q3WH2v82ct+T2Y1hdU5Gdtorx/cLifQjqCbL7bpznLTg==",
    { "kind-of": "^3.0.2" },
  ],
  [
    "is-odd",
    "0.1.2",
    "sha512-Ri7C2K7o5IrUU9UEI8losXJCCD/UtsaIrkR5sxIcFg4xQ9cRJXlWA5DQvTE0yDc0krvSNLsRGXN11UPS6KyfBw==",
    { "is-number": "^3.0.0" },
  ],
  [
    "jquery",
    "3.7.1",
    "sha512-m4avr8yL8kmFN8psrbFFFmB/If14iN5o9nw/NgnnM+kybDJpRsAynV2BsfpTYrTRysYUdADVD7CkUUizgkpLfg==",
  ],
  [
    "kind-of",
    "3.2.2",
    "sha512-NOW9QQXMoZGg/oqnVNoNTTIFEIid1627WCffUBJEdMxYApq7mNE7CpzucIPc+ZQg25Phej7IJSmX3hO+oblOtQ==",
    { "is-buffer": "^1.1.5" },
  ],
];
const lockedRoot = {
  name: "migrate-bun-lockb-v2",
  version: "1.0.0",
  dependencies: { "is-even": "^1.0.0", "jquery": "~3.7.1" },
};

// `resolved` and `integrity` are on every entry, so migrating this lockfile asks no registry for anything.
const packageLock = JSON.stringify({
  name: lockedRoot.name,
  version: lockedRoot.version,
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": lockedRoot,
    ...Object.fromEntries(
      locked.map(([name, version, integrity, dependencies]) => [
        `node_modules/${name}`,
        { version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity, dependencies },
      ]),
    ),
  },
});

test.concurrent.each([
  ["bun.lockb", readFileSync(join(import.meta.dir, "fixtures", "bun.lockb.v2")), ""],
  ["package-lock.json", Buffer.from(packageLock), "migrated lockfile from package-lock.json"],
])("a %s project is read with no file changing", async (lockfile, contents, note) => {
  const manifest = JSON.stringify(lockedRoot);
  using dir = tempDir("sbom-lockfile-source", { "package.json": manifest, [lockfile]: contents });
  const cwd = String(dir);
  // `.invalid` never resolves, so a run that asked the registry for anything would fail.
  const [cyclonedx, spdx] = await bothFormats(cwd, { BUN_CONFIG_REGISTRY: "https://registry.invalid/" });

  expect(normalizeBunSnapshot(cyclonedx.stderr)).toBe(note);
  const bom = JSON.parse(cyclonedx.stdout);
  expect(bom.components).toMatchObject(
    locked.map(([name, version, integrity]) => ({
      name,
      version,
      scope: "required",
      purl: `pkg:npm/${name}@${version}`,
      hashes: [{ alg: "SHA-512", content: hexOf(integrity) }],
    })),
  );
  expect(bom.dependencies).toEqual([
    { ref: "migrate-bun-lockb-v2@1.0.0", dependsOn: ["is-even@1.0.0", "jquery@3.7.1"] },
    { ref: "is-buffer@1.1.6", dependsOn: [] },
    { ref: "is-even@1.0.0", dependsOn: ["is-odd@0.1.2"] },
    { ref: "is-number@3.0.0", dependsOn: ["kind-of@3.2.2"] },
    { ref: "is-odd@0.1.2", dependsOn: ["is-number@3.0.0"] },
    { ref: "jquery@3.7.1", dependsOn: [] },
    { ref: "kind-of@3.2.2", dependsOn: ["is-buffer@1.1.6"] },
  ]);
  expect(cyclonedx.exitCode).toBe(0);

  expect(normalizeBunSnapshot(spdx.stderr)).toBe(note);
  expect(JSON.parse(spdx.stdout).packages).toMatchObject([
    { name: "migrate-bun-lockb-v2", versionInfo: "1.0.0" },
    ...locked.map(([name, version, integrity]) => ({
      name,
      versionInfo: version,
      externalRefs: [
        { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: `pkg:npm/${name}@${version}` },
      ],
      checksums: [{ algorithm: "SHA512", checksumValue: hexOf(integrity) }],
    })),
  ]);
  expect(spdx.exitCode).toBe(0);

  expect(readdirSync(cwd).sort()).toEqual([lockfile, "package.json"]);
  expect(readFileSync(join(cwd, lockfile)).equals(contents)).toBe(true);
  expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe(manifest);
});

// bun.lock is what the last install wrote: the root package, and its dependency `o`.
const lastInstall = project({ name: "root", version: "1.0.0", dependencies: { o: "1.0.0" } }, leaves("o"));

test.concurrent("the document reflects the lockfile of the last install, not a package.json edited since", async () => {
  using dir = tempDir("sbom-last-install", {
    ...lastInstall,
    "package.json": JSON.stringify({ name: "root", version: "1.0.0", dependencies: { "brand-new": "1.0.0" } }),
  });
  const [cyclonedx, spdx] = await bothFormats(String(dir));

  const bom = readCycloneDx(cyclonedx);
  expect(bom.root).toMatchObject({ "bom-ref": "root@1.0.0", name: "root", version: "1.0.0" });
  expect(bom.scopes).toEqual({ o: "required" });
  expect(bom.dependsOn).toEqual({ root: ["o"] });

  const doc = readSpdx(spdx);
  expect(doc.root).toMatchObject({ name: "root", versionInfo: "1.0.0" });
  expect(Object.keys(doc.packages)).toEqual(["o"]);
  expect(doc.relationships).toEqual(["SPDXRef-DOCUMENT DESCRIBES root", "root DEPENDS_ON o"]);

  expect(cyclonedx.exitCode).toBe(0);
  expect(spdx.exitCode).toBe(0);
});

test.concurrent("a workspace added since the last install has no document until it is in the lockfile", async () => {
  using dir = tempDir("sbom-new-workspace", {
    ...lastInstall,
    "package.json": JSON.stringify({
      name: "root",
      version: "1.0.0",
      workspaces: ["packages/*"],
      dependencies: { o: "1.0.0" },
    }),
    "packages/newbie/package.json": JSON.stringify({
      name: "newbie",
      version: "0.1.0",
      dependencies: { "brand-new": "1.0.0" },
    }),
  });
  const notListed = {
    stdout: "",
    stderr: "error: this workspace is not in the lockfile, nothing to list\nnote: run 'bun install' first\n",
    exitCode: 1,
  };
  expect(await bothFormats(join(String(dir), "packages", "newbie"))).toEqual([notListed, notListed]);
  // The project root is in the lockfile, so it still has its document.
  expect(readCycloneDx((await bothFormats(String(dir)))[0]).dependsOn).toEqual({ root: ["o"] });
});

// Each run describes the package `sbom-root-only`, which depends on nothing in that run. A row has the files of the
// project, the directory of the run, and its flags.
test.concurrent.each<[string, Record<string, string>, string, string[]]>([
  [
    "only devDependencies and --production",
    project({ name: "sbom-root-only", version: "1.2.3", devDependencies: { "dev-only": "1.0.0" } }, leaves("dev-only")),
    ".",
    ["--production"],
  ],
  [
    "a workspace that has no dependencies",
    project({ name: "monorepo", version: "1.0.0", dependencies: { a: "1.0.0" } }, leaves("a"), {
      "packages/sbom-root-only": { name: "sbom-root-only", version: "1.2.3" },
    }),
    "packages/sbom-root-only",
    [],
  ],
  [
    "a lockfile that has no packages",
    {
      "package.json": JSON.stringify({ name: "sbom-root-only", version: "1.2.3" }),
      "bun.lock": JSON.stringify({ lockfileVersion: 1, workspaces: { "": { name: "sbom-root-only" } }, packages: {} }),
    },
    ".",
    [],
  ],
])("the described package alone is a document, with %s", async (_, files, from, flags) => {
  using dir = tempDir("sbom-root-only", files);
  const [cyclonedx, spdx] = await bothFormats(join(String(dir), from), undefined, flags);

  expect(cyclonedx.stderr).toBe("");
  expect(JSON.parse(cyclonedx.stdout)).toMatchObject({
    bomFormat: "CycloneDX",
    metadata: {
      component: {
        type: "library",
        "bom-ref": "sbom-root-only@1.2.3",
        name: "sbom-root-only",
        version: "1.2.3",
        purl: "pkg:npm/sbom-root-only@1.2.3",
      },
    },
    components: [],
    dependencies: [{ ref: "sbom-root-only@1.2.3", dependsOn: [] }],
  });
  expect(cyclonedx.exitCode).toBe(0);

  expect(spdx.stderr).toBe("");
  expect(JSON.parse(spdx.stdout)).toMatchObject({
    spdxVersion: "SPDX-2.3",
    packages: [
      {
        name: "sbom-root-only",
        SPDXID: "SPDXRef-Package-sbom-root-only-1.2.3",
        versionInfo: "1.2.3",
        primaryPackagePurpose: "LIBRARY",
      },
    ],
    relationships: [
      {
        spdxElementId: "SPDXRef-DOCUMENT",
        relatedSpdxElement: "SPDXRef-Package-sbom-root-only-1.2.3",
        relationshipType: "DESCRIBES",
      },
    ],
  });
  expect(spdx.exitCode).toBe(0);
});

const missingLockfile = {
  stdout: "",
  stderr: "error: missing lockfile, nothing to list\nnote: run 'bun install' first\n",
  exitCode: 1,
};

// `bun install` saves no lockfile for the first two manifests, and they have no document either.
test.concurrent.each<[string, object]>([
  ["no dependency fields", {}],
  [
    "empty dependency fields",
    { dependencies: {}, devDependencies: {}, optionalDependencies: {}, peerDependencies: {} },
  ],
  ["dependencies", { dependencies: { "no-deps": "1.0.0" } }],
  ["devDependencies", { devDependencies: { "no-deps": "1.0.0" } }],
  ["optionalDependencies", { optionalDependencies: { "no-deps": "1.0.0" } }],
  ["peerDependencies", { peerDependencies: { "no-deps": "1.0.0" } }],
])("a project with %s and no lockfile exits 1 with empty stdout, and no file is created", async (_, fields) => {
  using dir = tempDir("sbom-no-lockfile", {
    "package.json": JSON.stringify({ name: "sbom-no-lockfile", version: "1.0.0", ...fields }),
  });
  const cwd = String(dir);
  expect(await bothFormats(cwd)).toEqual([missingLockfile, missingLockfile]);
  expect(readdirSync(cwd)).toEqual(["package.json"]);
});

test.concurrent("workspaces and no lockfile exits 1 with empty stdout, and no file is created", async () => {
  using dir = tempDir("sbom-no-lockfile-workspaces", {
    "package.json": JSON.stringify({ name: "sbom-no-lockfile", version: "1.0.0", workspaces: ["packages/*"] }),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      dependencies: { "no-deps": "1.0.0" },
    }),
  });
  const cwd = String(dir);
  expect(await bothFormats(cwd)).toEqual([missingLockfile, missingLockfile]);
  expect(readdirSync(cwd).sort()).toEqual(["package.json", "packages"]);
  expect(readdirSync(join(cwd, "packages", "lib"))).toEqual(["package.json"]);
});

// With `--sbom-format` and nothing else, this project has a document.
const withLockfile = project(
  { name: "sbom-flags", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } },
  leaves("no-deps"),
);

const missingFormat = {
  stdout: "",
  stderr: "error: bun pm sbom needs --sbom-format\nnote: pass --sbom-format cyclonedx or --sbom-format spdx\n",
  exitCode: 1,
};
const invalidFormat = {
  stdout: "",
  stderr: 'error: invalid --sbom-format value: "toml", expected cyclonedx or spdx\n',
  exitCode: 1,
};

// With a format, each directory fails on the file that is wrong, so the format is checked before that file is opened.
test.concurrent.each<[string, Record<string, string>, (cwd: string) => string]>([
  [
    "the lockfile",
    { ...withLockfile, "bun.lock": "this is not a lockfile\n" },
    () => "error: failed to parse lockfile: ParserError\n",
  ],
  [
    "package.json",
    {},
    cwd => `error: No package.json was found for directory "${cwd}"\nnote: Run "bun init" to initialize a project\n`,
  ],
])("a missing or invalid --sbom-format exits 1 with empty stdout before %s is opened", async (_, files, unreadable) => {
  using dir = tempDir("sbom-format-first", files);
  const cwd = String(dir);
  const [missing, invalid, valid] = await Promise.all([
    sbom(cwd, []),
    sbom(cwd, ["--sbom-format", "toml"]),
    sbom(cwd, ["--sbom-format", "cyclonedx"]),
  ]);
  expect({ missing, invalid, valid }).toEqual({
    missing: missingFormat,
    invalid: invalidFormat,
    valid: { stdout: "", stderr: unreadable(cwd), exitCode: 1 },
  });
});

const everyPlatform = (flag: string) =>
  `error: ${flag} is not supported by bun pm sbom\nnote: the document lists the packages of every platform\n`;

// `bun pm` also refuses the first three for a subcommand it does not have, so each row has a run without the flag too.
test.concurrent.each([
  ["--filter x", "error: --filter is only supported by `bun pm licenses`\n"],
  ["--json", "error: --json is only supported by `bun pm diff`, `bun pm licenses`, `bun pm pkg`, `bun pm view`\n"],
  ["--dev", "error: --dev is only supported by `bun pm licenses`\n"],
  ["--cpu x64", everyPlatform("--cpu")],
  ["--os linux", everyPlatform("--os")],
  ["--libc glibc", everyPlatform("--libc")],
  ["--global", "error: --global cannot be used with bun pm sbom\n"],
  ["-g", "error: --global cannot be used with bun pm sbom\n"],
])("%s is refused for sbom", async (flags, stderr) => {
  using dir = tempDir("sbom-refused-flag", withLockfile);
  const cwd = String(dir);
  const [alone, refused] = await Promise.all([
    sbom(cwd, ["--sbom-format", "cyclonedx"]),
    sbom(cwd, ["--sbom-format", "cyclonedx", ...flags.split(" ")]),
  ]);
  expect({ alone, refused }).toEqual({
    alone: { stdout: expect.stringMatching(/"bomFormat":\s*"CycloneDX"/), stderr: "", exitCode: 0 },
    refused: { stdout: "", stderr, exitCode: 1 },
  });
});

test.concurrent("an extra word is an error, and --silent only hides the message", async () => {
  using dir = tempDir("sbom-extra-word", withLockfile);
  const cwd = String(dir);
  const [alone, extra, silent] = await Promise.all([
    sbom(cwd, ["--sbom-format", "cyclonedx"]),
    sbom(cwd, ["--sbom-format", "cyclonedx", "extra"]),
    sbom(cwd, ["--sbom-format", "cyclonedx", "extra", "--silent"]),
  ]);
  expect({ alone, extra, silent }).toEqual({
    alone: { stdout: expect.stringMatching(/"bomFormat":\s*"CycloneDX"/), stderr: "", exitCode: 0 },
    extra: { stdout: "", stderr: "error: bun pm sbom does not take arguments\n", exitCode: 1 },
    silent: { stdout: "", stderr: "", exitCode: 1 },
  });
});

describe("after bun install from a registry", () => {
  const registry = new TestRegistry();
  let packageDir: string;

  // one-dep depends on no-deps@1.0.1.
  beforeAll(async () => {
    await registry.start();
    ({ packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "installed",
          version: "1.0.0",
          dependencies: { "one-dep": "1.0.0" },
          devDependencies: { "a-dep": "1.0.1" },
          optionalDependencies: { "basic-1": "1.0.0" },
        }),
      },
    }));
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  afterAll(() => {
    registry.stop();
  });

  test("both documents have each package of bun.lock, with its integrity as the hash", async () => {
    const lock = Bun.JSONC.parse(readFileSync(join(packageDir, "bun.lock"), "utf8")) as {
      packages: Record<string, [id: string, registry: string, info: object, integrity: string]>;
    };
    // The digest that the install wrote to bun.lock for the package.
    const digest = (name: string) => hexOf(lock.packages[name][3]);
    const [cyclonedx, spdx] = await bothFormats(packageDir);

    const component = (name: string, version: string, scope: string) => ({
      type: "library",
      "bom-ref": `${name}@${version}`,
      name,
      version,
      scope,
      purl: `pkg:npm/${name}@${version}`,
      hashes: [{ alg: "SHA-512", content: digest(name) }],
    });
    const bom = readCycloneDx(cyclonedx);
    expect(bom.components).toEqual({
      "a-dep": component("a-dep", "1.0.1", "excluded"),
      "basic-1": component("basic-1", "1.0.0", "optional"),
      "no-deps": component("no-deps", "1.0.1", "required"),
      "one-dep": component("one-dep", "1.0.0", "required"),
    });
    expect(bom.dependsOn).toEqual({ "installed": ["a-dep", "basic-1", "one-dep"], "one-dep": ["no-deps"] });

    const pkg = (name: string, version: string) => ({
      name,
      SPDXID: `SPDXRef-Package-${name}-${version}`,
      versionInfo: version,
      downloadLocation: "NOASSERTION",
      ...unasserted,
      externalRefs: [
        { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: `pkg:npm/${name}@${version}` },
      ],
      checksums: [{ algorithm: "SHA512", checksumValue: digest(name) }],
    });
    const doc = readSpdx(spdx);
    expect(doc.packages).toEqual({
      "a-dep": pkg("a-dep", "1.0.1"),
      "basic-1": pkg("basic-1", "1.0.0"),
      "no-deps": pkg("no-deps", "1.0.1"),
      "one-dep": pkg("one-dep", "1.0.0"),
    });
    expect(doc.relationships).toEqual([
      "SPDXRef-DOCUMENT DESCRIBES installed",
      "installed DEPENDS_ON a-dep",
      "installed DEPENDS_ON basic-1",
      "installed DEPENDS_ON one-dep",
      "one-dep DEPENDS_ON no-deps",
    ]);

    expect(cyclonedx.exitCode).toBe(0);
    expect(spdx.exitCode).toBe(0);
  });
});
