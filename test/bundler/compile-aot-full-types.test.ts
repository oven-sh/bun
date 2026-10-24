import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const home = join(import.meta.dir, "..", "..", "packages", "full-types");
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
  "koa": {
    licence: "MIT",
    holder: /Copyright \(c\) 2019 Koa contributors/,
    says: /Permission is hereby granted, free of charge/,
  },
  "@koa/router": {
    licence: "MIT",
    holder: /Copyright \(c\) 2015 @koajs maintainers and contributors/,
    says: /Permission is hereby granted, free of charge/,
  },
  "delegates": {
    licence: "MIT",
    holder: /Copyright \(c\) 2015 TJ Holowaychuk/,
    says: /Permission is hereby granted, free of charge/,
  },
  "on-finished": {
    licence: "MIT",
    holder: /Copyright \(c\) 2013 Jonathan Ong/,
    says: /Permission is hereby granted, free of charge/,
  },
  "ee-first": {
    licence: "MIT",
    holder: /Copyright \(c\) 2014 Jonathan Ong/,
    says: /Permission is hereby granted, free of charge/,
  },
  "parseurl": {
    licence: "MIT",
    holder: /Copyright \(c\) 2014 Jonathan Ong/,
    says: /Permission is hereby granted, free of charge/,
  },
  "express": {
    licence: "MIT",
    holder: /Copyright \(c\) 2009-2014 TJ Holowaychuk/,
    says: /Permission is hereby granted, free of charge/,
  },
  "router": {
    licence: "MIT",
    holder: /Copyright \(c\) 2013 Roman Shtylman/,
    says: /Permission is hereby granted, free of charge/,
  },
  "finalhandler": {
    licence: "MIT",
    holder: /Copyright \(c\) 2014-2022 Douglas Christopher Wilson/,
    says: /Permission is hereby granted, free of charge/,
  },
  "body-parser": {
    licence: "MIT",
    holder: /Copyright \(c\) 2014 Jonathan Ong/,
    says: /Permission is hereby granted, free of charge/,
  },
  "fastify": {
    licence: "MIT",
    holder: /Copyright \(c\) 2016-2025 The Fastify Team/,
    says: /Permission is hereby granted, free of charge/,
  },
};

const folders = typedVersions();

test("there are full types", () => {
  expect(folders.length).toBeGreaterThan(10);
  expect(folders.map(folder => relative(home, folder).replaceAll("\\", "/"))).toContain("react/19.3.1");
  expect(folders.map(folder => relative(home, folder).replaceAll("\\", "/"))).toContain("react-dom/19.3.1");
});

test("react's compiler-runtime is typed at the installed file's own path", () => {
  const versions = folders.filter(folder => json(join(folder, "sound.json")).name === "react");
  expect(versions.length).toBeGreaterThan(10);
  for (const folder of versions) {
    const manifest = json(join(folder, "sound.json"));
    expect(manifest.sound).toBe(2);
    expect(manifest.lay).toHaveProperty(["cjs/react-compiler-runtime.production.js"]);
    expect(Object.keys(manifest.lay)).not.toContain("compiler-runtime.js");
    expect(readFileSync(join(folder, "lay", "cjs", "react-compiler-runtime.production.js"), "utf8")).toContain(
      "exports.c = function (size: number): any[] {",
    );
  }
});

