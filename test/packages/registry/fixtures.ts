import { tempDir, type DirectoryTree } from "harness";
import { brotliDecompressSync } from "node:zlib";
import type { Packument, VersionDocument } from "./index.ts";

/** What bun and npm send to ask for the abbreviated packument. */
export const abbreviatedAccept = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

export type Manifest = { name: string; version: string } & Record<string, unknown>;

export async function pack(manifest: Manifest, files: Record<string, string> = {}): Promise<Buffer> {
  const entries: Record<string, string> = { "package/package.json": JSON.stringify(manifest) };
  for (const [path, content] of Object.entries(files)) entries[`package/${path}`] = content;
  return Buffer.from(await new Bun.Archive(entries, { compress: "gzip" }).bytes());
}

export const sha1 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha1").update(bytes).digest("hex");
export const sha512 = (bytes: Uint8Array) => `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
export const md5 = (bytes: Uint8Array | string) => new Bun.CryptoHasher("md5").update(bytes).digest("hex");

/** The version object as a registry stores it. The host of the tarball URL is stale on purpose. */
export function stored(manifest: Manifest, tarball: Uint8Array): VersionDocument {
  return {
    ...manifest,
    _id: `${manifest.name}@${manifest.version}`,
    dist: {
      integrity: sha512(tarball),
      shasum: sha1(tarball),
      tarball: `http://localhost:4873/${manifest.name}/-/${manifest.name}-${manifest.version}.tgz`,
    },
  };
}

export interface Fixture {
  manifests: Manifest[];
  tags?: Record<string, string>;
  /** `false` leaves `time` out of the packument, as a hand-written fixture does. */
  time?: false;
  /** Versions that are in the packument but whose tarball is not on disk. */
  withoutTarball?: string[];
  extra?: Record<string, unknown>;
}

/** A storage directory in the layout of verdaccio: `<name>/package.json` next to `<basename>-<version>.tgz`. */
export async function storage(fixtures: Fixture[]) {
  const tree: DirectoryTree = {};
  const tarballs = new Map<string, Buffer>();

  for (const { manifests, tags, time, withoutTarball = [], extra } of fixtures) {
    const name = manifests[0].name;
    const basename = name.slice(name.indexOf("/") + 1);
    const versions: Record<string, VersionDocument> = {};
    const times: Record<string, string> = {
      created: "2024-01-01T00:00:00.000Z",
      modified: "2024-03-02T10:20:30.400Z",
    };
    for (const [index, manifest] of manifests.entries()) {
      const tarball = await pack(manifest);
      versions[manifest.version] = stored(manifest, tarball);
      times[manifest.version] = `2024-01-0${index + 1}T00:00:00.000Z`;
      if (withoutTarball.includes(manifest.version)) continue;
      tree[`${name}/${basename}-${manifest.version}.tgz`] = tarball;
      tarballs.set(`${name}@${manifest.version}`, tarball);
    }
    const packument: Packument = {
      _id: name,
      name,
      "dist-tags": tags ?? { latest: manifests.at(-1)!.version },
      versions,
      ...(time === false ? {} : { time: times }),
      // What verdaccio adds to a stored document. The registry must not serve it.
      _attachments: {},
      _distfiles: {},
      _uplinks: {},
      _rev: "3-0123456789abcdef",
      ...extra,
    };
    tree[`${name}/package.json`] = JSON.stringify(packument, null, 2);
  }

  const directory = tempDir("registry-storage-", tree);
  return { directory, path: String(directory), tarballs };
}

export interface Reply {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: any;
  bytes: Uint8Array;
}

/** Sends one request and reads the answer whole. The body stays as the server encoded it. */
export async function request(url: string | URL, init: RequestInit = {}): Promise<Reply> {
  const response = await fetch(url, { ...init, decompress: false } as RequestInit);
  const bytes = await response.bytes();
  const headers = Object.fromEntries(response.headers);
  delete headers.date;
  const encoding = headers["content-encoding"];
  const plain =
    encoding === "gzip"
      ? Bun.gunzipSync(bytes)
      : encoding === "br"
        ? new Uint8Array(brotliDecompressSync(bytes))
        : bytes;
  const text = new TextDecoder().decode(plain);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, headers, text, json, bytes: plain };
}

export function publishBody(
  manifest: Manifest,
  tarball: Uint8Array,
  options: { tag?: string; access?: "public" | "restricted" | null; registry?: string } = {},
) {
  const { name, version } = manifest;
  const host = new URL(options.registry ?? "http://localhost:4873/").host;
  return {
    _id: name,
    name,
    "dist-tags": { [options.tag ?? "latest"]: version },
    versions: {
      [version]: {
        ...manifest,
        _id: `${name}@${version}`,
        _nodeVersion: "24.3.0",
        _npmVersion: "10.8.3",
        dist: {
          integrity: sha512(tarball),
          shasum: sha1(tarball),
          tarball: `http://${host}/${name}/-/${name}-${version}.tgz`,
        },
      },
    },
    access: options.access ?? null,
    _attachments: {
      [`${name}-${version}.tgz`]: {
        content_type: "application/octet-stream",
        data: Buffer.from(tarball).toString("base64"),
        length: tarball.byteLength,
      },
    },
  };
}

export const jsonHeaders = (token?: string): Record<string, string> => ({
  "content-type": "application/json",
  ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
});
