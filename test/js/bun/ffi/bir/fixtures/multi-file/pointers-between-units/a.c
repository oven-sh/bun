extern int values[]; int *cursor = &values[2]; int read(void) { return *cursor + cursor[-1]; }
