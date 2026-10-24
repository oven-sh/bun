// Files as tools emit them, one per tool: esbuild's __commonJS, __esm and __export; a webpack module map; a UMD wrapper; rollup's frozen namespace; TypeScript's __createBinding, __exportStar and __importStar; Babel's interop helpers. In each the functions are reached through tables, getters and loops of the tool's own run time.
import esbuild from "./esbuild.cjs";
import webpack from "./webpack.cjs";
import umd from "./umd.cjs";
import { rollup } from "./rollup.mjs";
import typescript from "./typescript.cjs";
import babel from "./babel.cjs";

console.log(esbuild());
console.log(webpack());
console.log(umd.greet(), umd.version());
console.log(rollup());
console.log(typescript());
console.log(babel());
