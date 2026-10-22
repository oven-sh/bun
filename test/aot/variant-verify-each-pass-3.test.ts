// The IR is verified after every pass, cached analyses are computed again and compared, and the flow results are validated after they are applied. A finding fails the build.
import { variant } from "./run-programs";

variant("verify-each-pass", ["--aot-check=verify-each-pass"], {}, 3, 3);
