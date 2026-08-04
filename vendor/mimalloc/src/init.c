/* ----------------------------------------------------------------------------
Copyright (c) 2018-2026, Microsoft Research, Daan Leijen
This is free software; you can redistribute it and/or modify it under the
terms of the MIT license. A copy of the license can be found in the file
"LICENSE" at the root of this distribution.
-----------------------------------------------------------------------------*/
#include "mimalloc.h"
#include "mimalloc/internal.h"
#include "mimalloc/prim.h"
#include "mimalloc/prim-tls.h"

#include <string.h>  // memcpy, memset
#include <stdlib.h>  // atexit

#if MI_DEBUG > 0
mi_decl_export volatile int mi_debug_stall_in_thread_theaps_done = 0;
#endif

#define MI_MEMID_INIT(kind)   {{{NULL,0}}, kind, true /* pinned */, true /* committed */, false /* zero */ }
#define MI_MEMID_STATIC       MI_MEMID_INIT(MI_MEM_STATIC)

// Empty page used to initialize the small free pages array
const mi_page_t _mi_page_empty = {
  MI_ATOMIC_VAR_INIT(0),  // xthread_id
  NULL,                   // free
  0,                      // used
  0,                      // capacity
  0,                      // reserved capacity
  0,                      // retire_expire
  false,                  // is_zero
  NULL,                   // local_free
  MI_ATOMIC_VAR_INIT(0),  // xthread_free
  0,                      // block_size
  0,                      // page_woffset
  MI_ARENA_SLICE_SIZE,    // page_committed
  #if (MI_PADDING || MI_ENCODE_FREELIST)
  { 0, 0 },               // keys
  #endif
  NULL,                   // theap
  NULL,                   // heap
  NULL, NULL,             // next, prev
  MI_MEMID_STATIC,        // memid
  { 0 },                  // purged
  0,                      // unformed_purged_lo
  0,                      // unformed_purged_hi
  MI_PAGE_SWEPT_NONE      // swept_state
};

#define MI_PAGE_EMPTY() ((mi_page_t*)&_mi_page_empty)

#if (MI_PADDING>0) && (MI_INTPTR_SIZE >= 8)
#define MI_SMALL_PAGES_EMPTY  { MI_INIT128(MI_PAGE_EMPTY), MI_PAGE_EMPTY(), MI_PAGE_EMPTY() }
#elif (MI_PADDING>0)
#define MI_SMALL_PAGES_EMPTY  { MI_INIT128(MI_PAGE_EMPTY), MI_PAGE_EMPTY(), MI_PAGE_EMPTY(), MI_PAGE_EMPTY() }
#else
#define MI_SMALL_PAGES_EMPTY  { MI_INIT128(MI_PAGE_EMPTY), MI_PAGE_EMPTY() }
#endif


// Empty page queues for every bin
#define QNULL(sz)  { NULL, NULL, 0, (sz)*sizeof(uintptr_t) }
#define MI_PAGE_QUEUES_EMPTY \
  { QNULL(1), \
    QNULL(     1), QNULL(     2), QNULL(     3), QNULL(     4), QNULL(     5), QNULL(     6), QNULL(     7), QNULL(     8), /* 8 */ \
    QNULL(    10), QNULL(    12), QNULL(    14), QNULL(    16), QNULL(    20), QNULL(    24), QNULL(    28), QNULL(    32), /* 16 */ \
    QNULL(    40), QNULL(    48), QNULL(    56), QNULL(    64), QNULL(    80), QNULL(    96), QNULL(   112), QNULL(   128), /* 24 */ \
    QNULL(   160), QNULL(   192), QNULL(   224), QNULL(   256), QNULL(   320), QNULL(   384), QNULL(   448), QNULL(   512), /* 32 */ \
    QNULL(   640), QNULL(   768), QNULL(   896), QNULL(  1024), QNULL(  1280), QNULL(  1536), QNULL(  1792), QNULL(  2048), /* 40 */ \
    QNULL(  2560), QNULL(  3072), QNULL(  3584), QNULL(  4096), QNULL(  5120), QNULL(  6144), QNULL(  7168), QNULL(  8192), /* 48 */ \
    QNULL( 10240), QNULL( 12288), QNULL( 14336), QNULL( 16384), QNULL( 20480), QNULL( 24576), QNULL( 28672), QNULL( 32768), /* 56 */ \
    QNULL( 40960), QNULL( 49152), QNULL( 57344), QNULL( 65536), QNULL( 81920), QNULL( 98304), QNULL(114688), QNULL(131072), /* 64 */ \
    QNULL(163840), QNULL(196608), QNULL(229376), QNULL(262144), QNULL(327680), QNULL(393216), QNULL(458752), QNULL(524288), /* 72 */ \
    QNULL(MI_LARGE_MAX_OBJ_WSIZE + 1  /* 655360, Huge queue */), \
    QNULL(MI_LARGE_MAX_OBJ_WSIZE + 2) /* Full queue */ }

#define MI_STAT_COUNT_NULL()  {0,0,0}

// Empty statistics
#define MI_STAT_COUNT(stat)     {0,0,0},
#define MI_STAT_COUNTER(stat)   {0},

#define MI_STATS_NULL  \
  MI_STAT_FIELDS() \
  \
  { MI_INIT4(MI_STAT_COUNT_NULL) }, \
  { { 0 }, { 0 }, { 0 }, { 0 } }, \
  \
  { MI_INIT74(MI_STAT_COUNT_NULL) }, \
  { MI_INIT74(MI_STAT_COUNT_NULL) }, \
  { MI_INIT5(MI_STAT_COUNT_NULL) }

// --------------------------------------------------------
// Statically allocate an empty theap as the initial
// thread local value for the default theap,
// and statically allocate the backing theap for the main
// thread so it can function without doing any allocation
// itself (as accessing a thread local for the first time
// may lead to allocation itself on some platforms)
// --------------------------------------------------------

static mi_decl_cache_align mi_subproc_t subproc_main
#if __cplusplus
  = { };     // empty initializer to prevent running the constructor (with msvc)
#else
  = { 0 };   // C zero initialize
#endif

static mi_subproc_t* subprocs = &subproc_main;
static mi_lock_t     subprocs_lock;

static mi_decl_cache_align mi_tld_t tld_empty = {
  0,                      // thread_id
  0,                      // thread_seq
  0,                      // default numa node
  &subproc_main,          // subproc
  NULL,                   // theaps list
  MI_LOCK_INITIALIZER,    // theaps lock
  false,                  // recurse
  false,                  // is_in_threadpool
  MI_MEMID_STATIC         // memid
};

mi_decl_cache_align const mi_theap_t _mi_theap_empty = {
  &tld_empty,             // tld
  MI_ATOMIC_VAR_INIT(NULL), // heap
  MI_ATOMIC_VAR_INIT(NULL), // subproc
  MI_ATOMIC_VAR_INIT(1),  // refcount
  MI_ATOMIC_VAR_INIT(0),  // freed
  0,                      // heartbeat
  0,                      // cookie
  { {0}, {0}, 0, true },  // random
  0,                      // page count
  MI_BIN_FULL, 0,         // page retired min/max
  0,                      // pages_full_size
  0, 0,                   // generic count
  NULL, NULL,             // tnext, tprev
  NULL, NULL,             // hnext, hprev
  0,                      // full page retain
  false,                  // allow reclaim
  false,                  // frozen
  true,                   // allow abandon
  false, 0,               // prof_force_slow, prof_countdown
  #if MI_GUARDED
  1, 0, 0, 1,             // min>max and count is 1 so we never write to it (see `internal.h:mi_heap_malloc_use_guarded`)
  #endif
  MI_SMALL_PAGES_EMPTY,
  MI_PAGE_QUEUES_EMPTY,
  MI_MEMID_STATIC,
  { sizeof(mi_stats_t), MI_STAT_VERSION, MI_STATS_NULL },      // stats
};

