// The generator of CI's machine images (scripts/build/ci-images). What these
// can show is that every image of the spec generates and that a name is a
// function of the generated files. Whether a bake works is only shown by a bake.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateImage,
  hashFiles,
  imageKey,
  images,
  macosMachines,
  tools,
} from "../../../scripts/build/ci-images/spec.ts";

test("every image of the spec generates, with its tools in the spec's order", () => {
  using dir = tempDir("ci-images", {});
  const names = new Set<string>();
  for (const image of [...images, ...macosMachines]) {
    const { key, name, directory } = generateImage(image, String(dir));
    expect(key).toBe(imageKey(image));
    expect(name).toMatch(new RegExp(`^${key}-[0-9a-f]{16}$`));
    names.add(name);

    const bootstrap = readFileSync(join(directory, image.os === "windows" ? "bootstrap.ps1" : "bootstrap.sh"), "utf8");
    const banners = [...bootstrap.matchAll(/^# ---- (\S+)$/gm)].map(match => match[1]);
    expect(banners).toEqual(tools(image).map(tool => tool.name));

    const described = JSON.parse(readFileSync(join(directory, "image.json"), "utf8"));
    expect(described.base).toEqual("base" in image ? image.base : undefined);
  }
  // A key is also the image's directory, so two images cannot share one.
  expect(names.size).toBe(images.length + macosMachines.length);
  expect(new Set([...names].map(name => name.slice(0, -17))).size).toBe(names.size);
});

test("an image's name is the hash of its bake directory", () => {
  using dir = tempDir("ci-images", {});
  const image = images[0]!;
  const first = generateImage(image, String(dir));
  expect(generateImage(image, String(dir)).name).toBe(first.name);
  // The name is the hash of exactly what is in the directory CI uploads and a bake downloads.
  const written = new Map(
    readdirSync(first.directory).map(name => [name, readFileSync(join(first.directory, name))] as const),
  );
  expect(first.name).toBe(`${first.key}-${hashFiles(written).slice(0, 16)}`);

  // Any byte of any file is part of the name.
  const [name, content] = [...written][0]!;
  written.set(name, Buffer.concat([content, Buffer.from("\n")]));
  expect(hashFiles(written).slice(0, 16)).not.toBe(first.name.slice(-16));
});

// The image's record is written by the generated script itself, in both
// shells. These are the exact lines, so that a change to how a step renders
// (appending, prefixing, a list of lines in PowerShell) shows up here and not
// an hour into a bake.
function recordSection(bootstrap: string): string[] {
  const lines = bootstrap.split("\n");
  const start = lines.indexOf("# ---- record-image");
  const end = lines.findIndex((line, index) => index > start && line.startsWith("# ---- "));
  return lines.slice(start, end < 0 ? undefined : end).filter(line => line !== "");
}

function recordedTools(image: (typeof images)[number]): string[] {
  return tools(image).map(({ name, identity }) => {
    const value =
      identity.kind === "pinned" ? ` ${identity.value}` : identity.kind === "notRecorded" ? ` ${identity.reason}` : "";
    return `tool ${name}: ${identity.kind}${value}`;
  });
}

test("the record a Linux bake writes", () => {
  using dir = tempDir("ci-images", {});
  const image = images.find(image => image.os === "linux" && image.role === "build")!;
  const bootstrap = readFileSync(join(generateImage(image, String(dir)).directory, "bootstrap.sh"), "utf8");
  const observed = tools(image).filter(tool => tool.identity.kind === "observed");
  expect(observed.map(tool => tool.name)).toEqual(["glibc-sysroot", "musl-sysroot"]);
  expect(recordSection(bootstrap)).toEqual([
    "# ---- record-image",
    "scratch=$(mktemp -d -p /var/tmp)",
    `printf '%s\\n' "name: $IMAGE_NAME" > /etc/bun-image.txt`,
    "cat >> /etc/bun-image.txt <<'EOF'",
    `image: ${JSON.stringify(image)}`,
    ...recordedTools(image),
    "EOF",
    ...observed.flatMap(({ name }) => [
      `[ -n "$(cat "$BAKE_DIR/observed/${name}")" ] || { echo 'bootstrap: nothing was observed for ${name}' >&2; exit 1; }`,
      `cat "$BAKE_DIR/observed/${name}" | sed 's/^/observed ${name}: /' >> /etc/bun-image.txt`,
    ]),
    // The query is a statement of its own: sh has no pipefail.
    `dpkg-query --show --showformat '\${binary:Package} \${Version}\\n' > "$scratch/packages"`,
    `[ -n "$(cat "$scratch/packages")" ] || { echo 'bootstrap: the package manager listed no packages' >&2; exit 1; }`,
    `cat "$scratch/packages" | LC_ALL=C sort | sed 's/^/package /' >> /etc/bun-image.txt`,
    'rm -rf "$scratch"',
  ]);
});

test("the record a Windows bake writes", () => {
  using dir = tempDir("ci-images", {});
  const image = images.find(image => image.os === "windows" && image.arch === "aarch64")!;
  const bootstrap = readFileSync(join(generateImage(image, String(dir)).directory, "bootstrap.ps1"), "utf8");
  const literal = (line: string) => `'${line.replace(/'/g, "''")}'`;
  const written = [`image: ${JSON.stringify(image)}`, ...recordedTools(image)];
  expect(recordSection(bootstrap)).toEqual([
    "# ---- record-image",
    "$scratch = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName())",
    "New-Item -ItemType Directory -Force $scratch | Out-Null",
    `"name: $IMAGE_NAME" | Out-File -Encoding ascii 'C:\\bun-image.txt'`,
    `Add-Content -Path 'C:\\bun-image.txt' -Encoding ascii -Value @(`,
    ...written.map((line, index) => `  ${literal(line)}${index < written.length - 1 ? "," : ""}`),
    ")",
    `if (-not (Get-Content "$BAKE_DIR\\observed\\visual-studio")) { throw 'bootstrap: nothing was observed for visual-studio' }`,
    `Get-Content "$BAKE_DIR\\observed\\visual-studio" | ForEach-Object { "observed visual-studio: $_" } | Out-File -Append -Encoding ascii 'C:\\bun-image.txt'`,
    `(scoop export | Out-String | ConvertFrom-Json).apps | ForEach-Object { "$($_.Name) $($_.Version)" } | Out-File -Encoding ascii "$scratch\\packages"`,
    `if (-not (Get-Content "$scratch\\packages")) { throw 'bootstrap: the package manager listed no packages' }`,
    `Get-Content "$scratch\\packages" | Sort-Object | ForEach-Object { "package $_" } | Out-File -Append -Encoding ascii 'C:\\bun-image.txt'`,
    "Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue",
  ]);
});
