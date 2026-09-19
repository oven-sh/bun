extern int shared; _Thread_local int mine = 2; _Thread_local int *to_mine = &mine; _Thread_local int *to_shared = &shared;
           int sum(void) { return *to_mine + *to_shared; }
