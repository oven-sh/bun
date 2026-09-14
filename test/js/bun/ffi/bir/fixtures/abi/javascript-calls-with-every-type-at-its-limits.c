// What crosses between JavaScript and C through `import`: every type at its limits, in every argument position,
// more arguments than there are registers, and memory that JavaScript owns.
#include <limits.h>
#include <stdint.h>
#include <string.h>

signed char min_i8(void) { return SCHAR_MIN; }     signed char max_i8(void) { return SCHAR_MAX; }
unsigned char max_u8(void) { return UCHAR_MAX; }
short min_i16(void) { return SHRT_MIN; }           short max_i16(void) { return SHRT_MAX; }
unsigned short max_u16(void) { return USHRT_MAX; }
int min_i32(void) { return INT_MIN; }              int max_i32(void) { return INT_MAX; }
unsigned max_u32(void) { return UINT_MAX; }
long long min_i64(void) { return LLONG_MIN; }      long long max_i64(void) { return LLONG_MAX; }
unsigned long long max_u64(void) { return ULLONG_MAX; }
float max_float(void) { return 3.40282347e38f; }   float tiny_float(void) { return 1.40129846e-45f; }
double max_double(void) { return 1.7976931348623157e308; }
double negative_zero(void) { return -0.0; }
double not_a_number(void) { volatile double zero = 0; return zero / zero; }
double infinity(void) { volatile double zero = 0; return 1 / zero; }

// Identities, to see what arrives.
signed char same_i8(signed char v) { return v; }   unsigned char same_u8(unsigned char v) { return v; }
short same_i16(short v) { return v; }               unsigned short same_u16(unsigned short v) { return v; }
int same_i32(int v) { return v; }                   unsigned same_u32(unsigned v) { return v; }
long long same_i64(long long v) { return v; }       unsigned long long same_u64(unsigned long long v) { return v; }
float same_float(float v) { return v; }             double same_double(double v) { return v; }
_Bool same_bool(_Bool v) { return v; }

// More arguments than registers, of every kind, in an order that interleaves them.
double twelve(int a, double b, long long c, float d, unsigned char e, double f, short g, float h, unsigned long long i, double j, _Bool k, int l) {
  return a + b * 2 + (double)c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + (double)i * 9 + j * 10 + k * 11 + l * 12;
}
long long ten_integers(long long a, long long b, long long c, long long d, long long e, long long f, long long g, long long h, long long i, long long j) {
  return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h + 9 * i + 10 * j;
}
double ten_doubles(double a, double b, double c, double d, double e, double f, double g, double h, double i, double j) {
  return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h + 9 * i + 10 * j;
}

// Memory JavaScript owns: read, written, measured; and an address C owns, handed out and taken back.
long long sum_bytes(const unsigned char *bytes, long long count) { long long total = 0; for (long long i = 0; i < count; i++) total += bytes[i]; return total; }
void fill(int *out, int count, int value) { for (int i = 0; i < count; i++) out[i] = value + i; }
long long length(const char *text) { return (long long)strlen(text); }
double scale_in_place(double *values, int count, double by) { double total = 0; for (int i = 0; i < count; i++) total += values[i] *= by; return total; }
static int owned_by_c[4] = {10, 20, 30, 40};
int *address_of_element(int index) { return &owned_by_c[index]; }
int read_through(const int *pointer) { return pointer ? *pointer : -1; }
int is_null(const void *pointer) { return pointer == 0; }
void *null_pointer(void) { return 0; }