mi_decl_cache_align const mi_theap_t _mi_theap_empty_wrong = {
  &tld_empty,             // tld
  MI_ATOMIC_VAR_INIT(NULL), // heap
  MI_ATOMIC_VAR_INIT(NULL), // subproc
  MI_ATOMIC_VAR_INIT(1),  // refcount
  MI_ATOMIC_VAR_INIT(0),  // freed
  0,                      // heartbeat
  1,                      // cookie  (see issue #1343)
  { {0}, {0}, 0, true },  // random
  0,                      // page count
  MI_BIN_FULL, 0,         // page retired min/max
  0,                      // pages_full_size
  0, 0,                   // generic count
  NULL, NULL,             // tnext, tprev
  NULL, NULL,             // hnext, hprev
  0,                      // full page retain
  false,                  // allow reclaim
  false,                  // frozen
  true,                   // allow abandon
  false, 0,               // prof_force_slow, prof_countdown
  #if MI_GUARDED
  1, 0, 0, 1,             // min>max and sample count is 1 so we never write to it (see `internal.h:mi_theap_malloc_use_guarded`)
  #endif
  MI_SMALL_PAGES_EMPTY,
  MI_PAGE_QUEUES_EMPTY,
  MI_MEMID_STATIC,
  { sizeof(mi_stats_t), MI_STAT_VERSION, MI_STATS_NULL },      // stats
};

// Heap for the main thread

#define MI_THREADID_INVALID ((mi_threadid_t)(~0))

extern mi_decl_hidden mi_decl_cache_align mi_theap_t mi_theap_main;         // theap of the main thread (belonging to the `mi_process_heap_main`)
extern mi_decl_hidden mi_decl_cache_align mi_heap_t  mi_process_heap_main;  // main heap of the main subproc

static mi_decl_cache_align mi_tld_t mi_process_tld_main = {
  0,                      // thread_id
  0,                      // thread_seq
  0,                      // numa node
  &subproc_main,          // subproc
  &mi_theap_main, // theaps list
  MI_LOCK_INITIALIZER,    // theaps lock
  false,                  // recurse
  false,                  // is_in_threadpool
  MI_MEMID_STATIC         // memid
};

mi_decl_cache_align mi_theap_t mi_theap_main = {
  &mi_process_tld_main,              // thread local data
  MI_ATOMIC_VAR_INIT(&mi_process_heap_main), // main heap
  MI_ATOMIC_VAR_INIT(&subproc_main),         // main subproc
  MI_ATOMIC_VAR_INIT(1),  // refcount
  MI_ATOMIC_VAR_INIT(0),  // freed
  0,                      // heartbeat
  0,                      // initial cookie
  { {0x846ca68b}, {0}, 0, true },  // random
  0,                      // page count
  MI_BIN_FULL, 0,         // page retired min/max
  0,                      // pages_full_size
  0, 0,                   // generic count
  NULL, NULL,             // tnext, tprev
  NULL, NULL,             // hnext, hprev
  2,                      // full page retain
  true,                   // allow page reclaim
  false,                  // frozen
  true,                   // allow page abandon
  false, 0,               // prof_force_slow, prof_countdown
  #if MI_GUARDED
  0, 0, 0, 0,
  #endif
  MI_SMALL_PAGES_EMPTY,
  MI_PAGE_QUEUES_EMPTY,
  MI_MEMID_STATIC,
  { sizeof(mi_stats_t), MI_STAT_VERSION, MI_STATS_NULL },      // stats
};

mi_decl_cache_align mi_heap_t mi_process_heap_main
#if __cplusplus
  = { };     // empty initializer to prevent running the constructor (with msvc)
#else
  = { 0 };   // C zero initialize
#endif

mi_threadid_t _mi_thread_id(void) mi_attr_noexcept {
  const mi_threadid_t tid = _mi_prim_thread_id();
  mi_assert_internal( (tid & 0x03) == 0 ); // mimalloc reserves the bottom 2 bits
  return tid;
}

mi_decl_hidden mi_decl_thread void* __mi_thread_id_helper = NULL;

#if MI_TLS_MODEL_LOCAL
// the thread-local main theap for allocation
mi_decl_hidden mi_decl_thread mi_theap_t* __mi_theap_default = (mi_theap_t*)&_mi_theap_empty;
// the last used non-main theap
mi_decl_hidden mi_decl_thread mi_theap_t* __mi_theap_cached = (mi_theap_t*)&_mi_theap_empty;
#endif

mi_decl_hidden bool _mi_process_is_initialized = false;  // set to `true` in `mi_process_init`.

mi_stats_t _mi_stats_main = { sizeof(mi_stats_t), MI_STAT_VERSION, MI_STATS_NULL };

#undef MI_STAT_COUNT
#undef MI_STAT_COUNTER


#if MI_GUARDED
mi_decl_export void mi_theap_guarded_set_sample_rate(mi_theap_t* theap, size_t sample_rate, size_t seed) {
  theap->guarded_sample_rate  = sample_rate;
  theap->guarded_sample_count = sample_rate;  // count down samples
  if (theap->guarded_sample_rate > 1) {
    if (seed == 0) {
      seed = _mi_theap_random_next(theap);
    }
    theap->guarded_sample_count = (seed % theap->guarded_sample_rate) + 1;  // start at random count between 1 and `sample_rate`
  }
}

mi_decl_export void mi_theap_guarded_set_size_bound(mi_theap_t* theap, size_t min, size_t max) {
  theap->guarded_size_min = min;
  theap->guarded_size_max = (min > max ? min : max);
}

void _mi_theap_guarded_init(mi_theap_t* theap) {
  mi_theap_guarded_set_sample_rate(theap,
    (size_t)mi_option_get_clamp(mi_option_guarded_sample_rate, 0, LONG_MAX),
    (size_t)mi_option_get(mi_option_guarded_sample_seed));
  mi_theap_guarded_set_size_bound(theap,
    (size_t)mi_option_get_clamp(mi_option_guarded_min, 0, LONG_MAX),
    (size_t)mi_option_get_clamp(mi_option_guarded_max, 0, LONG_MAX) );
}
#else
mi_decl_export void mi_theap_guarded_set_sample_rate(mi_theap_t* theap, size_t sample_rate, size_t seed) {
  MI_UNUSED(theap); MI_UNUSED(sample_rate); MI_UNUSED(seed);
}

mi_decl_export void mi_theap_guarded_set_size_bound(mi_theap_t* theap, size_t min, size_t max) {
  MI_UNUSED(theap); MI_UNUSED(min); MI_UNUSED(max);
}
void _mi_theap_guarded_init(mi_theap_t* theap) {
  MI_UNUSED(theap);
}
#endif

/* -----------------------------------------------------------
  Initialization
  Note: on some platforms lock_init or just a thread local access
  can cause allocation and induce recursion during initialization.
----------------------------------------------------------- */


// Initialize main subproc
static void mi_subproc_main_init(void) {
  if (subproc_main.memid.memkind != MI_MEM_STATIC) {
    subproc_main.memid = _mi_memid_create(MI_MEM_STATIC);
    subproc_main.heaps = &mi_process_heap_main;
    subproc_main.heap_total_count = 1;
    subproc_main.heap_count = 1;
    mi_atomic_store_ptr_release(mi_heap_t, &subproc_main.heap_main, &mi_process_heap_main);
    __mi_stat_increase_mt(&subproc_main.stats.heaps, 1);
    mi_stats_header_init(&subproc_main.stats);
    mi_lock_init(&subproc_main.arena_reserve_lock);
    mi_lock_init(&subproc_main.heaps_lock);
    mi_lock_init(&subproc_main.tlds_lock);
    mi_lock_init(&subprocs_lock);
    mi_lock_init(&tld_empty.theaps_lock);
  }
}

// Initialize main tld
static void mi_tld_register(mi_tld_t* tld);   // defined below, with the rest of the registry

static void mi_tld_main_init(void) {
  if (mi_process_tld_main.thread_id == 0) {
    mi_process_tld_main.thread_id = _mi_prim_thread_id();
    mi_lock_init(&mi_process_tld_main.theaps_lock);
  }
  // The main thread's tld is static and never goes through `mi_tld_alloc`, so register it here
  // instead -- otherwise it can never hand its theaps to the scavenger. `mi_subproc_main_init`
  // runs just before this and initializes the lock the registry takes.
  mi_tld_register(&mi_process_tld_main);
}

void _mi_theap_options_init(mi_theap_t* theap) {
  theap->allow_page_reclaim = (mi_option_get(mi_option_page_reclaim_on_free) >= 0);
  theap->allow_page_abandon = (mi_option_get(mi_option_page_full_retain) >= 0);
  theap->page_full_retain = mi_option_get_clamp(mi_option_page_full_retain, -1, 32);
  _mi_prof_theap_init(theap);
}

