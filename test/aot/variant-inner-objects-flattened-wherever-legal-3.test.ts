// Every field that may keep its slot and hold its inner object in a room of the outer one does, whatever the estimate of heat says, also where nobody holds the inner object.
// By that estimate small programs hardly ever take the form.
import { variant } from "./run-programs";

variant("inner-objects-flattened-wherever-legal", ["--aot-testing=FlattenUntilHeldWhereverLegal"], {}, 3, 3);
