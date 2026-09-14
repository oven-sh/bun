// The attributes the compiler knows by name, each on the kind of declaration it belongs to: the ones that are
// implemented do what they say, and the ones that only describe the code leave it alone.
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define A(...) __attribute__((__VA_ARGS__))

// On functions: what the optimizer, the analyzers or the linker may assume.
static A(always_inline) inline int always(int x) { return x + 1; }
static A(noinline) int never_inlined(int x) { return x + 2; }
static A(__noinline__, __noclone__, noipa) int three_at_once(int x) { return x + 3; }
static A(pure) int is_pure(const int *p) { return *p * 2; }
static A(const) int is_const(int x) { return x * 3; }
static A(cold) int is_cold(void) { return 4; }
static A(hot) int is_hot(void) { return 5; }
static A(flatten) int flattened(int x) { return always(x) + never_inlined(x); }
static A(leaf, nothrow) int leafy(void) { return 6; }
static A(malloc, alloc_size(1), assume_aligned(8), returns_nonnull, warn_unused_result) void *allocate(size_t n) { return malloc(n); }
static A(alloc_size(1, 2), alloc_align(3)) void *allocate_many(size_t n, size_t each, size_t alignment) { (void)alignment; return calloc(n, each); }
static A(nonnull(1), access(read_only, 1)) size_t length(const char *s) { return strlen(s); }
static A(nonnull) int first_of(const int *p) { return *p; }
static A(format(printf, 2, 3)) int say(char *out, const char *how, ...) { (void)how; out[0] = 'k'; out[1] = 0; return 1; }
static A(format_arg(1)) const char *translate(const char *how) { return how; }
static A(sentinel) int count_until_null(const char *first, ...) { return first != 0; }
static A(deprecated) int old_way(void) { return 7; }
static A(deprecated("use the new way")) int older_way(void) { return 8; }
static A(unavailable_is_not_used_here_but_unused_is, unused) int not_called(void) { return 9; }
static A(used) int kept_for_the_linker(void) { return 10; }
static A(noreturn) void leaves(void) { exit(0); }
static A(returns_twice) int like_setjmp(void) { return 0; }
static A(no_instrument_function, no_sanitize_address, no_sanitize_thread, no_sanitize_undefined, no_stack_protector, no_split_stack) int uninstrumented(int x) { return x; }
static A(no_sanitize("address")) int also_uninstrumented(int x) { return x; }
static A(optimize("O2")) int optimized(int x) { return x * 2; }
static A(artificial, gnu_inline, always_inline) inline int wrapper(int x) { return x; }
static A(visibility("hidden")) int hidden(void) { return 11; }
A(visibility("default"), externally_visible) int exported(void) { return 12; }
static A(warning("calling this is a warning in GCC")) int warned_about(void);
static A(error("calling this is an error in GCC")) int refused(void);
static A(constructor) void before_main(void);
static A(destructor) void after_main(void) { }
static A(constructor(200)) void before_main_with_priority(void);
static int order[2], ordered;
static void before_main(void) { order[ordered++] = 2; }
static void before_main_with_priority(void) { order[ordered++] = 1; }
static A(tainted_args, zero_call_used_regs("skip"), patchable_function_entry(0), null_terminated_string_arg(1)) int hardened(const char *s) { return s[0]; }
static A(stack_protect, no_reorder, no_icf, retain) int placed(void) { return 13; }
static A(simd) double lanes(double x) { return x + 0.5; }
static A(fd_arg(1)) int takes_descriptor(int fd) { return fd; }
static A(minsize, optnone, noinline) int small_and_slow(int x) { return x; }
static A(disable_tail_calls, nodebug, no_profile_instrument_function) int plain_call(int x) { return small_and_slow(x); }