// Initialization of the (statically allocated) main theap, and the main tld and subproc.
static void mi_theap_main_init(void) {
  if mi_unlikely(mi_theap_main.memid.memkind != MI_MEM_STATIC) {
    // theap
    mi_theap_main.memid = _mi_memid_create(MI_MEM_STATIC);
    #if defined(__APPLE__) || defined(_WIN32) && !defined(MI_SHARED_LIB)
      _mi_random_init_weak(&mi_theap_main.random);    // prevent allocation failure during bcrypt dll initialization with static linking (issue #1185)
    #else
      _mi_random_init(&mi_theap_main.random);
    #endif
    mi_theap_main.cookie  = _mi_theap_random_next(&mi_theap_main);
    _mi_theap_options_init(&mi_theap_main);
    _mi_theap_guarded_init(&mi_theap_main);
  }
}

// Initialize main heap
static void mi_heap_main_init(void) {
  if mi_unlikely(mi_process_heap_main.subproc == NULL) {
    mi_process_heap_main.subproc = &subproc_main;
    mi_process_heap_main.theaps  = &mi_theap_main;
    mi_process_heap_main.theap   = mi_thread_local_key_fast;

    mi_theap_main_init();
    mi_subproc_main_init();
    mi_tld_main_init();
    // mi_heap_theap_set(&mi_process_heap_main,&mi_theap_main); // set in `mi_thread_init(_theap_default)`

    mi_lock_init(&mi_process_heap_main.theaps_lock);
    mi_lock_init(&mi_process_heap_main.os_abandoned_pages_lock);
    mi_lock_init(&mi_process_heap_main.arena_pages_lock);
  }
}


/* -----------------------------------------------------------
  Thread local data
----------------------------------------------------------- */

// Register a tld with its subproc so the scavenger can find it when it parks
// (`mi_on_thread_idle_start`). Idempotent: the main thread's static tld can come through
// `mi_tld_alloc` more than once if the thread is re-initialized after `_mi_thread_done`.
static void mi_tld_register(mi_tld_t* tld) {
  if (tld == NULL) return;
  mi_subproc_t* const subproc = tld->subproc;
  mi_lock(&subproc->tlds_lock) {
    for (mi_tld_t* t = subproc->tlds; t != NULL; t = t->subproc_next) {
      if (t == tld) goto done;   // already registered
    }
    tld->subproc_next = subproc->tlds;
    subproc->tlds = tld;
  done: ;
  }
}

// Unlink before the tld memory goes away. The tld cannot be mid-sweep here: only a PARKED tld is
// ever claimed, and a thread running its own teardown is RUNNING by definition -- assert it.
static void mi_tld_unregister(mi_tld_t* tld) {
  if (tld == NULL) return;
  mi_assert_internal(mi_atomic_load_acquire(&tld->park_state) != MI_PARK_SWEEPING);
  mi_subproc_t* const subproc = tld->subproc;
  mi_lock(&subproc->tlds_lock) {
    mi_tld_t** prev = &subproc->tlds;
    while (*prev != NULL) {
      if (*prev == tld) { *prev = tld->subproc_next; break; }
      prev = &(*prev)->subproc_next;
    }
    tld->subproc_next = NULL;
  }
}

// Allocate fresh tld
static mi_tld_t* mi_tld_alloc(mi_subproc_t* subproc) {
  // if (_mi_is_main_thread()) {
  //   mi_atomic_increment_relaxed(&tld_main.subproc->thread_count);
  //   return &tld_main;
  // }
  // else
  {
    // allocate tld meta-data
    // note: we need to be careful to not access the tld from `_mi_meta_zalloc`
    // (and in turn from `_mi_arena_alloc_aligned` and `_mi_os_alloc_aligned`).
    mi_memid_t memid;
    mi_tld_t* tld = (mi_tld_t*)_mi_meta_zalloc(subproc, sizeof(mi_tld_t), &memid);
    if (tld==NULL) {
      _mi_error_message(ENOMEM, "unable to allocate memory for thread local data\n");
      return NULL;
    }
    tld->memid = memid;
    tld->theaps = NULL;
    mi_lock_init(&tld->theaps_lock);
    tld->subproc = subproc;
    tld->numa_node = _mi_os_numa_node();
    tld->thread_id = _mi_prim_thread_id();
    tld->thread_seq = mi_atomic_increment_relaxed(&tld->subproc->thread_total_count);
    tld->is_in_threadpool = _mi_prim_thread_is_in_threadpool();
    mi_atomic_increment_relaxed(&tld->subproc->thread_count);
    mi_tld_register(tld);
    return tld;
  }
}

#define MI_TLD_INVALID  ((mi_tld_t*)1)

mi_decl_noinline static void mi_tld_free(mi_tld_t* tld) {
  if (tld==NULL || tld==MI_TLD_INVALID) return;
  mi_tld_unregister(tld);
  mi_atomic_decrement_relaxed(&tld->subproc->thread_count);
  tld->thread_id = MI_THREADID_INVALID;              // note: not 0 as that would re-initialize tld_main
                                                     // we also need to set an invalid tid for tld_main as sometimes the same thread-id
                                                     // is reused by the OS after a thread has terminated. (see issue #1287)
  mi_lock_done(&tld->theaps_lock);
  _mi_meta_free(tld->subproc, tld, sizeof(mi_tld_t), tld->memid);  // note: safe for static tld_main
}


mi_subproc_t* _mi_subproc_main(void) {
  return &subproc_main;
}

mi_subproc_t* _mi_subproc(void) {
  // should work without doing initialization (as it may be called from `_mi_tld -> mi_tld_alloc ... -> os_alloc -> _mi_subproc()`
  // todo: this will still fail on OS systems where the first access to a thread-local causes allocation.
  //       on such systems we can check for this with the _mi_prim_get_default_theap as those are protected (by being
  //       stored in a TLS slot for example)
  mi_theap_t* theap = _mi_theap_default();
  if (theap == NULL || theap->tld == NULL) {  // see issue #1289
    return _mi_subproc_main();
  }
  else {
    return theap->tld->subproc;  // avoid using thread local storage (`thread_tld`)
  }
}

mi_heap_t* _mi_subproc_heap_main(mi_subproc_t* subproc) {
  mi_heap_t* heap = mi_atomic_load_ptr_acquire(mi_heap_t,&subproc->heap_main);
  if mi_likely(heap!=NULL) {
    return heap;
  }
  else if (subproc==_mi_subproc_main()) {
    mi_heap_main_init();
    mi_assert_internal(mi_atomic_load_ptr_acquire(mi_heap_t,&subproc->heap_main) != NULL);
    return mi_atomic_load_ptr_acquire(mi_heap_t,&subproc->heap_main);
  }
  else {
    mi_assert_internal(false);
    return &mi_process_heap_main;
  }
}

mi_heap_t* mi_heap_main(void) {
  return _mi_subproc_heap_main(_mi_subproc()); // don't use mi_theap_main_init_get() so this call works during process_init
}

bool _mi_is_process_heap_main(const mi_heap_t* heap) {
  return (heap == NULL || heap == &mi_process_heap_main);
}

bool _mi_is_theap_main(const mi_theap_t* theap) {
  return (mi_theap_is_initialized(theap) && _mi_is_heap_main(_mi_theap_heap(theap)));
}



/* -----------------------------------------------------------
  Sub process
----------------------------------------------------------- */


mi_subproc_t* _mi_subproc_from_id(mi_subproc_id_t subproc_id) {
  return (mi_subproc_t*)(subproc_id._mi_subproc_id);
}

mi_subproc_id_t _mi_subproc_to_id(mi_subproc_t* subproc) {
  mi_subproc_id_t id = { subproc };
  return id;
}

mi_subproc_id_t mi_subproc_main(void) {
  return _mi_subproc_to_id(_mi_subproc_main());
}

mi_subproc_id_t mi_subproc_current(void) {
  return _mi_subproc_to_id(_mi_subproc());
}

