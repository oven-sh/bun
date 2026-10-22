// "sideEffects": false. The barrel exports four names from four files, and the program asks for one. Of the others, one file is no JavaScript, one does not exist, and one imports a package that is not installed. `bun build --compile` never reads them, so the build succeeds; `bun run` fails.
// STATISTIC: SourceFilesInferred = 3
import { wanted } from "half-written";

console.log(wanted());
