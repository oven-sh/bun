int order[8];
int count;
__attribute__((constructor(300))) static void c(void) { order[count++] = 3; }
__attribute__((constructor)) static void d(void) { order[count++] = 4; }
