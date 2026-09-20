static int state = 100; static int step(void) { state += 100; return state; } int b(void) { return step(); }
