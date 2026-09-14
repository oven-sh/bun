// One C file imported by several JavaScript files, statically, dynamically and with require, is one module: they
// share its objects. (That a worker has objects of its own is tested in abi.test.ts.)
static int counter;
int bump(void) { return ++counter; }
int current(void) { return counter; }
