// What JavaScript sees of a C file: every function with external linkage, each argument and result converted
// the way its C type says.
typedef enum { RED, GREEN } Color;
char f_char(char a) { return a; }
signed char f_i8(signed char a) { return a; }
unsigned char f_u8(unsigned char a) { return a; }
short f_i16(short a) { return a; }
unsigned short f_u16(unsigned short a) { return a; }
int f_i32(int a) { return a; }
unsigned f_u32(unsigned a) { return a; }
long long f_i64(long long a, unsigned long long b) { return a + (long long)b; }
unsigned long long f_u64(unsigned long long a) { return a; }
double f_double(double a, float b) { return a + b; }
float f_float(float a) { return a; }
_Bool f_bool(_Bool a) { return a; }
void *f_ptr(const char *a, int **b, int (*cb)(int)) { return (void *)(a ? a + 1 : 0) + (b != 0) + (cb != 0); }
void f_void(void) {}
Color f_enum(Color c) { return c; }
static int hidden(int a) { return a * 2; }
int uses_hidden(int a) { return hidden(a); }
static inline int also_hidden(int a) { return a; }
int counter;
