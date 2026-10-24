// The application has exactOptionalPropertyTypes and strictFunctionTypes on. The tsconfig.json in lib has them off, and lib's files are written for that.
import { defaults, read } from "./lib/options";
import { handle } from "./lib/handlers";

console.log(read(defaults()), read({ step: 2 }), Object.keys(defaults()));
console.log(handle({ name: "rex", bark: 2 } as { name: string }));
