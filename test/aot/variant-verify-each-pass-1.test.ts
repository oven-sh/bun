// The IR is verified after every pass, cached analyses are computed again and compared, and the flow results are validated after they are applied. A finding fails the build.
import { variant } from "./run-programs";

variant("verify-each-pass", ["--aot-check=verify-each-pass"], {}, 1, 3, [
  "definitions-by-descriptor/descriptors-that-leave-the-getter-out-beside-descriptors-that-hold-one",
  "escape-analysis/a-closure-of-an-async-function-that-nobody-calls",
  "function-prototypes/a-constructor-function-that-is-only-called-with-the-objects-of-others",
  "structural-types/a-spread-of-a-text-an-array-or-an-instance-of-other-classes",
]);
