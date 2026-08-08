/* ----------------------------------------------------------------------------
Copyright (c) 2018-2022, Microsoft Research, Daan Leijen
This is free software; you can redistribute it and/or modify it under the
terms of the MIT license. A copy of the license can be found in the file
"LICENSE" at the root of this distribution.
-----------------------------------------------------------------------------*/

#include "mimalloc.h"
#include "mimalloc/internal.h"
#include "mimalloc/prim-tls.h"  // _mi_thread_is_initialized
#if defined(MI_MALLOC_OVERRIDE)

#if !defined(__APPLE__)
#error "this file should only be included on macOS"
#endif

/* ------------------------------------------------------
   Override system malloc on macOS
   This is done through the malloc zone interface.
   It seems to be most robust in combination with interposing
   though or otherwise we may get zone errors as there are could
   be allocations done by the time we take over the
   zone.
------------------------------------------------------ */

#include <AvailabilityMacros.h>
#include <malloc/malloc.h>
#include <mach/mach_init.h>  // mach_task_self
#include <string.h>  // memset
#include <stdlib.h>
#include <unistd.h>  // getpid

#include "mimalloc-stats.h"

#ifdef __cplusplus
extern "C" {
#endif

#if defined(MAC_OS_X_VERSION_10_6) && (MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_X_VERSION_10_6)
// only available from OSX 10.6
extern malloc_zone_t* malloc_default_purgeable_zone(void) __attribute__((weak_import));
#endif

/* ------------------------------------------------------
   malloc zone members
------------------------------------------------------ */

static bool is_mimalloc_zone( malloc_zone_t* zone ); 

static size_t zone_size(malloc_zone_t* zone, const void* p) {
  if (mi_any_heap_contains(p)) { 
    return mi_usable_size(p);
  }
  else if (!is_mimalloc_zone(zone)) {  // can happen due to interpose
    return zone->size(zone,p);
  }
  else {
    return 0;
  }
}

static void* zone_malloc(malloc_zone_t* zone, size_t size) {
  MI_UNUSED(zone);
  return mi_malloc(size);
}

static void* zone_calloc(malloc_zone_t* zone, size_t count, size_t size) {
  MI_UNUSED(zone);
  return mi_calloc(count, size);
}

static void* zone_valloc(malloc_zone_t* zone, size_t size) {
  MI_UNUSED(zone);
  return mi_malloc_aligned(size, _mi_os_page_size());
}

static void zone_free(malloc_zone_t* zone, void* p) {
  if mi_likely(mi_any_heap_contains(p)) {
    if mi_likely(_mi_thread_is_initialized()) {
      mi_free(p); // with the page_map and pagemap_commit=1 we can use the regular free
    }
    else {
      // during thread shutdown `_pthread_tsd_cleanup` may call `zone_free` on a pointer that was allocated in another subproc.
      _mi_free_subproc_safe(p); 
    }
  }
  else if (!is_mimalloc_zone(zone)) {  // can happen due to interpose
    zone->free(zone,p);
  }
}

static void* zone_realloc(malloc_zone_t* zone, void* p, size_t newsize) {
  if (p == NULL || mi_any_heap_contains(p)) {
    return mi_realloc(p, newsize);
  }
  else if (!is_mimalloc_zone(zone)) {  // can happen due to interpose
    return zone->realloc(zone,p,newsize);
  }
  else {
    return NULL;
  }
}

static void* zone_memalign(malloc_zone_t* zone, size_t alignment, size_t size) {
  MI_UNUSED(zone);
  return mi_malloc_aligned(size,alignment);
}

static void zone_destroy(malloc_zone_t* zone) {
  if (!is_mimalloc_zone(zone)) {
    zone->destroy(zone);
  }
}

static unsigned zone_batch_malloc(malloc_zone_t* zone, size_t size, void** ps, unsigned count) {
  unsigned i;
  for (i = 0; i < count; i++) {
    ps[i] = zone_malloc(zone, size);
    if (ps[i] == NULL) break;
  }
  return i;
}

static void zone_batch_free(malloc_zone_t* zone, void** ps, unsigned count) {
  for(size_t i = 0; i < count; i++) {
    zone_free(zone, ps[i]);
    ps[i] = NULL;
  }
}

static size_t zone_pressure_relief(malloc_zone_t* zone, size_t size) {
  MI_UNUSED(zone); MI_UNUSED(size);
  mi_collect(false);
  return 0;
}

static void zone_free_definite_size(malloc_zone_t* zone, void* p, size_t size) {
  MI_UNUSED(size);
  zone_free(zone,p);
}

static boolean_t zone_claimed_address(malloc_zone_t* zone, void* p) {
  MI_UNUSED(zone);
  return mi_is_in_heap_region(p);
}

/* ------------------------------------------------------
   Introspection members
------------------------------------------------------ */

#define MI_ZONE_ENUM_BATCH 256

typedef struct mi_zone_enum_s {
  task_t   task;
  void*    context;
  unsigned type_mask;
  vm_range_recorder_t* recorder;
  unsigned count;
  vm_range_t ranges[MI_ZONE_ENUM_BATCH];
} mi_zone_enum_t;

static void mi_zone_enum_flush(mi_zone_enum_t* e, unsigned type) {
  if (e->count > 0) {
    e->recorder(e->task, e->context, type, e->ranges, e->count);
    e->count = 0;
  }
}

static void mi_zone_enum_push(mi_zone_enum_t* e, unsigned type, void* addr, size_t size) {
  if (e->count == MI_ZONE_ENUM_BATCH) mi_zone_enum_flush(e, type);
  e->ranges[e->count].address = (vm_address_t)addr;
  e->ranges[e->count].size    = (vm_size_t)size;
  e->count++;
}

/* ------------------------------------------------------
   Out-of-process enumeration (leaks/heap/malloc_history).
   Every pointer is a remote address; dereference via `reader`.
------------------------------------------------------ */

#include "../../bitmap.h"   // mi_bitmap_t / mi_bchunk_t layout

static kern_return_t mi_zr_identity(task_t task, vm_address_t addr, vm_size_t size, void** out) {
  MI_UNUSED(task); MI_UNUSED(size);
  *out = (void*)addr;
  return KERN_SUCCESS;
}

#define MI_ZR(dst, rptr, sz) do { \
  void* _p; \
  if (reader(task, (vm_address_t)(rptr), (vm_size_t)(sz), &_p) != KERN_SUCCESS) return KERN_FAILURE; \
  memcpy((dst), _p, (sz)); \
} while(0)

