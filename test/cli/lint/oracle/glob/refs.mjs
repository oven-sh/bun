// Where the judges are: three directories `node_modules`, because some of the packages are needed in several versions.
//
//   GLOB_JUDGES            minimatch 10.2.6, brace-expansion 5.0.12, picomatch 4.0.7, ignore 5.3.2, is-glob 4.0.3, glob-parent 6.0.2,
//                          @typescript-eslint/eslint-plugin with its own ignore 7.0.12
//   GLOB_JUDGES_PRETTIER   micromatch 4.0.8 on picomatch 2.3.2, fast-glob 3.3.3, ignore 7.0.5, glob-parent 5.1.2
//   GLOB_JUDGES_3          minimatch 3.1.5, which eslint-plugin-import asks
import { createRequire } from "node:module";
import { resolve } from "node:path";
export const require = createRequire(import.meta.url);
const directory = (name, otherwise) => resolve(process.env[name] ?? otherwise) + "/";
export const J = directory("GLOB_JUDGES", "node_modules"),
  P = directory("GLOB_JUDGES_PRETTIER", "node_modules"),
  M3 = directory("GLOB_JUDGES_3", "node_modules");