mi_subproc_id_t mi_subproc_new(void) {
  static _Atomic(size_t) subproc_total_count;
  mi_subproc_t* const parent = _mi_subproc();
  mi_memid_t memid;
  mi_subproc_t* subproc = (mi_subproc_t*)_mi_meta_zalloc(parent, sizeof(mi_subproc_t),&memid);
  if (subproc == NULL) { return _mi_subproc_to_id(NULL); }

  // init subproc
  subproc->memid = memid;
  subproc->parent = parent;
  subproc->subproc_seq = mi_atomic_increment_relaxed(&subproc_total_count) + 1;
  mi_stats_header_init(&subproc->stats);
  mi_lock_init(&subproc->arena_reserve_lock);
  mi_lock_init(&subproc->heaps_lock);
  mi_lock_init(&subproc->tlds_lock);
  mi_lock(&subprocs_lock) {
    // push on subproc list
    subproc->next = subprocs;
    if (subprocs!=NULL) { subprocs->prev = subproc; }
    subprocs = subproc;
  }

  // init main heap
  mi_heap_t* heap_main = _mi_heap_new_for_subproc(subproc,0,true);
  if (heap_main==NULL) {
    mi_subproc_destroy(_mi_subproc_to_id(subproc));
    return _mi_subproc_to_id(NULL);
  }
  mi_assert_internal(subproc->heap_main == heap_main);

  return _mi_subproc_to_id(subproc);
}

// destroy all subproc resources including arena's, heap's etc.
static void mi_subproc_unsafe_destroy(mi_subproc_t* subproc, bool acquire_subprocs_lock)
{
  if (subproc==NULL) return;

  // remove from the subproc list
  mi_lock_maybe(&subprocs_lock, acquire_subprocs_lock) {
    if (subproc->next!=NULL) { subproc->next->prev = subproc->prev;  }
    if (subproc->prev!=NULL) { subproc->prev->next = subproc->next;  }
                        else { mi_assert_internal(subprocs==subproc);  subprocs = subproc->next; }
  }

  // destroy all subproc heaps
  mi_lock(&subproc->heaps_lock) {
    mi_heap_t* heap = subproc->heaps;
    while (heap != NULL) {
      mi_heap_t* next = heap->next;
      if (heap!=subproc->heap_main) { mi_heap_destroy(heap); }
      heap = next;
    }
    mi_assert_internal(subproc->heap_main==NULL || subproc->heaps == subproc->heap_main);
    if (subproc->heap_main!=NULL) {
      _mi_heap_force_destroy(subproc->heap_main);  // no warning if destroying the main heap
    }
  }

  // remove associated arenas
  _mi_arenas_unsafe_destroy_all(subproc);

  // merge stats back into the main subproc?
  if (subproc!=&subproc_main) {
    _mi_stats_merge_into(&subproc_main.stats, &subproc->stats);
  }

  // safe to release
  // todo: should we refcount subprocesses?
  mi_lock_done(&subproc->arena_reserve_lock);
  mi_lock_done(&subproc->heaps_lock);
  if (subproc!=&subproc_main) {
    _mi_meta_free( subproc->parent, subproc, sizeof(mi_subproc_t), subproc->memid);
  }
  else {
    // for the main subproc, also release the global page map
    _mi_page_map_unsafe_destroy();
  }
}

void mi_subproc_destroy(mi_subproc_id_t subproc_id) {
  mi_subproc_t* subproc = _mi_subproc_from_id(subproc_id);
  if (subproc==NULL || subproc==&subproc_main) return;
  mi_subproc_unsafe_destroy(subproc, true /* take lock */);
}

static void mi_subprocs_unsafe_destroy_all(void) {
  mi_lock(&subprocs_lock) {
    mi_subproc_t* subproc = subprocs;
    while (subproc!=NULL) {
      mi_subproc_t* next = subproc->next;
      if (subproc!=&subproc_main) {
        mi_subproc_unsafe_destroy(subproc, false /* take subprocs lock */);
      }
      subproc = next;
    }
  }
  mi_subproc_unsafe_destroy(&subproc_main, true /* take subprocs lock */);
}

static mi_theap_t* mi_thread_init_ex(mi_heap_t* heap_main) mi_attr_noexcept;

void mi_subproc_add_current_thread(mi_subproc_id_t subproc_id) {
  mi_subproc_t* subproc = _mi_subproc_from_id(subproc_id);
  mi_assert_internal(subproc!=NULL);
  if (subproc==NULL) return;
  mi_assert_internal(subproc->heap_main!=NULL);
  if (subproc->heap_main==NULL) return;
  mi_theap_t* theap = _mi_theap_default();
  if (mi_theap_is_initialized(theap)) {
    if (theap->tld!=NULL && theap->tld->subproc != subproc) {
      _mi_warning_message("unable to add thread to the subprocess as it was already in another subprocess (at %p)\n", theap->tld->subproc);
    }
    return;
  }

  // initialize this thread tld & theap
  mi_thread_init_ex(subproc->heap_main);
}


bool mi_subproc_visit_heaps(mi_subproc_id_t subproc_id, mi_heap_visit_fun* visitor, void* arg) {
  mi_subproc_t* subproc = _mi_subproc_from_id(subproc_id);
  if (subproc==NULL) return false;
  bool ok = true;
  mi_lock(&subproc->heaps_lock) {
    for (mi_heap_t* heap = subproc->heaps; heap!=NULL && ok; heap = heap->next) {
      ok = (*visitor)(heap, arg);
    }
  }
  return ok;
}


/* -----------------------------------------------------------
  Allocate theap data
----------------------------------------------------------- */

static mi_theap_t* mi_heap_check_for_existing_theap(mi_heap_t* heap) {
  const mi_threadid_t tid = _mi_thread_id();
  mi_theap_t* thread_theap = NULL;
  mi_lock(&heap->theaps_lock) {
    for(mi_theap_t* theap = heap->theaps; theap != NULL; theap = theap->hnext ) {
      if (theap->tld->thread_id == tid) {
        thread_theap = theap;
        break;
      }
    }
  }
  return thread_theap;
}

// Initialize the thread local default theap, called from `mi_thread_init`
static mi_theap_t* _mi_thread_init_theap_default(mi_heap_t* heap_main) {
  mi_theap_t* theap = _mi_theap_default();
  if (mi_theap_is_initialized(theap)) return theap;
  if (_mi_is_main_thread() && heap_main==NULL) {
    heap_main = &mi_process_heap_main;
    theap = &mi_theap_main;
    mi_heap_main_init();
  }
  else {
    // allocates tld data
    // note: we cannot access thread-locals yet as that can cause (recursive) allocation
    // (on macOS <= 14 for example where the loader allocates thread-local data on demand).
    if (heap_main==NULL) {
      heap_main = mi_heap_main();
      mi_assert_internal(heap_main == &mi_process_heap_main);
    }
    mi_assert_internal(heap_main!=NULL);
    theap = mi_heap_check_for_existing_theap(heap_main);
    if (theap==NULL)
    {
      // allocated the tld
      mi_tld_t* tld = mi_tld_alloc(heap_main->subproc);
      if (tld==NULL) return NULL;    // out-of-memory on tld allocation

      // allocate and initialize the theap for the main heap
      theap = _mi_theap_create( heap_main, tld);
      if (theap==NULL) return NULL;  // out-of-memory on theap allocation
    }
  }
  // now initialize the thread
  _mi_theap_default_set(theap);

  // and only then set the heap_theap field as that accesses thread locals
  _mi_heap_theap_set(heap_main, theap);  // todo: can fail!

  mi_assert_internal(mi_theap_is_initialized(theap));
  mi_theap_t* const heap_theap = (heap_main==NULL ? NULL : (mi_theap_t*)_mi_thread_local_get(heap_main->theap));
  mi_assert_internal(heap_main==NULL || heap_theap == theap); MI_UNUSED_RELEASE(heap_theap);
  return theap;
}