static kern_return_t mi_zone_enum_remote_freelist(task_t task, memory_reader_t reader,
                                                  vm_address_t rpage, const mi_page_t* lpage,
                                                  vm_address_t pstart, size_t bsize,
                                                  mi_block_t* rhead, uintptr_t* free_map, size_t cap)
{
  MI_UNUSED(rpage); MI_UNUSED(lpage);
  vm_address_t rb = (vm_address_t)rhead;
  size_t guard = 0;
  while (rb != 0 && guard++ <= cap) {
    if (rb < pstart || (size_t)(rb - pstart) >= cap * bsize) break;  // corrupt / out of page
    size_t idx = (size_t)(rb - pstart) / bsize;
    free_map[idx / MI_INTPTR_BITS] |= ((uintptr_t)1 << (idx % MI_INTPTR_BITS));
    mi_encoded_t enc;
    MI_ZR(&enc, rb, sizeof(enc));
    #if MI_ENCODE_FREELIST
    rb = (vm_address_t)mi_ptr_decode((const void*)rpage, enc, lpage->keys);
    #else
    rb = (vm_address_t)enc;
    #endif
  }
  return KERN_SUCCESS;
}

static kern_return_t mi_zone_enum_remote_page(task_t task, memory_reader_t reader,
                                              mi_zone_enum_t* e, vm_address_t rpage)
{
  mi_page_t lpage;
  MI_ZR(&lpage, rpage, sizeof(lpage));
  const size_t bsize  = lpage.block_size;
  if (bsize == 0 || lpage.capacity == 0) return KERN_SUCCESS;
  const size_t ubsize = bsize - MI_PADDING_SIZE;
  // `lpage` is a local copy of a page that lives in the TARGET process, so the block start
  // must be rebuilt from the remote page address -- mi_page_start(&lpage) would offset from
  // our own copy. (Upstream dropped the cached `page_start` field in favour of `page_woffset`.)
  const vm_address_t pstart = (vm_address_t)(rpage + ((size_t)lpage.page_woffset * MI_SIZE_SIZE));

  if (e->type_mask & MALLOC_PTR_REGION_RANGE_TYPE) {
    mi_zone_enum_flush(e, MALLOC_PTR_IN_USE_RANGE_TYPE);
    mi_zone_enum_push(e, MALLOC_PTR_REGION_RANGE_TYPE, (void*)pstart, (size_t)lpage.reserved * bsize);
    mi_zone_enum_flush(e, MALLOC_PTR_REGION_RANGE_TYPE);
  }
  if (!(e->type_mask & MALLOC_PTR_IN_USE_RANGE_TYPE)) return KERN_SUCCESS;
  if (lpage.used == 0) return KERN_SUCCESS;

  mi_block_t* xtf = (mi_block_t*)((uintptr_t)lpage.xthread_free & ~(uintptr_t)1);
  if (lpage.free == NULL && lpage.local_free == NULL && xtf == NULL) {
    for (size_t i = 0; i < lpage.capacity; i++) {
      mi_zone_enum_push(e, MALLOC_PTR_IN_USE_RANGE_TYPE, (void*)(pstart + i*bsize), ubsize);
    }
    return KERN_SUCCESS;
  }

  #define MI_ZR_MAX_BLOCKS  (MI_SMALL_PAGE_SIZE / sizeof(void*))
  uintptr_t free_map[MI_ZR_MAX_BLOCKS / MI_INTPTR_BITS];
  const size_t cap = (lpage.capacity > MI_ZR_MAX_BLOCKS ? MI_ZR_MAX_BLOCKS : lpage.capacity);
  const size_t mapw = _mi_divide_up(cap, MI_INTPTR_BITS);
  memset(free_map, 0, mapw * sizeof(uintptr_t));

  if (mi_zone_enum_remote_freelist(task, reader, rpage, &lpage, pstart, bsize, lpage.free,       free_map, cap) != KERN_SUCCESS) return KERN_FAILURE;
  if (mi_zone_enum_remote_freelist(task, reader, rpage, &lpage, pstart, bsize, lpage.local_free, free_map, cap) != KERN_SUCCESS) return KERN_FAILURE;
  if (mi_zone_enum_remote_freelist(task, reader, rpage, &lpage, pstart, bsize, xtf,              free_map, cap) != KERN_SUCCESS) return KERN_FAILURE;

  for (size_t w = 0; w < mapw; w++) {
    uintptr_t used = ~free_map[w];
    while (used != 0) {
      size_t bit = mi_ctz(used);
      size_t idx = w*MI_INTPTR_BITS + bit;
      if (idx >= cap) break;
      mi_zone_enum_push(e, MALLOC_PTR_IN_USE_RANGE_TYPE, (void*)(pstart + idx*bsize), ubsize);
      used &= used - 1;
    }
  }
  return KERN_SUCCESS;
}