test("react-dom's server bundles are typed at the installed files' own paths", () => {
  const versions = folders.filter(folder => json(join(folder, "sound.json")).name === "react-dom");
  expect(versions.length).toBeGreaterThanOrEqual(2);
  for (const folder of versions) {
    const manifest = json(join(folder, "sound.json"));
    expect(manifest.sound).toBe(2);
    expect(manifest.when).toEqual({});
    expect(Object.keys(manifest.lay)).toEqual([
      "cjs/react-dom-server-legacy.browser.production.js",
      "cjs/react-dom-server.bun.production.js",
    ]);
    for (const [path, bytes] of Object.entries(layOf(folder, "react-dom", manifest.version))) {
      const text = bytes.toString();
      expect([path, /^exports\.renderToString = function \(/m.test(text)]).toEqual([path, path.includes("legacy")]);
      expect([path, /^exports\.version = "/m.test(text)]).toEqual([path, true]);
      expect([path, /^(import|export) /m.test(text)]).toEqual([path, false]);
      expect([path, /^(declare )?namespace FZ \{$/m.test(text)]).toEqual([path, true]);
    }
  }
});

test("an int32 of a typed text is Bun's", () => {
  const texts = folders.flatMap(folder => {
    const { name, version } = json(join(folder, "sound.json"));
    return Object.entries(layOf(folder, name, version)).map(([path, bytes]) => [
      `${name}/${version}/${path}`,
      bytes.toString(),
    ]);
  });
  const declaring = texts.filter(([, text]) => /\btype int32 = /.test(text));
  expect(declaring.length).toBeGreaterThanOrEqual(6);
  for (const [path, text] of declaring)
    expect([path, /\btype int32 = (.*);/.exec(text)![1]]).toEqual([path, 'import("bun").int32']);
});

test.each(["19.3.0", "19.3.1"])("react-dom %s constructs a request without a cast through unknown", version => {
  const lay = join(home, "react-dom", version, "lay");
  const texts = filesUnder(lay);
  expect(texts.length).toBe(2);
  for (const path of texts) {
    const text = readFileSync(join(lay, path), "utf8");
    expect(text).toContain("new (RequestInstance as FZ.RequestConstructor)(");
    expect(text).not.toContain(" as unknown as ");
  }
});

test.skipIf(!existsSync(join(home, "..", "..", ".gitattributes")))(
  "neither git nor the formatter changes a byte of them",
  () => {
    const lines = (file: string) => readFileSync(join(home, "..", "..", file), "utf8").split(/\r?\n/);
    expect(lines(".gitattributes")).toContain("packages/full-types/** -text");
    expect(lines(".prettierignore")).toContain("packages/full-types");
  },
);

test("what seroval exports does not name the type of its nodes in a result", () => {
  const text = readFileSync(join(home, "seroval", "1.6.9", "lay", "dist", "index.js"), "utf8");
  const exported = /^export \{ (.*) \};$/m.exec(text)![1].split(", ");
  expect(exported).toContain("toCrossJSONAsync");
  for (const name of exported) {
    const head = new RegExp(`^(?:async )?function ${name.replace("$", "\\$")}\\(.*\\): (.*) \\{$`, "m").exec(text);
    if (head)
      expect({ name, result: head[1] }).toEqual({
        name,
        result: expect.not.stringMatching(/SerovalNode|SerovalJSON|ObjectRecord|MapRecord/),
      });
  }
});

test("no typed text freezes a value of which its type says nothing", () => {
  const text = readFileSync(join(home, "seroval", "1.6.9", "lay", "dist", "index.js"), "utf8");
  expect(text).toContain("function applyObjectFlag(obj: any[] | SV.MadeObject, flag: SV.Given): SV.Deserialized {");
  expect(text).toMatch(/^declare namespace SV \{$/m);
  expect(text).toContain("\n  interface MadeObject { [key: string]: any }\n");
});

describe.each(folders.map(folder => [relative(home, folder).replaceAll("\\", "/"), folder]))("%s", (where, folder) => {
  const manifest = json(join(folder, "sound.json"));
  const { name, version } = manifest;

  test("the manifest has the expected format", () => {
    const required = Object.keys(manifest).filter(key => key !== "compilerOptions");
    expect(required.sort()).toEqual(["basis", "lay", "name", "needs", "sound", "version", "when"]);
    expect([1, 2]).toContain(manifest.sound);
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
    expect(companion.name).toBe("@oven/sound-" + name.replace(/^@/, "").replaceAll("/", "__"));
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

  test('of the module "bun" a laid text names only the type that the compiler declares itself', () => {
    for (const [path, bytes] of Object.entries(layOf(folder, name, version)))
      expect([path, /import\("bun"\)(?!\.int32;)|from "bun"/.test(bytes.toString())]).toEqual([path, false]);
  });

  test("a full-types file does not hide a declaration file's place", () => {
    for (const path of Object.keys(manifest.lay)) expect(path).not.toMatch(/\.d\.[cm]?ts$/);
  });

  test("the license and the notice are present", () => {
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
      if (manifest.sound === 1 && manifest.lay[path] !== "new") continue;
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
