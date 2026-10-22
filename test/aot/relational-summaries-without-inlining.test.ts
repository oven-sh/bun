// No call is taken into its caller: what a caller believes about a callee is only tested where the call stays a call.
import { programsBuiltWith } from "./run-programs";

programsBuiltWith("relational-summaries", "without-inlining", ["--aot-disable=InlineCalls"]);