static kern_return_t mi_zone_enum_remote_bitmap(task_t task, memory_reader_t reader,
                                                mi_zone_enum_t* e, vm_address_t rarena,
                                                vm_address_t rpages_meta, vm_address_t rbitmap)
{
  size_t chunk_count;
  MI_ZR(&chunk_count, rbitmap + offsetof(mi_bitmap_t, chunk_count), sizeof(chunk_count));
  for (size_t c = 0; c < chunk_count; c++) {
    mi_bchunk_t chunk;
    MI_ZR(&chunk, rbitmap + offsetof(mi_bitmap_t, chunks) + c*sizeof(mi_bchunk_t), sizeof(chunk));
    for (size_t f = 0; f < MI_BCHUNK_FIELDS; f++) {
      mi_bfield_t b = chunk.bfields[f];
      while (b != 0) {
        size_t bit = mi_ctz(b);
        size_t slice_index = c*MI_BCHUNK_BITS + f*MI_BFIELD_BITS + bit;
        // mirror `mi_arena_page_at_slice`: with separated metadata, small-block
        // pages still keep the page struct at the slice start (block_size==0 in
        // pages_meta marks that case).
        vm_address_t rpage = rarena + slice_index * MI_ARENA_SLICE_SIZE;
        if (rpages_meta != 0) {
          vm_address_t rmeta = rpages_meta + slice_index * sizeof(mi_page_t);
          size_t bs; MI_ZR(&bs, rmeta + offsetof(mi_page_t, block_size), sizeof(bs));
          if (bs > 0) rpage = rmeta;
        }
        if (mi_zone_enum_remote_page(task, reader, e, rpage) != KERN_SUCCESS) return KERN_FAILURE;
        b &= b - 1;
      }
    }
  }
  return KERN_SUCCESS;
}

