// A package whose own tsconfig.json turns isolatedModules off erases its const enums, so a const enum after a return is not unreachable code there, whatever the program's tsconfig.json says.
import { first } from "./inner/late.ts";
console.log(first());
