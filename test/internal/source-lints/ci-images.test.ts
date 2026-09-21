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
  pins,
  recordedTool,
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
function recordSection(image: (typeof images)[number], root: string): string[] {
  const script = join(generateImage(image, root).directory, image.os === "windows" ? "bootstrap.ps1" : "bootstrap.sh");
  const lines = readFileSync(script, "utf8").split("\n");
  const start = lines.indexOf("# ---- record-image");
  const end = lines.findIndex((line, index) => index > start && line.startsWith("# ---- "));
  return lines.slice(start, end < 0 ? undefined : end).filter(line => line !== "");
}

test("a tool's line of the record, for each kind of identity", () => {
  const image = images.find(image => image.os === "linux" && image.role === "build")!;
  const lines = tools(image).map(recordedTool);
  expect(lines).toContain(`tool nodejs: pinned ${pins.nodejs.version}`);
  expect(lines).toContain("tool llvm: packageDatabase");
  expect(lines).toContain("tool glibc-sysroot: observed");
  expect(lines).toContain("tool record-image: configuration");
  expect(lines).toContain("tool prefetch: notRecorded decided by the commit being built, not by this file");
});

test("the record a Debian bake writes", () => {
  using dir = tempDir("ci-images", {});
  const image = images.find(image => image.os === "linux" && image.role === "build")!;
  expect(recordSection(image, String(dir))).toEqual([
    "# ---- record-image",
    "scratch=$(mktemp -d -p /var/tmp)",
    `printf '%s\\n' "name: $IMAGE_NAME" > /etc/bun-image.txt`,
    "cat >> /etc/bun-image.txt <<'EOF'",
    `image: ${JSON.stringify(image)}`,
    ...tools(image).map(recordedTool),
    "EOF",
    `[ -n "$(cat "$BAKE_DIR/observed/glibc-sysroot")" ] || { echo 'bootstrap: nothing was observed for glibc-sysroot' >&2; exit 1; }`,
    `cat "$BAKE_DIR/observed/glibc-sysroot" | sed 's/^/observed glibc-sysroot: /' >> /etc/bun-image.txt`,
    `[ -n "$(cat "$BAKE_DIR/observed/musl-sysroot")" ] || { echo 'bootstrap: nothing was observed for musl-sysroot' >&2; exit 1; }`,
    `cat "$BAKE_DIR/observed/musl-sysroot" | sed 's/^/observed musl-sysroot: /' >> /etc/bun-image.txt`,
    // The query is a statement of its own: sh has no pipefail.
    `dpkg-query --show --showformat '\${binary:Package} \${Version}\\n' > "$scratch/packages"`,
    `[ -n "$(cat "$scratch/packages")" ] || { echo 'bootstrap: the package manager listed no packages' >&2; exit 1; }`,
    `cat "$scratch/packages" | LC_ALL=C sort | sed 's/^/package /' >> /etc/bun-image.txt`,
    'rm -rf "$scratch"',
  ]);
});

// An observed tool's value goes into the record, so what it observes has to be
// the same for every bake of the same content. apk writes the time of the
// install into a log inside the root it installs into.
test("the musl sysroot is observed without apk's log", () => {
  using dir = tempDir("ci-images", {});
  const image = images.find(image => image.os === "linux" && image.role === "build")!;
  const bootstrap = readFileSync(join(generateImage(image, String(dir)).directory, "bootstrap.sh"), "utf8");
  const section = bootstrap.slice(
    bootstrap.indexOf("# ---- musl-sysroot"),
    bootstrap.indexOf("# ---- windows-sysroot"),
  );
  const removed = ["/opt/linux-sysroot-musl", "/opt/linux-sysroot-musl-arm64"].map(
    root => `rm -rf ${root}/var/log/apk.log`,
  );
  const lines = section.split("\n");
  for (const line of removed) expect(lines).toContain(line);
  // Removed before it is observed.
  expect(lines.indexOf(removed[1]!)).toBeLessThan(
    lines.findIndex(line => line.includes("$BAKE_DIR/observed/musl-sysroot")),
  );
});

test("the packages an Alpine bake records", () => {
  using dir = tempDir("ci-images", {});
  const image = images.find(image => image.os === "linux" && image.distro === "alpine")!;
  expect(recordSection(image, String(dir)).filter(line => line.includes("$scratch/"))).toEqual([
    `apk list --installed > "$scratch/apk-list"`,
    `cut -d ' ' -f1 "$scratch/apk-list" > "$scratch/packages"`,
    `[ -n "$(cat "$scratch/packages")" ] || { echo 'bootstrap: the package manager listed no packages' >&2; exit 1; }`,
    `cat "$scratch/packages" | LC_ALL=C sort | sed 's/^/package /' >> /etc/bun-image.txt`,
  ]);
});

test("the record a Windows bake writes", () => {
  using dir = tempDir("ci-images", {});
  const image = images.find(image => image.os === "windows" && image.arch === "aarch64")!;
  const written = [`image: ${JSON.stringify(image)}`, ...tools(image).map(recordedTool)];
  expect(recordSection(image, String(dir))).toEqual([
    "# ---- record-image",
    "$scratch = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName())",
    "New-Item -ItemType Directory -Force $scratch | Out-Null",
    `"name: $IMAGE_NAME" | Out-File -Encoding ascii 'C:\\bun-image.txt'`,
    `Add-Content -Path 'C:\\bun-image.txt' -Encoding ascii -Value @(`,
    ...written.map((line, index) => `  '${line}'${index < written.length - 1 ? "," : ""}`),
    ")",
    `if (-not (Get-Content "$BAKE_DIR\\observed\\visual-studio")) { throw 'bootstrap: nothing was observed for visual-studio' }`,
    `Get-Content "$BAKE_DIR\\observed\\visual-studio" | ForEach-Object { "observed visual-studio: $_" } | Out-File -Append -Encoding ascii 'C:\\bun-image.txt'`,
    `scoop export | Out-String | ConvertFrom-Json | Select-Object -ExpandProperty apps | ForEach-Object { "$($_.Name) $($_.Version)" } | Out-File -Encoding ascii "$scratch\\packages"`,
    // Scoop's exit code: a query that failed must not leave a record without its packages.
    'if ($LASTEXITCODE -ne 0) { throw "bootstrap: scoop exited with code $LASTEXITCODE" }',
    `if (-not (Get-Content "$scratch\\packages")) { throw 'bootstrap: the package manager listed no packages' }`,
    `Get-Content "$scratch\\packages" | Sort-Object | ForEach-Object { "package $_" } | Out-File -Append -Encoding ascii 'C:\\bun-image.txt'`,
    "Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue",
  ]);
});
