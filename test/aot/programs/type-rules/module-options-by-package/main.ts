// isolatedModules and allowUmdGlobalAccess apply only to the package whose tsconfig.json sets them: the same code has three errors in strict/ and none in loose/.
import { Color } from "./strict/colors.ts";
import { Shade } from "./loose/shades.ts";
console.log(Color.Red, Shade.Dark);
