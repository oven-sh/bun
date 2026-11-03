export interface Row {
  name: string;
  entry: string;
  workloads: { name: string; arguments: string[] }[];
  ownPackages?: string[];
  typedPackages?: string[];
  typedSources?: boolean;
  typedFlags?: string[];
  libraries?: { name: string; entryPoints: string[]; flags?: string[]; added?: Record<string, string> }[];
  flags?: string[];
}

export interface Column {
  name: string;
  bun: "ours" | "released" | "ceiling";
  command: string[];
  typed: boolean;
  rebuilt?: boolean;
  erases?: boolean;
  withoutTestsThatNeverFail?: "in the packages" | "anywhere";
  only?: (row: Row) => boolean;
}

const production = ["--define", 'process.env.NODE_ENV="production"'];

export const columns: Column[] = [
  { name: "as-installed", bun: "ours", command: ["compile", ...production], typed: false },
  { name: "rebuilt", bun: "ours", command: ["compile", ...production], typed: false, rebuilt: true, only: row => !!row.libraries },
  { name: "typed", bun: "ours", command: ["compile", ...production], typed: true },
  { name: "erased", bun: "ours", command: ["compile", ...production, "--aot-erase-types"], typed: true, erases: true, only: row => !!row.typedSources },
  { name: "typed-by-ceiling-bun", bun: "ceiling", command: ["compile", ...production], typed: true },
  { name: "no-tests-in-packages", bun: "ceiling", command: ["compile", ...production], typed: true, withoutTestsThatNeverFail: "in the packages" },
  { name: "no-tests-anywhere", bun: "ceiling", command: ["compile", ...production], typed: true, withoutTestsThatNeverFail: "anywhere" },
  { name: "jit", bun: "ours", command: ["compile", "--no-aot", ...production], typed: false },
  { name: "released", bun: "released", command: ["build", "--compile", "--production", ...production], typed: false },
];

const pages = ["catalog", "article"];

export const rows: Row[] = [
  {
    name: "orders",
    entry: "orders.ts",
    ownPackages: ["orders"],
    workloads: ["10", "1000", "100000"].map(lines => ({ name: `${lines} lines`, arguments: [lines] })),
  },
  {
    name: "react-to-string",
    entry: "react-to-string.tsx",
    typedPackages: ["react", "react-dom"],
    workloads: pages.map(page => ({ name: page, arguments: [page] })),
  },
  {
    name: "react-to-readable-stream",
    entry: "react-to-readable-stream.tsx",
    typedPackages: ["react", "react-dom"],
    workloads: pages.map(page => ({ name: page, arguments: [page] })),
  },
  {
    name: "react-to-pipeable-stream",
    entry: "react-to-pipeable-stream.tsx",
    workloads: pages.map(page => ({ name: page, arguments: [page] })),
  },
  {
    name: "react-reconciler",
    entry: "react-reconciler.tsx",
    typedPackages: ["react", "react-reconciler"],
    workloads: ["reconciled", "painted"].map(how => ({ name: how, arguments: [how] })),
  },
  {
    name: "zod",
    entry: "zod.ts",
    typedSources: true,
    typedFlags: ["--conditions=@zod/source"],
    workloads: ["valid", "invalid"].map(kind => ({ name: `${kind} order`, arguments: [kind] })),
  },
  {
    name: "seroval",
    entry: "seroval.ts",
    typedPackages: ["seroval"],
    workloads: ["serialize", "json"].map(how => ({ name: how, arguments: [how] })),
  },
  {
    name: "hono",
    entry: "hono.ts",
    libraries: [{ name: "hono", entryPoints: ["./src/index.ts"], flags: ["--tsconfig-override", "./tsconfig.build.json"] }],
    workloads: [{ name: "eight requests", arguments: [] }],
  },
  {
    name: "elysia",
    entry: "elysia.ts",
    libraries: [{ name: "elysia", entryPoints: ["./src/index.ts"], added: { "src/undeclared.d.ts": 'declare module "fast-decode-uri-component";\n' } }],
    workloads: [{ name: "eight requests", arguments: [] }],
  },
  {
    name: "base64-js",
    entry: "base64-js.ts",
    typedPackages: ["base64-js"],
    workloads: ["encode", "decode"].map(how => ({ name: `${how} 48 KB`, arguments: [how] })),
  },
];
