extern int order[];
extern int count;
__attribute__((constructor)) static void a(void) { order[count++] = 1; }
__attribute__((constructor(500))) static void b(void) { order[count++] = 2; }
