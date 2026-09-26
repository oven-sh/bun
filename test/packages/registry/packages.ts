import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Credentials, User } from "./auth.ts";
import { RegistryError, notFound, type Body } from "./http.ts";
import type { PackageName } from "./names.ts";
import { highestVersion, isValidTag, isValidVersion, parsePackageName, validateNewPackageName } from "./names.ts";
import { own, tarballFilename, type Human, type Packument, type VersionDocument } from "./packument.ts";

export type Access = "public" | "restricted";

/** Who can read a package: its packument, its versions, its dist-tags and its tarballs. */
export type ReadPolicy = "anyone" | "authenticated" | "maintainers" | string[];
/** Who can publish, unpublish, deprecate and tag. A write always needs a user. */
export type WritePolicy = "authenticated" | "maintainers" | string[];

export interface AccessRule {
  read?: ReadPolicy;
  write?: WritePolicy;
}

/**
 * Rules by name pattern, where `*` stands for any run of characters: `@scope/*`, `internal-*`, `*`. The first
 * pattern that matches decides. A package that no pattern matches follows the registry defaults: everyone reads a
 * public package, the maintainers read a restricted package, and the maintainers write. A package without
 * maintainers, which is each package that comes from the storage directory, accepts a write from every user.
 */
export type AccessRules = Record<string, AccessRule>;

export interface StoredPackage {
  name: PackageName;
  document: Packument;
  access: Access;
  /** Tarballs by file name. A file of the storage directory is read when a client asks for it. */
  tarballs: Map<string, Blob>;
  /** Versions that were unpublished. The registry never accepts them again. */
  unpublished: Set<string>;
  /** Stands in for `time.modified` when the stored document has none. */
  modified: Date;
  /** Rendered responses by form and base URL. Every change of the package empties it. */
  rendered: Map<string, Body>;
  tarballHashes: Map<string, string>;
}

export interface PublishResult {
  ok: true;
  id: string;
  rev: string;
}

