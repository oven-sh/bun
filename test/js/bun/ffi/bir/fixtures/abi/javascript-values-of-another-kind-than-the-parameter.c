// What the functions that the .ts file calls with the wrong kinds of values do with what arrives.
#include <string.h>
int first(const unsigned char *bytes) { return bytes ? bytes[0] : -1; }
int length_of(const char *text) { return text ? (int)strlen(text) : -1; }
long long same64(long long value) { return value; }
unsigned long long same_u64(unsigned long long value) { return value; }
int add(int a, int b) { return a + b; }
double half(double value) { return value / 2; }
float single(float value) { return value; }
_Bool truth(_Bool value) { return value; }
int first_int(const int *values) { return values ? values[0] : -1; }
