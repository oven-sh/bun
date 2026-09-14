// The arguments of an attribute are any balanced sequence of tokens: version numbers with two dots, names with
// equals signs, strings that look like Swift. The ones nobody here reads must be skipped as they are, in every
// spelling a system header writes them (these are Apple's and Microsoft's, written out so that no SDK is needed;
// GCC does not know them, so only Clang says the same).
#include <stdio.h>

#define __API_AVAILABLE_macos(x) macos,introduced=x
#define __API_A(x) __attribute__((availability(__API_AVAILABLE_##x)))
#define API_AVAILABLE(x) __API_A(x)
#define __OSX_AVAILABLE_STARTING(_osx, _ios) __attribute__((availability(macosx,introduced=_osx)))
#define __MAC_10_0 10.0
#define __MAC_10_13_4 10.13.4
#define API_UNAVAILABLE(x) __attribute__((availability(x,unavailable)))
#define NS_SWIFT_NAME(name) __attribute__((swift_name(#name)))

int since_a_version(void) __attribute__((availability(macos,introduced=10.13.4)));
int deprecated_too(void) __attribute__((availability(macos,introduced=10.4,deprecated=10.6,message="use something else")));
int several_platforms(void) __attribute__((availability(macos,introduced=10.13.4))) __attribute__((availability(ios,introduced=11.3))) __attribute__((availability(watchos,unavailable)));
int through_macros(void) API_AVAILABLE(macos(10.13.4));
int starting(void) __OSX_AVAILABLE_STARTING(__MAC_10_13_4, __IPHONE_2_0);
int unavailable_elsewhere(void) API_UNAVAILABLE(tvos);
int with_swift_name(int a, int b) __attribute__((swift_name("Thing.combine(_:with:)")));
int renamed(void) NS_SWIFT_NAME(Thing.value(self:));
int external(void) __attribute__((external_source_symbol(language="Swift", defined_in="Module", generated_declaration)));
int checked(int x) __attribute__((diagnose_if(x > 1000, "too big", "warning")));
[[clang::availability(macos, introduced=11.2.3)]] int bracketed(void);
enum __attribute__((enum_extensibility(open))) choices { FIRST __attribute__((availability(macos,introduced=10.15.1))) = 1, SECOND __attribute__((swift_name("second"))) };
struct versioned { int old_field __attribute__((availability(macos,introduced=10.0,obsoleted=12.0.1))); int new_field; };
typedef int since_typedef __attribute__((availability(macos,introduced=10.9.5)));
extern int a_variable __attribute__((availability(macos,introduced=10.1.2))) __attribute__((visibility("default")));
__attribute__((availability(swift, unavailable, message="not from Swift"))) int decorated(void);
#ifdef _MSC_VER
__declspec(deprecated("since 1.2.3, use " "another")) __declspec(uuid("12345678-1234-1234-1234-123456789abc")) int microsoft(void);
#else
int microsoft(void);
#endif

int since_a_version(void) { return 1; }
int deprecated_too(void) { return 2; }
int several_platforms(void) { return 3; }
int through_macros(void) { return 4; }
int starting(void) { return 5; }
int unavailable_elsewhere(void) { return 6; }
int with_swift_name(int a, int b) { return a + b; }
int renamed(void) { return 8; }
int external(void) { return 9; }
int checked(int x) { return x; }
int bracketed(void) { return 11; }
int a_variable = 12;
int decorated(void) { return 13; }
int microsoft(void) { return 14; }

int main(void) {
  struct versioned v = {1, 2};
  since_typedef t = 3;
  printf("%d %d %d %d %d %d %d %d %d %d %d %d %d %d\n", since_a_version(), deprecated_too(), several_platforms(), through_macros(), starting(), unavailable_elsewhere(),
         with_swift_name(3, 4), renamed(), external(), checked(10), bracketed(), a_variable, decorated(), microsoft());
  printf("%d %d %d %d\n", FIRST, SECOND, v.old_field + v.new_field, t);
  // Where a number is wanted, a token like 10.13.4 is still an error: but only there. (See the diagnostics.)
  return 0;
}