const day = 24 * 60 * 60 * 1000;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split(/\*+/)
    .map(literal => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

function nextRevision(current: string | undefined, document: unknown): string {
  const sequence = Number.parseInt(current ?? "", 10);
  const hash = new Bun.CryptoHasher("md5").update(JSON.stringify(document)).digest("hex");
  return `${Number.isFinite(sequence) ? sequence + 1 : 1}-${hash}`;
}

const hoistedFields = [
  "description",
  "homepage",
  "keywords",
  "repository",
  "author",
  "bugs",
  "license",
  "contributors",
  "readmeFilename",
] as const;

/** The registry keeps the first 64K of a readme. */
const maximumReadmeLength = 64 * 1024;

const integrityAlgorithms = ["sha512", "sha384", "sha256", "sha1"] as const;

export class Packages {
  /** Packages in memory: the ones a client published, and the ones of the storage directory that were read. */
  readonly #loaded = new Map<string, Promise<StoredPackage | null>>();
  /** Names that were published and then removed, with the time. The registry blocks them for 24 hours. */
  readonly #removed = new Map<string, { at: number; versions: Set<string> }>();
  readonly #rules: [RegExp, AccessRule][];
  /** The last write of each package. A write waits for the one before it, so that two never see the same state. */
  readonly #writes = new Map<string, Promise<unknown>>();

  constructor(
    readonly storage: string | undefined,
    rules: AccessRules = {},
  ) {
    this.#rules = Object.entries(rules).map(([pattern, rule]) => [patternToRegExp(pattern), rule]);
  }

  async get(name: string): Promise<StoredPackage | null> {
    let loading = this.#loaded.get(name);
    if (loading === undefined) {
      const parsed = parsePackageName(name);
      if (parsed === null) return null;
      loading = this.#read(parsed);
      this.#loaded.set(name, loading);
    }
    return loading;
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== null;
  }

  /**
   * Removes a package and every trace of it, so that a test can publish the same name and version again. This is
   * not what `npm unpublish` does: see `unpublish`.
   */
  delete(name: string) {
    this.#loaded.set(name, Promise.resolve(null));
    this.#removed.delete(name);
  }

  /** Puts a package of the storage directory back to the state on disk. */
  reset(name?: string) {
    if (name === undefined) {
      this.#loaded.clear();
      this.#removed.clear();
    } else {
      this.#loaded.delete(name);
      this.#removed.delete(name);
    }
  }

  /** Every package name, sorted. */
  async names(): Promise<string[]> {
    const names = new Set<string>();
    if (this.storage !== undefined) {
      const hasPackument = (directory: string) => Bun.file(join(directory, "package.json")).exists();
      for (const entry of await readdir(this.storage, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = join(this.storage, entry.name);
        if (!entry.name.startsWith("@")) {
          if (await hasPackument(directory)) names.add(entry.name);
          continue;
        }
        for (const scoped of await readdir(directory, { withFileTypes: true })) {
          if (scoped.isDirectory() && (await hasPackument(join(directory, scoped.name)))) {
            names.add(`${entry.name}/${scoped.name}`);
          }
        }
      }
    }
    for (const name of this.#loaded.keys()) names.add(name);
    const present = await Promise.all([...names].map(async name => ((await this.get(name)) ? name : null)));
    return present.filter(name => name !== null).sort();
  }

  #exclusive<T>(name: string, write: () => Promise<T>): Promise<T> {
    const result = (this.#writes.get(name) ?? Promise.resolve()).then(write, write);
    this.#writes.set(
      name,
      result.catch(() => {}),
    );
    return result;
  }

  async #read(name: PackageName): Promise<StoredPackage | null> {
    if (this.storage === undefined) return null;
    // A name is a package of the storage only when a directory has exactly that name. A file system can ignore
    // the case of a name, drop a period at its end, or refuse some of its characters. The registry does not.
    let directory = this.storage;
    for (const part of name.name.split("/")) {
      if (!(await entries(directory)).includes(part)) return null;
      directory = join(directory, part);
    }
    const file = Bun.file(join(directory, "package.json"));
    if (!(await file.exists())) return null;
    let document: unknown;
    try {
      document = await file.json();
    } catch (error) {
      throw new Error(`${file.name} is not a packument: ${error}`);
    }
    if (!isObject(document) || !isObject(document.versions) || !isObject(document["dist-tags"])) {
      throw new Error(`${file.name} is not a packument: it needs "versions" and "dist-tags"`);
    }
    const stored: StoredPackage = {
      name,
      document: document as Packument,
      access: "public",
      tarballs: new Map(),
      unpublished: new Set(),
      modified: new Date(file.lastModified),
      rendered: new Map(),
      tarballHashes: new Map(),
    };
    for (const version of Object.values(stored.document.versions)) {
      const filename = tarballFilename(version, name.basename);
      // A file name comes from a stored URL. It must not leave the directory of the package.
      if (filename.includes("/") || filename.includes("\\") || filename.startsWith(".")) continue;
      stored.tarballs.set(filename, Bun.file(join(directory, filename)));
    }
    return stored;
  }

  #rule(name: string): AccessRule | undefined {
    for (const [pattern, rule] of this.#rules) {
      if (pattern.test(name)) return rule;
    }
  }

  canRead(stored: StoredPackage, credentials: Credentials): boolean {
    const policy = this.#rule(stored.name.name)?.read ?? (stored.access === "public" ? "anyone" : "maintainers");
    if (policy === "anyone") return true;
    if (credentials.kind !== "user") return false;
    if (policy === "authenticated") return true;
    if (policy === "maintainers") return isMaintainer(stored, credentials.user.name);
    return policy.includes(credentials.user.name);
  }

  canWrite(name: string, stored: StoredPackage | null, user: User): boolean {
    const policy = this.#rule(name)?.write ?? "maintainers";
    if (policy === "authenticated") return true;
    if (policy === "maintainers") {
      const maintainers = stored?.document.maintainers;
      return !maintainers || maintainers.length === 0 || isMaintainer(stored, user.name);
    }
    return policy.includes(user.name);
  }

  /**
   * The package for a read, or the 404 that the registry sends for a package that is not there. It sends the same
   * 404 for a package that the client is not allowed to see, so that the answer does not reveal the name.
   */
  async read(name: string, credentials: Credentials): Promise<StoredPackage> {
    const stored = await this.get(name);
    if (stored === null || !this.canRead(stored, credentials)) throw notFound();
    return stored;
  }

  async #forWrite(name: PackageName, user: User): Promise<StoredPackage> {
    const stored = await this.get(name.name);
    if (stored === null || !this.canRead(stored, { kind: "user", user, via: "bearer", token: null })) throw notFound();
    if (!this.canWrite(name.name, stored, user)) throw forbidden(name.name);
    return stored;
  }

  #commit(stored: StoredPackage, now: Date): PublishResult {
    const document = stored.document;
    document.time = { ...document.time, modified: now.toISOString() };
    document.time.created ??= document.time.modified;
    stored.modified = now;
    document._id = stored.name.name;
    document._rev = nextRevision(document._rev, document);
    stored.rendered.clear();
    return { ok: true, id: stored.name.name, rev: document._rev };
  }

  /** `PUT /<name>` with `_attachments`: one new version and its tarball. */
  publish(name: PackageName, body: unknown, user: User): Promise<PublishResult> {
    return this.#exclusive(name.name, async () => {
      if (!isObject(body)) throw new RegistryError(400, "Bad Request: the body must be a JSON object");
      if (body.name !== name.name) {
        throw new RegistryError(400, `Bad Request: the body is for "${body.name}", the URL is for "${name.name}"`);
      }
      const versions = isObject(body.versions) ? Object.entries(body.versions) : [];
      if (versions.length !== 1) {
        throw new RegistryError(400, "Bad Request: a publish holds one version");
      }
      const [key, incoming] = versions[0];
      if (!isValidVersion(key)) throw new RegistryError(400, `Bad Request: "${key}" is not a valid version`);
      if (!isObject(incoming) || incoming.name !== name.name || incoming.version !== key) {
        throw new RegistryError(400, `Bad Request: versions["${key}"] must have this name and this version`);
      }

      const existing = await this.get(name.name);
      if (existing !== null && !this.canRead(existing, { kind: "user", user, via: "bearer", token: null })) {
        throw forbidden(name.name);
      }
      if (!this.canWrite(name.name, existing, user)) throw forbidden(name.name);

      const removed = this.#removed.get(name.name);
      if (existing === null) {
        const refusal = validateNewPackageName(name.name);
        if (refusal !== null)
          throw new RegistryError(400, `Bad Request: invalid package name "${name.name}": ${refusal}`);
        if (removed !== undefined && Date.now() - removed.at < day) {
          throw new RegistryError(403, `${name.name} cannot be republished until 24 hours have passed.`);
        }
      }
      if (
        (existing && own(existing.document.versions, key)) ||
        existing?.unpublished.has(key) ||
        removed?.versions.has(key)
      ) {
        throw new RegistryError(403, `You cannot publish over the previously published versions: ${key}.`);
      }

      const access = body.access ?? null;
      if (access !== null && access !== "public" && access !== "restricted") {
        throw new RegistryError(400, `Bad Request: access must be "public" or "restricted"`);
      }
      if (access === "restricted" && name.scope === null) {
        throw new RegistryError(400, "Bad Request: only a scoped package can be restricted");
      }

      const tarball = readAttachment(body._attachments);
      const shasum = new Bun.CryptoHasher("sha1").update(tarball).digest("hex");
      const dist = isObject(incoming.dist) ? incoming.dist : {};
      if (typeof dist.shasum === "string" && dist.shasum.toLowerCase() !== shasum) {
        throw new RegistryError(400, `Bad Request: dist.shasum is ${dist.shasum}, the tarball has ${shasum}`);
      }
      if (typeof dist.integrity === "string") verifyIntegrity(dist.integrity, tarball);

      const tags = isObject(body["dist-tags"]) ? Object.entries(body["dist-tags"]) : [];
      for (const [tag, target] of tags) {
        if (!isValidTag(tag)) throw new RegistryError(400, `Bad Request: "${tag}" is not a valid dist-tag`);
        if (target !== key) throw new RegistryError(400, `Bad Request: dist-tag "${tag}" must point to ${key}`);
      }

      const now = new Date();
      const publisher: Human = { name: user.name, email: user.email };
      const stored: StoredPackage = existing ?? {
        name,
        document: { _id: name.name, name: name.name, "dist-tags": {}, versions: {}, maintainers: [publisher] },
        access: access ?? (name.scope === null ? "public" : "restricted"),
        tarballs: new Map(),
        unpublished: removed?.versions ?? new Set(),
        modified: now,
        rendered: new Map(),
        tarballHashes: new Map(),
      };
      if (existing === null) {
        this.#loaded.set(name.name, Promise.resolve(stored));
        this.#removed.delete(name.name);
      } else if (access !== null) {
        stored.access = access;
      }

      const filename = `${name.basename}-${key}.tgz`;
      const { readme, ...manifest } = incoming as VersionDocument & { readme?: unknown };
      const version: VersionDocument = {
        ...manifest,
        _id: `${name.name}@${key}`,
        dist: {
          ...dist,
          integrity: `sha512-${new Bun.CryptoHasher("sha512").update(tarball).digest("base64")}`,
          shasum,
          tarball: `${name.name}/-/${filename}`,
        },
        _npmUser: publisher,
        maintainers: stored.document.maintainers ?? [publisher],
      };

      const document = stored.document;
      document.versions[key] = version;
      stored.tarballs.set(filename, new Blob([tarball]));
      stored.tarballHashes.delete(filename);
      for (const [tag] of tags) document["dist-tags"][tag] = key;
      document["dist-tags"].latest ??= key;
      document.time = { ...document.time, [key]: now.toISOString() };

      if (document["dist-tags"].latest === key) {
        const hoisted: Record<string, unknown> = document;
        for (const field of hoistedFields) {
          if (version[field] === undefined) delete hoisted[field];
          else hoisted[field] = version[field];
        }
        const text = typeof readme === "string" ? readme : typeof body.readme === "string" ? body.readme : "";
        document.readme = text.slice(0, maximumReadmeLength);
      }
      return this.#commit(stored, now);
    });
  }

  /**
   * `PUT /<name>` without a tarball. `npm deprecate` sends the whole packument with new `deprecated` messages, and
   * `npm star` sends `users`.
   */
  change(name: PackageName, body: unknown, user: User): Promise<PublishResult> {
    return this.#exclusive(name.name, async () => {
      if (!isObject(body)) throw new RegistryError(400, "Bad Request: the body must be a JSON object");
      const stored = await this.get(name.name);
      if (stored === null || !this.canRead(stored, { kind: "user", user, via: "bearer", token: null }))
        throw notFound();

      let changed = false;
      if (isObject(body.versions)) {
        for (const [key, incoming] of Object.entries(body.versions)) {
          const version = own(stored.document.versions, key);
          if (version === undefined || !isObject(incoming)) continue;
          const message = incoming.deprecated;
          if (message === version.deprecated) continue;
          if (message !== undefined && typeof message !== "string") {
            throw new RegistryError(400, "Bad Request: a deprecation message is a string");
          }
          if (!this.canWrite(name.name, stored, user)) throw forbidden(name.name);
          // An empty message takes the deprecation away.
          if (!message) delete version.deprecated;
          else version.deprecated = message;
          changed = true;
        }
      }
      if (isObject(body.users)) {
        const users = { ...stored.document.users };
        if (own(body.users, user.name)) users[user.name] = true;
        else delete users[user.name];
        stored.document.users = users;
        changed = true;
      }
      if (!changed) return { ok: true, id: name.name, rev: stored.document._rev ?? "" };
      return this.#commit(stored, new Date());
    });
  }

  /**
   * `PUT /<name>/-rev/<rev>`: the client read the packument, edited it, and sends it back. `npm unpublish <spec>`
   * removes a version this way, and `npm owner` replaces `maintainers`.
   */
  replace(name: PackageName, revision: string, body: unknown, user: User): Promise<PublishResult> {
    return this.#exclusive(name.name, async () => {
      if (!isObject(body)) throw new RegistryError(400, "Bad Request: the body must be a JSON object");
      const stored = await this.#forWrite(name, user);
      checkRevision(stored, revision);
      const document = stored.document;

      if (isObject(body.versions)) {
        for (const key of Object.keys(document.versions)) {
          if (Object.hasOwn(body.versions, key)) continue;
          delete document.versions[key];
          stored.unpublished.add(key);
        }
      }
      if (Object.keys(document.versions).length === 0) {
        return this.#remove(stored);
      }

      if (isObject(body["dist-tags"])) {
        const tags: Record<string, string> = {};
        for (const [tag, target] of Object.entries(body["dist-tags"])) {
          if (!isValidTag(tag)) throw new RegistryError(400, `Bad Request: "${tag}" is not a valid dist-tag`);
          if (typeof target === "string" && own(document.versions, target)) tags[tag] = target;
        }
        document["dist-tags"] = tags;
      } else {
        for (const [tag, target] of Object.entries(document["dist-tags"])) {
          if (!own(document.versions, target)) delete document["dist-tags"][tag];
        }
      }
      // Every package has a `latest`. When its version goes away, the highest version that is left takes the tag.
      document["dist-tags"].latest ??= highestVersion(Object.keys(document.versions))!;

      if (Array.isArray(body.maintainers)) {
        const maintainers = body.maintainers.filter(
          (maintainer): maintainer is Human => isObject(maintainer) && typeof maintainer.name === "string",
        );
        if (maintainers.length === 0) throw new RegistryError(400, "Bad Request: a package needs one maintainer");
        document.maintainers = maintainers.map(({ name, email }) => ({ name, email }));
      }
      return this.#commit(stored, new Date());
    });
  }

  /** `DELETE /<name>/-rev/<rev>`: `npm unpublish <name> --force`. */
  unpublish(name: PackageName, revision: string, user: User): Promise<PublishResult> {
    return this.#exclusive(name.name, async () => {
      const stored = await this.#forWrite(name, user);
      checkRevision(stored, revision);
      return this.#remove(stored);
    });
  }

  #remove(stored: StoredPackage): PublishResult {
    const versions = new Set([...stored.unpublished, ...Object.keys(stored.document.versions)]);
    this.#loaded.set(stored.name.name, Promise.resolve(null));
    this.#removed.set(stored.name.name, { at: Date.now(), versions });
    return { ok: true, id: stored.name.name, rev: stored.document._rev ?? "" };
  }

  /** `DELETE /<name>/-/<file>/-rev/<rev>`: the last step of `npm unpublish <spec>`. */
  removeTarball(name: PackageName, filename: string, revision: string, user: User): Promise<PublishResult> {
    return this.#exclusive(name.name, async () => {
      const stored = await this.#forWrite(name, user);
      checkRevision(stored, revision);
      for (const version of Object.values(stored.document.versions)) {
        if (tarballFilename(version, name.basename) === filename) {
          throw new RegistryError(400, `Bad Request: ${filename} belongs to version ${version.version}`);
        }
      }
      if (!stored.tarballs.delete(filename)) throw notFound();
      stored.tarballHashes.delete(filename);
      return { ok: true, id: name.name, rev: stored.document._rev ?? "" };
    });
  }

  setTag(name: PackageName, tag: string, version: unknown, user: User): Promise<PublishResult> {
    return this.#exclusive(name.name, async () => {
      const stored = await this.#forWrite(name, user);
      if (!isValidTag(tag)) throw new RegistryError(400, `Bad Request: "${tag}" is not a valid dist-tag`);
      if (typeof version !== "string" || !own(stored.document.versions, version)) {
        throw new RegistryError(404, `version not found: ${version}`);
      }
      stored.document["dist-tags"][tag] = version;
      return this.#commit(stored, new Date());
    });
  }

  removeTag(name: PackageName, tag: string, user: User): Promise<PublishResult> {
    return this.#exclusive(name.name, async () => {
      const stored = await this.#forWrite(name, user);
      if (tag === "latest") throw new RegistryError(400, `Bad Request: the "latest" tag cannot be removed`);
      if (!Object.hasOwn(stored.document["dist-tags"], tag)) throw new RegistryError(404, `dist-tag not found: ${tag}`);
      delete stored.document["dist-tags"][tag];
      return this.#commit(stored, new Date());
    });
  }

  setAccess(name: PackageName, access: unknown, user: User): Promise<void> {
    return this.#exclusive(name.name, async () => {
      const stored = await this.#forWrite(name, user);
      if (access !== "public" && access !== "restricted") {
        throw new RegistryError(400, `Bad Request: access must be "public" or "restricted"`);
      }
      if (access === "restricted" && name.scope === null) {
        throw new RegistryError(400, "Bad Request: only a scoped package can be restricted");
      }
      stored.access = access;
    });
  }

  /** The md5 of a tarball, which is its entity tag. */
  async tarballHash(stored: StoredPackage, filename: string, tarball: Blob): Promise<string> {
    let hash = stored.tarballHashes.get(filename);
    if (hash === undefined) {
      hash = new Bun.CryptoHasher("md5").update(await tarball.bytes()).digest("hex");
      stored.tarballHashes.set(filename, hash);
    }
    return hash;
  }
}

