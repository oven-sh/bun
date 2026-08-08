/* ----------------------------------------------------------------------------
Copyright (c) 2018-2026, Microsoft Research, Daan Leijen
This is free software; you can redistribute it and/or modify it under the
terms of the MIT license. A copy of the license can be found in the file
"LICENSE" at the root of this distribution.
-----------------------------------------------------------------------------*/
#pragma once
#ifndef MI_INTERNAL_H
#define MI_INTERNAL_H

// --------------------------------------------------------------------------
// This file contains the internal API's of mimalloc and various utility
// functions and macros.
// --------------------------------------------------------------------------

#include "types.h"
#include "track.h"
#include "bits.h"


// --------------------------------------------------------------------------
// Compiler defines
// --------------------------------------------------------------------------

#if (MI_DEBUG>0)
#define mi_trace_message(...)  _mi_trace_message(__VA_ARGS__)
#else
#define mi_trace_message(...)
#endif

#define mi_decl_cache_align     mi_decl_align(64)

#if defined(_MSC_VER)
#pragma warning(disable:4127)   // suppress constant conditional warning (due to MI_SECURE paths)
#pragma warning(disable:26812)  // unscoped enum warning
#define mi_decl_forceinline     __forceinline
#define mi_decl_noinline        __declspec(noinline)
#define mi_decl_thread          __declspec(thread)
#define mi_decl_noreturn        __declspec(noreturn)
#define mi_decl_weak
#define mi_decl_hidden
#define mi_decl_cold
#define mi_decl_unused
#elif (defined(__GNUC__) && (__GNUC__ >= 3)) || defined(__clang__) // includes clang and icc
#if !MI_TRACK_ASAN
#define mi_decl_forceinline     __attribute__((always_inline)) inline
#else
#define mi_decl_forceinline     inline
#endif
#define mi_decl_noinline        __attribute__((noinline))
#define mi_decl_thread          __thread
#define mi_decl_noreturn        __attribute__((noreturn))
#define mi_decl_weak            __attribute__((weak))
#define mi_decl_hidden          __attribute__((visibility("hidden")))
#define mi_decl_unused          __attribute__((unused))
#if (__GNUC__ >= 4) || defined(__clang__)
#define mi_decl_cold            __attribute__((cold))
#else
#define mi_decl_cold
#endif
#elif __cplusplus >= 201103L    // c++11
#define mi_decl_forceinline     inline
#define mi_decl_noinline
#define mi_decl_thread          thread_local
#define mi_decl_noreturn        [[noreturn]]
#define mi_decl_weak
#define mi_decl_hidden
#define mi_decl_cold
#if __cplusplus >= 201703L    // c++17
#define mi_decl_unused          [[maybe_unused]]
#else
#define mi_decl_unused
#endif
#else
#define mi_decl_forceinline     inline
#define mi_decl_noinline
#define mi_decl_thread          __thread        // hope for the best :-)
#define mi_decl_noreturn
#define mi_decl_weak
#define mi_decl_hidden
#define mi_decl_cold
#define mi_decl_unused
#endif

#if defined(__GNUC__) || defined(__clang__)
#define mi_unlikely(x)     (__builtin_expect(!!(x),false))
#define mi_likely(x)       (__builtin_expect(!!(x),true))
#elif (defined(__cplusplus) && (__cplusplus >= 202002L)) || (defined(_MSVC_LANG) && _MSVC_LANG >= 202002L)
#define mi_unlikely(x)     (x) [[unlikely]]
#define mi_likely(x)       (x) [[likely]]
#else
#define mi_unlikely(x)     (x)
#define mi_likely(x)       (x)
#endif

#ifndef __has_builtin
#define __has_builtin(x)    0
#endif

#if defined(__cplusplus)
#define mi_decl_externc     extern "C"
#else
#define mi_decl_externc
#endif

#if (defined(__GNUC__) && (__GNUC__ >= 7)) || defined(__clang__) // includes clang and icc
#define mi_decl_maybe_unused    __attribute__((unused))
#elif __cplusplus >= 201703L    // c++17
#define mi_decl_maybe_unused    [[maybe_unused]]
#else
#define mi_decl_maybe_unused
#endif

#if defined(__cplusplus)
#define mi_decl_externc         extern "C"
#else
#define mi_decl_externc
#endif


#if defined(__EMSCRIPTEN__) && !defined(__wasi__)
#define __wasi__
#endif


// --------------------------------------------------------------------------
// Internal functions
// --------------------------------------------------------------------------


// "libc.c"
#include <stdarg.h>
int           _mi_vsnprintf(char* buf, size_t bufsize, const char* fmt, va_list args);
int           _mi_snprintf(char* buf, size_t buflen, const char* fmt, ...);
char          _mi_toupper(char c);
int           _mi_strnicmp(const char* s, const char* t, size_t n);
void          _mi_strlcpy(char* dest, const char* src, size_t dest_size);
void          _mi_strlcat(char* dest, const char* src, size_t dest_size);
size_t        _mi_strlen(const char* s);
size_t        _mi_strnlen(const char* s, size_t max_len);
char*         _mi_strnstr(char* s, size_t max_len, const char* pat);
bool          _mi_streq(const char* s, const char* t);
int           _mi_getenv(const char* name, char* result, size_t result_size);

// "options.c"
void          _mi_fputs(mi_output_fun* out, void* arg, const char* prefix, const char* message);
void          _mi_fprintf(mi_output_fun* out, void* arg, const char* fmt, ...);
void          _mi_raw_message(const char* fmt, ...);
void          _mi_message(const char* fmt, ...);
void          _mi_warning_message(const char* fmt, ...);
void          _mi_verbose_message(const char* fmt, ...);
void          _mi_trace_message(const char* fmt, ...);
void          _mi_options_init(void);
void          _mi_options_post_init(void);
long          _mi_option_get_fast(mi_option_t option);
void          _mi_error_message(int err, const char* fmt, ...);

// random.c
void          _mi_random_init(mi_random_ctx_t* ctx);
void          _mi_random_init_weak(mi_random_ctx_t* ctx);
void          _mi_random_reinit_if_weak(mi_random_ctx_t * ctx);
void          _mi_random_split(mi_random_ctx_t* ctx, mi_random_ctx_t* new_ctx);
uintptr_t     _mi_random_next(mi_random_ctx_t* ctx);
uintptr_t     _mi_theap_random_next(mi_theap_t* theap);
uintptr_t     _mi_os_random_weak(uintptr_t extra_seed);
static inline uintptr_t _mi_random_shuffle(uintptr_t x);

// init.c
extern mi_decl_hidden mi_decl_cache_align const mi_page_t  _mi_page_empty;
void          _mi_auto_process_init(void);
void mi_cdecl _mi_auto_process_done(void) mi_attr_noexcept;
bool          _mi_is_redirected(void);
bool          _mi_allocator_init(const char** message);
void          _mi_allocator_done(void);
bool          _mi_is_main_thread(void);
bool          _mi_is_process_heap_main(const mi_heap_t* heap);
bool          _mi_preloading(void);           // true while the C runtime is not initialized yet
void          _mi_thread_done(mi_theap_t* theap);
mi_theap_t*   _mi_thread_init(void);
bool          _mi_is_empty_theap(const mi_theap_t* theap);

mi_subproc_t* _mi_subproc(void);
mi_subproc_t* _mi_subproc_main(void);
void          _mi_process_fork_prepare(void);
extern mi_decl_hidden bool _mi_process_is_forked_child;
void          _mi_process_fork_parent(void);
void          _mi_process_fork_child(void);
void          _mi_thread_locals_fork_prepare(void);
void          _mi_thread_locals_fork_parent(void);
void          _mi_thread_locals_fork_child(void);
mi_heap_t*    _mi_subproc_heap_main(mi_subproc_t* subproc);
mi_subproc_t* _mi_subproc_from_id(mi_subproc_id_t subproc_id);

mi_threadid_t _mi_thread_id(void) mi_attr_noexcept;
size_t        _mi_thread_seq_id(void) mi_attr_noexcept;
bool          _mi_is_theap_main(const mi_theap_t* theap);
void          _mi_theap_guarded_init(mi_theap_t* theap);
void          _mi_theap_options_init(mi_theap_t* theap);

// os.c
void          _mi_os_init(void);                                            // called from process init
void*         _mi_os_alloc(mi_subproc_t* subproc, size_t size, mi_memid_t* memid);
void*         _mi_os_zalloc(mi_subproc_t* subproc, size_t size, mi_memid_t* memid);
void          _mi_os_free(mi_subproc_t* subproc, void* p, size_t size, mi_memid_t memid);
void          _mi_os_free_ex(mi_subproc_t* subproc, void* p, size_t size, bool still_committed, mi_memid_t memid );

size_t        _mi_os_page_size(void);
size_t        _mi_os_guard_page_size(void);
size_t        _mi_os_good_alloc_size(size_t size);
bool          _mi_os_has_overcommit(void);
bool          _mi_os_has_virtual_reserve(void);
size_t        _mi_os_virtual_address_bits(void);
size_t        _mi_os_minimal_purge_size(void);

