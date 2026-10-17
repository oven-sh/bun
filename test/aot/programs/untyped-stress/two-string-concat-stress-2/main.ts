// `+` on two strings: the length, characters and internal representation of the result, and empty operands; run with options that stress the garbage collector (variant 2).
// ENV JSC_verifyGC=1
// ENV JSC_scribbleFreeCells=1
// ENV JSC_useZombieMode=1
// ENV JSC_slowPathAllocsBetweenGCs=10
import "./impl.js";
