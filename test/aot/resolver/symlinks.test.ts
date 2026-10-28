import { isWindows } from "harness";
import { describe } from "../supported";
import { packageFiles, testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

type LinkedTree = Pick<ResolutionCase, "files" | "links">;
type LinkAnswer = [from: string, specifier: string, followed: string | null, preserved?: string | null];

interface LinkFixture {
  name: string;
  createTree: () => LinkedTree;
  answers: LinkAnswer[];
  skip?: boolean;
}

const fixtures: LinkFixture[] = [
  {
    name: "a linked file",
    createTree: () => ({
      files: { "real/a.js": "" },
      links: { "linked.js": "real/a.js", "second.js": "linked.js", "dangling.js": "real/none.js" },
    }),
    answers: [
      ["importer.js", "./linked.js", "real/a.js"],
      ["importer.js", "./linked", "real/a.js"],
      ["importer.js", "./second.js", "real/a.js"],
      ["importer.js", "./dangling.js", null],
      ["importer.js", "./dangling", null],
    ],
    // A junction cannot name a file.
    skip: isWindows,
  },
  {
    name: "a linked directory",
    createTree: () => ({
      files: { "real-dir/a.js": "", "real-dir/index.js": "", "real-dir/sub/b.js": "" },
      links: { "linked-dir": "real-dir" },
    }),
    answers: [
      ["importer.js", "./linked-dir/a.js", "real-dir/a.js", "linked-dir/a.js"],
      ["importer.js", "./linked-dir", "real-dir/index.js", "linked-dir/index.js"],
      ["importer.js", "./linked-dir/sub/b.js", "real-dir/sub/b.js", "linked-dir/sub/b.js"],
    ],
  },
  {
    name: "a linked package",
    createTree: () => ({
      files: packageFiles("lib", { main: "./main.js" }, ["main.js", "pair.ts", "pair.js"], "packages/lib"),
      links: { "node_modules/lib": "packages/lib" },
    }),
    answers: [
      ["importer.js", "lib", "packages/lib/main.js", "node_modules/lib/main.js"],
      ["importer.js", "lib/main.js", "packages/lib/main.js", "node_modules/lib/main.js"],
      // The extension order follows the path that is searched, not the real path.
      ["importer.js", "lib/pair", "packages/lib/pair.js", "node_modules/lib/pair.js"],
      ["packages/lib/importer.js", "./pair", "packages/lib/pair.ts"],
    ],
  },
  {
    name: "workspaces",
    createTree: () => ({
      files: {
        ...packageFiles("a", {}, [], "packages/a"),
        ...packageFiles("b", {}, ["index.js", "node_modules/own-dependency/index.js"], "packages/b"),
        "node_modules/hoisted/index.js": "",
      },
      links: { "node_modules/a": "packages/a", "node_modules/b": "packages/b" },
    }),
    answers: [
      ["packages/a/importer.js", "b", "packages/b/index.js", "node_modules/b/index.js"],
      ["packages/a/importer.js", "hoisted", "node_modules/hoisted/index.js"],
      ["packages/a/importer.js", "own-dependency", null],
      ["packages/b/importer.js", "own-dependency", "packages/b/node_modules/own-dependency/index.js"],
      // packages/a has no entry file.
      ["packages/b/importer.js", "a", null],
    ],
  },
  {
    name: "a store",
    createTree: () => ({
      files: { "store/pkg@1/node_modules/pkg/index.js": "", "store/pkg@1/node_modules/peer/index.js": "" },
      links: { "node_modules/pkg": "store/pkg@1/node_modules/pkg" },
    }),
    answers: [
      ["importer.js", "pkg", "store/pkg@1/node_modules/pkg/index.js", "node_modules/pkg/index.js"],
      ["importer.js", "peer", null],
      ["store/pkg@1/node_modules/pkg/importer.js", "peer", "store/pkg@1/node_modules/peer/index.js"],
    ],
  },
];

function followedCase({ name, createTree, answers, skip }: LinkFixture): ResolutionCase {
  return {
    name,
    ...createTree(),
    pins: answers.map(([from, specifier, followed]): Pin => [from, specifier, followed]),
    skip,
  };
}

function preservedCase({ name, createTree, answers, skip }: LinkFixture): ResolutionCase {
  return {
    name: `${name}, links preserved`,
    ...createTree(),
    pins: answers.map(([from, specifier, followed, preserved = followed]): Pin => [from, specifier, preserved]),
    options: { preserveSymlinks: true },
    skip,
  };
}

describe("code resolution", () => testResolution([...fixtures.map(followedCase), ...fixtures.map(preservedCase)]));