// On variables and members: alignment, placement, initialization, cleanup.
static A(aligned(64)) char over_aligned[3];
static A(aligned) char as_aligned_as_anything[3];
static A(unused) int never_read;
static A(used) int kept = 14;
static A(common) int in_common;
static A(nocommon) int not_in_common;
static A(nonstring) char no_terminator[4] = "abcd";
A(weak) int weak_object = 15;
static A(tls_model("initial-exec")) __thread int thread_object = 16;
static int checked_alignment;
struct checked { A(warn_if_not_aligned(4)) int member; };
static int cleaned;
static void cleaner(int *p) { cleaned += *p; }
static int with_cleanup(void) { A(cleanup(cleaner)) int local = 5; A(uninitialized) int junk; (void)junk; return local; }
static A(mode(QI)) int one_byte; static A(mode(HI)) int two_bytes; static A(mode(SI)) long four_bytes; static A(mode(DI)) int eight_bytes; static A(__mode__(__word__)) int word; static A(mode(pointer)) int pointer_sized;

// On types: layout.
struct A(packed) packed { char c; int i; };
struct A(aligned(32)) aligned_type { char c; };
struct members { char c; A(packed) int squeezed; A(aligned(16)) char apart; };
typedef int A(aligned(1)) underaligned_int;
typedef int A(may_alias) aliasing_int;
typedef int A(vector_size(16)) four_ints;
typedef float A(ext_vector_type(4)) four_floats_clang_way_is_skipped_by_gcc;
union A(transparent_union) either { int *ints; float *floats; };
static int through_union(union either u) { return *u.ints; }
struct A(designated_init) only_designated { int a, b; };
enum A(flag_enum, enum_extensibility(open)) flags { FLAG_A = 1, FLAG_B = 2 };
enum with_deprecated_member { CURRENT, OUTDATED A(deprecated) };
struct A(ms_struct) microsoft_layout { char c; int bits : 3; };
struct A(gcc_struct) gnu_layout { char c; int bits : 3; };
struct counted { int n; int values[] A(counted_by(n)); };
struct A(warn_unused_result) result_type { int v; };

int main(void) {
  int n = 7;
  printf("%d %d %d %d %d %d %d %d %d\n", always(1), never_inlined(1), three_at_once(1), is_pure(&n), is_const(2), is_cold(), is_hot(), flattened(1), leafy());
  void *block = allocate(16), *blocks = allocate_many(2, 8, 8);
  char said[4];
  printf("%d %d %d %d %d %s %s %d\n", block != 0, blocks != 0, (int)length("four"), first_of(&n), say(said, "%d", 1), said, translate("x"), count_until_null("a", "b", (char *)0));
  free(block); free(blocks);
  printf("%d %d %d %d %d %d %d\n", old_way(), older_way(), kept_for_the_linker(), like_setjmp(), uninstrumented(1) + also_uninstrumented(1), optimized(2), wrapper(3));
  printf("%d %d %d%d %d %d %.1f %d %d\n", hidden(), exported(), order[0], order[1], hardened("h") == 'h', placed(), lanes(1.0), takes_descriptor(3), plain_call(4));
  printf("%d %d %d %d %d\n", (int)((size_t)over_aligned % 64), (int)((size_t)as_aligned_as_anything % _Alignof(max_align_t)), kept + weak_object + thread_object, no_terminator[3] == 'd', in_common + not_in_common + checked_alignment);
  int from_cleanup = with_cleanup();
  printf("%d %d\n", from_cleanup, cleaned);
  printf("%d %d %d %d %d %d\n", (int)sizeof one_byte, (int)sizeof two_bytes, (int)sizeof four_bytes, (int)sizeof eight_bytes, (int)sizeof word == (int)sizeof(void *), (int)sizeof pointer_sized == (int)sizeof(void *));
  printf("%d %d %d %d %d %d\n", (int)sizeof(struct packed), (int)_Alignof(struct aligned_type), (int)offsetof(struct members, squeezed), (int)offsetof(struct members, apart), (int)_Alignof(underaligned_int), (int)sizeof(four_ints));
  aliasing_int through = 5;
  struct only_designated designated = {.a = 1, .b = 2};
  struct counted *flexible = malloc(sizeof *flexible + 2 * sizeof(int));
  flexible->n = 2; flexible->values[1] = 9;
  printf("%d %d %d %d %d %d\n", through_union(&n) + through_union((union either)&n), through + designated.b, FLAG_A | FLAG_B, CURRENT, flexible->values[1], (int)sizeof(struct microsoft_layout) >= (int)sizeof(struct gnu_layout));
  free(flexible);
  (void)never_read; (void)not_called;
  if (n == 0) leaves();
  return 0;
}
