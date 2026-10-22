// B3 and Air are validated after every phase.
import { variant } from "./run-programs";

variant("validate-back-end", ["--aot-check=validate-back-end"], {}, 2, 8);
