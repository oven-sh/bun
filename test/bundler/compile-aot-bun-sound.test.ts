import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const home = join(import.meta.dir, "..", "..", "packages", "bun-sound");
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const isSum = (text: unknown) => typeof text === "string" && /^[0-9a-f]{64}$/.test(text);
const isInside = (path: string) =>
  !path.startsWith("/") &&
  !path.includes("\\") &&
  path.split("/").every(part => part !== "" && part !== "." && part !== "..");

function filesUnder(folder: string, from = folder): string[] {
  return readdirSync(folder).flatMap(name => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesUnder(path, from) : [relative(from, path).replaceAll("\\", "/")];
  });
}
function typedVersions(folder = home, depth = 0): string[] {
  if (existsSync(join(folder, "sound.json"))) return [folder];
  if (depth === 3) return [];
  return readdirSync(folder)
    .filter(name => !["tools", "trees", "recipe"].includes(name) && statSync(join(folder, name)).isDirectory())
    .flatMap(name => typedVersions(join(folder, name), depth + 1));
}
function sumsOf(folder: string) {
  const lines = readFileSync(join(folder, "lay.sums"), "utf8").split("\n").filter(Boolean);
  return Object.fromEntries(lines.map(line => [line.slice(66), line.slice(0, 64)]));
}
function layOf(folder: string, name: string, version: string): Record<string, Buffer> {
  if (existsSync(join(folder, "lay")))
    return Object.fromEntries(
      filesUnder(join(folder, "lay")).map(path => [path, readFileSync(join(folder, "lay", path))]),
    );
  const kept: string = json(join(folder, "family.json")).of;
  const from = join(home, name, kept, "lay");
  return Object.fromEntries(
    filesUnder(from).map(path => [
      path,
      Buffer.from(
        readFileSync(join(from, path), "utf8")
          .replaceAll(`"${kept}"`, `"${version}"`)
          .replaceAll(`${name}:  ${kept}`, `${name}:  ${version}`),
      ),
    ]),
  );
}

const licences: Record<string, { licence: string; holder: RegExp; says: RegExp }> = {
  "react": {
    licence: "MIT",
    holder: /Copyright \(c\) Meta Platforms, Inc\. and affiliates\./,
    says: /Permission is hereby granted, free of charge/,
  },
  "react-dom": {
    licence: "MIT",
    holder: /Copyright \(c\) Meta Platforms, Inc\. and affiliates\./,
    says: /Permission is hereby granted, free of charge/,
  },
  "react-reconciler": {
    licence: "MIT",
    holder: /Copyright \(c\) Meta Platforms, Inc\. and affiliates\./,
    says: /Permission is hereby granted, free of charge/,
  },
  "seroval": {
    licence: "MIT",
    holder: /Copyright \(c\) 2025 Alexis Munsayac/,
    says: /Permission is hereby granted, free of charge/,
  },
  "@anthropic-ai/sdk": {
    licence: "MIT",
    holder: /Copyright 2023 Anthropic, PBC\./,
    says: /Permission is hereby granted, free of charge/,
  },
  "fuse.js": {
    licence: "Apache-2.0",
    holder: /Copyright \(c\) 2023 Kiro Risk/,
    says: /Apache License\s+Version 2\.0, January 2004/,
  },
};

const folders = typedVersions();

test("there are typed versions", () => {
  expect(folders.length).toBeGreaterThan(10);
});

test.skipIf(!existsSync(join(home, "..", "..", ".gitattributes")))(
  "neither git nor the formatter changes a byte of them",
  () => {
    const lines = (file: string) => readFileSync(join(home, "..", "..", file), "utf8").split(/\r?\n/);
    expect(lines(".gitattributes")).toContain("packages/bun-sound/** -text");
    expect(lines(".prettierignore")).toContain("packages/bun-sound");
  },
);

