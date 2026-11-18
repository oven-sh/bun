// This is (for now) very loose implementation reference, mostly type testing

import { expectType } from "./utilities";

const mySecurityScanner: Bun.Security.Scanner = {
  version: "1",
  scan: async ({ packages }) => {
    const response = await fetch("https://threat-feed.example.com");

    if (!response.ok) {
      throw new Error("Unable to fetch threat feed");
    }

    // Would recommend using a schema library or something to validate here. You
    // should throw if the parsing fails rather than returning no advisories,
    // this code needs to be defensive...
    const myThreatFeed = (await response.json()) as Array<{
      package: string;
      version: string;
      url: string;
      description: string;
      category: "unhealthy" | "spam" | "malware"; // Imagine some other categories...
    }>;

    return myThreatFeed.flatMap((threat): Bun.Security.Advisory[] => {
      const match = packages.some(p => p.name === threat.package && p.version === threat.version);

      if (!match) {
        return [];
      }

      return [
        {
          level: threat.category === "malware" ? "fatal" : "warn",
          package: threat.package,
          url: threat.url,
          description: threat.description,
        },
      ];
    });
  },
};

expectType(mySecurityScanner).toBeDefined();

// `bun install` writes `lockfileVersion` 3 and object values in `overrides`
// for nested and version-scoped override rules.
const lockfileWithScopedOverrides: Bun.BunLockFile = {
  lockfileVersion: 3,
  configVersion: 1,
  workspaces: {
    "": {
      name: "forms",
      dependencies: {
        "is-even": "1.0.0",
        "is-odd": "3.0.1",
      },
    },
  },
  overrides: {
    "is-even": {
      "is-buffer@^1": "1.1.6",
    },
    "is-number": "7.0.0",
    "is-number@^3": {
      ".": "3.0.0",
      "kind-of": "3.2.2",
    },
    "is-odd": {
      "is-number": "6.0.0",
    },
    "kind-of": "6.0.3",
  },
  packageExtensions: {
    "legacy-plugin@2.0.3": { dependencies: ["lodash"], optionalPeers: ["webpack"] },
    "react-redux@7.2.9": { peerDependencies: ["react"] },
  },
  packages: {
    "@rollup/rollup-linux-x64-musl": [
      "@rollup/rollup-linux-x64-musl@4.9.0",
      "",
      { os: "linux", cpu: "x64", libc: "musl" },
      "sha512-VFAC1RDRSbU3iOF98X42KaVicAfKf0m0OvIu8dbnqhTe26Kh6Ym9JrDulz7Hbk7/9zGc41JkV02g+p3BivOdAg==",
    ],
    // tarball with an integrity hash
    "is-number": [
      "is-number@https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
      {},
      "sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==",
    ],
    // github with an integrity hash
    "kind-of": [
      "kind-of@github:jonschlinkert/kind-of#668b595",
      {},
      "jonschlinkert-kind-of-668b595",
      "sha512-D8LJZadajuFIjieklJph9BxDn91LdpjDZqP9yZ8WGkaQLIqBae+qVPRhFnnGzJyqb/CXEpMOgcF132yLMt+jBQ==",
    ],
    // git without an integrity hash
    "is-odd": ["is-odd@git+https://example.com/is-odd.git#a80ee0d", {}, "a80ee0d"],
  },
};

declare const lockfilePackage: Bun.BunLockFilePackageArray;
if (lockfilePackage.length === 4) {
  // npm has the registry at index 1. git and github have the info object there.
  expectType(lockfilePackage[1]).is<string | Bun.BunLockFilePackageInfo>();
}

const lockfileWithUnknownLibc: Bun.BunLockFile = {
  lockfileVersion: 2,
  workspaces: {},
  packages: {
    // @ts-expect-error
    "some-package": ["some-package@1.0.0", "", { libc: "bionic" }, "sha512-AAAA"],
  },
};
expectType(lockfileWithUnknownLibc).toBeDefined();

expectType(lockfileWithScopedOverrides.packageExtensions).is<
  Record<string, { dependencies?: string[]; peerDependencies?: string[]; optionalPeers?: string[] }> | undefined
>();
expectType(lockfileWithScopedOverrides.lockfileVersion).is<0 | 1 | 2 | 3>();
expectType(lockfileWithScopedOverrides.overrides).is<Record<string, string | Record<string, string>> | undefined>();

const lockfileWithUnknownVersion: Bun.BunLockFile = {
  // @ts-expect-error
  lockfileVersion: 4,
  workspaces: {},
  packages: {},
};

const lockfileWithDeepOverride: Bun.BunLockFile = {
  lockfileVersion: 3,
  workspaces: {},
  overrides: {
    "is-odd": {
      // @ts-expect-error
      "is-number": { "kind-of": "6.0.3" },
    },
  },
  packages: {},
};

expectType(lockfileWithUnknownVersion).toBeDefined();
expectType(lockfileWithDeepOverride).toBeDefined();