/** The names in a directory, or nothing when it is not a directory. */
async function entries(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

function isMaintainer(stored: StoredPackage | null, user: string): boolean {
  return stored?.document.maintainers?.some(maintainer => maintainer.name === user) ?? false;
}

function forbidden(name: string) {
  return new RegistryError(
    403,
    `You do not have permission to publish "${name}". Are you logged in as the correct user?`,
  );
}

function checkRevision(stored: StoredPackage, revision: string) {
  // A document of the storage directory can have an empty `_rev`. Then there is nothing to compare.
  const current = stored.document._rev;
  if (current && revision !== current) throw new RegistryError(409, "Document update conflict.");
}

function readAttachment(attachments: unknown): Buffer<ArrayBuffer> {
  const tarballs = isObject(attachments) ? Object.entries(attachments).filter(([key]) => key.endsWith(".tgz")) : [];
  if (tarballs.length !== 1) throw new RegistryError(400, "Bad Request: a publish holds one tarball");
  const [key, attachment] = tarballs[0];
  if (!isObject(attachment) || typeof attachment.data !== "string") {
    throw new RegistryError(400, `Bad Request: _attachments["${key}"].data must be base64`);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.data) || attachment.data.length % 4 !== 0) {
    throw new RegistryError(400, `Bad Request: _attachments["${key}"].data must be base64`);
  }
  const tarball = Buffer.from(attachment.data, "base64");
  if (tarball.byteLength === 0) throw new RegistryError(400, "Bad Request: the tarball is empty");
  if (typeof attachment.length === "number" && attachment.length !== tarball.byteLength) {
    throw new RegistryError(
      400,
      `Bad Request: _attachments["${key}"].length is ${attachment.length}, the tarball has ${tarball.byteLength} bytes`,
    );
  }
  return tarball;
}

function verifyIntegrity(integrity: string, tarball: Buffer) {
  for (const entry of integrity.trim().split(/\s+/)) {
    const dash = entry.indexOf("-");
    const algorithm = integrityAlgorithms.find(candidate => candidate === entry.slice(0, dash));
    if (algorithm === undefined) continue;
    const expected = entry.slice(dash + 1).split("?", 1)[0];
    const actual = new Bun.CryptoHasher(algorithm).update(tarball).digest("base64");
    if (expected !== actual) {
      throw new RegistryError(400, `Bad Request: dist.integrity is ${entry}, the tarball has ${algorithm}-${actual}`);
    }
  }
}