bool          _mi_os_reset(mi_subproc_t* subproc, void* addr, size_t size);
bool          _mi_os_decommit(mi_subproc_t* subproc, void* addr, size_t size);
void          _mi_os_reuse(mi_subproc_t* subproc, void* p, size_t size);
mi_decl_nodiscard bool _mi_os_commit(mi_subproc_t* subproc, void* p, size_t size, bool* is_zero);
mi_decl_nodiscard bool _mi_os_commit_ex(mi_subproc_t* subproc, void* addr, size_t size, bool* is_zero, size_t stat_size);
mi_decl_nodiscard bool _mi_os_protect(void* addr, size_t size);
bool          _mi_os_unprotect(void* addr, size_t size);
bool          _mi_os_purge(mi_subproc_t* subproc, void* p, size_t size);
bool          _mi_os_purge_zero(mi_subproc_t* subproc, void* p, size_t size, size_t stat_size, bool* is_zero);
bool          _mi_os_purge_ex(mi_subproc_t* subproc, void* p, size_t size, bool allow_reset, size_t stats_size, mi_commit_fun_t* commit_fun, void* commit_fun_arg);
bool          _mi_os_discard(mi_subproc_t* subproc, void* p, size_t size);

size_t        _mi_os_secure_guard_page_size(void);
bool          _mi_os_secure_guard_page_set_at(mi_subproc_t* subproc, void* addr, mi_memid_t memid);
bool          _mi_os_secure_guard_page_set_before(mi_subproc_t* subproc, void* addr, mi_memid_t memid);
bool          _mi_os_secure_guard_page_reset_at(mi_subproc_t* subproc, void* addr, mi_memid_t memid);
bool          _mi_os_secure_guard_page_reset_before(mi_subproc_t* subproc, void* addr, mi_memid_t memid);

int           _mi_os_numa_node(void);
int           _mi_os_numa_node_count(void);

void*         _mi_os_alloc_aligned(mi_subproc_t* subproc, size_t size, size_t alignment, bool commit, bool allow_large, mi_memid_t* memid);
void*         _mi_os_alloc_aligned_at_offset(mi_subproc_t* subproc, size_t size, size_t alignment, size_t align_offset, bool commit, bool allow_large, mi_memid_t* memid);

void*         _mi_os_get_aligned_hint(size_t try_alignment, size_t size);
bool          _mi_os_canuse_large_page(size_t size, size_t alignment);
size_t        _mi_os_large_page_size(void);
void*         _mi_os_alloc_huge_os_pages(mi_subproc_t* subproc, size_t pages, int numa_node, mi_msecs_t max_secs, size_t* pages_reserved, size_t* psize, mi_memid_t* memid);

// threadlocal.c
#define mi_thread_local_key_fast  ((mi_thread_local_t)1)

mi_thread_local_t _mi_thread_local_create(void);
void          _mi_thread_local_free( mi_thread_local_t key );
bool          _mi_thread_local_set(  mi_thread_local_t key, void* val );
void*         _mi_thread_local_get(  mi_thread_local_t key );
void          _mi_thread_locals_init(void);
void          _mi_thread_locals_done(void);
void          _mi_thread_locals_thread_done(void);

// arena.c
mi_arena_id_t _mi_arena_id_none(void);
mi_arena_t*   _mi_arena_from_id(mi_arena_id_t id);
bool          _mi_arena_memid_is_suitable(mi_memid_t memid, mi_arena_t* request_arena);

void*         _mi_arenas_alloc(mi_heap_t* heap, size_t size, bool commit, bool allow_pinned, mi_arena_t* req_arena, size_t tseq, int numa_node, mi_memid_t* memid);
void*         _mi_arenas_alloc_aligned(mi_heap_t* heap, size_t size, size_t alignment, size_t align_offset, bool commit, bool allow_pinned, mi_arena_t* req_arena, size_t tseq, int numa_node, mi_memid_t* memid);
void          _mi_arenas_free(mi_subproc_t* subproc, void* p, size_t size, mi_memid_t memid);
bool          _mi_arenas_contain(const void* p);
void          _mi_arenas_collect(bool force_purge, bool visit_all, mi_tld_t* tld);
void          _mi_arenas_purge_abandoned_holes(mi_heap_t* heap, mi_tld_t* tld);
void          _mi_arenas_try_purge(bool force, bool visit_all, mi_subproc_t* subproc, size_t tseq);
void          _mi_arenas_unsafe_destroy_all(mi_subproc_t* subproc);

mi_page_t*    _mi_arenas_page_alloc(mi_theap_t* theap, size_t block_size, size_t page_alignment);
void          _mi_arenas_page_free(mi_page_t* page, mi_theap_t* current_theapx /* can be NULL */);
void          _mi_arenas_page_abandon(mi_page_t* page, mi_theap_t* current_theap);
void          _mi_arenas_page_unabandon(mi_page_t* page, mi_theap_t* current_theapx /* can be NULL */);
bool          _mi_arenas_page_try_reabandon_to_mapped(mi_page_t* page);
size_t        mi_arenas_get_count(mi_subproc_t* subproc);
uint8_t*      mi_arena_slice_start(mi_arena_t* arena, size_t slice_index);

// heap-snapshot.c
void          _mi_heap_snapshot_on_exit(void);

// prof.c
void          _mi_prof_sample(mi_theap_t* theap, mi_page_t* page, void* p, size_t req_size);
void          _mi_prof_free(const void* p);
void          _mi_prof_init(void);
void          _mi_prof_theap_init(mi_theap_t* theap);

// scavenger.c
void          _mi_scavenger_start(void);
void          _mi_scavenger_forked_child(void);
void          _mi_scavenger_start_if_forked(void);
void          _mi_scavenger_stop(void);
void          _mi_scavenger_wake(mi_subproc_t* subproc);
bool          _mi_scavenger_is_running(void);
void          _mi_arenas_purge_now(mi_subproc_t* subproc);
void          _mi_prof_theap_lazy_enable(mi_theap_t* theap);
size_t        _mi_prof_rate(void);
void          _mi_prof_on_exit(void);

// arena-meta.c
void*         _mi_meta_zalloc( mi_subproc_t* subproc, size_t size, mi_memid_t* memid );
void          _mi_meta_free(mi_subproc_t* subproc, void* p, size_t size, mi_memid_t memid);
bool          _mi_meta_is_meta_page(mi_subproc_t* subproc, void* p);

// "page-map.c"
bool          _mi_page_map_init(void);
mi_decl_nodiscard bool _mi_page_map_register(mi_page_t* page);
void          _mi_page_map_unregister(mi_page_t* page);
void          _mi_page_map_unregister_range(void* start, size_t size);
mi_page_t*    _mi_safe_ptr_page(const void* p);
void          _mi_page_map_unsafe_destroy(void);

// "page.c"
void*         _mi_malloc_generic(mi_theap_t* theap, size_t size, size_t zero_huge_alignment, size_t* usable)  mi_attr_noexcept mi_attr_malloc;

void          _mi_page_retire(mi_page_t* page) mi_attr_noexcept;       // free the page if there are no other pages with many free blocks
void          _mi_page_unfull(mi_page_t* page);
void          _mi_page_free(mi_page_t* page, mi_page_queue_t* pq);     // free the page
void          _mi_page_abandon(mi_page_t* page, mi_page_queue_t* pq);  // abandon the page, to be picked up by another thread...

size_t        _mi_page_queue_append(mi_theap_t* theap, mi_page_queue_t* pq, mi_page_queue_t* append);
void          _mi_deferred_free(mi_theap_t* theap, bool force);

void          _mi_page_free_collect(mi_page_t* page, bool force);
void          _mi_page_free_collect_no_unpurge(mi_page_t* page, bool force);   // for read-only heap inspection: never un-purges a hole
void          _mi_page_free_collect_partly(mi_page_t* page, mi_block_t* head);
mi_decl_nodiscard bool _mi_page_init(mi_theap_t* theap, mi_page_t* page);
bool          _mi_page_queue_is_valid(mi_theap_t* theap, const mi_page_queue_t* pq);

size_t        _mi_page_stats_bin(const mi_page_t* page); // for stats
size_t        _mi_bin_size(size_t bin);                  // for stats
size_t        _mi_bin(size_t size);                      // for stats

// "theap.c"
mi_theap_t*   _mi_theap_create(mi_heap_t* heap, mi_tld_t* tld);
void          _mi_theap_delete(mi_theap_t* theap, bool acquire_tld_theaps_lock);
void          _mi_theap_default_set(mi_theap_t* theap);
void          _mi_theap_cached_set(mi_theap_t* theap);
void          _mi_theap_collect_retired(mi_theap_t* theap, bool force);
void          _mi_theap_collect_abandon(mi_theap_t* theap);
// May the calling thread touch the owner-only state of `theap` (its plain free lists, page
// queues and non-atomic stats)? Either we own it, or its owner parked and handed it to us for
// the duration of a sweep (see `mi_on_thread_idle_start`). Both mean: no concurrent owner.
static inline bool _mi_theap_can_touch(const mi_theap_t* theap) {
  if (theap == NULL || theap->tld == NULL) return true;
  if (theap->tld->thread_id == _mi_thread_id()) return true;
  return (mi_atomic_load_acquire(&theap->tld->park_state) == MI_PARK_SWEEPING);
}

void          _mi_thread_idle_work(mi_tld_t* tld, mi_theap_t* theap0) mi_attr_noexcept;
void          _mi_theap_sweep_parked(mi_subproc_t* subproc);
void          _mi_park_leave(mi_tld_t* tld);
void          _mi_scavenger_forked_child(void);
bool          _mi_theap_area_visit_blocks(const mi_heap_area_t* area, mi_page_t* page, mi_block_visit_fun* visitor, void* arg);
void          _mi_theap_page_reclaim(mi_theap_t* theap, mi_page_t* page);
bool          _mi_theap_free(mi_theap_t* theap, bool acquire_heap_theaps_lock, bool acquire_tld_theaps_lock);
void          _mi_theap_incref(mi_theap_t* theap);
void          _mi_theap_decref(mi_theap_t* theap);
bool          _mi_page_visit_blocks( mi_page_t* page, mi_block_visit_fun* visitor, void* arg );

