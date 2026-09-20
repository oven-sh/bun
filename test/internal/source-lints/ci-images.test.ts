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