// Free the thread local theaps
static void mi_thread_theaps_done(mi_tld_t* tld)
{
  // abandon the pages of all theaps in this thread
  mi_lock(&tld->theaps_lock) {
    #if MI_DEBUG > 0
    if (mi_debug_stall_in_thread_theaps_done) {
      mi_debug_stall_in_thread_theaps_done = 2; // signal: tld->theaps_lock held
      while (mi_debug_stall_in_thread_theaps_done) { _mi_prim_thread_yield(); }
    }
    #endif
    mi_theap_t* theap = tld->theaps;
    while (theap != NULL) {
      mi_theap_t* next = theap->tnext;
      // never destroy theaps; if a dll is linked statically with mimalloc,
      // there may still be delete/free calls after the mi_fls_done is called. Issue #207
      _mi_theap_collect_abandon(theap);
      // A concurrent `mi_heap_free_theaps` may NULL theap->heap (so collect no-ops)
      // and then CAS it back if its inner try-acquire fails; in that window the
      // page_count invariant doesn't hold here. The second loop re-collects.
      theap = next;
    }
  }

  // reset the thread local theaps
  // note: do this after abandon as page->heap may be NULL and mi_heap_main should return the heap
  // belonging to the right subprocess
  _mi_theap_default_set((mi_theap_t*)&_mi_theap_empty);
  _mi_theap_cached_set((mi_theap_t*)&_mi_theap_empty);

  // free the theaps of this thread.
  // This can run concurrently with a `mi_heap_free_theaps` and we need to ensure we free theaps atomically.
  // We do this in a loop where we release the theaps_lock at every potential re-iteration to unblock
  // potential concurrent `mi_heap_free_theaps` which tries to remove the theap from our theaps list.
  bool all_freed;
  do {
    all_freed = true;
    mi_lock(&tld->theaps_lock) {
      mi_theap_t* theap = tld->theaps;
      while (theap != NULL) {
        mi_theap_t* next = theap->tnext;
        // A concurrent `mi_heap_free_theaps` may have transiently NULL'd
        // theap->heap (and CAS'd it back on inner-lock failure or page_count>0),
        // causing our first-loop collect to no-op. Re-collect; idempotent and
        // cheap if already done. `_mi_theap_free` below also guards against
        // freeing with pages from the non-owning side.
        if (theap->page_count != 0) {
          _mi_theap_collect_abandon(theap);
        }
        if (!_mi_theap_free(theap, true /* acquire heap->theaps_lock */, false /* dont re-acquire the tld->theaps_lock*/ )) {
          all_freed = false;
        }
        theap = next;
      }
    }
    if (!all_freed) {
      mi_subproc_stat_counter_increase(tld->subproc,heaps_delete_wait,1);
      _mi_prim_thread_yield();
    }
    else {
      mi_assert_internal(tld->theaps==NULL);
    }
  } while (!all_freed);

  mi_assert(_mi_theap_default()==(mi_theap_t*)&_mi_theap_empty); // careful to not re-initialize the default theap during theap_delete
  mi_assert(!mi_theap_is_initialized(_mi_theap_default()));
}


// --------------------------------------------------------
// Try to run `mi_thread_done()` automatically so any memory
// owned by the thread but not yet released can be abandoned
// and re-owned by another thread.
//
// 1. windows dynamic library:
//     call from DllMain on DLL_THREAD_DETACH
// 2. windows static library:
//     use special linker section to call a destructor when the thread is done
// 3. unix, pthreads:
//     use a pthread key to call a destructor when a pthread is done
//
// In the last two cases we also need to call `mi_process_init`
// to set up the thread local keys.
// --------------------------------------------------------

// Set up handlers so `mi_thread_done` is called automatically
static void mi_process_setup_auto_thread_done(void) {
  mi_atomic_do_once {
    _mi_prim_thread_init_auto_done();
    _mi_theap_default_set(&mi_theap_main);
  }
}


bool _mi_is_main_thread(void) {
  return (mi_process_tld_main.thread_id==0 || mi_process_tld_main.thread_id == _mi_thread_id());
}

// Initialize thread
static mi_theap_t* mi_thread_init_ex(mi_heap_t* heap_main) mi_attr_noexcept
{
  // ensure our process has started already
  mi_process_init();

  // if the theap_default is already set we have already initialized
  mi_theap_t* theap = _mi_theap_default();
  if (mi_theap_is_initialized(theap)) return theap;

  // otherwise initialize the default theap
  theap = _mi_thread_init_theap_default(heap_main);
  if (theap == NULL) return NULL; // out-of-memory on tld/theap allocation

  mi_subproc_stat_increase(_mi_theap_subproc(theap), threads, 1);  // or theap stats and wait for merge?
  // _mi_verbose_message("thread init: 0x%zx\n", _mi_thread_id());
  return theap;
}

mi_theap_t* _mi_thread_init(void) {
  return mi_thread_init_ex(NULL);
}

void mi_decl_noinline mi_thread_init(void) mi_attr_noexcept {
  _mi_thread_init();
}

void mi_thread_done(void) mi_attr_noexcept {
  _mi_thread_done(NULL);
}

void _mi_thread_done(mi_theap_t* _theap_main)
{
  // NULL can be passed on some platforms
  if (_theap_main==NULL) {
    _theap_main = _mi_theap_default();
  }

  // prevent re-entrancy through theap_done/theap_set_default_direct (issue #699)
  if (!mi_theap_is_initialized(_theap_main)) {
    return;
  }

  // note: we store the tld as we should avoid reading `thread_tld` at this point (to avoid reinitializing the thread local storage)
  mi_tld_t* const tld = _theap_main->tld;

  // release dynamic thread_local's
  _mi_thread_locals_thread_done();

  // adjust stats
  mi_subproc_stat_decrease(tld->subproc, threads, 1);  // todo: or `_theap_main->heap`?

  // check thread-id as on Windows shutdown with FLS the main (exit) thread may call this on
  // thread-local theaps: `tld` is another thread's, so its park is not ours to leave -- but the
  // dynamic thread_local's are the *calling* thread's own, so still release those.
  if (tld->thread_id != _mi_prim_thread_id()) {
    _mi_thread_locals_thread_done();
    return;
  }

  // a thread can reach teardown still parked: leave the park (waiting out any in-flight sweep of
  // our theaps) before ANY owner-side free below -- everything after this frees or rewrites what
  // the scavenger would otherwise still be walking.
  _mi_park_leave(tld);

  // release dynamic thread_local's -- this is an `mi_free`, so it must come after the park leave
  _mi_thread_locals_thread_done();

  // delete the thread local theaps
  mi_thread_theaps_done(tld);

  // free thread local data
  mi_tld_free(tld);
}


mi_decl_cold mi_decl_noinline mi_theap_t* _mi_theap_empty_get(void) {
  return (mi_theap_t*)&_mi_theap_empty;
}

bool _mi_is_empty_theap(const mi_theap_t* theap) {
  return (theap == &_mi_theap_empty);
}


#if MI_TLS_MODEL_WIN32

// If we can, we use one of the 64 direct TLS slots (but fall back to expansion slots if needed)
// See <https://en.wikipedia.org/wiki/Win32_Thread_Information_Block> for the offsets.
#if MI_SIZE_SIZE==4
#define MI_TLS_DIRECT_FIRST             (0x0E10 / MI_INTPTR_SIZE)
#else
#define MI_TLS_DIRECT_FIRST             (0x1480 / MI_INTPTR_SIZE)
#endif
#define MI_TLS_DIRECT_SLOTS             (64)
#define MI_TLS_EXPANSION_SLOTS          (1024)

// We initially use the last of the expansion slots as the default NULL.
// note: this will fail if the program allocates exactly 1024+64 slots with TlsAlloc 
// before we are initialized :-( (but this seems quite unlikely).
// (todo: another approach could be to use slot 7 (EnvironmentPointer) as the initial slot as that seems to be always NULL)
#define MI_TLS_INITIAL_SLOT             MI_TLS_EXPANSION_SLOT
#define MI_TLS_INITIAL_EXPANSION_SLOT   (MI_TLS_EXPANSION_SLOTS-1)

// in case of errors assign fixed slots (but since we use EFAULT the program should fail anyways)
#define MI_TLS_ERROR_SLOT               (5)   // arbitrary user pointer
#define MI_TLS_ERROR_EXPANSION_SLOT     (7)   // environment pointer (only used for OS/2 emulation)


mi_decl_hidden mi_decl_cache_align size_t _mi_theap_default_slot = MI_TLS_INITIAL_SLOT;
mi_decl_hidden size_t _mi_theap_default_expansion_slot = MI_TLS_INITIAL_EXPANSION_SLOT;
mi_decl_hidden size_t _mi_theap_cached_slot            = MI_TLS_INITIAL_SLOT;
mi_decl_hidden size_t _mi_theap_cached_expansion_slot  = MI_TLS_INITIAL_EXPANSION_SLOT;

