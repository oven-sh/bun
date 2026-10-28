import { isWindows, type DirectoryTree } from "harness";
import { describe } from "../supported";
import { packageFiles, testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

const orders = {
  import: [".tsx", ".jsx", ".mts", ".ts", ".mjs", ".js", ".cts", ".cjs", ".json"],
  require: [".tsx", ".ts", ".jsx", ".cts", ".cjs", ".js", ".mjs", ".mts", ".json"],
  nodeModulesImport: [".mjs", ".jsx", ".mts", ".js", ".cjs", ".tsx", ".ts", ".cts", ".json"],
  nodeModulesRequire: [".jsx", ".cjs", ".js", ".mjs", ".mts", ".tsx", ".ts", ".cts", ".json"],
};

const pairs = orders.import.flatMap((a, index) => orders.import.slice(index + 1).map((b): [string, string] => [a, b]));

function pairName(a: string, b: string): string {
  return `${a.slice(1)}-${b.slice(1)}`;
}

function winner(order: string[], a: string, b: string): string {
  return order.indexOf(a) < order.indexOf(b) ? a : b;
}

function pairFiles(base: string): DirectoryTree {
  const tree: DirectoryTree = {};
  for (const [a, b] of pairs) {
    for (const extension of [a, b]) {
      const text = extension === ".json" ? "{}" : "";
      tree[`${base}files/${pairName(a, b)}/m${extension}`] = text;
      tree[`${base}indexes/${pairName(a, b)}/index${extension}`] = text;
    }
  }
  return tree;
}

function pairPins(from: string, prefix: string, base: string, importOrder: string[], requireOrder: string[]): Pin[] {
  return pairs.flatMap(([a, b]): Pin[] => {
    const file = `files/${pairName(a, b)}/m`;
    const directory = `indexes/${pairName(a, b)}`;
    const onImport = winner(importOrder, a, b);
    const onRequire = winner(requireOrder, a, b);
    return [
      [from, prefix + file, base + file + onImport, base + file + onRequire],
      [from, prefix + directory, `${base}${directory}/index${onImport}`, `${base}${directory}/index${onRequire}`],
    ];
  });
}

function packagePairFiles(): DirectoryTree {
  return { ...packageFiles("pkg", {}, []), ...pairFiles("node_modules/pkg/") };
}

const cases: ResolutionCase[] = [
  {
    name: "outside node_modules",
    files: pairFiles(""),
    pins: pairPins("importer.js", "./", "", orders.import, orders.require),
  },
  {
    name: "a package subpath",
    files: packagePairFiles(),
    pins: pairPins("importer.js", "pkg/", "node_modules/pkg/", orders.nodeModulesImport, orders.nodeModulesRequire),
  },
  {
    name: "relative, inside node_modules",
    files: packagePairFiles(),
    pins: pairPins(
      "node_modules/pkg/importer.js",
      "./",
      "node_modules/pkg/",
      orders.nodeModulesImport,
      orders.nodeModulesRequire,
    ),
  },
  {
    name: "edges",
    files: {
      "node_modules/single.ts": "",
      "node_modules/single.js": "",
      "both/m.ts": "",
      "both/m/index.js": "",
      "both/index.js": "",
      "index.js": "",
      "addon/m.node": "",
      ...packageFiles("pkg", {}, ["addon/m.node", "both/m.js", "both/m/index.js"]),
    },
    pins: [
      // There is no package directory, so the order outside node_modules stays.
      ["importer.js", "single", "node_modules/single.ts"],
      ["importer.js", "./both/m", "both/m.ts"],
      ["importer.js", "./both/m/", "both/m/index.js"],
      ["importer.js", "pkg/both/m", "node_modules/pkg/both/m.js"],
      // TODO: on Windows `bun run` loses the "/" and takes m.js.
      ...((isWindows ? [] : [["importer.js", "pkg/both/m/", "node_modules/pkg/both/m/index.js"]]) as Pin[]),
      // Only the two orders of `require` end with ".node".
      ["importer.js", "./addon/m", null, "addon/m.node"],
      ["importer.js", "pkg/addon/m", null, "node_modules/pkg/addon/m.node"],
      ["both/importer.js", "."],
      ["both/importer.js", "./"],
      ["both/importer.js", ".."],
    ],
  },
];

describe("code resolution", () => testResolution(cases));
