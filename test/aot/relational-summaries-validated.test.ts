// The build checks itself while it runs: an object that lies in a frame stops the program where it reaches anything but a read, a store without a barrier checks what its flag claims, a deleted test is made all the same.
import { programsBuiltWith } from "./run-programs";

programsBuiltWith("relational-summaries", "validated", ["--aot-validate", "--aot-disable=InlineCalls"]);
