static int state = 1; static int step(void) { return state++; } int a(void) { return step() * 10 + step(); }
