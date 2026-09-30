// Where the files of the corpus are below its root, as sync.sh writes them: a module takes the root and asks here for the rest.
export const suites = ["compiler", "conformance"] as const;
export type Suite = (typeof suites)[number];

export interface CorpusPaths {
  root: string;
  // TypeScript's tests/cases: a directory for each suite, with the cases and the directories of cases below it.
  cases: string;
  // TypeScript's tests/lib, which the harness mounts at /.lib.
  lib: string;
  // TypeScript's error baselines, both suites directly in one directory.
  typescriptBaselines: string;
  // For each suite, typescript-go's error baselines whose bytes are not TypeScript's or that TypeScript lacks.
  typescriptGoBaselines: Record<Suite, string>;
  // The list of lines <suite>/<name>.errors.txt where TypeScript has a baseline and typescript-go reports no error.
  noErrors: string;
  // typescript-go's lists of the differences from TypeScript that it accepts, and of those that it has triaged.
  submoduleAccepted: string;
  submoduleTriaged: string;
}

// The parts are joined with "/", which every platform opens.
export function corpusPaths(root: string): CorpusPaths {
  const typescriptGo = `${root}/baselines/typescript-go`;
  return {
    root,
    cases: `${root}/cases`,
    lib: `${root}/lib`,
    typescriptBaselines: `${root}/baselines/typescript`,
    typescriptGoBaselines: { compiler: `${typescriptGo}/compiler`, conformance: `${typescriptGo}/conformance` },
    noErrors: `${typescriptGo}/NO_ERRORS.txt`,
    submoduleAccepted: `${root}/submoduleAccepted.txt`,
    submoduleTriaged: `${root}/submoduleTriaged.txt`,
  };
}
