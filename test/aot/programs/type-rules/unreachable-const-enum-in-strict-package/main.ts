// isolatedModules in a package's own tsconfig.json preserves the package's const enums, so a const enum after a return is unreachable code there.
import { first } from "./inner/late.ts";
console.log(first());