static DWORD mi_tls_raw_index_default = TLS_OUT_OF_INDEXES;
static DWORD mi_tls_raw_index_cached  = TLS_OUT_OF_INDEXES;

static bool mi_win_tls_slot_alloc(size_t* slot, size_t* extended, DWORD* raw_index) {
  const DWORD index = TlsAlloc();
  *raw_index = index;
  if (index==TLS_OUT_OF_INDEXES) {
    *extended = MI_TLS_ERROR_EXPANSION_SLOT;
    *slot = MI_TLS_ERROR_SLOT;
    return false;
  }
  else if (index<MI_TLS_DIRECT_SLOTS) {
    *extended = 0;
    *slot = index + MI_TLS_DIRECT_FIRST;
    return true;
  }
  #if !MI_WIN_DIRECT_TLS
  else if (index < MI_TLS_DIRECT_SLOTS + MI_TLS_EXPANSION_SLOTS - 1) { // check maximum number of expansion slots - 1 (as we use the last one as the default)
    *extended = index - MI_TLS_DIRECT_SLOTS;
    *slot = MI_TLS_EXPANSION_SLOT;
    return true;
  }
  #endif
  else {
    // to high an index for us
    _mi_error_message(EFAULT, "returned TLS index was too high (%u)\n", index);
    TlsFree(index);
    *raw_index = TLS_OUT_OF_INDEXES;
    *extended = MI_TLS_ERROR_EXPANSION_SLOT;
    *slot = MI_TLS_ERROR_SLOT;
    return false;
  }
}

static void mi_win_tls_slot_free(DWORD* raw_index) {
  if (*raw_index != TLS_OUT_OF_INDEXES) {
    TlsFree(*raw_index);
    *raw_index = TLS_OUT_OF_INDEXES;
  }
}

static void mi_tls_slots_init(void) {
  mi_atomic_do_once {
    bool ok = mi_win_tls_slot_alloc(&_mi_theap_default_slot, &_mi_theap_default_expansion_slot, &mi_tls_raw_index_default);
    if (ok) {
      ok = mi_win_tls_slot_alloc(&_mi_theap_cached_slot, &_mi_theap_cached_expansion_slot, &mi_tls_raw_index_cached);
    }
    if (!ok) {
      _mi_error_message(EFAULT, "unable to allocate a fast TLS user slot.\n");
    }
  }
}

static void mi_tls_slots_done(void) {
  mi_win_tls_slot_free(&mi_tls_raw_index_default);
  mi_win_tls_slot_free(&mi_tls_raw_index_cached );
}

static void mi_win_tls_slot_set(size_t slot, size_t extended_slot, void* value) {
  mi_assert_internal((slot >= MI_TLS_DIRECT_FIRST && slot < MI_TLS_DIRECT_FIRST + MI_TLS_DIRECT_SLOTS) || slot == MI_TLS_EXPANSION_SLOT);
  if (slot < MI_TLS_DIRECT_FIRST + MI_TLS_DIRECT_SLOTS) {
    mi_prim_tls_slot_set(slot, value);
  }
  else {
    mi_assert_internal(extended_slot < MI_TLS_EXPANSION_SLOTS);
    TlsSetValue((DWORD)(extended_slot + MI_TLS_DIRECT_SLOTS), value);  // use TlsSetValue to initialize the TlsExpansion array if needed
  }
}

#elif MI_TLS_MODEL_PTHREADS

// only for pthreads for now
mi_decl_hidden pthread_key_t _mi_theap_default_key = MI_PTHREAD_KEY_INVALID;
mi_decl_hidden pthread_key_t _mi_theap_cached_key = MI_PTHREAD_KEY_INVALID;

static void mi_theap_cached_key_destroy(void* theapv) {
  mi_theap_t* theap = (mi_theap_t*)theapv;
  if (theap!=NULL) {
    _mi_theap_decref(theap);
  }
}

static void mi_tls_slots_init(void) {
  mi_atomic_do_once {
    _mi_pthread_key_create(&_mi_theap_default_key,NULL,NULL);
    _mi_pthread_key_create(&_mi_theap_cached_key,&mi_theap_cached_key_destroy,NULL);
  }  
}

static void mi_tls_slots_done(void) {
  mi_pthread_key_delete(&_mi_theap_default_key);
  mi_pthread_key_delete(&_mi_theap_cached_key);
}

#elif MI_TLS_MODEL_FIXED 

static void mi_tls_slots_init(void) {
  mi_atomic_do_once {
    mi_theap_t* theap = _mi_theap_default();
    if (theap!=NULL) {
      _mi_error_message(EINVAL,"fixed TLS slot is already in use (slot %d = %p)", MI_TLS_MODEL_FIXED_DEFAULT, theap);
    }
    theap = _mi_theap_cached();
    if (theap!=NULL) {
      _mi_error_message(EINVAL,"fixed TLS slot is already in use (slot %d = %p)", MI_TLS_MODEL_FIXED_CACHED, theap);
    }
  }
}

static void mi_tls_slots_done(void) {
  // nothing
}


#else

static void mi_tls_slots_init(void) {
  // nothing
}

static void mi_tls_slots_done(void) {
  // nothing
}

#endif

void _mi_theap_cached_set(mi_theap_t* theap) {
  mi_theap_t* prev = _mi_theap_cached();
  if (prev==theap) return;
  // set
  mi_tls_slots_init();
  #if MI_TLS_MODEL_LOCAL
    __mi_theap_cached = theap;
  #elif MI_TLS_MODEL_FIXED
    mi_prim_tls_slot_set(MI_TLS_MODEL_FIXED_CACHED, theap);
  #elif MI_TLS_MODEL_WIN32
    mi_win_tls_slot_set(_mi_theap_cached_slot, _mi_theap_cached_expansion_slot, theap);
  #elif MI_TLS_MODEL_PTHREADS
    mi_pthread_key_set(&_mi_theap_cached_key, theap);
  #endif
  // update refcounts (so cached theap memory keeps available until no longer cached)
  _mi_theap_incref(theap);
  _mi_theap_decref(prev);
}

void _mi_theap_default_set(mi_theap_t* theap)  {
  mi_assert_internal(theap != NULL);
  mi_assert_internal(theap->tld != NULL);
  mi_assert_internal(theap->tld->thread_id==0 || theap->tld->thread_id==_mi_thread_id());
  mi_tls_slots_init();
  #if MI_TLS_MODEL_LOCAL
    __mi_theap_default = theap;
  #elif MI_TLS_MODEL_FIXED
    mi_prim_tls_slot_set(MI_TLS_MODEL_FIXED_DEFAULT, theap);
  #elif MI_TLS_MODEL_WIN32
    mi_win_tls_slot_set(_mi_theap_default_slot, _mi_theap_default_expansion_slot, theap);
  #elif MI_TLS_MODEL_PTHREADS
    mi_pthread_key_set(&_mi_theap_default_key, theap);
  #endif

  // set theap main if needed
  if (mi_theap_is_initialized(theap)) {
    // ensure the default theap is passed to `_mi_thread_done` as on some platforms we cannot access TLS at thread termination (as it would allocate again)
    _mi_prim_thread_associate_default_theap(theap);
  }
}

void mi_thread_set_in_threadpool(void) mi_attr_noexcept {
  mi_theap_t* theap = mi_theap_get_default();
  theap->tld->is_in_threadpool = true;
}

// --------------------------------------------------------
// Run functions on process init/done, and thread init/done
// --------------------------------------------------------
static bool os_preloading = true;    // true until this module is initialized

// Returns true if this module has not been initialized; Don't use C runtime routines until it returns false.
bool mi_decl_noinline _mi_preloading(void) {
  return os_preloading;
}

// Returns true if mimalloc was redirected
mi_decl_nodiscard bool mi_is_redirected(void) mi_attr_noexcept {
  return _mi_is_redirected();
}