// "heap.c"
void          _mi_heap_area_init(mi_heap_area_t* area, mi_page_t* page);
mi_decl_cold  mi_theap_t* _mi_heap_theap_get_or_init(const mi_heap_t* heap);  // get (and possible create) the theap belonging to a heap
void          _mi_heap_move_pages(mi_heap_t* heap_from, mi_heap_t* heap_to);  // in "arena.c"
void          _mi_heap_destroy_pages(mi_heap_t* heap_from);                   // in "arena.c"
void          _mi_heap_force_destroy(mi_heap_t* heap);                        // allow destroying the main heap
mi_heap_t*    _mi_heap_new_for_subproc(mi_subproc_t* subproc, mi_arena_id_t exclusive_arena_id, bool is_heap_main);
bool          _mi_heap_theap_set(mi_heap_t* heap, mi_theap_t* theap);

// "stats.c"
void          _mi_stats_init(void);
void          _mi_stats_merge_into(mi_stats_t* to, mi_stats_t* from);

mi_msecs_t    _mi_clock_now(void);
mi_msecs_t    _mi_clock_end(mi_msecs_t start);
mi_msecs_t    _mi_clock_start(void);

// "alloc.c"
void*         _mi_page_malloc_zero(mi_theap_t* theap, mi_page_t* page, size_t size, bool zero) mi_attr_noexcept;                  // called from `_mi_theap_malloc_aligned`
void*         _mi_theap_malloc_zero(mi_theap_t* theap, size_t size, bool zero, size_t* usable) mi_attr_noexcept;
void*         _mi_theap_malloc_zero_ex(mi_theap_t* theap, size_t size, bool zero, size_t huge_alignment, size_t* usable) mi_attr_noexcept;     // called from `_mi_theap_malloc_aligned`
void*         _mi_theap_realloc_zero(mi_theap_t* theap, void* p, size_t newsize, bool zero, size_t* usable_pre, size_t* usable_post) mi_attr_noexcept;
mi_block_t*   _mi_page_ptr_unalign(const mi_page_t* page, const void* p);
void          _mi_padding_shrink(const mi_page_t* page, const mi_block_t* block, const size_t min_size);

// "free.c"
void          _mi_free_subproc_safe(void* p);
void          _mi_page_unguard_all(mi_page_t* page);

#if MI_DEBUG>1
bool          _mi_page_is_valid(mi_page_t* page);
#endif


// ------------------------------------------------------
// Assertions
// ------------------------------------------------------

#if (MI_DEBUG)
// use our own assertion to print without memory allocation
mi_decl_noreturn mi_decl_cold void _mi_assert_fail(const char* assertion, const char* fname, unsigned int line, const char* func) mi_attr_noexcept;
#define mi_assert(expr)     ((expr) ? (void)0 : _mi_assert_fail(#expr,__FILE__,__LINE__,__func__))
#else
#define mi_assert(x)
#endif

#if (MI_DEBUG>1)
#define mi_assert_internal    mi_assert
#else
#define mi_assert_internal(x)
#endif

#if (MI_DEBUG>2)
#define mi_assert_expensive   mi_assert
#else
#define mi_assert_expensive(x)
#endif


/* -----------------------------------------------------------
  Statistics (in `stats.c`)
----------------------------------------------------------- */

// add to stat keeping track of the peak
void __mi_stat_increase(mi_stat_count_t* stat, size_t amount);
void __mi_stat_decrease(mi_stat_count_t* stat, size_t amount);
void __mi_stat_increase_mt(mi_stat_count_t* stat, size_t amount);
void __mi_stat_decrease_mt(mi_stat_count_t* stat, size_t amount);

// adjust stat in special cases to compensate for double counting (and does not adjust peak values and can decrease the total)
void __mi_stat_adjust_increase(mi_stat_count_t* stat, size_t amount);
void __mi_stat_adjust_decrease(mi_stat_count_t* stat, size_t amount);
void __mi_stat_adjust_increase_mt(mi_stat_count_t* stat, size_t amount);
void __mi_stat_adjust_decrease_mt(mi_stat_count_t* stat, size_t amount);

// counters can just be increased
void __mi_stat_counter_increase(mi_stat_counter_t* stat, size_t amount);
void __mi_stat_counter_increase_mt(mi_stat_counter_t* stat, size_t amount);

#define mi_heap_stat_counter_increase(heap,stat,amount)         __mi_stat_counter_increase_mt( &(heap)->stats.stat, amount)
#define mi_heap_stat_increase(heap,stat,amount)                 __mi_stat_increase_mt( &(heap)->stats.stat, amount)
#define mi_heap_stat_decrease(heap,stat,amount)                 __mi_stat_decrease_mt( &(heap)->stats.stat, amount)
#define mi_heap_stat_adjust_increase(heap,stat,amnt)            __mi_stat_adjust_increase_mt( &(heap)->stats.stat, amnt)
#define mi_heap_stat_adjust_decrease(heap,stat,amnt)            __mi_stat_adjust_decrease_mt( &(heap)->stats.stat, amnt)

#define mi_subproc_stat_counter_increase(subproc,stat,amount)   __mi_stat_counter_increase_mt( &(subproc)->stats.stat, amount)
#define mi_subproc_stat_increase(subproc,stat,amount)           __mi_stat_increase_mt( &(subproc)->stats.stat, amount)
#define mi_subproc_stat_decrease(subproc,stat,amount)           __mi_stat_decrease_mt( &(subproc)->stats.stat, amount)
#define mi_subproc_stat_adjust_increase(subproc,stat,amount)    __mi_stat_adjust_increase_mt( &(subproc)->stats.stat, amount)
#define mi_subproc_stat_adjust_decrease(subproc,stat,amount)    __mi_stat_adjust_decrease_mt( &(subproc)->stats.stat, amount)

#define mi_theap_stat_counter_increase(theap,stat,amount)       __mi_stat_counter_increase( &(theap)->stats.stat, amount)
#define mi_theap_stat_increase(theap,stat,amount)               __mi_stat_increase( &(theap)->stats.stat, amount)
#define mi_theap_stat_decrease(theap,stat,amount)               __mi_stat_decrease( &(theap)->stats.stat, amount)
#define mi_theap_stat_adjust_increase(theap,stat,amnt)          __mi_stat_adjust_increase( &(theap)->stats.stat, amnt)
#define mi_theap_stat_adjust_decrease(theap,stat,amnt)          __mi_stat_adjust_decrease( &(theap)->stats.stat, amnt)


/* -----------------------------------------------------------
  pthread thread locals
----------------------------------------------------------- */

#if MI_USE_PTHREADS

#if defined(__APPLE__) && defined(__aarch64__)
#define MI_PTHREAD_KEY_INVALID ((pthread_key_t)(0))   // nicer codegen
#else
#define MI_PTHREAD_KEY_INVALID ((pthread_key_t)(-1))
#endif

#if defined(__linux__) && defined(__GLIBC__)
// pthread_getspecific returns NULL for invalid keys. <https://man7.org/linux/man-pages/man3/pthread_getspecific.3p.html>
// see also: <https://github.com/lattera/glibc/blob/master/nptl/pthread_getspecific.c>
#define MI_PTHREADS_GET_INVALID_KEY_IS_NULL  1
#endif

mi_decl_noinline bool _mi_pthread_key_create(pthread_key_t* pkey, void (*destruct)(void*), void* init);

static inline void* mi_pthread_key_get(pthread_key_t key) {
  #if !MI_PTHREADS_GET_INVALID_KEY_IS_NULL
  if mi_unlikely(key==MI_PTHREAD_KEY_INVALID) return NULL;
  #endif
  return pthread_getspecific(key);  
}

static inline bool mi_pthread_key_set(pthread_key_t* pkey, void* val) {
  if mi_likely(*pkey!=MI_PTHREAD_KEY_INVALID) { pthread_setspecific(*pkey,val); return true; }
  else if (val!=NULL) { return _mi_pthread_key_create(pkey,NULL,val); }
  else return true;
}

static inline void mi_pthread_key_delete(pthread_key_t* pkey) {
  const pthread_key_t key = *pkey;
  if (key!=MI_PTHREAD_KEY_INVALID) {
    *pkey = MI_PTHREAD_KEY_INVALID;
    pthread_key_delete(key);
  }
}
#endif

/* -----------------------------------------------------------
  Options (exposed for the debugger)
----------------------------------------------------------- */
typedef enum mi_option_init_e {
  MI_OPTION_UNINIT,       // not yet initialized
  MI_OPTION_DEFAULTED,    // not found in the environment, use default value
  MI_OPTION_INITIALIZED   // found in environment or set explicitly
} mi_option_init_t;

typedef struct mi_option_desc_s {
  long              value;  // the value
  mi_option_init_t  init;   // is it initialized yet? (from the environment)
  mi_option_t       option; // for debugging: the option index should match the option
  const char*       name;   // option name without `mimalloc_` prefix
  const char*       legacy_name; // potential legacy option name
} mi_option_desc_t;



/* -----------------------------------------------------------
  Inlined definitions
----------------------------------------------------------- */
#define MI_UNUSED(x)     (void)(x)
#if (MI_DEBUG>1)
#define MI_UNUSED_RELEASE(x)
#else
#define MI_UNUSED_RELEASE(x)  MI_UNUSED(x)
#endif