static kern_return_t intro_enumerator(task_t task, void* context,
                            unsigned type_mask, vm_address_t zone_address,
                            memory_reader_t reader,
                            vm_range_recorder_t recorder)
{
  if (recorder == NULL) return KERN_SUCCESS;
  if (reader == NULL) reader = &mi_zr_identity;

  mi_zone_enum_t e = { task, context, type_mask, recorder, 0, {0} };

  // root: zone->reserved1 holds &subproc_main (set at zone registration)
  vm_address_t rsubproc;
  MI_ZR(&rsubproc, zone_address + offsetof(malloc_zone_t, reserved1), sizeof(rsubproc));
  if (rsubproc == 0) return KERN_SUCCESS;
  mi_subproc_t lsubproc;
  MI_ZR(&lsubproc, rsubproc, sizeof(lsubproc));

  if (type_mask & MALLOC_ADMIN_REGION_RANGE_TYPE) {
    for (size_t i = 0; i < MI_MAX_ARENAS; i++) {
      mi_arena_t* ra = lsubproc.arenas[i];
      if (ra == NULL) continue;
      mi_arena_t la; MI_ZR(&la, ra, sizeof(la));
      mi_zone_enum_push(&e, MALLOC_ADMIN_REGION_RANGE_TYPE, ra, la.slice_count * MI_ARENA_SLICE_SIZE);
    }
    mi_zone_enum_flush(&e, MALLOC_ADMIN_REGION_RANGE_TYPE);
  }

  if (!(type_mask & (MALLOC_PTR_IN_USE_RANGE_TYPE | MALLOC_PTR_REGION_RANGE_TYPE))) {
    return KERN_SUCCESS;
  }

  // walk every heap → arena_pages[i]->pages bitmap → page → blocks
  vm_address_t rheap = (vm_address_t)lsubproc.heaps;
  while (rheap != 0) {
    mi_heap_t lheap; MI_ZR(&lheap, rheap, sizeof(lheap));
    for (size_t i = 0; i < MI_MAX_ARENAS; i++) {
      mi_arena_pages_t* rap = lheap.arena_pages[i];
      mi_arena_t*       ra  = lsubproc.arenas[i];
      if (rap == NULL || ra == NULL) continue;
      mi_arena_t la; MI_ZR(&la, ra, sizeof(la));
      mi_arena_pages_t lap; MI_ZR(&lap, rap, sizeof(lap));
      kern_return_t kr = mi_zone_enum_remote_bitmap(task, reader, &e,
                            (vm_address_t)ra, (vm_address_t)la.pages_meta, (vm_address_t)lap.pages);
      if (kr != KERN_SUCCESS) return kr;
    }
    // OS-allocated abandoned pages (not in any arena bitmap)
    vm_address_t rosp = (vm_address_t)lheap.os_abandoned_pages;
    while (rosp != 0) {
      mi_page_t lp; MI_ZR(&lp, rosp, sizeof(lp));
      mi_zone_enum_remote_page(task, reader, &e, rosp);
      rosp = (vm_address_t)lp.next;
    }
    rheap = (vm_address_t)lheap.next;
  }
  mi_zone_enum_flush(&e, MALLOC_PTR_IN_USE_RANGE_TYPE);
  return KERN_SUCCESS;
}

