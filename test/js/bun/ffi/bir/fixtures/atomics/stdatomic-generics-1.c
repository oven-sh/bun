#include <stdatomic.h>
         #include <stdbool.h>
         #ifdef __STDC_NO_ATOMICS__
         #error atomics are supported
         #endif
         #if ATOMIC_INT_LOCK_FREE != 2 || ATOMIC_POINTER_LOCK_FREE != 2 || ATOMIC_BOOL_LOCK_FREE != 2 || ATOMIC_LLONG_LOCK_FREE != 2
         #error lock free macros
         #endif
         _Static_assert(memory_order_relaxed == 0 && memory_order_consume == 1 && memory_order_acquire == 2
             && memory_order_release == 3 && memory_order_acq_rel == 4 && memory_order_seq_cst == 5, "orders");
         _Static_assert(__atomic_always_lock_free(sizeof(long long), 0) && !__atomic_always_lock_free(16, 0), "lock free");
         atomic_int shared = ATOMIC_VAR_INIT(40);
         atomic_uchar byte;
         atomic_short half;
         atomic_llong wide;
         atomic_size_t size;
         atomic_bool ready;
         atomic_uintptr_t address;
         _Atomic(const char *) text;
         static const char message[] = "atomic";
         int basics(void) {
             atomic_init(&byte, 200);
             atomic_store(&half, -2);
             atomic_store_explicit(&wide, 1LL << 40, memory_order_release);
             int a = atomic_load(&shared);
             int b = atomic_load_explicit(&byte, memory_order_acquire);
             int c = atomic_exchange(&half, 9);
             long long d = atomic_exchange_explicit(&wide, 3, memory_order_acq_rel);
             return a + b + c + (int)(d >> 40) + atomic_load(&half) + (int)atomic_load(&wide);
         }
         int fetches(void) {
             atomic_store(&shared, 100);
             int a = atomic_fetch_add(&shared, 5);
             int b = atomic_fetch_sub_explicit(&shared, 10, memory_order_relaxed);
             int c = atomic_fetch_or(&shared, 0x100);
             int d = atomic_fetch_and_explicit(&shared, 0x1f0, memory_order_seq_cst);
             int e = atomic_fetch_xor(&shared, 0xff);
             atomic_store(&byte, 255);
             int f = atomic_fetch_add(&byte, 3);
             return a + b + c + d + e + atomic_load(&shared) + f * 1000 + atomic_load(&byte) * 100000;
         }
         int pointer_arithmetic(void) {
             atomic_store(&text, message);
             const char *old = atomic_fetch_add(&text, 2);
             const char *now = atomic_fetch_sub(&text, 1);
             return (old == message) + (now == message + 2) * 10 + *atomic_load(&text) * 100;
         }
         int compare(int current, int guess, int replacement) {
             atomic_store(&shared, current);
             int expected = guess;
             bool strong = atomic_compare_exchange_strong(&shared, &expected, replacement);
             int after_strong = expected;
             bool weak = atomic_compare_exchange_weak_explicit(&shared, &expected, replacement + 1, memory_order_acq_rel, memory_order_acquire);
             return strong * 1000000 + weak * 100000 + after_strong * 1000 + expected * 10 + (atomic_load(&shared) == replacement + 1);
         }
         int misc(void) {
             atomic_thread_fence(memory_order_seq_cst);
             atomic_thread_fence(memory_order_acquire);
             atomic_signal_fence(memory_order_release);
             atomic_store(&ready, 7);
             atomic_store(&size, sizeof(shared));
             atomic_store(&address, (uintptr_t)&shared);
             int order = 5;
             atomic_store_explicit(&shared, 3, order);
             return atomic_is_lock_free(&wide) + atomic_load(&ready) * 10 + (int)atomic_load(&size) * 100
                 + (atomic_load(&address) == (uintptr_t)&shared) * 1000 + kill_dependency(atomic_load(&shared)) * 10000;
         }
         static atomic_flag guard = ATOMIC_FLAG_INIT;
         int flags(void) {
             bool first = atomic_flag_test_and_set(&guard);
             bool second = atomic_flag_test_and_set_explicit(&guard, memory_order_acquire);
             atomic_flag_clear(&guard);
             bool third = atomic_flag_test_and_set(&guard);
             atomic_flag_clear_explicit(&guard, memory_order_release);
             return first * 100 + second * 10 + third;
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)basics());
  printf("%d\n", (int)fetches());
  printf("%d\n", (int)pointer_arithmetic());
  printf("%d\n", (int)compare(8, 8, 20));
  printf("%d\n", (int)compare(8, 5, 20));
  printf("%d\n", (int)misc());
  printf("%d\n", (int)flags());
  printf("%d\n", (int)flags());
  return 0;
}