#define MI_INIT4(x)   x(),x(),x(),x()
#define MI_INIT8(x)   MI_INIT4(x),MI_INIT4(x)
#define MI_INIT16(x)  MI_INIT8(x),MI_INIT8(x)
#define MI_INIT32(x)  MI_INIT16(x),MI_INIT16(x)
#define MI_INIT64(x)  MI_INIT32(x),MI_INIT32(x)
#define MI_INIT128(x) MI_INIT64(x),MI_INIT64(x)
#define MI_INIT256(x) MI_INIT128(x),MI_INIT128(x)

#define MI_INIT74(x)  MI_INIT64(x),MI_INIT8(x),x(),x()
#define MI_INIT5(x)   MI_INIT4(x),x()
#define MI_INIT6(x)   MI_INIT4(x),x(),x()

#include <string.h>
// initialize a local variable to zero; use memset as compilers optimize constant sized memset's
#define _mi_memzero_var(x)  memset(&x,0,sizeof(x))

// Is `x` a power of two? (0 is considered a power of two)
static inline bool _mi_is_power_of_two(uintptr_t x) {
  return ((x & (x - 1)) == 0);
}

// Is a pointer aligned?
static inline bool _mi_is_aligned(const void* p, size_t alignment) {
  return (alignment==0 || ((uintptr_t)p % alignment) == 0);
}

// Align upwards
static inline uintptr_t _mi_align_up(uintptr_t sz, size_t alignment) {
  mi_assert_internal(alignment != 0);
  uintptr_t mask = alignment - 1;
  if ((alignment & mask) == 0) {  // power of two?
    return ((sz + mask) & ~mask);
  }
  else {
    return (((sz + mask)/alignment)*alignment);
  }
}

// Align a pointer upwards
static inline void* _mi_align_up_ptr(const void* p, size_t alignment) {
  return (void*)_mi_align_up((uintptr_t)p, alignment);
}

static inline uintptr_t _mi_align_down(uintptr_t sz, size_t alignment) {
  mi_assert_internal(alignment != 0);
  uintptr_t mask = alignment - 1;
  if ((alignment & mask) == 0) { // power of two?
    return (sz & ~mask);
  }
  else {
    return ((sz / alignment) * alignment);
  }
}

// align a pointer downwards
static inline void* _mi_align_down_ptr(const void* p, size_t alignment) {
  return (void*)_mi_align_down((uintptr_t)p, alignment);
}

// Divide upwards: `s <= _mi_divide_up(s,d)*d < s+d`.
static inline uintptr_t _mi_divide_up(uintptr_t size, size_t divider) {
  mi_assert_internal(divider != 0);
  return (divider == 0 ? size : ((size + divider - 1) / divider));
}


// clamp an integer
static inline size_t _mi_clamp(size_t sz, size_t min, size_t max) {
  if (sz < min) return min;
  else if (sz > max) return max;
  else return sz;
}

// Is memory zero initialized?
static inline bool mi_mem_is_zero(const void* p, size_t size) {
  for (size_t i = 0; i < size; i++) {
    if (((uint8_t*)p)[i] != 0) return false;
  }
  return true;
}

// Align a byte size to a size in _machine words_,
// i.e. byte size == `wsize*sizeof(void*)`.
static inline size_t _mi_wsize_from_size(size_t size) {
  mi_assert_internal(size <= SIZE_MAX - sizeof(uintptr_t));
  return (size + sizeof(uintptr_t) - 1) / sizeof(uintptr_t);
}

// Overflow detecting multiply
#if __has_builtin(__builtin_umul_overflow) || (defined(__GNUC__) && (__GNUC__ >= 5))
#include <limits.h>      // UINT_MAX, ULONG_MAX
#if defined(_CLOCK_T)    // for Illumos
#undef _CLOCK_T
#endif
static inline bool mi_mul_overflow(size_t count, size_t size, size_t* total) {
  #if (SIZE_MAX == ULONG_MAX)
    return __builtin_umull_overflow(count, size, (unsigned long *)total);
  #elif (SIZE_MAX == UINT_MAX)
    return __builtin_umul_overflow(count, size, (unsigned int *)total);
  #else
    return __builtin_umulll_overflow(count, size, (unsigned long long *)total);
  #endif
}
#else /* __builtin_umul_overflow is unavailable */
static inline bool mi_mul_overflow(size_t count, size_t size, size_t* total) {
  *total = count*size;
  if mi_likely(((size|count)>>(4*MI_SIZE_SIZE))==0) {  // did size and count fit both in the lower half bits of a size_t?
    return false;
  }
  else {
    return (size!=0 && (SIZE_MAX / size) < count);
  }
}
#endif

// Safe multiply `count*size` into `total`; return `true` on overflow.
static inline bool mi_count_size_overflow(size_t count, size_t size, size_t* total) {
  if (count==1) {  // quick check for the case where count is one (common for C++ allocators)
    *total = size;
    return false;
  }
  else if mi_likely(!mi_mul_overflow(count, size, total)) {
    return false;
  }
  else {
    #if MI_DEBUG > 0
    _mi_error_message(EOVERFLOW, "allocation request is too large (%zu * %zu bytes)\n", count, size);
    #endif
    *total = SIZE_MAX;
    return true;
  }
}


/*----------------------------------------------------------------------------------------
  Heap functions
------------------------------------------------------------------------------------------- */

extern mi_decl_hidden const mi_theap_t _mi_theap_empty;       // read-only empty theap, initial value of the thread local default theap (in the MI_TLS_MODEL_LOCAL)
extern mi_decl_hidden const mi_theap_t _mi_theap_empty_wrong; // read-only empty theap used to signal that a theap for a heap could not be allocated


static inline mi_heap_t* _mi_theap_heap_peek(const mi_theap_t* theap) {
  return mi_atomic_load_ptr_relaxed(mi_heap_t,&theap->heap);
}

static inline mi_heap_t* _mi_theap_heap(const mi_theap_t* theap) {
  mi_heap_t* const heap = _mi_theap_heap_peek(theap);
  mi_assert_internal(heap!=NULL);
  return heap;
}

static inline bool mi_theap_is_initialized(const mi_theap_t* theap) {
  return (theap != NULL && _mi_theap_heap_peek(theap) != NULL);
}

static inline mi_subproc_t* _mi_theap_subproc(const mi_theap_t* theap) {
  mi_subproc_t* const subproc = mi_atomic_load_ptr_relaxed(mi_subproc_t,&theap->subproc);
  mi_assert_internal(!mi_theap_is_initialized(theap) || _mi_theap_heap(theap)->subproc == subproc);
  return subproc;
}

static inline mi_page_t* _mi_theap_get_free_small_page(mi_theap_t* theap, size_t size) {
  mi_assert_internal(size <= (MI_SMALL_SIZE_MAX + MI_PADDING_SIZE));
  const size_t idx = _mi_wsize_from_size(size);
  mi_assert_internal(idx < MI_PAGES_DIRECT);
  return theap->pages_free_direct[idx];
}

//static inline uintptr_t _mi_ptr_cookie(const void* p) {
//  extern mi_theap_t _mi_theap_main;
//  mi_assert_internal(_mi_theap_main.cookie != 0);
//  return ((uintptr_t)p ^ _mi_theap_main.cookie);
//}


/* -----------------------------------------------------------
  The page map maps addresses to `mi_page_t` pointers
----------------------------------------------------------- */

#if MI_PAGE_MAP_FLAT

// flat page-map committed on demand, using one byte per slice (64 KiB).
// single indirection and low commit, but large initial virtual reserve (4 GiB with 48 bit virtual addresses)
// used by default on <= 40 bit virtual address spaces.
extern mi_decl_hidden _Atomic(uint8_t*) _mi_page_map;
extern mi_decl_hidden _Atomic(void*)    _mi_page_map_max_address;

static inline size_t _mi_page_map_index(const void* p) {
  return (size_t)((uintptr_t)p >> MI_ARENA_SLICE_SHIFT);
}

static inline uint8_t _mi_page_map_at(size_t idx) {
  return mi_atomic_load_ptr_relaxed(uint8_t,&_mi_page_map)[idx];
}

static inline mi_page_t* _mi_ptr_page_ex(const void* p, bool* valid) {
  const size_t idx = _mi_page_map_index(p);
  const size_t ofs = _mi_page_map_at(idx);
  if (valid != NULL) { *valid = (ofs != 0); }
  return (mi_page_t*)((((uintptr_t)p >> MI_ARENA_SLICE_SHIFT) + 1 - ofs) << MI_ARENA_SLICE_SHIFT);
}

static inline mi_page_t* _mi_checked_ptr_page(const void* p) {
  #if MI_MIN_VABITS < MI_INTPTR_BITS
  if mi_unlikely(((uintptr_t)p >> MI_MIN_VABITS) != 0) {
    if (p > mi_atomic_load_ptr_relaxed(void, &_mi_page_map_max_address)) return NULL;
  }
  #endif
  bool valid;
  mi_page_t* const page = _mi_ptr_page_ex(p, &valid);
  return (valid ? page : NULL);
}

static inline mi_page_t* _mi_unchecked_ptr_page(const void* p) {
  return _mi_ptr_page_ex(p, NULL);
}

#else

