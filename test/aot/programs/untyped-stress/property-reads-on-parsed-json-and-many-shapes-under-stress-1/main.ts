// Property reads by name on parsed JSON and on objects of many shapes at one site; run with options that stress the garbage collector (variant 1).
// ENV JSC_verifyGC=1
// ENV JSC_scribbleFreeCells=1
// ENV JSC_useZombieMode=1
// ENV JSC_slowPathAllocsBetweenGCs=50
import "../../jsc-shell-functions.ts";
import "./program.ts";
