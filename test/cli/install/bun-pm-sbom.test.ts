import { spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, bunExe, runBunInstall } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

async function sbom(cwd: string, args: string[] = []) {
  await using proc = spawn({
    cmd: [bunExe(), "pm", "sbom", ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function setup(name: string, pkg: object) {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name, version: "1.0.0", ...pkg }));
  await runBunInstall(bunEnv, packageDir);
  return packageDir;
}

describe("bun pm sbom", () => {
  describe("CycloneDX", () => {
    test("produces a spec-valid document with components and dependency graph", async () => {
      const dir = await setup("sbom-cdx", {
        dependencies: { "one-dep": "1.0.0" },
        devDependencies: { "a-dep": "1.0.1" },
      });

      const { stdout, stderr, exitCode } = await sbom(dir);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);

      const bom = JSON.parse(stdout);

      expect(bom.bomFormat).toBe("CycloneDX");
      expect(bom.specVersion).toBe("1.7");
      expect(bom.$schema).toContain("cyclonedx.org/schema/bom-1.7");
      expect(bom.serialNumber).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(bom.version).toBe(1);

      // metadata
      expect(bom.metadata.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(bom.metadata.tools.components[0].name).toBe("bun");
      expect(typeof bom.metadata.tools.components[0].version).toBe("string");
      expect(bom.metadata.component.name).toBe("sbom-cdx");
      expect(bom.metadata.component.version).toBe("1.0.0");
      expect(bom.metadata.component.type).toBe("application");
      expect(bom.metadata.component["bom-ref"]).toBe("sbom-cdx@1.0.0");

      // components: one-dep, no-deps (transitive), a-dep
      const byRef = Object.fromEntries(bom.components.map((c: any) => [c["bom-ref"], c]));
      expect(Object.keys(byRef).sort()).toEqual(["a-dep@1.0.1", "no-deps@1.0.1", "one-dep@1.0.0"]);

      const oneDep = byRef["one-dep@1.0.0"];
      expect(oneDep).toMatchObject({
        type: "library",
        name: "one-dep",
        version: "1.0.0",
        purl: "pkg:npm/one-dep@1.0.0",
        scope: "required",
      });
      expect(oneDep.externalReferences[0].type).toBe("distribution");
      expect(oneDep.externalReferences[0].url).toContain("/one-dep/-/one-dep-1.0.0.tgz");
      expect(oneDep.hashes[0].alg).toBe("SHA-512");
      // SHA-512 hex is 128 chars
      expect(oneDep.hashes[0].content).toMatch(/^[0-9a-f]{128}$/);

      // dev dep scope
      expect(byRef["a-dep@1.0.1"].scope).toBe("excluded");
      // transitive runtime dep
      expect(byRef["no-deps@1.0.1"].scope).toBe("required");

      // dependency graph
      const depsByRef = Object.fromEntries(bom.dependencies.map((d: any) => [d.ref, d.dependsOn]));
      expect(depsByRef["sbom-cdx@1.0.0"].sort()).toEqual(["a-dep@1.0.1", "one-dep@1.0.0"]);
      expect(depsByRef["one-dep@1.0.0"]).toEqual(["no-deps@1.0.1"]);
      expect(depsByRef["no-deps@1.0.1"]).toEqual([]);
      expect(depsByRef["a-dep@1.0.1"]).toEqual([]);

      // every bom-ref appearing in dependencies must be declared
      const declared = new Set<string>([
        bom.metadata.component["bom-ref"],
        ...bom.components.map((c: any) => c["bom-ref"]),
      ]);
      for (const d of bom.dependencies) {
        expect(declared.has(d.ref)).toBe(true);
        for (const r of d.dependsOn) expect(declared.has(r)).toBe(true);
      }
    });

    test("percent-encodes scope in purl", async () => {
      const dir = await setup("sbom-scoped", {
        dependencies: { "@types/no-deps": "1.0.0" },
      });

      const { stdout, exitCode } = await sbom(dir);
      expect(exitCode).toBe(0);

      const bom = JSON.parse(stdout);
      const scoped = bom.components.find((c: any) => c.name === "@types/no-deps");
      expect(scoped).toBeDefined();
      expect(scoped.purl).toBe("pkg:npm/%40types/no-deps@1.0.0");
    });
  });

  describe("SPDX", () => {
    test("produces a spec-valid document with packages and relationships", async () => {
      const dir = await setup("sbom-spdx", {
        dependencies: { "one-dep": "1.0.0" },
        devDependencies: { "a-dep": "1.0.1" },
      });

      const { stdout, stderr, exitCode } = await sbom(dir, ["--format", "spdx"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);

      const doc = JSON.parse(stdout);

      expect(doc.spdxVersion).toBe("SPDX-2.3");
      expect(doc.dataLicense).toBe("CC0-1.0");
      expect(doc.SPDXID).toBe("SPDXRef-DOCUMENT");
      expect(doc.name).toBe("sbom-spdx@1.0.0");
      expect(doc.documentNamespace).toMatch(
        /^https:\/\/spdx\.org\/spdxdocs\/sbom-spdx-1\.0\.0-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(doc.creationInfo.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(doc.creationInfo.creators[0]).toMatch(/^Tool: bun-/);
      expect(doc.documentDescribes).toEqual(["SPDXRef-Package-sbom-spdx-1.0.0"]);

      // packages
      const byId = Object.fromEntries(doc.packages.map((p: any) => [p.SPDXID, p]));
      expect(Object.keys(byId).sort()).toEqual([
        "SPDXRef-Package-a-dep-1.0.1",
        "SPDXRef-Package-no-deps-1.0.1",
        "SPDXRef-Package-one-dep-1.0.0",
        "SPDXRef-Package-sbom-spdx-1.0.0",
      ]);

      const root = byId["SPDXRef-Package-sbom-spdx-1.0.0"];
      expect(root).toMatchObject({
        name: "sbom-spdx",
        versionInfo: "1.0.0",
        downloadLocation: "NOASSERTION",
        filesAnalyzed: false,
        primaryPackagePurpose: "APPLICATION",
      });

      const oneDep = byId["SPDXRef-Package-one-dep-1.0.0"];
      expect(oneDep.name).toBe("one-dep");
      expect(oneDep.versionInfo).toBe("1.0.0");
      expect(oneDep.downloadLocation).toContain("/one-dep/-/one-dep-1.0.0.tgz");
      expect(oneDep.externalRefs).toEqual([
        { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:npm/one-dep@1.0.0" },
      ]);
      expect(oneDep.checksums[0].algorithm).toBe("SHA512");
      expect(oneDep.checksums[0].checksumValue).toMatch(/^[0-9a-f]{128}$/);

      // relationships
      const rels = doc.relationships;
      expect(rels).toContainEqual({
        spdxElementId: "SPDXRef-DOCUMENT",
        relatedSpdxElement: "SPDXRef-Package-sbom-spdx-1.0.0",
        relationshipType: "DESCRIBES",
      });
      expect(rels).toContainEqual({
        spdxElementId: "SPDXRef-Package-sbom-spdx-1.0.0",
        relatedSpdxElement: "SPDXRef-Package-one-dep-1.0.0",
        relationshipType: "DEPENDS_ON",
      });
      expect(rels).toContainEqual({
        spdxElementId: "SPDXRef-Package-one-dep-1.0.0",
        relatedSpdxElement: "SPDXRef-Package-no-deps-1.0.1",
        relationshipType: "DEPENDS_ON",
      });
      // dev dep uses DEV_DEPENDENCY_OF (edge direction: dep OF dependent)
      expect(rels).toContainEqual({
        spdxElementId: "SPDXRef-Package-a-dep-1.0.1",
        relatedSpdxElement: "SPDXRef-Package-sbom-spdx-1.0.0",
        relationshipType: "DEV_DEPENDENCY_OF",
      });

      // every SPDXID referenced in a relationship must be declared
      const declared = new Set<string>([doc.SPDXID, ...doc.packages.map((p: any) => p.SPDXID)]);
      for (const r of rels) {
        expect(declared.has(r.spdxElementId)).toBe(true);
        expect(declared.has(r.relatedSpdxElement)).toBe(true);
      }

      // all SPDXIDs match the required pattern
      for (const p of doc.packages) {
        expect(p.SPDXID).toMatch(/^SPDXRef-[A-Za-z0-9.\-]+$/);
      }
    });
  });

  test("writes to a file with -o", async () => {
    const dir = await setup("sbom-outfile", { dependencies: { "no-deps": "1.0.0" } });
    const outfile = join(dir, "sbom.cdx.json");

    const { stdout, exitCode } = await sbom(dir, ["-o", outfile]);
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
    expect(existsSync(outfile)).toBe(true);

    const bom = JSON.parse(readFileSync(outfile, "utf8"));
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.components.map((c: any) => c.name)).toEqual(["no-deps"]);
  });

  test("workspaces are included as components", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "sbom-ws-root",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
    );
    await write(
      join(packageDir, "packages", "pkg-a", "package.json"),
      JSON.stringify({
        name: "pkg-a",
        version: "2.0.0",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );
    await runBunInstall(bunEnv, packageDir);

    const { stdout, exitCode } = await sbom(packageDir);
    expect(exitCode).toBe(0);
    const bom = JSON.parse(stdout);

    const pkgA = bom.components.find((c: any) => c.name === "pkg-a");
    expect(pkgA).toBeDefined();
    expect(pkgA.version).toBe("2.0.0");
    expect(pkgA["bom-ref"]).toContain("workspace:");
    expect(pkgA.purl).toBe("pkg:npm/pkg-a@2.0.0");

    const depsByRef = Object.fromEntries(bom.dependencies.map((d: any) => [d.ref, d.dependsOn]));
    expect(depsByRef[bom.metadata.component["bom-ref"]]).toContain(pkgA["bom-ref"]);
    expect(depsByRef[pkgA["bom-ref"]]).toEqual(["no-deps@1.0.0"]);
  });

  test("rejects unknown --format", async () => {
    const dir = await setup("sbom-badfmt", { dependencies: { "no-deps": "1.0.0" } });

    const { stderr, exitCode } = await sbom(dir, ["--format", "toml"]);
    expect(stderr).toContain("invalid --format value");
    expect(stderr).toContain("cyclonedx");
    expect(stderr).toContain("spdx");
    expect(exitCode).toBe(1);
  });

  test("errors when lockfile is missing", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(packageJson, JSON.stringify({ name: "sbom-nolock", version: "1.0.0" }));

    const { stderr, exitCode } = await sbom(packageDir);
    expect(stderr).toContain("Lockfile not found");
    expect(exitCode).toBe(1);
  });

  test("--format=spdx syntax works", async () => {
    const dir = await setup("sbom-eqfmt", { dependencies: { "no-deps": "1.0.0" } });

    const { stdout, exitCode } = await sbom(dir, ["--format=spdx"]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).spdxVersion).toBe("SPDX-2.3");
  });

  test("prints in `bun pm` help", async () => {
    await using proc = spawn({
      cmd: [bunExe(), "pm"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toContain("bun pm sbom");
  });
});