// 2-level page map:
// double indirection, but low commit and low virtual reserve.
//
// the page-map is usually 4 MiB (for 48 bit virtual addresses) and points to sub maps of 64 KiB.
// the page-map is committed on-demand (in 64 KiB parts) (and sub-maps are committed on-demand as well)
// one sub page-map = 64 KiB => covers 2^(16-3) * 2^16 = 2^29 = 512 MiB address space
// the page-map needs 48-(16+13) = 19 bits => 2^19 sub map pointers = 2^22 bytes = 4 MiB reserved size.
#define MI_PAGE_MAP_SUB_SHIFT     (13)
#define MI_PAGE_MAP_SUB_COUNT     (MI_ZU(1) << MI_PAGE_MAP_SUB_SHIFT)
#define MI_PAGE_MAP_SHIFT         (MI_MAX_VABITS - MI_PAGE_MAP_SUB_SHIFT - MI_ARENA_SLICE_SHIFT)
#define MI_PAGE_MAP_COUNT         (MI_ZU(1) << MI_PAGE_MAP_SHIFT)

typedef mi_page_t**   mi_submap_t;
extern mi_decl_hidden _Atomic(mi_submap_t)* _mi_page_map;
extern mi_decl_hidden _Atomic(void*) _mi_page_map_max_address;

static inline size_t _mi_page_map_index(const void* p, size_t* sub_idx) {
  const size_t u = (size_t)((uintptr_t)p / MI_ARENA_SLICE_SIZE);
  if (sub_idx != NULL) { *sub_idx = u % MI_PAGE_MAP_SUB_COUNT; }
  return (u / MI_PAGE_MAP_SUB_COUNT);
}

static inline mi_submap_t _mi_page_map_at(size_t idx) {
  return mi_atomic_load_ptr_relaxed(mi_page_t*, &_mi_page_map[idx]);
}

static inline mi_page_t* _mi_unchecked_ptr_page(const void* p) {
  size_t sub_idx;
  const size_t idx = _mi_page_map_index(p, &sub_idx);
  return (_mi_page_map_at(idx))[sub_idx];  // NULL if p==NULL
}

static inline mi_page_t* _mi_checked_ptr_page(const void* p) {
  #if MI_MIN_VABITS < MI_INTPTR_BITS
  if mi_unlikely(((uintptr_t)p >> MI_MIN_VABITS) != 0) {
    if (p > mi_atomic_load_ptr_relaxed(void, &_mi_page_map_max_address)) return NULL;
  }
  #endif
  size_t sub_idx;
  const size_t idx = _mi_page_map_index(p, &sub_idx);
  mi_submap_t const sub = _mi_page_map_at(idx);
  if mi_unlikely(sub == NULL) return NULL;
  return sub[sub_idx];
}

#endif

static inline mi_page_t* _mi_ptr_page(const void* p) {
  mi_assert_internal(p==NULL || mi_is_in_heap_region(p));
  #if MI_DEBUG || MI_SECURE || MI_FREE_IS_CHECKED
  return _mi_checked_ptr_page(p);
  #else
  return _mi_unchecked_ptr_page(p);
  #endif
}


// Get the block size of a page
static inline size_t mi_page_block_size(const mi_page_t* page) {
  mi_assert_internal(page->block_size > 0);
  return page->block_size;
}

// Page start
static inline uint8_t* mi_page_start(const mi_page_t* page) {
  // multiplication must be done in `size_t`; in a 32-bit multiplication the offset wraps for pages whose blocks start 4 GiB or more after the page meta info
  return (uint8_t*)page + ((size_t)page->page_woffset * MI_SIZE_SIZE);
}

static inline size_t mi_page_size(const mi_page_t* page) {
  return mi_page_block_size(page) * page->reserved;
}

static inline uint8_t* mi_page_area(const mi_page_t* page, size_t* size) {
  if (size) { *size = mi_page_size(page); }
  return mi_page_start(page);
}

static inline size_t mi_page_info_size(void) {
  return _mi_align_up(sizeof(mi_page_t), MI_MAX_ALIGN_SIZE);
}

static inline bool mi_page_contains_address(const mi_page_t* page, const void* p) {
  size_t psize;
  uint8_t* start = mi_page_area(page, &psize);
  return (start <= (uint8_t*)p && (uint8_t*)p < start + psize);
}

static inline bool mi_page_is_in_arena(const mi_page_t* page) {
  return (page->memid.memkind == MI_MEM_ARENA);
}

static inline bool mi_page_is_singleton(const mi_page_t* page) {
  return (page->reserved == 1);
}

// Get the usable block size of a page without fixed padding.
// This may still include internal padding due to alignment and rounding up size classes.
static inline size_t mi_page_usable_block_size(const mi_page_t* page) {
  return mi_page_block_size(page) - MI_PADDING_SIZE;
}

static inline bool mi_page_meta_is_separated(const mi_page_t* page) {
  #if MI_PAGE_META_IS_SEPARATED
  // usually separated but can still be in front for direct OS allocations (due to size or alignment) or due to MI_PAGE_META_ALIGNED_FREE_SMALL
  return (page->memid.memkind == MI_MEM_ARENA && page != _mi_align_down_ptr(mi_page_start(page), MI_ARENA_SLICE_ALIGN));
  #else
  MI_UNUSED(page);
  return false;
  #endif
}

static inline uint8_t* mi_page_slice_start(const mi_page_t* page) {
  if (mi_page_meta_is_separated(page)) {
    // page meta info is at a separate location (at `arena->pages`)
    return (uint8_t*)_mi_align_down_ptr(mi_page_start(page), MI_ARENA_SLICE_ALIGN);
  }
  else {
    // page meta info is at the start of the page slices
    return (uint8_t*)page;
  }
}

// This gives the offset relative to the start slice of a page.
static inline size_t mi_page_slice_offset_of(const mi_page_t* page, size_t offset_relative_to_page_start) {
  return (mi_page_start(page) - mi_page_slice_start(page)) + offset_relative_to_page_start;
}

// Currently committed part of a page
static inline size_t mi_page_committed(const mi_page_t* page) {
  return (page->slice_committed == 0 ? mi_page_size(page) : page->slice_committed - mi_page_slice_offset_of(page,0));
}

// are all blocks in a page freed?
// note: needs up-to-date used count, (as the `xthread_free` list may not be empty). see `_mi_page_collect_free`.
static inline bool mi_page_all_free(const mi_page_t* page) {
  mi_assert_internal(page != NULL);
  return (page->used == 0);
}

// ------------------------------------------------------
// Page hole purging  (see the "Page hole purging" section in `page.c`)
// ------------------------------------------------------

void          _mi_page_purge_holes(mi_page_t* page, mi_tld_t* tld);   // `tld`: the one being swept (owns the sweep state)
void          _mi_page_purged_reset(mi_page_t* page);
bool          _mi_page_unpurge_run(mi_page_t* page);
void          _mi_page_unpurge_all(mi_page_t* page);
size_t        _mi_page_purged_count(const mi_page_t* page);
void          _mi_page_unpurge_unformed_upto(mi_page_t* page, uintptr_t end);   // hand the discarded unformed tail back below `end` (an absolute address)
size_t        _mi_page_unformed_purged_bytes(const mi_page_t* page);            // the bytes of this page's unformed tail that are discarded right now
bool          _mi_page_purge_os_page_blocks(size_t os_page_size, size_t block_size, uintptr_t page_start,
                                            size_t capacity, size_t k, size_t* first, size_t* last);
void          _mi_page_holes_count_page_freed(void);
void          _mi_page_holes_count_ineligible(const mi_page_t* page);
void          _mi_page_holes_reset_ineligible(void);
void          _mi_page_purge_holes_begin(mi_tld_t* tld);
void          _mi_page_purge_holes_end(mi_tld_t* tld);
void          _mi_page_purge_holes_sweep_begin(mi_tld_t* tld);   // once per idle sweep, before its passes

// ------------------------------------------------------
// Hole report  (`mi_purge_holes_report`, see the "Hole report" section in `page.c`)
//
// What is left behind after a sweep, per size class: the free bytes that share an OS page
// with a live block cannot be discarded, and this says how much of that there is and how
// few live blocks are holding it down.
// ------------------------------------------------------

#define MI_HOLES_HIST_BUCKETS  (5)    // live blocks per pinned OS page: 1, 2, 3-4, 5-8, 9+
#define MI_HOLES_GRAN_COUNT    (5)    // the hypothetical OS page sizes of the granularity curve

typedef struct mi_holes_bin_s {
  size_t block_size;           // the largest block size seen in this bin
  size_t pages;
  size_t ineligible_pages;     // pages `mi_page_can_purge_holes` rejects (nothing in them is discardable)
  size_t live_bytes;           // bytes of allocated blocks
  size_t free_bytes;           // bytes of free blocks (free-listed *and* already discarded)
  size_t undiscardable_bytes;  // free bytes in an OS page that a live block pins (or that is not entirely inside the block area)
  size_t discarded_bytes;      // bytes of the OS pages that are discarded right now
  size_t edge_bytes;           // of `undiscardable_bytes`: those in a partial OS page (holds the page header, or memory past `capacity`)
  size_t pending_bytes;        // free bytes in a fully free OS page that is not discarded (no sweep yet, or the discard failed)
  size_t pinned_ospages;       // OS pages holding >= 1 live block
  size_t pinned_live_blocks;   // live blocks over those (a block straddling two pinned OS pages counts in both)
  size_t pinned_free_bytes;    // free bytes trapped inside those pinned OS pages
  size_t pinned_live_bytes;    // live bytes inside those pinned OS pages
  size_t hist[MI_HOLES_HIST_BUCKETS];
} mi_holes_bin_t;