describe.each(folders.map(folder => [relative(home, folder).replaceAll("\\", "/"), folder]))("%s", (where, folder) => {
  const manifest = json(join(folder, "sound.json"));
  const { name, version } = manifest;

  test("the manifest is of the format", () => {
    expect(Object.keys(manifest).sort()).toEqual(["basis", "lay", "name", "needs", "sound", "version", "when"]);
    expect(manifest.sound).toBe(1);
    expect(`${name}/${version}`).toBe(where);
    expect(manifest.needs).toBeArray();
    expect(Object.keys(manifest.lay)).not.toBeEmpty();
    for (const [path, sum] of Object.entries(manifest.basis))
      expect([path, isInside(path) && isSum(sum)]).toEqual([path, true]);
    for (const [path, sum] of Object.entries(manifest.lay))
      expect([path, isInside(path) && (sum === "new" || isSum(sum))]).toEqual([path, true]);
    for (const value of Object.values(manifest.when)) expect(value).toBeString();
    expect(Object.keys(manifest.lay).filter(path => path in manifest.basis)).toEqual([]);
    expect(Object.keys(manifest.lay)).not.toContain("package.json");
  });

  test("package.json is the companion's", () => {
    const companion = json(join(folder, "package.json"));
    expect(licences).toHaveProperty([name]);
    expect(companion.name).toBe("@sound/" + name.replace(/^@/, "").replaceAll("/", "__"));
    expect(companion.version).toBe(version);
    expect(companion.peerDependencies).toEqual({ [name]: version });
    expect(companion.files).toEqual(["sound.json", "lay", "LICENSE", "NOTICE"]);
    expect(companion.license).toBe(licences[name]?.licence);
    expect(Object.keys(companion).sort()).toEqual([
      "description",
      "files",
      "license",
      "name",
      "peerDependencies",
      "version",
    ]);
  });

  test("lay/ is what lay.sums pins and what the manifest names", () => {
    const sums = sumsOf(folder);
    const lay = layOf(folder, name, version);
    expect(Object.keys(sums).sort()).toEqual(Object.keys(manifest.lay).sort());
    expect(Object.keys(lay).sort()).toEqual(Object.keys(sums).sort());
    expect(Object.fromEntries(Object.entries(lay).map(([path, bytes]) => [path, sha256(bytes)]))).toEqual(sums);
  });

  test("a typed file does not hide a declaration file's place", () => {
    for (const path of Object.keys(manifest.lay)) expect(path).not.toMatch(/\.d\.[cm]?ts$/);
  });

  test("the licence and the notice are there", () => {
    expect(licences).toHaveProperty([name]);
    const { holder, says, licence } = licences[name];
    const text = readFileSync(join(folder, "LICENSE"), "utf8");
    const notice = readFileSync(join(folder, "NOTICE"), "utf8");
    expect(text).toMatch(says);
    expect(notice).toMatch(holder);
    expect(notice).toContain(`${name} ${version}`);
    expect(notice).toContain(`Licensed under ${licence}`);
    for (const path of Object.keys(manifest.lay)) expect(notice).toContain(`lay/${path}\n`);
    if (licence === "MIT") expect(text).toMatch(holder);
    if (licence !== "Apache-2.0") return;
    for (const [path, bytes] of Object.entries(layOf(folder, name, version))) {
      if (manifest.lay[path] !== "new") continue;
      expect(bytes.toString().split("\n")[0]).toMatch(/^\/\/ CHANGED: /);
      expect(bytes.toString()).toMatch(holder);
    }
  });

  test("nothing that is published names a machine", () => {
    const machine = /\/Users\/|\/home\/|\/private\/|\/tmp\//;
    for (const file of ["sound.json", "package.json", "NOTICE"])
      expect(readFileSync(join(folder, file), "utf8")).not.toMatch(machine);
    for (const [path, bytes] of Object.entries(layOf(folder, name, version)))
      expect([path, machine.test(bytes.toString())]).toEqual([path, false]);
  });
});
