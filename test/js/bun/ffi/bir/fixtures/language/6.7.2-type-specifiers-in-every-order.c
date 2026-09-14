// C11 6.7.2: each multiset of type specifiers names one type, in whatever order its members come.
#include <stdio.h>

#define KIND(x) _Generic((x), _Bool: "bool", char: "char", signed char: "schar", unsigned char: "uchar", short: "short", \
  unsigned short: "ushort", int: "int", unsigned: "uint", long: "long", unsigned long: "ulong", long long: "llong", \
  unsigned long long: "ullong", float: "float", double: "double", long double: "ldouble", float _Complex: "cfloat", \
  double _Complex: "cdouble", default: "other")
// Every check says which specifiers it is about and whether they name the type expected; the test compares that,
// line by line, with values.json.
#define IS(specifiers, name) do { specifiers object = 0; int holds = KIND(object)[0] == name[0] && KIND(object)[1] == name[1] && KIND(object)[2] == name[2]; checks++; wrong += !holds; printf("%s is %s => %d\n", #specifiers, name, holds); } while (0)

int main(void) {
  int checks = 0, wrong = 0;
  IS(char, "char"); IS(signed char, "schar"); IS(char signed, "schar"); IS(unsigned char, "uchar"); IS(char unsigned, "uchar");
  IS(short, "short"); IS(signed short, "short"); IS(short int, "short"); IS(signed short int, "short");
  IS(int short, "short"); IS(short signed, "short"); IS(int signed short, "short"); IS(short int signed, "short");
  IS(unsigned short, "ushort"); IS(unsigned short int, "ushort"); IS(short unsigned, "ushort"); IS(int unsigned short, "ushort"); IS(short int unsigned, "ushort");
  IS(int, "int"); IS(signed, "int"); IS(signed int, "int"); IS(int signed, "int");
  IS(unsigned, "uint"); IS(unsigned int, "uint"); IS(int unsigned, "uint");
  IS(long, "long"); IS(signed long, "long"); IS(long int, "long"); IS(signed long int, "long");
  IS(long signed, "long"); IS(int long, "long"); IS(int long signed, "long"); IS(long signed int, "long");
  IS(unsigned long, "ulong"); IS(unsigned long int, "ulong"); IS(long unsigned, "ulong"); IS(int unsigned long, "ulong"); IS(long int unsigned, "ulong");
  IS(long long, "llong"); IS(signed long long, "llong"); IS(long long int, "llong"); IS(signed long long int, "llong");
  IS(long signed long, "llong"); IS(long int long, "llong"); IS(int long long signed, "llong"); IS(long long signed int, "llong");
  IS(unsigned long long, "ullong"); IS(unsigned long long int, "ullong"); IS(long unsigned long, "ullong"); IS(long long unsigned, "ullong");
  IS(int long unsigned long, "ullong"); IS(long int long unsigned, "ullong");
  IS(float, "float"); IS(double, "double"); IS(long double, "ldouble"); IS(double long, "ldouble");
  IS(_Bool, "bool");
  IS(float _Complex, "cfloat"); IS(_Complex float, "cfloat"); IS(double _Complex, "cdouble"); IS(_Complex double, "cdouble");
  // Qualifiers, storage classes and alignment specifiers may be mixed in anywhere without changing the type named.
  IS(const unsigned volatile long int, "ulong"); IS(long const long unsigned, "ullong"); IS(static short unsigned const int, "ushort");
  IS(volatile char signed const, "schar"); IS(long _Alignas(16) double, "ldouble");
  // A typedef name, a structure, a union or an enumeration is a type specifier on its own.
  typedef unsigned long long wide;
  IS(wide, "ullong"); IS(const wide, "ullong"); IS(wide volatile, "ullong");
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