static size_t intro_good_size(malloc_zone_t* zone, size_t size) {
  MI_UNUSED(zone);
  return mi_good_size(size);
}

static boolean_t intro_check(malloc_zone_t* zone) {
  MI_UNUSED(zone);
  return true;
}

static void intro_print(malloc_zone_t* zone, boolean_t verbose) {
  MI_UNUSED(zone); MI_UNUSED(verbose);
  mi_stats_print(NULL);
}

static void intro_log(malloc_zone_t* zone, void* p) {
  MI_UNUSED(zone); MI_UNUSED(p);
  // todo?
}

static pid_t mi_zone_locked_pid = -1;

static void intro_force_lock(malloc_zone_t* zone) {
  MI_UNUSED(zone);
  mi_zone_locked_pid = getpid();
  _mi_process_fork_prepare();
}

static void intro_force_unlock(malloc_zone_t* zone) {
  MI_UNUSED(zone);
  if (mi_zone_locked_pid == -1) return;
  if (getpid() == mi_zone_locked_pid) { _mi_process_fork_parent(); }
                                 else { _mi_process_fork_child(); }
  mi_zone_locked_pid = -1;
}

static void intro_reinit_lock(malloc_zone_t* zone) {
  MI_UNUSED(zone);
  // zone version 9+ calls this in the child instead of force_unlock
  _mi_process_fork_child();
  mi_zone_locked_pid = -1;
}

static void intro_statistics(malloc_zone_t* zone, malloc_statistics_t* stats) {
  MI_UNUSED(zone);
  // note: subproc stats are a lower bound — per-theap counters merge up lazily
  // (on collect/thread-done). For exact numbers use the enumerator.
  mi_stats_t_decl(mst);
  if (mi_stats_get(&mst)) {
    stats->blocks_in_use   = (unsigned)(mst.malloc_normal_count.total + mst.malloc_huge_count.total);
    stats->size_in_use     = (size_t)(mst.malloc_normal.current + mst.malloc_huge.current);
    stats->max_size_in_use = (size_t)(mst.malloc_normal.peak + mst.malloc_huge.peak);
    stats->size_allocated  = (size_t)(mst.reserved.current);
  }
  else {
    stats->blocks_in_use = 0; stats->size_in_use = 0; stats->max_size_in_use = 0; stats->size_allocated = 0;
  }
}

static boolean_t intro_zone_locked(malloc_zone_t* zone) {
  MI_UNUSED(zone);
  return (mi_zone_locked_pid != -1 && mi_zone_locked_pid == getpid());
}

// Required whenever the zone advertises version >= 9: macOS calls this from the
// atfork_child handler (_malloc_fork_child) without a NULL check. mimalloc keeps
// no zone-level locks that need reinitializing after fork, so a no-op is safe.
// Leaving it NULL makes the forked child jump to address 0 and crash in fork().


/* ------------------------------------------------------
  At process start, override the default allocator
------------------------------------------------------ */

#if defined(__GNUC__) && !defined(__clang__)
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#endif

#if defined(__clang__)
#pragma clang diagnostic ignored "-Wc99-extensions"
#endif

