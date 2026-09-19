#ifndef SHARED_H
#define SHARED_H
struct point { int x, y; };
typedef int (*binary)(int, int);
extern int counter;
extern struct point origin;
extern const char *const names[3];
extern binary operations[3];
int scratch;                     /* a tentative definition in every unit */
int is_even(unsigned n);
int is_odd(unsigned n);
int add(int, int); int sub(int, int); int mul(int, int);
int bump(void);
const char *describe(int which);
int puts(const char *);
#endif
