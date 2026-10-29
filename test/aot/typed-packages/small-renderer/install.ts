import { cpSync } from "fs";
import { join } from "path";
import { installPackage } from "../install-package";

/**
 * Copies the programs of this folder into `project`, and into its node_modules the package that they import, small-renderer,
 * and the package that small-renderer imports, task-queue. `edit` changes the TypeScript of small-renderer.
 */
export function installSmallRenderer(project: string, edit?: (typed: string) => string) {
  for (const file of ["host.ts", "main.ts", "terminal.ts", "with-look-alikes.ts", "tsconfig.json"])
    cpSync(join(import.meta.dir, file), join(project, file));
  installPackage(join(import.meta.dir, "packages", "task-queue"), project);
  return installPackage(join(import.meta.dir, "packages", "small-renderer"), project, edit);
}
