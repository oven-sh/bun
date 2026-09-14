_Thread_local int shared = 5; _Thread_local int tentative; static _Thread_local int mine = 100; int b(void) { return shared * 1000 + tentative * 100000 + mine++; }
