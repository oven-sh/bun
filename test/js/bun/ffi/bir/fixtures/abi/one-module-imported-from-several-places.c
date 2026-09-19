// One C file imported by several JavaScript files, statically, dynamically and with require, is one module: they
// share its objects. (So do the Workers of a process and the thread that started them: c-import.test.ts.)
static int counter;
int bump(void) { return ++counter; }
int current(void) { return counter; }
