import { join } from "path";

type RegistryPackage = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  /** The other files of the tarball, by their path in the package. The default is an index.js that exports `name`. */
  files?: Record<string, string>;
};

/**
 * An npm registry in this process. It serves one version of each package, and `requests` has the
 * path of each request it got, in order.
 */
async function memoryRegistry(packages: RegistryPackage[]) {
  const served = new Map<
    string,
    { manifest: Omit<RegistryPackage, "files">; tarball: Uint8Array; tarballPath: string; integrity: string }
  >();
  for (const { files, ...manifest } of packages) {
    const { name, version } = manifest;
    const archive = {
      "package.json": JSON.stringify(manifest),
      ...(files ?? { "index.js": `module.exports = ${JSON.stringify(name)};` }),
    };
    const tarball = await new Bun.Archive(
      Object.fromEntries(Object.entries(archive).map(([path, content]) => [`package/${path}`, content])),
      { compress: "gzip" },
    ).bytes();
    served.set(name, {
      manifest,
      tarball,
      tarballPath: `/${name}/-/${name}-${version}.tgz`,
      integrity: "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64"),
    });
  }

  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { origin, pathname } = new URL(request.url);
      requests.push(pathname);
      for (const { manifest, tarball, tarballPath, integrity } of served.values()) {
        if (pathname === tarballPath) return new Response(tarball);
        if (pathname !== `/${manifest.name}`) continue;
        return Response.json({
          name: manifest.name,
          "dist-tags": { latest: manifest.version },
          versions: { [manifest.version]: { ...manifest, dist: { tarball: origin + tarballPath, integrity } } },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    /** The value of `registry` in bunfig.toml. */
    url: server.url.href,
    requests,
    integrity: (name: string) => served.get(name)!.integrity,
    tarballUrl: (name: string) => server.url.origin + served.get(name)!.tarballPath,
    [Symbol.dispose]: () => void server.stop(true),
  };
}

/** The `name@version` of each row of "packages" in the bun.lock of `cwd`. No bun.lock gives no rows. */
export async function lockedPackages(cwd: string): Promise<Record<string, string>> {
  const lockfile = Bun.file(join(cwd, "bun.lock"));
  if (!(await lockfile.exists())) return {};
  const { packages = {} } = Bun.JSONC.parse(await lockfile.text()) as { packages?: Record<string, [string]> };
  return Object.fromEntries(Object.entries(packages).map(([key, [id]]) => [key, id]));
}

/**
 * Makes the load of `lockb` fail after the loader read the dependency rows. The loader then reads
 * 8 zero bytes, which are in front of the first section with a tag.
 */
export function failAfterDependencyRows(lockb: Buffer): Buffer {
  const tags = ["wOrKsPaC", "tRuStEDd", "eMpTrUsT", "oVeRriDs", "pAtChEdD", "cAtAlOgS", "cNfGvRsN", "sCoPdOvR"];
  const sections = tags.map(tag => lockb.indexOf(tag)).filter(at => at >= 8);
  if (sections.length === 0) throw new Error("bun.lockb has no section with a tag");
  lockb[Math.min(...sections) - 8] = 1;
  return lockb;
}

// A name over 8 bytes is an offset into the string buffer of its lockfile. A shorter name is stored inline.
const aliasTargets = ["short", "some-other-package"];

/** One `npm:` alias for each target, under a name of its own: `{ "<kind>-of-short": "npm:short@1.0.0", ... }`. */
export const aliasRows = (kind: string): Record<string, string> =>
  Object.fromEntries(aliasTargets.map(target => [`${kind}-of-${target}`, `npm:${target}@1.0.0`]));

/** The names of `rows` as dependencies on the registry packages of those names. */
export const plainDependencies = (rows: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.keys(rows).map(name => [name, "^1.0.0"]));

/** What `lockedPackages` gives when each name of `rows` is the registry package of that name. */
export const ownPackages = (rows: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.keys(rows).map(name => [name, `${name}@1.0.0`]));

/** What `lockedPackages` gives when each name of `rows` is its alias target. */
export const aliasedPackages = (rows: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(rows).map(([name, alias]) => [name, alias.slice("npm:".length)]));

/** What `installedNames` gives when each name of `rows` is the registry package of that name. */
export const ownNames = (rows: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.keys(rows).map(name => [name, name]));

/** What `installedNames` gives when each name of `rows` is its alias target. */
export const targetNames = (rows: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(rows).map(([name, alias]) => [name, alias.slice("npm:".length, alias.lastIndexOf("@"))]),
  );

/** The `name` in the package.json of each of `names` in the node_modules of `cwd`. */
export async function installedNames(cwd: string, names: string[]): Promise<Record<string, string>> {
  const packageJson = (name: string) => Bun.file(join(cwd, "node_modules", name, "package.json")).json();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, (await packageJson(name)).name])));
}

/** `packages` as they are in bun.lock under the package at `parent`. */
export const nestedIn = (parent: string, packages: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(packages).map(([name, id]) => [`${parent}/${name}`, id]));

/** The rows of "packages" in a bun.lock that `lockedPackages` reads as `packages`. The rows have no dependencies. */
export const lockfileRows = (registry: { integrity(name: string): string }, packages: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(packages).map(([key, id]) => [
      key,
      [id, "", {}, registry.integrity(id.slice(0, id.lastIndexOf("@")))],
    ]),
  );

/** The paths of the manifests of `names`, as the registry records them, sorted. */
export const manifestsOf = (...names: string[]) => names.map(name => `/${name}`).sort();

/** A registry with the alias targets, a package for each name of `rows`, and `more`. */
export const aliasRegistry = (rows: Record<string, string>, more: RegistryPackage[] = []) =>
  memoryRegistry([...[...aliasTargets, ...Object.keys(rows)].map(name => ({ name, version: "1.0.0" })), ...more]);
