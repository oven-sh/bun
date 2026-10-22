// After the flow analysis has solved, each of its rules runs once more over the solved sets. Whatever that still changes is an update that the solve lost: a set that is too small is a false proof. Then every rule runs again without its shortcuts for common cases: whatever that adds to a set, a shortcut had left out. A finding fails the build.
import { variant } from "./run-programs";

variant("flow-fixpoint", ["--aot-check=flow-fixpoint"], {}, 3, 3);