static malloc_introspection_t mi_introspect = {
  .enumerator = &intro_enumerator,
  .good_size = &intro_good_size,
  .check = &intro_check,
  .print = &intro_print,
  .log = &intro_log,
  .force_lock = &intro_force_lock,
  .force_unlock = &intro_force_unlock,
#if defined(MAC_OS_X_VERSION_10_6) && (MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_X_VERSION_10_6) && !defined(__ppc__)
  .statistics = &intro_statistics,
  .zone_locked = &intro_zone_locked,
  .enable_discharge_checking = NULL,
  .disable_discharge_checking = NULL,
  .discharge = NULL,
  #ifdef __BLOCKS__
  .enumerate_discharged_pointers = NULL,
  #else
  .enumerate_unavailable_without_blocks = NULL,
  #endif
#endif  
#if defined(MAC_OS_X_VERSION_10_12) && (MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_X_VERSION_10_12) && !defined(__ppc__)
  .reinit_lock = &intro_reinit_lock,
#endif
};

static malloc_zone_t mi_malloc_zone = {
  // note: even with designators, the order is important for C++ compilation
  //.reserved1 = NULL,
  //.reserved2 = NULL,
  .size = &zone_size,
  .malloc = &zone_malloc,
  .calloc = &zone_calloc,
  .valloc = &zone_valloc,
  .free = &zone_free,
  .realloc = &zone_realloc,
  .destroy = &zone_destroy,
  .zone_name = "mimalloc",
  .batch_malloc = &zone_batch_malloc,
  .batch_free = &zone_batch_free,
  .introspect = &mi_introspect,
#if defined(MAC_OS_X_VERSION_10_6) && (MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_X_VERSION_10_6) && !defined(__ppc__)
  #if defined(MAC_OS_X_VERSION_10_14) && (MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_X_VERSION_10_14)
  .version = 10,
  #else
  .version = 9,
  #endif
  // switch to version 9+ on OSX 10.6 to support memalign.
  .memalign = &zone_memalign,
  .free_definite_size = &zone_free_definite_size,
  #if defined(MAC_OS_X_VERSION_10_7) && (MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_X_VERSION_10_7)
  .pressure_relief = &zone_pressure_relief,
  #endif
  #if defined(MAC_OS_X_VERSION_10_14) && (MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_X_VERSION_10_14)
  .claimed_address = &zone_claimed_address,
  #endif
#else
  .version = 4,
#endif
};

#ifdef __cplusplus
}
#endif

static bool is_mimalloc_zone( malloc_zone_t* zone ) {
  return (zone==NULL || zone==&mi_malloc_zone);
}

#if defined(MI_OSX_INTERPOSE) && defined(MI_SHARED_LIB_EXPORT)

// ------------------------------------------------------
// Override malloc_xxx and malloc_zone_xxx api's to use only
// our mimalloc zone. Since even the loader uses malloc
// on macOS, this ensures that all allocations go through
// mimalloc (as all calls are interposed).
// The main `malloc`, `free`, etc calls are interposed in `alloc-override.c`,
// Here, we also override macOS specific API's like
// `malloc_zone_calloc` etc. see <https://github.com/aosm/libmalloc/blob/master/man/malloc_zone_malloc.3>
// ------------------------------------------------------

static inline malloc_zone_t* mi_get_default_zone(void) {
  mi_atomic_do_once {
    mi_malloc_zone.reserved1 = _mi_subproc_main();   // root for out-of-process introspection
    malloc_zone_register(&mi_malloc_zone);  // by calling register we avoid a zone error on free (see <http://eatmyrandom.blogspot.com/2010/03/mallocfree-interception-on-mac-os-x.html>)
  }
  return &mi_malloc_zone;
}

mi_decl_externc int  malloc_jumpstart(uintptr_t cookie);
mi_decl_externc void _malloc_fork_prepare(void);
mi_decl_externc void _malloc_fork_parent(void);
mi_decl_externc void _malloc_fork_child(void);


static malloc_zone_t* mi_malloc_create_zone(vm_size_t size, unsigned flags) {
  MI_UNUSED(size); MI_UNUSED(flags);
  return mi_get_default_zone();
}

static malloc_zone_t* mi_malloc_default_zone (void) {
  return mi_get_default_zone();
}