// Called once by the process loader from `src/prim/prim.c`
void _mi_auto_process_init(void) {
  // mi_heap_main_init();
  // #if defined(__APPLE__) || defined(MI_TLS_RECURSE_GUARD)
  // volatile mi_theap_t* dummy = __mi_theap_default; // access TLS to allocate it before setting tls_initialized to true;
  // if (dummy == NULL) return;                       // use dummy or otherwise the access may get optimized away (issue #697)
  // #endif

  os_preloading = false;
  mi_assert_internal(_mi_is_main_thread());

  mi_process_init();
  mi_tls_slots_init();
  mi_process_setup_auto_thread_done();
  _mi_thread_locals_init();

  _mi_options_post_init();  // now we can print to stderr
  if (_mi_is_redirected()) _mi_verbose_message("malloc is redirected.\n");

  // show message from the redirector (if present)
  const char* msg = NULL;
  _mi_allocator_init(&msg);
  if (msg != NULL && (mi_option_is_enabled(mi_option_verbose) || mi_option_is_enabled(mi_option_show_errors))) {
    _mi_fputs(NULL,NULL,NULL,msg);
  }

  // reseed random
  _mi_random_reinit_if_weak(&mi_theap_main.random);
}

// CPU features
mi_decl_cache_align size_t _mi_cpu_movsb_max = 0;  // for size <= max, rep movsb is fast
mi_decl_cache_align size_t _mi_cpu_stosb_max = 0;  // for size <= max, rep stosb is fast
mi_decl_cache_align bool _mi_cpu_has_popcnt = false;

#if (MI_ARCH_X64 || MI_ARCH_X86)
#if defined(__GNUC__)
// #include <cpuid.h>
static bool mi_cpuid(uint32_t* regs4, uint32_t level, uint32_t sublevel) {
  // note: use explicit assembly instead of __get_cpuid as we need the sublevel (in ecx)
  // (on Ubuntu 22 with WSL the __get_cpuid does not clear ecx for level 7 which is incorrect).
  uint32_t eax, ebx, ecx, edx;
  __asm __volatile("cpuid" : "=a"(eax), "=b"(ebx), "=c"(ecx), "=d"(edx) : "a"(level), "c"(sublevel) : );
  regs4[0] = eax;
  regs4[1] = ebx;
  regs4[2] = ecx;
  regs4[3] = edx;
  return true;
}

#elif defined(_MSC_VER)
static bool mi_cpuid(uint32_t* regs4, uint32_t level, uint32_t sublevel) {
  __cpuidex((int32_t*)regs4, (int32_t)level, (int32_t)sublevel);
  return true;
}
#else
static bool mi_cpuid(uint32_t* regs4, uint32_t level, uint32_t sublevel) {
  MI_UNUSED(regs4); MI_UNUSED(level); MI_UNUSED(sublevel);
  return false;
}
#endif

static void mi_detect_cpu_features(void) {
  // FSRM for fast short rep movsb support (AMD Zen3+ (~2020) or Intel Ice Lake+ (~2017))
  // EMRS for fast enhanced rep movsb/stosb support (not used at the moment, memcpy always seems faster?)
  // FSRS for fast short rep stosb
  bool amd = false;
  bool fsrm = false;
  // bool erms = false;
  bool fsrs = false;
  uint32_t cpu_info[4];
  if (mi_cpuid(cpu_info, 0, 0)) {
    amd = (cpu_info[2]==0x444d4163); // (Auth enti cAMD)
  }
  if (mi_cpuid(cpu_info, 7, 0)) {
    fsrm = ((cpu_info[3] & (1 << 4)) != 0); // bit 4 of EDX : see <https://en.wikipedia.org/wiki/CPUID#EAX=7,_ECX=0:_Extended_Features>
    // erms = ((cpu_info[1] & (1 << 9)) != 0); // bit 9 of EBX : see <https://en.wikipedia.org/wiki/CPUID#EAX=7,_ECX=0:_Extended_Features>
  }
  if (mi_cpuid(cpu_info, 7, 1)) {
    fsrs = ((cpu_info[1] & (1 << 11)) != 0); // bit 11 of EBX: see <https://en.wikipedia.org/wiki/CPUID#EAX=7,_ECX=1:_Extended_Features>
  }
  if (mi_cpuid(cpu_info, 1, 0)) {
    _mi_cpu_has_popcnt = ((cpu_info[2] & (1 << 23)) != 0); // bit 23 of ECX : see <https://en.wikipedia.org/wiki/CPUID#EAX=1:_Processor_Info_and_Feature_Bits>
  }

  if (fsrm) {
    _mi_cpu_movsb_max = 127;
  }
  if (fsrs || (amd && fsrm)) {  // fsrm on amd implies fsrs, see: https://marc.info/?l=git-commits-head&m=168186277717803
    _mi_cpu_stosb_max = 127;
  }
}

#else
static void mi_detect_cpu_features(void) {
  #if MI_ARCH_ARM64
  _mi_cpu_has_popcnt = true;
  #endif
}
#endif


// Initialize the process; called by thread_init or the process loader
static void mi_process_init_once(void) mi_attr_noexcept {
  _mi_process_is_initialized = true;  
  _mi_verbose_message("process init: 0x%zx\n", _mi_thread_id());

  mi_detect_cpu_features();
  _mi_options_init();
  _mi_stats_init();
  _mi_os_init();
  // the following can potentially allocate (on freeBSD for pthread keys)
  // todo: do 2-phase so we can use stats at first, then later init the keys?
  mi_heap_main_init(); // before page_map_init so stats are working
  _mi_page_map_init(); // todo: this could fail.. should we abort in that case?
  mi_thread_init();
  _mi_process_is_initialized = true;

  #if !defined(_WIN32) && !defined(__wasi__)
  pthread_atfork(&_mi_process_fork_prepare, &_mi_process_fork_parent, &_mi_process_fork_child);
  #endif

  #if defined(_WIN32) && defined(MI_WIN_USE_FLS)
  // On windows, when building as a static lib the FLS cleanup happens to early for the main thread.
  // To avoid this, set the FLS value for the main thread to NULL so the fls cleanup
  // will not call _mi_thread_done on the (still executing) main thread. See issue #508.
  _mi_prim_thread_associate_default_theap(NULL);
  #endif

  // mi_stats_reset();  // only call stat reset *after* thread init (or the theap tld == NULL)
  mi_track_init();
  _mi_prof_init();
  if (mi_option_is_enabled(mi_option_reserve_huge_os_pages)) {
    size_t pages = mi_option_get_clamp(mi_option_reserve_huge_os_pages, 0, 128*1024);
    int reserve_at  = (int)mi_option_get_clamp(mi_option_reserve_huge_os_pages_at, -1, INT_MAX);
    if (reserve_at != -1) {
      mi_reserve_huge_os_pages_at(pages, reserve_at, pages*500);
    } else {
      mi_reserve_huge_os_pages_interleave(pages, 0, pages*500);
    }
  }
  if (mi_option_is_enabled(mi_option_reserve_os_memory)) {
    long ksize = mi_option_get(mi_option_reserve_os_memory);
    if (ksize > 0) {
      mi_reserve_os_memory((size_t)ksize*MI_KiB, true, true);
    }
  }
  _mi_scavenger_start();
}

/* -----------------------------------------------------------
  Fork handling (POSIX). Acquire process-wide locks before fork
  so the child inherits consistent shared state, then either
  release (parent) or reinitialize (child) afterwards. The child
  has only the calling thread, so per-heap and per-tld locks held
  by other threads must be reinitialized rather than released.
----------------------------------------------------------- */

static _Atomic(uintptr_t) mi_fork_depth;  // allow nested prepare/parent calls (e.g., zone hooks + pthread_atfork)
bool _mi_process_is_forked_child;          // set once in fork_child, never cleared; lets visitors avoid waiting on dead-thread state

