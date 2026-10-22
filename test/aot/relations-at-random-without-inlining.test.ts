// No call is taken into its caller: what a caller believes about a callee is only tested where the call stays a call. The build checks itself while it runs.
import { programsBuiltWith } from "./run-programs";

programsBuiltWith("relations-at-random", "without-inlining", ["--aot-validate", "--aot-disable=InlineCalls"]);