static malloc_zone_t* mi_malloc_default_purgeable_zone(void) {
  return mi_get_default_zone();
}

static void mi_malloc_destroy_zone(malloc_zone_t* zone) {
  MI_UNUSED(zone);
  // nothing.
}

static kern_return_t mi_malloc_get_all_zones (task_t task, memory_reader_t mr, vm_address_t** addresses, unsigned* count) {
  MI_UNUSED(task); MI_UNUSED(mr);
  if (addresses != NULL) *addresses = NULL;
  if (count != NULL) *count = 0;
  return KERN_SUCCESS;
}

static const char* mi_malloc_get_zone_name(malloc_zone_t* zone) {
  return (zone == NULL ? mi_malloc_zone.zone_name : zone->zone_name);
}

static void mi_malloc_set_zone_name(malloc_zone_t* zone, const char* name) {
  MI_UNUSED(zone); MI_UNUSED(name);
}

static int mi_malloc_jumpstart(uintptr_t cookie) {
  MI_UNUSED(cookie);
  return 1; // or 0 for no error?
}

static void mi__malloc_fork_prepare(void) {
  _mi_process_fork_prepare();
}
static void mi__malloc_fork_parent(void) {
  _mi_process_fork_parent();
}
static void mi__malloc_fork_child(void) {
  _mi_process_fork_child();
}

static void mi_malloc_printf(const char* fmt, ...) {
  MI_UNUSED(fmt);
}

static bool zone_check(malloc_zone_t* zone) {
  MI_UNUSED(zone);
  return true;
}

static malloc_zone_t* zone_from_ptr(const void* p) {
  MI_UNUSED(p);
  return (mi_any_heap_contains(p) ? mi_get_default_zone() : NULL);
}

static void zone_log(malloc_zone_t* zone, void* p) {
  MI_UNUSED(zone); MI_UNUSED(p);
}

static void zone_print(malloc_zone_t* zone, bool b) {
  MI_UNUSED(zone); MI_UNUSED(b);
}

static void zone_print_ptr_info(void* p) {
  MI_UNUSED(p);
}

static void zone_register(malloc_zone_t* zone) {
  MI_UNUSED(zone);
}

static void zone_unregister(malloc_zone_t* zone) {
  MI_UNUSED(zone);
}

// use interposing so `DYLD_INSERT_LIBRARIES` works without `DYLD_FORCE_FLAT_NAMESPACE=1`
// See: <https://books.google.com/books?id=K8vUkpOXhN4C&pg=PA73>
struct mi_interpose_s {
  const void* replacement;
  const void* target;
};
#define MI_INTERPOSE_FUN(oldfun,newfun) { (const void*)&newfun, (const void*)&oldfun }
#define MI_INTERPOSE_MI(fun)            MI_INTERPOSE_FUN(fun,mi_##fun)
#define MI_INTERPOSE_ZONE(fun)          MI_INTERPOSE_FUN(malloc_##fun,fun)
__attribute__((used)) static const struct mi_interpose_s _mi_zone_interposes[]  __attribute__((section("__DATA, __interpose"))) =
{

  MI_INTERPOSE_MI(malloc_create_zone),
  MI_INTERPOSE_MI(malloc_default_purgeable_zone),
  MI_INTERPOSE_MI(malloc_default_zone),
  MI_INTERPOSE_MI(malloc_destroy_zone),
  MI_INTERPOSE_MI(malloc_get_all_zones),
  MI_INTERPOSE_MI(malloc_get_zone_name),
  MI_INTERPOSE_MI(malloc_jumpstart),
  MI_INTERPOSE_MI(malloc_printf),
  MI_INTERPOSE_MI(malloc_set_zone_name),
  MI_INTERPOSE_MI(_malloc_fork_child),
  MI_INTERPOSE_MI(_malloc_fork_parent),
  MI_INTERPOSE_MI(_malloc_fork_prepare),

  MI_INTERPOSE_ZONE(zone_batch_free),
  MI_INTERPOSE_ZONE(zone_batch_malloc),
  MI_INTERPOSE_ZONE(zone_calloc),
  MI_INTERPOSE_ZONE(zone_check),
  MI_INTERPOSE_ZONE(zone_free),
  MI_INTERPOSE_ZONE(zone_from_ptr),
  MI_INTERPOSE_ZONE(zone_log),
  MI_INTERPOSE_ZONE(zone_malloc),
  MI_INTERPOSE_ZONE(zone_memalign),
  MI_INTERPOSE_ZONE(zone_print),
  MI_INTERPOSE_ZONE(zone_print_ptr_info),
  MI_INTERPOSE_ZONE(zone_realloc),
  MI_INTERPOSE_ZONE(zone_register),
  MI_INTERPOSE_ZONE(zone_unregister),
  MI_INTERPOSE_ZONE(zone_valloc)
};


