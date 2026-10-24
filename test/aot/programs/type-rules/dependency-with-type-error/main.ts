// A package that ships TypeScript is held to the types it wrote, like the program. A file of a package that has a type error is not: its annotations test nothing, and the build goes on. The other files of the package keep their tests.
import { half as looseHalf } from "loose-package";
import { half as neighborHalf } from "loose-package/neighbor";
import { half as soundHalf } from "sound-package";

const eight: any = "8";
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
attempt("a package without type errors", () => soundHalf(eight));
attempt("a file of a package with a type error", () => looseHalf(eight));
attempt("another file of that package", () => neighborHalf(eight));