void _mi_process_fork_prepare(void) {
  if (!_mi_process_is_initialized) return;
  if (mi_atomic_increment_acq_rel(&mi_fork_depth) != 0) return;
  // fork() does not allocate, so a caller may reach it still parked with the scavenger mid-way
  // through rewriting this thread's own pages. The clone would freeze that torn heap into a child
  // where no thread will ever finish the sweep -- take our heaps back first, while we hold none
  // of the locks below and the scavenger we wait on is still live in this (the parent) process.
  {
    mi_theap_t* const theap = _mi_theap_default();
    if (theap != NULL && mi_theap_is_initialized(theap)) { _mi_park_leave(theap->tld); }
  }
  mi_subproc_t* const subproc = _mi_subproc_main();
  // Acquire outermost-first: locks that can be held across an allocation (and so may
  // nest into arena_reserve_lock) must be taken before arena_reserve_lock.
  mi_lock_acquire(&subprocs_lock);
  _mi_thread_locals_fork_prepare();              // held across mi_rezalloc_aligned
  mi_lock_acquire(&mi_process_heap_main.arena_pages_lock);  // held across mi_malloc in mi_heap_ensure_arena_pages
  mi_lock_acquire(&subproc->heaps_lock);
  // Quiesce every heap's list locks, not just heap_main: _mi_theap_init/_mi_theap_free
  // mutate heap->theaps under heap->theaps_lock without taking subproc->heaps_lock.
  for (mi_heap_t* h = subproc->heaps; h != NULL; h = h->next) {
    if (h == &mi_process_heap_main) continue; // heap_main handled explicitly for ordering
    mi_lock_acquire(&h->arena_pages_lock);
    mi_lock_acquire(&h->theaps_lock);
    mi_lock_acquire(&h->os_abandoned_pages_lock);
  }
  mi_lock_acquire(&mi_process_heap_main.theaps_lock);
  mi_lock_acquire(&mi_process_heap_main.os_abandoned_pages_lock);
  mi_lock_acquire(&subproc->tlds_lock);   // leaf: never held across an allocation or a sweep
  mi_lock_acquire(&subproc->arena_reserve_lock);
}

void _mi_process_fork_parent(void) {
  if (!_mi_process_is_initialized) return;
  if (mi_atomic_decrement_acq_rel(&mi_fork_depth) != 1) return;
  mi_subproc_t* const subproc = _mi_subproc_main();
  mi_lock_release(&subproc->arena_reserve_lock);
  mi_lock_release(&subproc->tlds_lock);
  mi_lock_release(&mi_process_heap_main.os_abandoned_pages_lock);
  mi_lock_release(&mi_process_heap_main.theaps_lock);
  for (mi_heap_t* h = subproc->heaps; h != NULL; h = h->next) {
    if (h == &mi_process_heap_main) continue;
    mi_lock_release(&h->os_abandoned_pages_lock);
    mi_lock_release(&h->theaps_lock);
    mi_lock_release(&h->arena_pages_lock);
  }
  mi_lock_release(&subproc->heaps_lock);
  mi_lock_release(&mi_process_heap_main.arena_pages_lock);
  _mi_thread_locals_fork_parent();
  mi_lock_release(&subprocs_lock);
}

void _mi_process_fork_child(void) {
  if (!_mi_process_is_initialized) return;
  if (mi_atomic_exchange_acq_rel(&mi_fork_depth, 0) == 0) return;
  _mi_process_is_forked_child = true;
  _mi_scavenger_forked_child();   // the thread did not survive; clear the state that says it did
  // single-threaded here: just reinitialize every lock we know about
  mi_lock_init(&subprocs_lock);
  for (mi_subproc_t* sp = subprocs; sp != NULL; sp = sp->next) {
    mi_lock_init(&sp->arena_reserve_lock);
    mi_lock_init(&sp->heaps_lock);
    mi_lock_init(&sp->tlds_lock);
    // a wake that was in flight at fork() leaves this at 1 with nobody to clear it, and the
    // 0->1 edge in `_mi_scavenger_wake` would then never fire again
    mi_atomic_store_relaxed(&sp->scavenger_wake, (uint32_t)0);
    // no scavenger in the child: nothing will ever finish a claimed sweep
    mi_atomic_store_relaxed(&sp->parked_count, 0);
    for (mi_tld_t* t = sp->tlds; t != NULL; t = t->subproc_next) {
      mi_atomic_store_relaxed(&t->park_state, (uint32_t)MI_PARK_RUNNING);
      mi_atomic_store_relaxed(&t->park_reclaim, (uint32_t)0);
      mi_atomic_store_relaxed(&t->park_swept, (uint32_t)0);
    }
    for (mi_heap_t* h = sp->heaps; h != NULL; h = h->next) {
      mi_lock_init(&h->theaps_lock);
      mi_lock_init(&h->arena_pages_lock);
      mi_lock_init(&h->os_abandoned_pages_lock);
    }
  }
  mi_lock_init(&mi_process_tld_main.theaps_lock);
  mi_theap_t* const theap = _mi_theap_default();
  if (theap != NULL && mi_theap_is_initialized(theap) && theap->tld != &mi_process_tld_main) {
    mi_lock_init(&theap->tld->theaps_lock);
  }
  // Re-init tld->theaps_lock for every theap still on a heap list: those tlds belong to
  // threads that vanished at fork() and may have held the lock (e.g. inside _mi_theap_init
  // or mi_thread_theaps_done). _mi_theap_free in the child takes that lock at theap.c:322.
  for (mi_subproc_t* sp = subprocs; sp != NULL; sp = sp->next) {
    for (mi_heap_t* h = sp->heaps; h != NULL; h = h->next) {
      for (mi_theap_t* t = h->theaps; t != NULL; t = t->hnext) {
        if (t->tld != NULL) { mi_lock_init(&t->tld->theaps_lock); }
      }
    }
  }
  _mi_thread_locals_fork_child();
}

// Initialize the process; called by thread_init or the process loader
void mi_process_init(void) mi_attr_noexcept {
  // #if _MSC_VER < 1920
	// mi_heap_main_init(); // vs2017 can dynamically re-initialize _mi_heap_main
	// #endif
  mi_atomic_do_once {
    mi_process_init_once();
  }
}


// Called when the process is done
static void mi_process_done_once(void) {
  // only shutdown if we were initialized
  if (!_mi_process_is_initialized) return;
  // ensure we are called once
  static bool process_done = false;
  if (process_done) return;
  process_done = true;

  // stop the background scavenger before any teardown
  _mi_scavenger_stop();

  // write a heap snapshot / heap profile if requested (before any cleanup so the live state is captured)
  _mi_heap_snapshot_on_exit();
  _mi_prof_on_exit();

  // free dynamic thread locals (if used at all)
  _mi_thread_locals_done();

  // release any thread specific resources and ensure _mi_thread_done is called on all but the main thread
  _mi_prim_thread_done_auto_done();

  #ifndef MI_SKIP_COLLECT_ON_EXIT
    #if (MI_DEBUG || !defined(MI_SHARED_LIB))
    // free all memory if possible on process exit. This is not needed for a stand-alone process
    // but should be done if mimalloc is statically linked into another shared library which
    // is repeatedly loaded/unloaded, see issue #281.
    mi_theap_collect(_mi_theap_default(), true /* force */);
    #endif
  #endif

  // done with tracking tools
  mi_track_done()

  // Forcefully release all retained memory; this can be dangerous in general if overriding regular malloc/free
  // since after process_done there might still be other code running that calls `free` (like at_exit routines,
  // or C-runtime termination code.
  if (mi_option_is_enabled(mi_option_destroy_on_exit)) {
    mi_subprocs_unsafe_destroy_all(); // destroys all subprocs, arenas, and the page_map!
  }
  else if (subproc_main.heap_main != NULL) {
    mi_heap_stats_merge_to_subproc(subproc_main.heap_main);
  }

  // careful now to no longer access any allocator functionality
  if (mi_option_is_enabled(mi_option_show_stats) || mi_option_is_enabled(mi_option_verbose)) {
    mi_subproc_stats_print_out(mi_subproc_main(), NULL, NULL);
  }
  mi_lock_done(&subprocs_lock);
  mi_tls_slots_done();
  _mi_allocator_done();
  _mi_verbose_message("process done: 0x%zx\n", mi_process_tld_main.thread_id);
  os_preloading = true; // don't call the C runtime anymore
}

void mi_cdecl mi_process_done(void) mi_attr_noexcept {
  mi_atomic_do_once {
    mi_process_done_once();
  }
}

void mi_cdecl _mi_auto_process_done(void) mi_attr_noexcept {
  #ifdef MI_NO_PROCESS_DETACH
  // Embedder opted out of automatic exit-time teardown entirely. The process is going
  // away; skipping mi_process_done avoids touching allocator state after other static
  // destructors may have already run. mi_process_done() can still be called manually.
  return;
  #endif
  if (_mi_option_get_fast(mi_option_destroy_on_exit)>1) return;
  mi_process_done();
}