typedef struct mi_holes_report_s {
  mi_holes_bin_t bin[MI_BIN_COUNT];
  size_t total_pages;
  size_t ineligible_pages;
  size_t unformed_bytes;       // memory of blocks not formed yet (`capacity < reserved`)
  size_t unformed_discarded_bytes;  // of those: the OS pages the sweep discarded (`page->unformed_purged_*`)
  // The granularity curve: how many bytes WOULD be discardable if the OS page size were
  // `mi_holes_granularity(g)` -- the total size of the G-aligned, G-sized spans that lie wholly
  // inside a page's block area and hold not one live block. Nothing is discarded to measure it;
  // it is pure counting over the same free/live classification the sweep uses.
  size_t discardable_at[MI_HOLES_GRAN_COUNT];
  size_t unmadvisable_pages;   // excluded from the curve: their memory cannot be discarded at ANY granularity

  // Where the memory actually IS. If the curve turns out flat, the free memory is not
  // contaminating the pages -- and then this says where it went instead.
  //
  // CAVEAT, and it is why these fields are named the way they are: `slices_committed` is set for
  // the WHOLE arena at reserve time whenever the OS memory is `initially_committed` (which every
  // POSIX mmap is), and a reset-style purge (MADV_FREE_REUSABLE on darwin) does NOT clear it. So
  // there that bitmap is address space, not residency, and `arena_committed_bytes` must not be
  // read as "memory we are paying for". `slices_dirty` (ever touched) and `slices_purge`
  // (scheduled but not yet purged) are the bitmaps that carry residency information.
  size_t page_committed_bytes;       // committed bytes of the pages this walk reached
  size_t arena_reserved_bytes;       // total arena address space
  size_t arena_committed_bytes;      // popcount(slices_committed) -- see the caveat: on POSIX this is ~= reserved
  size_t arena_free_dirty_bytes;     // slices in NO page that were touched at least once: the UPPER bound on arena slack still resident
  size_t arena_purge_pending_bytes;  // slices in NO page, scheduled for purge but not purged yet: definitely still resident (the purge delay)
  size_t arena_meta_bytes;           // the arenas' own bitmaps (`info_slices`) -- ROUGH: excludes the `mi_meta` heaps
} mi_holes_report_t;

size_t        mi_holes_granularity(size_t g);
void          _mi_page_holes_report_page(const mi_page_t* page, mi_holes_report_t* rep);
void          _mi_page_holes_report_print(const mi_holes_report_t* rep);
void          _mi_arenas_holes_report(mi_heap_t* heap, mi_holes_report_t* rep);
void          _mi_arenas_holes_committed(mi_heap_t* heap, mi_holes_report_t* rep);
void          _mi_purge_holes_report_collect(mi_holes_report_t* rep);

// The base of the OS-page bitmap: the start of the first OS page that the block area of
// this page overlaps. It is OS-page aligned by construction, so bit `k` always names the
// OS-page-aligned range `[base + k*os_page_size, base + (k+1)*os_page_size)`.
static inline uintptr_t mi_page_purge_base(const mi_page_t* page) {
  return _mi_align_down((uintptr_t)mi_page_start(page), _mi_os_page_size());
}

// the number of OS pages the block area spans = the number of bits this page needs
static inline size_t mi_page_purge_bits(const mi_page_t* page) {
  const uintptr_t base = mi_page_purge_base(page);
  const uintptr_t end = (uintptr_t)mi_page_start(page) + mi_page_size(page);
  return _mi_divide_up((size_t)(end - base), _mi_os_page_size());
}

// Eligible when the page's OS pages fit the bitmap. This does not depend on the block size
// at all: a discard covers a whole OS page, so any number of small free blocks can together
// cover one (and a page whose free runs never cover a whole OS page simply discards nothing).
// Small and medium pages always fit; a large (4 MiB) page only fits when the OS page is
// 16 KiB, and a huge page is a singleton (one block) so there is nothing to purge in it.
// Pinned memory (large/huge OS pages) cannot be madvise'd away, and an arena with a custom
// commit function owns its own commit/decommit -- like every other purge site
// (`mi_arena_schedule_purge`, `_mi_os_purge_ex`), we stay away from both.
static inline bool mi_page_can_purge_holes(const mi_page_t* page) {
  if (page->reserved <= 1) return false;             // a singleton page has no free block while it is in use
  if (page->memid.is_pinned) return false;
  const mi_arena_t* const arena = mi_memid_arena(page->memid);
  if (arena != NULL && arena->commit_fun != NULL) return false;
  return (mi_page_purge_bits(page) <= MI_PAGE_PURGE_BITS);
}

static inline bool mi_page_has_purged(const mi_page_t* page) {
  for (size_t i = 0; i < MI_PAGE_PURGE_WORDS; i++) {
    if (page->purged[i] != 0) return true;
  }
  return false;
}

// is the memory of OS page `k` (counted from `mi_page_purge_base`) discarded?
static inline bool mi_page_os_page_purged(const mi_page_t* page, size_t k) {
  if (k >= MI_PAGE_PURGE_BITS) return false;
  return ((page->purged[k / 64] >> (k % 64)) & 1) != 0;
}

// Is the block at index `idx` free-but-discarded (and thus not on any free list)?
// This is the derived purge predicate: an OS page is discarded only when *every* block
// overlapping it is free, so a block lost memory exactly when it overlaps a discarded OS page.
static inline bool mi_page_block_index_is_purged(const mi_page_t* page, size_t idx) {
  if (!mi_page_has_purged(page)) return false;
  const size_t os_size = _mi_os_page_size();
  const uintptr_t base = mi_page_purge_base(page);
  const uintptr_t lo = (uintptr_t)mi_page_start(page) + (idx * page->block_size);
  const size_t kfirst = (size_t)(lo - base) / os_size;
  const size_t klast = (size_t)((lo + page->block_size - 1) - base) / os_size;
  for (size_t k = kfirst; k <= klast && k < MI_PAGE_PURGE_BITS; k++) {
    if (mi_page_os_page_purged(page, k)) return true;
  }
  return false;
}

// is `block` free-but-discarded? A purged block is on no free list, so a free-list walk
// (as `free.c:mi_check_is_double_freex` does) cannot see that it is already free.
static inline bool mi_page_block_is_purged(const mi_page_t* page, const void* block) {
  if (!mi_page_has_purged(page)) return false;
  mi_assert_internal((const uint8_t*)block >= mi_page_start(page));
  const size_t idx = ((size_t)((const uint8_t*)block - mi_page_start(page))) / page->block_size;
  if (idx >= page->capacity) return false;
  return mi_page_block_index_is_purged(page, idx);
}

// are there immediately available blocks, i.e. blocks available on the free list.
static inline bool mi_page_immediate_available(const mi_page_t* page) {
  mi_assert_internal(page != NULL);
  return (page->free != NULL);
}


// is the page not yet used up to its reserved space?
static inline bool mi_page_is_expandable(const mi_page_t* page) {
  mi_assert_internal(page != NULL);
  mi_assert_internal(page->capacity <= page->reserved);
  return (page->capacity < page->reserved);
}


static inline bool mi_page_is_full(const mi_page_t* page) {
  const bool full = (page->reserved == page->used);
  mi_assert_internal(!full || page->free == NULL);
  return full;
}

// is more than 7/8th of a page in use?
static inline bool mi_page_is_mostly_used(const mi_page_t* page) {
  if (page==NULL) return true;
  uint16_t frac = page->reserved / 8U;
  return (page->reserved - page->used <= frac);
}

// is more than (n-1)/n'th of a page in use?
static inline bool mi_page_is_used_at_frac(const mi_page_t* page, uint16_t n) {
  if (page==NULL) return true;
  uint16_t frac = page->reserved / n;
  return (page->reserved - page->used <= frac);
}


static inline bool mi_page_is_huge(const mi_page_t* page) {
  return (mi_page_is_singleton(page) &&
          (page->block_size > MI_LARGE_MAX_OBJ_SIZE ||
           (mi_memkind_is_os(page->memid.memkind) && page->memid.mem.os.base < (void*)page)));
}

static inline mi_page_queue_t* mi_page_queue(const mi_theap_t* theap, size_t size) {
  mi_page_queue_t* const pq = &((mi_theap_t*)theap)->pages[_mi_bin(size)];
  if (size <= MI_LARGE_MAX_OBJ_SIZE) { mi_assert_internal(pq->block_size <= MI_LARGE_MAX_OBJ_SIZE); }
  return pq;
}


//-----------------------------------------------------------
// Page thread id and flags
//-----------------------------------------------------------

// Thread id of thread that owns this page (with flags in the bottom 2 bits)
static inline mi_threadid_t mi_page_xthread_id(const mi_page_t* page) {
  return mi_atomic_load_relaxed(&((mi_page_t*)page)->xthread_id);
}

// Plain thread id of the thread that owns this page
static inline mi_threadid_t mi_page_thread_id(const mi_page_t* page) {
  return (mi_page_xthread_id(page) & ~MI_PAGE_FLAG_MASK);
}

static inline mi_page_flags_t mi_page_flags(const mi_page_t* page) {
  return (mi_page_xthread_id(page) & MI_PAGE_FLAG_MASK);
}

static inline bool mi_page_flags_set(mi_page_t* page, bool set, mi_page_flags_t newflag) {
  mi_page_flags_t old;
  if (set) { old = mi_atomic_or_relaxed(&page->xthread_id, newflag); }
      else { old = mi_atomic_and_relaxed(&page->xthread_id, ~newflag); }
  return ((old & newflag) == newflag);
}

static inline bool mi_page_is_in_full(const mi_page_t* page) {
  return ((mi_page_flags(page) & MI_PAGE_IN_FULL_QUEUE) != 0);
}

