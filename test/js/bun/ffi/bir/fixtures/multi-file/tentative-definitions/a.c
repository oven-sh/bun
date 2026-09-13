int shared; int table[4]; extern int limit; int get(void) { return shared + table[3] + limit; }