#else

// ------------------------------------------------------
// hook into the zone api's without interposing
// This is the official way of adding an allocator but
// it seems less robust than using interpose.
// ------------------------------------------------------

static inline malloc_zone_t* mi_get_default_zone(void)
{
  // The first returned zone is the real default
  malloc_zone_t** zones = NULL;
  unsigned count = 0;
  kern_return_t ret = malloc_get_all_zones(0, NULL, (vm_address_t**)&zones, &count);
  if (ret == KERN_SUCCESS && count > 0) {
    return zones[0];
  }
  else {
    // fallback
    return malloc_default_zone();
  }
}

#if defined(__clang__)
__attribute__((constructor(101))) // highest priority
#else
__attribute__((constructor))      // priority level is not supported by gcc
#endif
__attribute__((used))
static void _mi_macos_override_malloc(void) {
  malloc_zone_t* purgeable_zone = NULL;

  #if defined(MAC_OS_X_VERSION_10_6) && (MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_X_VERSION_10_6)
  // force the purgeable zone to exist to avoid strange bugs
  if (malloc_default_purgeable_zone) {
    purgeable_zone = malloc_default_purgeable_zone();
  }
  #endif

  // Register our zone.
  // thomcc: I think this is still needed to put us in the zone list.
  mi_malloc_zone.reserved1 = _mi_subproc_main();   // root for out-of-process introspection
  malloc_zone_register(&mi_malloc_zone);
  // Unregister the default zone, this makes our zone the new default
  // as that was the last registered.
  malloc_zone_t *default_zone = mi_get_default_zone();
  // thomcc: Unsure if the next test is *always* false or just false in the
  // cases I've tried. I'm also unsure if the code inside is needed. at all
  if (default_zone != &mi_malloc_zone) {
    malloc_zone_unregister(default_zone);

    // Reregister the default zone so free and realloc in that zone keep working.
    malloc_zone_register(default_zone);
  }

  // Unregister, and re-register the purgeable_zone to avoid bugs if it occurs
  // earlier than the default zone.
  if (purgeable_zone != NULL) {
    malloc_zone_unregister(purgeable_zone);
    malloc_zone_register(purgeable_zone);
  }

}
#endif  // MI_OSX_INTERPOSE

// Heap-image restore: libsystem_malloc rewrites a registered zone's function table in place (typed-malloc shims whose
// bookkeeping lives in libsystem's own per-process data). The zone as the image builder's libsystem left it therefore
// must not be copied over the one this process registered: the restore keeps these ranges as they are.
#ifdef __cplusplus
extern "C"
#endif
mi_decl_export size_t mi_malloc_zone_process_owned_ranges(uintptr_t (*out)[2], size_t cap) {
  size_t n = 0;
  if (n < cap) { out[n][0] = (uintptr_t)&mi_malloc_zone; out[n][1] = (uintptr_t)(&mi_malloc_zone + 1); n++; }
  if (n < cap) { out[n][0] = (uintptr_t)&mi_introspect; out[n][1] = (uintptr_t)(&mi_introspect + 1); n++; }
  return n;
}

#endif // MI_MALLOC_OVERRIDE
