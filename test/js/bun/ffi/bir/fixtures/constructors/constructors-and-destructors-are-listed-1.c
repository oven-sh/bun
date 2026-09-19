int order[8]; int n;
         static void last(void) __attribute__((constructor));
         static void last(void) { order[n++] = 3; }
         __attribute__((constructor(101))) static void first(void) { order[n++] = 1; }
         __attribute__((constructor(200))) void second(void) { order[n++] = 2; }
         __attribute__((destructor)) static void bye(void) { order[n++] = 9; }
         __attribute__((destructor(101))) static void bye_late(void) { order[n++] = 8; }
         static void unused(void) { order[0] = 7; }
         int main(void) { return n; }