static inline void mi_page_set_in_full(mi_page_t* page, bool in_full) {
  const bool was_in_full = mi_page_flags_set(page, in_full, MI_PAGE_IN_FULL_QUEUE);
  if (was_in_full != in_full) {
    // optimize: maintain pages_full_size to avoid visiting the full queue (issue #1220)
    mi_theap_t* const theap = page->theap;
    mi_assert_internal(theap!=NULL);
    if (theap != NULL) {
      const size_t size = page->capacity * mi_page_block_size(page);
      if (in_full) { theap->pages_full_size += size; }
              else { mi_assert_internal(size <= theap->pages_full_size); theap->pages_full_size -= size; }
    }
  }
}

static inline bool mi_page_has_interior_pointers(const mi_page_t* page) {
  return ((mi_page_flags(page) & MI_PAGE_HAS_INTERIOR_POINTERS) != 0);
}

static inline void mi_page_set_has_interior_pointers(mi_page_t* page, bool has_aligned) {
  mi_page_flags_set(page, has_aligned, MI_PAGE_HAS_INTERIOR_POINTERS);
}

static inline void mi_page_set_theap(mi_page_t* page, mi_theap_t* theap) {
  // mi_assert_internal(!mi_page_is_in_full(page));  // can happen when destroying pages on theap_destroy
  page->theap = theap;
  const mi_threadid_t tid = (theap == NULL ? MI_THREADID_ABANDONED : theap->tld->thread_id);
  mi_assert_internal((tid & MI_PAGE_FLAG_MASK) == 0);

  // we need to use an atomic cas since a concurrent thread may still set the MI_PAGE_HAS_INTERIOR_POINTERS flag (see `alloc_aligned.c`).
  mi_threadid_t xtid_old = mi_page_xthread_id(page);
  mi_threadid_t xtid;
  do {
    xtid = tid | (xtid_old & MI_PAGE_FLAG_MASK);
  } while (!mi_atomic_cas_weak_release(&page->xthread_id, &xtid_old, xtid));
}

static inline bool mi_page_is_abandoned(const mi_page_t* page) {
  // note: the xtheap field of an abandoned theap is set to the subproc (for fast reclaim-on-free)
  return (mi_page_thread_id(page) <= MI_THREADID_ABANDONED_MAPPED);
}

static inline bool mi_page_is_abandoned_mapped(const mi_page_t* page) {
  return (mi_page_thread_id(page) == MI_THREADID_ABANDONED_MAPPED);
}

static inline void mi_page_set_abandoned_mapped(mi_page_t* page) {
  mi_assert_internal(mi_page_is_abandoned(page));
  mi_atomic_or_relaxed(&page->xthread_id, (mi_threadid_t)MI_THREADID_ABANDONED_MAPPED);
}

static inline void mi_page_clear_abandoned_mapped(mi_page_t* page) {
  mi_assert_internal(mi_page_is_abandoned_mapped(page));
  mi_atomic_and_relaxed(&page->xthread_id, (mi_threadid_t)MI_PAGE_FLAG_MASK);
}


static inline mi_theap_t* mi_page_theap(const mi_page_t* page) {
  mi_assert_internal(!mi_page_is_abandoned(page));
  mi_assert_internal(page->theap != NULL && page->theap != &_mi_theap_empty);
  return page->theap;
}

static inline mi_tld_t* mi_page_tld(const mi_page_t* page) {
  mi_assert_internal(!mi_page_is_abandoned(page));
  mi_assert_internal(page->theap != NULL);
  return page->theap->tld;
}


static inline mi_heap_t* mi_page_heap(const mi_page_t* page) {
  mi_heap_t* heap = page->heap;
  mi_assert_internal(heap != NULL);
  return heap;
}

static inline mi_subproc_t* mi_page_subproc(const mi_page_t* page) {
  mi_heap_t* const heap = mi_page_heap(page);
  return heap->subproc;
}

static inline mi_heap_t* mi_arena_heap_main(const mi_arena_t* arena) {
  return _mi_subproc_heap_main(arena->subproc);
}

static inline mi_heap_t* mi_heap_get_heap_main(const mi_heap_t* heap) {
  return _mi_subproc_heap_main(heap->subproc);
}

static inline bool _mi_is_heap_main(const mi_heap_t* heap) {
  mi_assert_internal(heap!=NULL);
  return (mi_heap_get_heap_main(heap) == heap);
}



//-----------------------------------------------------------
// Thread free list and ownership
//-----------------------------------------------------------

// Thread free flag helpers
static inline mi_block_t* mi_tf_block(mi_thread_free_t tf) {
  return (mi_block_t*)(tf & ~1);
}
static inline bool mi_tf_is_owned(mi_thread_free_t tf) {
  return ((tf & 1) == 1);
}
static inline mi_thread_free_t mi_tf_create(mi_block_t* block, bool owned) {
  return (mi_thread_free_t)((uintptr_t)block | (owned ? 1 : 0));
}

// Thread free access
static inline mi_block_t* mi_page_thread_free(const mi_page_t* page) {
  return mi_tf_block(mi_atomic_load_relaxed(&((mi_page_t*)page)->xthread_free));
}

// are there any available blocks?
static inline bool mi_page_has_any_available(const mi_page_t* page) {
  mi_assert_internal(page != NULL && page->reserved > 0);
  return (page->used < page->reserved || (mi_page_thread_free(page) != NULL));
}

// Owned?
static inline bool mi_page_is_owned(const mi_page_t* page) {
  return mi_tf_is_owned(mi_atomic_load_relaxed(&((mi_page_t*)page)->xthread_free));
}

// get ownership; returns true if the page was not owned before.
static inline bool mi_page_claim_ownership(mi_page_t* page) {
  const uintptr_t old = mi_atomic_or_acq_rel(&page->xthread_free, (uintptr_t)1);
  return ((old&1)==0);
}


/* -------------------------------------------------------------------
  Guarded objects
------------------------------------------------------------------- */
#if MI_GUARDED
// we always align guarded pointers in a block at an offset
// the block `next` field is then used as a tag to distinguish regular offset aligned blocks from guarded ones
#define MI_BLOCK_TAG_ALIGNED   ((mi_encoded_t)(0))
#define MI_BLOCK_TAG_GUARDED   (~MI_BLOCK_TAG_ALIGNED)
#endif

static inline bool mi_block_ptr_is_guarded(const mi_block_t* block, const void* p) {
#if MI_GUARDED
  const ptrdiff_t offset = (uint8_t*)p - (uint8_t*)block;
  return (offset >= (ptrdiff_t)(sizeof(mi_block_t)) && block->next == MI_BLOCK_TAG_GUARDED);
#else
  MI_UNUSED(block); MI_UNUSED(p);
  return false;
#endif
}

#if MI_GUARDED
static inline bool mi_theap_malloc_use_guarded(mi_theap_t* theap, size_t size) {
  // this code is written to result in fast assembly as it is on the hot path for allocation
  const size_t count = theap->guarded_sample_count - 1;  // if the rate was 0, this will underflow and count for a long time..
  if mi_likely(count != 0) {
    // no sample
    theap->guarded_sample_count = count;
    return false;
  }
  else if (size >= theap->guarded_size_min && size <= theap->guarded_size_max) {
    // use guarded allocation
    theap->guarded_sample_count = theap->guarded_sample_rate;  // reset
    return (theap->guarded_sample_rate != 0);
  }
  else {
    // failed size criteria, rewind count (but don't write to an empty theap)
    if (theap->guarded_sample_rate != 0) { theap->guarded_sample_count = 1; }
    return false;
  }
}

mi_decl_restrict void* _mi_theap_malloc_guarded(mi_theap_t* theap, size_t size, bool zero) mi_attr_noexcept;

#endif


/* -------------------------------------------------------------------
Encoding/Decoding the free list next pointers

This is to protect against buffer overflow exploits where the
free list is mutated. Many hardened allocators xor the next pointer `p`
with a secret key `k1`, as `p^k1`. This prevents overwriting with known
values but might be still too weak: if the attacker can guess
the pointer `p` this  can reveal `k1` (since `p^k1^p == k1`).
Moreover, if multiple blocks can be read as well, the attacker can
xor both as `(p1^k1) ^ (p2^k1) == p1^p2` which may reveal a lot
about the pointers (and subsequently `k1`).

Instead mimalloc uses an extra key `k2` and encodes as `((p^k2)<<<k1)+k1`.
Since these operations are not associative, the above approaches do not
work so well any more even if the `p` can be guesstimated. For example,
for the read case we can subtract two entries to discard the `+k1` term,
but that leads to `((p1^k2)<<<k1) - ((p2^k2)<<<k1)` at best.
We include the left-rotation since xor and addition are otherwise linear
in the lowest bit. Finally, both keys are unique per page which reduces
the re-use of keys by a large factor.

We also pass a separate `null` value to be used as `NULL` or otherwise
`(k2<<<k1)+k1` would appear (too) often as a sentinel value.
------------------------------------------------------------------- */

static inline bool mi_is_in_same_page(const void* p, const void* q) {
  mi_page_t* page = _mi_ptr_page(p);
  return mi_page_contains_address(page,q);
  // return (_mi_ptr_page(p) == _mi_ptr_page(q));
}

static inline void* mi_ptr_decode(const void* null, const mi_encoded_t x, const uintptr_t* keys) {
  void* p = (void*)(mi_rotr(x - keys[0], keys[0]) ^ keys[1]);
  return (p==null ? NULL : p);
}

static inline mi_encoded_t mi_ptr_encode(const void* null, const void* p, const uintptr_t* keys) {
  uintptr_t x = (uintptr_t)(p==NULL ? null : p);
  return mi_rotl(x ^ keys[1], keys[0]) + keys[0];
}

