static const char *state = "text"; static int step(int n) { static int calls; calls += n; return calls; } int c(void) { return step(2) + step(3) + state[1]; }
