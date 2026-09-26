import { write } from "bun";
import { tempDir, type DirectoryTree } from "harness";
import { join } from "node:path";
import { Registry, type RegistryOptions } from "./registry.ts";

export * from "./index.ts";

/** `Bun.TOML.stringify` has the return type of `JSON.stringify`. For an object the result is always a string. */
export const toml = (value: object): string => Bun.TOML.stringify(value)!;

export type BunfigOptions = {
  saveTextLockfile?: boolean;
  /** Leave the registry out, so that the install goes to the default one. */
  npm?: boolean;
  linker?: "isolated" | "hoisted";
  globalStore?: boolean;
  publicHoistPattern?: string | string[];
  hoistPattern?: string | string[];
  hoist?: boolean;
};

/** The packages that bun's install tests share: `test/cli/install/registry/packages`. */
export const fixturePackages = join(import.meta.dir, "..", "..", "cli", "install", "registry", "packages");

/**
 * A registry that serves the fixture packages, with the helpers that bun's install tests need.
 * Every instance has its own users, tokens and published packages, so test files do not affect each other.
 *
 * ```ts
 * const registry = new TestRegistry();
 * beforeAll(() => registry.start());
 * afterAll(() => registry.stop());
 * ```
 */
export class TestRegistry extends Registry {
  readonly packagesPath: string;

  constructor(options: RegistryOptions = {}) {
    const storage = options.storage ?? fixturePackages;
    super({
      ...options,
      storage,
      access: { "@needs-auth/*": { read: "authenticated" }, ...options.access },
    });
    this.packagesPath = storage;
  }

  registryUrl() {
    return this.url;
  }

  /** Creates a user through the API, as `npm adduser` does. Returns a token of the user. */
  async generateUser(username: string, password: string): Promise<string> {
    const response = await fetch(`${this.url}-/user/org.couchdb.user:${encodeURIComponent(username)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: username, password, email: `${username}@example.com` }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Failed to create user ${username}: ${response.status} ${body}`);
    return JSON.parse(body).token;
  }

  /** A bunfig.toml that points to this registry with the token of a new user. */
  async authBunfig(user: string) {
    const token = await this.generateUser(user, user);
    return toml({
      install: {
        cache: false,
        registry: { url: this.url, token },
      },
    });
  }

  async createTestDir(
    options: { bunfigOpts?: BunfigOptions; files?: DirectoryTree | string } = {
      bunfigOpts: { linker: "hoisted" },
      files: {},
    },
  ) {
    const packageDir = String(tempDir("registry-test-", options.files ?? {}));
    await this.writeBunfig(packageDir, options.bunfigOpts);
    return { packageDir, packageJson: join(packageDir, "package.json") };
  }

  async writeBunfig(dir: string, options: BunfigOptions = {}) {
    await write(
      join(dir, "bunfig.toml"),
      toml({
        install: {
          cache: join(dir, ".bun-cache"),
          saveTextLockfile: options.saveTextLockfile,
          registry: options.npm ? undefined : this.url,
          linker: options.linker,
          globalStore: options.globalStore,
          publicHoistPattern: options.publicHoistPattern,
          hoistPattern: options.hoistPattern,
          hoist: options.hoist,
        },
      }),
    );
  }
}