static inline uint32_t mi_ptr_encode_canary(const void* null, const void* p, const uintptr_t* keys) {
  const uint32_t x = (uint32_t)(mi_ptr_encode(null,p,keys));
  // make the lowest byte 0 to prevent spurious read overflows which could be a security issue (issue #951)
  #if MI_BIG_ENDIAN
  return (x & 0x00FFFFFF);
  #else
  return (x & 0xFFFFFF00);
  #endif
}

static inline mi_block_t* mi_block_nextx( const void* null, const mi_block_t* block, const uintptr_t* keys ) {
  mi_track_mem_defined(block,sizeof(mi_block_t));
  mi_block_t* next;
  #if MI_ENCODE_FREELIST
  next = (mi_block_t*)mi_ptr_decode(null, block->next, keys);
  #else
  MI_UNUSED(keys); MI_UNUSED(null);
  next = (mi_block_t*)block->next;
  #endif
  mi_track_mem_noaccess(block,sizeof(mi_block_t));
  return next;
}

static inline void mi_block_set_nextx(const void* null, mi_block_t* block, const mi_block_t* next, const uintptr_t* keys) {
  mi_track_mem_undefined(block,sizeof(mi_block_t));
  #if MI_ENCODE_FREELIST
  block->next = mi_ptr_encode(null, next, keys);
  #else
  MI_UNUSED(keys); MI_UNUSED(null);
  block->next = (mi_encoded_t)next;
  #endif
  mi_track_mem_noaccess(block,sizeof(mi_block_t));
}

static inline mi_block_t* mi_block_next(const mi_page_t* page, const mi_block_t* block) {
  #if MI_ENCODE_FREELIST
  mi_block_t* next = mi_block_nextx(page,block,page->keys);
  // check for free list corruption: is `next` at least in the same page?
  // todo: check if `next` is `page->block_size` aligned?
  if mi_unlikely(next!=NULL && !mi_is_in_same_page(block, next)) {
    _mi_error_message(EFAULT, "corrupted free list entry of size %zub at %p: value 0x%zx\n", mi_page_block_size(page), block, (uintptr_t)next);
    next = NULL;
  }
  return next;
  #else
  MI_UNUSED(page);
  return mi_block_nextx(page,block,NULL);
  #endif
}

static inline void mi_block_set_next(const mi_page_t* page, mi_block_t* block, const mi_block_t* next) {
  #if MI_ENCODE_FREELIST
  mi_block_set_nextx(page,block,next, page->keys);
  #else
  MI_UNUSED(page);
  mi_block_set_nextx(page,block,next,NULL);
  #endif
}

/* -----------------------------------------------------------
  arena blocks
----------------------------------------------------------- */

// Blocks needed for a given byte size
static inline size_t mi_slice_count_of_size(size_t size) {
  return _mi_divide_up(size, MI_ARENA_SLICE_SIZE);
}

// Byte size of a number of blocks
static inline size_t mi_size_of_slices(size_t bcount) {
  return (bcount * MI_ARENA_SLICE_SIZE);
}


/* -----------------------------------------------------------
  memory id's
----------------------------------------------------------- */

static inline mi_memid_t _mi_memid_create(mi_memkind_t memkind) {
  mi_memid_t memid;
  _mi_memzero_var(memid);
  memid.memkind = memkind;
  return memid;
}

static inline mi_memid_t _mi_memid_none(void) {
  return _mi_memid_create(MI_MEM_NONE);
}

static inline mi_memid_t _mi_memid_create_os(void* base, size_t size, bool committed, bool is_zero, bool is_large) {
  mi_memid_t memid = _mi_memid_create(MI_MEM_OS);
  memid.mem.os.base = base;
  memid.mem.os.size = size;
  memid.initially_committed = committed;
  memid.initially_zero = is_zero;
  memid.is_pinned = is_large;
  return memid;
}

static inline mi_memid_t _mi_memid_create_meta(mi_meta_page_t* mpage, size_t block_idx, size_t block_count) {
  mi_memid_t memid = _mi_memid_create(MI_MEM_META);
  memid.mem.meta.meta_page = mpage;
  memid.mem.meta.block_index = (uint32_t)block_idx;
  memid.mem.meta.block_count = (uint32_t)block_count;
  memid.initially_committed = true;
  memid.initially_zero = true;
  memid.is_pinned = true;
  return memid;
}


// -------------------------------------------------------------------
// Fast "random" shuffle
// -------------------------------------------------------------------

static inline uintptr_t _mi_random_shuffle(uintptr_t x) {
  if (x==0) { x = 17; }   // ensure we don't get stuck in generating zeros
#if (MI_INTPTR_SIZE>=8)
  // by Sebastiano Vigna, see: <http://xoshiro.di.unimi.it/splitmix64.c>
  x ^= x >> 30;
  x *= 0xbf58476d1ce4e5b9UL;
  x ^= x >> 27;
  x *= 0x94d049bb133111ebUL;
  x ^= x >> 31;
#elif (MI_INTPTR_SIZE==4)
  // by Chris Wellons, see: <https://nullprogram.com/blog/2018/07/31/>
  x ^= x >> 16;
  x *= 0x7feb352dUL;
  x ^= x >> 15;
  x *= 0x846ca68bUL;
  x ^= x >> 16;
#endif
  return x;
}


// ---------------------------------------------------------------------------------
// Provide our own `_mi_memcpy/set` for potential performance optimizations.
//
// For now, only on x64/x86 we optimize to `rep movsb/stosb`.
// Generally, we check for "fast short rep movsb/stosb" (FSRM/FSRS) or "fast enhanced rep movsb" (ERMS) support
// (AMD Zen3+ (~2020) or Intel Ice Lake+ (~2017). See also issue #201 and pr #253.
// Todo: we see improvements on win32 but less with glibc; we might want to only enable this on windows.
// ---------------------------------------------------------------------------------

#if !MI_TRACK_ENABLED && (MI_ARCH_X64 || MI_ARCH_X86) && (defined(_WIN32) || defined(__GNUC__))

extern mi_decl_hidden size_t _mi_cpu_movsb_max;  // in init.c
extern mi_decl_hidden size_t _mi_cpu_stosb_max;

static inline void mi_rep_movsb(void* dst, const void* src, size_t n) {
  #if defined(__GNUC__)
  __asm volatile("rep movsb" : "+D"(dst), "+c"(n), "+S"(src) : : "memory");
  #else
  __movsb((unsigned char*)dst, (const unsigned char*)src, n);
  #endif
}

static inline void mi_rep_stosb(void* dst, uint8_t val, size_t n) {
  #if defined(__GNUC__)
  __asm volatile("rep stosb" : "+D"(dst), "+c"(n) : "a"(val) : "memory");
  #else
  __stosb((unsigned char*)dst, val, n);
  #endif
}

static inline void _mi_memcpy(void* dst, const void* src, size_t n) {
  if mi_likely(n <= _mi_cpu_movsb_max) {  // has fsrm && n <= 127  (todo: and maybe has erms?)
    mi_rep_movsb(dst, src, n);
  }
  else {
    memcpy(dst, src, n);
  }
}

static inline void _mi_memset(void* dst, int val, size_t n) {
  if mi_likely(n <= _mi_cpu_stosb_max) {  // has fsrs && n <= 127
    mi_rep_stosb(dst, (uint8_t)val, n);
  }
  else {
    memset(dst, val, n);
  }
}

#else

static inline void _mi_memcpy(void* dst, const void* src, size_t n) {
  memcpy(dst, src, n);
}

static inline void _mi_memset(void* dst, int val, size_t n) {
  memset(dst, val, n);
}

#endif

// -------------------------------------------------------------------------------
// The `_mi_memcpy_aligned` can be used if the pointers are machine-word aligned
// This is used for example in `mi_realloc`.
// -------------------------------------------------------------------------------

#if (defined(__GNUC__) && (__GNUC__ >= 4)) || defined(__clang__)

// On GCC/CLang we provide a hint that the pointers are word aligned.
static inline void _mi_memcpy_aligned(void* dst, const void* src, size_t n) {
  mi_assert_internal(((uintptr_t)dst % MI_INTPTR_SIZE == 0) && ((uintptr_t)src % MI_INTPTR_SIZE == 0));
  void* adst = __builtin_assume_aligned(dst, MI_INTPTR_SIZE);
  const void* asrc = __builtin_assume_aligned(src, MI_INTPTR_SIZE);
  _mi_memcpy(adst, asrc, n);
}

static inline void _mi_memset_aligned(void* dst, int val, size_t n) {
  mi_assert_internal((uintptr_t)dst % MI_INTPTR_SIZE == 0);
  void* adst = __builtin_assume_aligned(dst, MI_INTPTR_SIZE);
  _mi_memset(adst, val, n);
}

#else

// Default fallback on `_mi_memcpy`
static inline void _mi_memcpy_aligned(void* dst, const void* src, size_t n) {
  mi_assert_internal(((uintptr_t)dst % MI_INTPTR_SIZE == 0) && ((uintptr_t)src % MI_INTPTR_SIZE == 0));
  _mi_memcpy(dst, src, n);
}

static inline void _mi_memset_aligned(void* dst, int val, size_t n) {
  mi_assert_internal((uintptr_t)dst % MI_INTPTR_SIZE == 0);
  _mi_memset(dst, val, n);
}

#endif

static inline void _mi_memzero(void* dst, size_t n) {
  _mi_memset(dst, 0, n);
}

static inline void _mi_memzero_aligned(void* dst, size_t n) {
  _mi_memset_aligned(dst, 0, n);
}



#endif  // MI_INTERNAL_H
