// Two packages ship TypeScript that exactOptionalPropertyTypes and strictFunctionTypes would reject. Only the application has these options on, so the packages keep their types.
// STATISTIC: SourceFilesDemoted = 0
import { defaults, read, reset } from "exact";
import { handle, visit } from "variance";

const options = { limit: 3, step: 4 };
console.log(read(defaults()), read({ step: 2 }), read(options));
reset(options);
console.log(read(options), Object.keys(options), Object.keys(defaults()));
const rex = { name: "rex", bark: 2 };
console.log(handle(rex), visit(rex));
