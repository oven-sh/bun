/* ----------------------------------------------------------------------------
Copyright (c) 2019-2026, Microsoft Research, Daan Leijen
This is free software; you can redistribute it and/or modify it under the
terms of the MIT license. A copy of the license can be found in the file
"LICENSE" at the root of this distribution.
-----------------------------------------------------------------------------*/

/* ----------------------------------------------------------------------------
"Arenas" are fixed area's of OS memory from which we can allocate
large blocks (>= MI_ARENA_MIN_BLOCK_SIZE, 64KiB).
In contrast to the rest of mimalloc, the arenas are shared between
threads and need to be accessed using atomic operations.

Arenas are also used to for huge OS page (1GiB) reservations or for reserving
OS memory upfront which can be improve performance or is sometimes needed
on embedded devices. We can also employ this with WASI or `sbrk` systems
to reserve large arenas upfront and be able to reuse the memory more effectively.

The arena allocation needs to be thread safe and we use an atomic bitmap to allocate.
-----------------------------------------------------------------------------*/

#include "mimalloc.h"
#include "mimalloc/internal.h"
#include "mimalloc/prim.h"
#include "mimalloc/prim-tls.h"
#include "bitmap.h"

#if (MI_ARENA_MAX_SIZE >= MI_SIZE_SIZE*UINT32_MAX)
#error "The page_t.page_woffset field is not large enough to cover a full arena (redefine it to be an offset in MI_MAX_ALIGN_SIZE sizes?)"
#endif

/* -----------------------------------------------------------
  Arena id's
----------------------------------------------------------- */

mi_arena_id_t _mi_arena_id_none(void) {
  return NULL;
}

mi_arena_t* _mi_arena_from_id(mi_arena_id_t id) {
  mi_arena_t* const arena = (mi_arena_t*)id;
  mi_assert_internal(arena==NULL || arena->parent==NULL); // id's should never point to sub-arena's
  return arena;
}

mi_arena_id_t mi_arena_id_from_arena(mi_arena_t* arena) {
  mi_assert_internal(arena==NULL || arena->parent==NULL);
  return (arena==NULL ? _mi_arena_id_none() : (mi_arena_id_t)arena);
}


static bool mi_arena_is_suitable(mi_arena_t* arena, mi_arena_t* req_arena) {
  if (arena == req_arena) return true;                         // they match
  if (arena == NULL) return false;
  if (req_arena == NULL && !arena->is_exclusive) return true;  // or the arena is not exclusive, and we didn't request a specific one
  if (arena->parent != NULL && arena->parent == req_arena) return true;  // sub-arena? (note that req_arena is never a sub arena)
  return false;
}

bool _mi_arena_memid_is_suitable(mi_memid_t memid, mi_arena_t* request_arena) {
  if (memid.memkind == MI_MEM_ARENA) {
    return mi_arena_is_suitable(memid.mem.arena.arena, request_arena);
  }
  else {
    return mi_arena_is_suitable(NULL, request_arena);
  }
}

size_t mi_arenas_get_count(mi_subproc_t* subproc) {
  return mi_atomic_load_relaxed(&subproc->arena_count);
}

mi_arena_t* mi_arena_from_index(mi_subproc_t* subproc, size_t idx) {
  mi_assert_internal(idx < mi_arenas_get_count(subproc));
  return mi_atomic_load_ptr_acquire(mi_arena_t, &subproc->arenas[idx]);
}

static size_t mi_arena_info_slices(mi_arena_t* arena) {
  return arena->info_slices;
}

#if MI_DEBUG > 1
static bool mi_heap_has_page(mi_heap_t* heap, mi_arena_t* arena, mi_page_t* page) {
  mi_assert(arena->arena_idx < MI_MAX_ARENAS);
  mi_arena_pages_t* arena_pages = heap->arena_pages[arena->arena_idx];
  return (page->memid.memkind == MI_MEM_ARENA &&
          page->memid.mem.arena.arena == arena &&
          arena_pages != NULL &&
          mi_bitmap_is_setN(arena_pages->pages, page->memid.mem.arena.slice_index, 1));
}
#endif

size_t mi_arena_min_alignment(void) {
  return MI_ARENA_SLICE_ALIGN;
}

size_t mi_arena_min_size(void) {
  return MI_ARENA_MIN_SIZE;
}

static size_t mi_arena_max_object_size(void) {
  size_t max_size = mi_option_get_size(mi_option_arena_max_object_size);
  max_size = _mi_align_up(max_size, MI_ARENA_SLICE_SIZE);
  if (max_size <= MI_ARENA_MIN_OBJ_SIZE) {
    return MI_ARENA_MIN_OBJ_SIZE;
  }
  else if (max_size >= MI_ARENA_MAX_SIZE - MI_BCHUNK_SIZE) {  // minus a bchunk to accommodate meta info
    return (MI_ARENA_MAX_SIZE - MI_BCHUNK_SIZE);
  }
  else {
    return max_size;
  }
}

mi_decl_nodiscard static bool mi_arena_commit(mi_subproc_t* subproc, mi_arena_t* arena, void* start, size_t size, bool* is_zero, size_t already_committed) {
  mi_assert_internal(subproc!=NULL);
  if (arena != NULL && arena->commit_fun != NULL) {
    return (*arena->commit_fun)(true, start, size, is_zero, arena->commit_fun_arg);
  }
  else if (already_committed > 0) {
    return _mi_os_commit_ex(subproc, start, size, is_zero, already_committed);
  }
  else {
    return _mi_os_commit(subproc, start, size, is_zero);
  }
}



/* -----------------------------------------------------------
  Util
----------------------------------------------------------- */


// Size of an arena
static size_t mi_arena_size(mi_arena_t* arena) {
  return mi_size_of_slices(arena->slice_count);
}

// Start of the arena memory area
static uint8_t* mi_arena_start(mi_arena_t* arena) {
  return ((uint8_t*)arena);
}

// Start of a slice
uint8_t* mi_arena_slice_start(mi_arena_t* arena, size_t slice_index) {
  mi_assert_internal(slice_index < arena->slice_count);
  return (mi_arena_start(arena) + mi_size_of_slices(slice_index));
}

mi_page_t* mi_arena_page_at_slice(mi_arena_t* arena, size_t slice_index) {
  mi_assert_internal(slice_index < arena->slice_count);
  if (arena->pages_meta != NULL) {
    mi_page_t* const page = &arena->pages_meta[slice_index];
    #if MI_PAGE_META_ALIGNED_FREE_SMALL
    // pages with small blocks still have the page at the start of the slice (and set the `block_size` in pages_meta to 0)
    if (page->block_size>0) return page;
    #else
    return page;
    #endif
  }
  // fall through (for MI_PAGE_META_ALIGNED_FREE_SMALL)
  return (mi_page_t*)mi_arena_slice_start(arena,slice_index);
}

// Arena area
void* mi_arena_area(mi_arena_id_t arena_id, size_t* size) {
  if (size != NULL) *size = 0;
  mi_arena_t* arena = _mi_arena_from_id(arena_id);
  if (arena == NULL) return NULL;
  if (size != NULL) {
    mi_assert_internal(mi_size_of_slices(arena->slice_count) <= arena->total_size);
    *size = arena->total_size;
  }
  return mi_arena_start(arena);
}


// Create an arena memid
static mi_memid_t mi_memid_create_arena(mi_arena_t* arena, size_t slice_index, size_t slice_count) {
  mi_assert_internal(slice_index < UINT32_MAX);
  mi_assert_internal(slice_count < UINT32_MAX);
  mi_assert_internal(slice_count > 0);
  mi_assert_internal(slice_index < arena->slice_count);
  mi_memid_t memid = _mi_memid_create(MI_MEM_ARENA);
  memid.mem.arena.arena = arena;
  memid.mem.arena.slice_index = (uint32_t)slice_index;
  memid.mem.arena.slice_count = (uint32_t)slice_count;
  return memid;
}

// get the arena and slice span
static mi_arena_t* mi_arena_from_memid(mi_memid_t memid, size_t* slice_index, size_t* slice_count) {
  mi_assert_internal(memid.memkind == MI_MEM_ARENA);
  mi_arena_t* arena = memid.mem.arena.arena;
  if (slice_index!=NULL) { *slice_index = memid.mem.arena.slice_index; }
  if (slice_count!=NULL) { *slice_count = memid.mem.arena.slice_count; }
  return arena;
}

static size_t mi_page_full_size(mi_page_t* page) {
  if (page->memid.memkind == MI_MEM_ARENA) {
    return page->memid.mem.arena.slice_count * MI_ARENA_SLICE_SIZE;
  }
  else if (mi_memid_is_os(page->memid) || page->memid.memkind == MI_MEM_EXTERNAL) {
    mi_assert_internal((uint8_t*)page->memid.mem.os.base <= (uint8_t*)page);
    const ptrdiff_t presize = (uint8_t*)page - (uint8_t*)page->memid.mem.os.base;
    mi_assert_internal((ptrdiff_t)page->memid.mem.os.size >= presize);
    return (presize > (ptrdiff_t)page->memid.mem.os.size ? 0 : page->memid.mem.os.size - presize);
  }
  else {
    return 0;
  }
}


/* -----------------------------------------------------------
  Arena Allocation
----------------------------------------------------------- */

static mi_decl_noinline void* mi_arena_try_alloc_at(
  mi_arena_t* arena, size_t slice_count, bool commit, size_t tseq, mi_memid_t* memid)
{
  mi_assert_internal(arena!=NULL);
  mi_assert_internal(slice_count>0);
  size_t slice_index;
  if (!mi_bbitmap_try_find_and_clearN(arena->slices_free, tseq, slice_count, &slice_index)) return NULL;

  // claimed it!
  void* p = mi_arena_slice_start(arena, slice_index);
  *memid = mi_memid_create_arena(arena, slice_index, slice_count);
  memid->is_pinned = arena->memid.is_pinned;

  // set the dirty bits and track which slices become accessible
  size_t touched_slices = slice_count;
  if (arena->memid.initially_zero) {
    size_t already_dirty = 0;
    memid->initially_zero = mi_bitmap_setN(arena->slices_dirty, slice_index, slice_count, &already_dirty);
    mi_assert_internal(already_dirty <= touched_slices);
    touched_slices -= already_dirty;
  }

  // set commit state
  if (commit) {
    // commit requested, but the range may not be committed as a whole: ensure it is committed now
    const size_t already_committed = mi_bitmap_popcountN(arena->slices_committed, slice_index, slice_count);
    if (already_committed < slice_count) {
      // not all committed, try to commit now
      bool commit_zero = false;
      if (!mi_arena_commit(arena->subproc, arena, p, mi_size_of_slices(slice_count), &commit_zero, mi_size_of_slices(slice_count - already_committed))) {
        // if the commit fails, release ownership, and return NULL;
        // note: this does not roll back dirty bits but that is ok.
        mi_bbitmap_setN(arena->slices_free, slice_index, slice_count);
        return NULL;
      }
      if (commit_zero) {
        memid->initially_zero = true;
      }

      // set the commit bits
      mi_bitmap_setN(arena->slices_committed, slice_index, slice_count, NULL);

      // committed
      #if MI_DEBUG > 1
      if (memid->initially_zero) {
        if (!mi_mem_is_zero(p, mi_size_of_slices(slice_count))) {
          _mi_error_message(EFAULT, "internal error: arena allocation was not zero-initialized!\n");
          memid->initially_zero = false;
        }
      }
      #endif
    }
    else {
      // already fully committed.
      _mi_os_reuse(arena->subproc, p, mi_size_of_slices(slice_count));
      // if the OS has overcommit, and this is the first time we access these pages, then
      // count the commit now (as at arena reserve we didn't count those commits as these are on-demand)
      if (_mi_os_has_overcommit() && touched_slices > 0 && !arena->memid.is_pinned /* huge pages, issue #1236 */) {
        mi_subproc_stat_increase( arena->subproc, committed, mi_size_of_slices(touched_slices));
      }
    }

    mi_assert_internal(mi_bitmap_is_setN(arena->slices_committed, slice_index, slice_count));
    memid->initially_committed = true;

    // tool support
    if (memid->initially_zero) {
      mi_track_mem_defined(p, slice_count * MI_ARENA_SLICE_SIZE);
    }
    else {
      mi_track_mem_undefined(p, slice_count * MI_ARENA_SLICE_SIZE);
    }
  }
  else {
    // no need to commit, but check if it is already fully committed
    memid->initially_committed = mi_bitmap_is_setN(arena->slices_committed, slice_index, slice_count);
    if (!memid->initially_committed) {
      // partly committed.. adjust stats
      size_t already_committed_count = 0;
      mi_bitmap_setN(arena->slices_committed, slice_index, slice_count, &already_committed_count);
      mi_bitmap_clearN(arena->slices_committed, slice_index, slice_count);
      mi_subproc_stat_decrease(arena->subproc, committed, mi_size_of_slices(already_committed_count));
    }
  }

  mi_assert_internal(mi_bbitmap_is_clearN(arena->slices_free, slice_index, slice_count));
  if (commit) { mi_assert_internal(mi_bitmap_is_setN(arena->slices_committed, slice_index, slice_count)); }
  if (commit) { mi_assert_internal(memid->initially_committed); }
  mi_assert_internal(mi_bitmap_is_setN(arena->slices_dirty, slice_index, slice_count));

  return p;
}


static int mi_reserve_os_memory_ex2(mi_subproc_t* subproc, size_t size, bool commit, bool allow_large, bool exclusive, mi_arena_id_t* arena_id);

// try to reserve a fresh arena space
static bool mi_arena_reserve(mi_subproc_t* subproc, size_t req_size, bool allow_large, mi_arena_id_t* arena_id)
{
  const size_t arena_count = mi_arenas_get_count(subproc);
  if (arena_count > (MI_MAX_ARENAS - 4)) return false;

  // calc reserve
  size_t arena_reserve = mi_option_get_size(mi_option_arena_reserve);
  if (arena_reserve == 0) return false;

  if (!_mi_os_has_virtual_reserve()) {
    arena_reserve = arena_reserve/4;  // be conservative if virtual reserve is not supported (for WASM for example)
  }
  arena_reserve = _mi_align_up(arena_reserve, MI_ARENA_SLICE_SIZE);

  if (arena_count >= 1 && arena_count <= 128) {
    // scale up the arena sizes exponentially every 8 entries
    const size_t multiplier = (size_t)1 << _mi_clamp(arena_count/8, 0, 16);
    size_t reserve = 0;
    if (!mi_mul_overflow(multiplier, arena_reserve, &reserve)) {
      arena_reserve = reserve;
    }
  }

  // try to accommodate the requested size for huge allocations
  req_size = _mi_align_up(req_size + MI_ARENA_MAX_CHUNK_OBJ_SIZE, MI_ARENA_MAX_CHUNK_OBJ_SIZE); // over-reserve for meta-info
  if (arena_reserve < req_size) {
    arena_reserve = req_size;
  }

  // check arena bounds
  const size_t min_reserve = MI_ARENA_MIN_SIZE;
  const size_t max_reserve = MI_ARENA_MAX_SIZE;   // 16 GiB
  if (arena_reserve < min_reserve) {
    arena_reserve = min_reserve;
  }
  else if (arena_reserve > max_reserve) {
    arena_reserve = max_reserve;
  }

  // should be able to at least handle the current allocation size
  if (arena_reserve < req_size) return false;

  // commit eagerly?
  bool arena_commit = false;
  const bool overcommit = _mi_os_has_overcommit();
  if (mi_option_get(mi_option_arena_eager_commit) == 2) { arena_commit = overcommit || mi_option_is_enabled(mi_option_allow_large_os_pages); }
  else if (mi_option_get(mi_option_arena_eager_commit) == 1) { arena_commit = true; }

  // on an OS with overcommit (Linux) we don't count the commit yet as it is on-demand. Once a slice
  // is actually allocated for the first time it will be counted.
  const bool adjust = (overcommit && arena_commit);
  if (adjust) { mi_subproc_stat_adjust_decrease( subproc, committed, arena_reserve); }
  // and try to reserve the arena
  int err = mi_reserve_os_memory_ex2(subproc, arena_reserve, arena_commit, allow_large, false /* exclusive? */, arena_id);
  if (err != 0) {
    if (adjust) { mi_subproc_stat_adjust_increase( subproc, committed, arena_reserve); } // roll back
    // failed to allocate: try a smaller size arena as fallback?
    const size_t small_arena_reserve = 4 * MI_ARENA_MIN_SIZE; // 128 MiB (or 32 MiB on 32-bit)
    if (arena_reserve > small_arena_reserve && small_arena_reserve > req_size) {
      // try again
      if (adjust) { mi_subproc_stat_adjust_decrease(subproc, committed, small_arena_reserve); }
      err = mi_reserve_os_memory_ex2(subproc, small_arena_reserve, arena_commit, allow_large, false /* exclusive? */, arena_id);
      if (err != 0 && adjust) { mi_subproc_stat_adjust_increase( subproc, committed, small_arena_reserve); } // roll back
    }
  }
  return (err==0);
}




/* -----------------------------------------------------------
  Arena iteration
----------------------------------------------------------- */

static inline bool mi_arena_is_suitable_ex(mi_arena_t* arena, mi_arena_t* req_arena, bool match_numa, int numa_node, bool allow_pinned) {
  if (!allow_pinned && arena->memid.is_pinned) return false;
  if (!mi_arena_is_suitable(arena, req_arena)) return false;
  if (req_arena == NULL) { // if not specific, check numa affinity
    const bool numa_suitable = (numa_node < 0 || arena->numa_node < 0 || arena->numa_node == numa_node);
    if (match_numa) { if (!numa_suitable) return false; }
               else { if (numa_suitable)  return false; }
  }
  return true;
}

// determine the start of search; important to keep heaps and threads
// into their own memory regions to reduce contention.
static size_t mi_arena_start_idx(mi_heap_t* heap, size_t tseq, size_t arena_cycle) {
  const size_t hseq   = heap->heap_seq;
  const size_t hcount = mi_atomic_load_relaxed(&heap->subproc->heap_count);
  if (arena_cycle <= 1)     return 0;
  if (hseq==0 || hcount<=1 || arena_cycle > 0x8FF) return (tseq % arena_cycle); // common for single heap programs

  // spread heaps evenly among arena's, and then evenly for threads in their fraction
  size_t start;
  mi_assert_internal(arena_cycle <= 0x8FF);             // prevent overflow on 32-bit
  const size_t frac = (arena_cycle * 256) / hcount;     // fraction in the arena_cycle; at most: arena_cycle * 0x100
  if (frac==0) {
    // many heaps (> 256 per arena)
    start = (hseq % arena_cycle);
  }
  else {
    const size_t hspot = (hseq % hcount);  
    start = (frac * hspot) / 256;           // (arena_cycle * (hseq % hcount)) / hcount
    if (frac >= 512) {  // at least 2 arena's per heap?
      start = start + (tseq % (frac/256));
    }
  }
  mi_assert_internal(start < arena_cycle);
  return start;
}

#define mi_forall_arenas(heap, req_arena, tseq, name_arena) { \
  const size_t _arena_count = mi_arenas_get_count(heap->subproc); \
  const size_t _arena_cycle = (_arena_count == 0 ? 0 : _arena_count - 1); /* first search the arenas below the last one */ \
  /* always start searching in the arena's below the max */ \
  const size_t _start = mi_arena_start_idx(heap,tseq,_arena_cycle); \
  for (size_t _i = 0; _i < _arena_count; _i++) { \
    mi_arena_t* name_arena; \
    if (req_arena != NULL) { \
      name_arena = req_arena; /* if there is a specific req_arena, only search that one */\
      if (_i > 0) break;      /* only once */ \
    } \
    else { \
      size_t _idx; \
      if (_i < _arena_cycle) { \
        _idx = _i + _start; \
        if (_idx >= _arena_cycle) { _idx -= _arena_cycle; } /* adjust so we rotate through the cycle */ \
      } \
      else { \
        _idx = _i; /* remaining arena's after the cycle */ \
      } \
      name_arena = mi_arena_from_index(heap->subproc,_idx); \
    } \
    if (name_arena != NULL) \
    {

#define mi_forall_arenas_end()  \
    } \
  } \
  }

#define mi_forall_suitable_arenas(heap, req_arena, tseq, match_numa, numa_node, allow_large, name_arena) \
  mi_forall_arenas(heap, req_arena,tseq,name_arena) { \
    if (mi_arena_is_suitable_ex(name_arena, req_arena, match_numa, numa_node, allow_large)) { \

#define mi_forall_suitable_arenas_end() \
  }} \
  mi_forall_arenas_end()

/* -----------------------------------------------------------
  Arena allocation
----------------------------------------------------------- */

// allocate slices from the arenas
static mi_decl_noinline void* mi_arenas_try_find_free(
  mi_heap_t* heap, size_t slice_count, size_t alignment,
  bool commit, bool allow_large, mi_arena_t* req_arena, size_t tseq, int numa_node, mi_memid_t* memid)
{
  // mi_assert_internal(slice_count <= mi_slice_count_of_size(MI_ARENA_MAX_CHUNK_OBJ_SIZE));
  mi_assert(alignment <= MI_ARENA_SLICE_ALIGN);
  if (alignment > MI_ARENA_SLICE_ALIGN) return NULL;

  // search arena's
  mi_forall_suitable_arenas(heap, req_arena, tseq, true /* only numa matching */, numa_node, allow_large, arena)
  {
    void* p = mi_arena_try_alloc_at(arena, slice_count, commit, tseq, memid);
    if (p != NULL) return p;
  }
  mi_forall_suitable_arenas_end();
  if (numa_node < 0) return NULL;

  // search again but now regardless of preferred numa affinity
  mi_forall_suitable_arenas(heap, req_arena, tseq, false /* numa non-matching now */, numa_node, allow_large, arena)
  {
    void* p = mi_arena_try_alloc_at(arena, slice_count, commit, tseq, memid);
    if (p != NULL) return p;
  }
  mi_forall_suitable_arenas_end();
  return NULL;
}

// Allocate slices from the arena's -- potentially allocating a fresh arena
static mi_decl_noinline void* mi_arenas_try_alloc(
  mi_heap_t* heap,
  size_t slice_count, size_t alignment,
  bool commit, bool allow_large,
  mi_arena_t* req_arena, size_t tseq, int numa_node, mi_memid_t* memid)
{
  // mi_assert(slice_count <= MI_ARENA_MAX_CHUNK_OBJ_SLICES);
  mi_assert(alignment <= MI_ARENA_SLICE_ALIGN);
  void* p;

  // not too large?
  if (slice_count * MI_ARENA_SLICE_SIZE > MI_ARENA_MAX_SIZE) return NULL;

  // try to find free slices in the arena's
  p = mi_arenas_try_find_free(heap, slice_count, alignment, commit, allow_large, req_arena, tseq, numa_node, memid);
  if (p != NULL) return p;

  // did we need a specific arena?
  if (req_arena != NULL) return NULL;

  // don't create arena's while preloading (todo: or should we?)
  if (_mi_preloading()) return NULL;

  // don't create arena's if OS allocation is disallowed
  if (mi_option_is_enabled(mi_option_disallow_os_alloc)) return NULL;

  // otherwise, try to reserve a new arena -- but one thread at a time.. (todo: allow 2 or 4 to reduce contention?)
  mi_subproc_t* const subproc = heap->subproc;
  const size_t arena_count = mi_arenas_get_count(subproc);
  mi_lock(&subproc->arena_reserve_lock) {
    if (arena_count == mi_arenas_get_count(subproc)) {
      // we are the first to enter the lock, reserve a fresh arena
      mi_arena_id_t arena_id = _mi_arena_id_none();
      mi_arena_reserve(subproc, mi_size_of_slices(slice_count), allow_large, &arena_id);
    }
    else {
      // another thread already reserved a new arena
    }
  }
  // try once more to allocate in the new arena
  mi_assert_internal(req_arena == NULL);
  p = mi_arenas_try_find_free(heap, slice_count, alignment, commit, allow_large, req_arena, tseq, numa_node, memid);
  if (p != NULL) return p;

  return NULL;
}

// Allocate from the OS (if allowed)
static void* mi_arena_os_alloc_aligned(
  mi_subproc_t* subproc,
  size_t size, size_t alignment, size_t align_offset,
  bool commit, bool allow_large,
  mi_arena_id_t req_arena_id, mi_memid_t* memid)
{
  // if we cannot use OS allocation, return NULL
  if (mi_option_is_enabled(mi_option_disallow_os_alloc) || req_arena_id != _mi_arena_id_none()) {
    errno = ENOMEM;
    return NULL;
  }

  if (align_offset > 0) {
    return _mi_os_alloc_aligned_at_offset(subproc, size, alignment, align_offset, commit, allow_large, memid);
  }
  else {
    return _mi_os_alloc_aligned(subproc, size, alignment, commit, allow_large, memid);
  }
}


// Allocate large sized memory
void* _mi_arenas_alloc_aligned( mi_heap_t* heap,
  size_t size, size_t alignment, size_t align_offset,
  bool commit, bool allow_large,
  mi_arena_t* req_arena, size_t tseq, int numa_node, mi_memid_t* memid)
{
  mi_assert_internal(memid != NULL);
  mi_assert_internal(size > 0);

  // try to allocate in an arena if the alignment is small enough and the object is not too small (as for theap meta data)
  if (!mi_option_is_enabled(mi_option_disallow_arena_alloc) &&                // is arena allocation allowed?
      size >= MI_ARENA_MIN_OBJ_SIZE && size <= mi_arena_max_object_size() &&  // and not too small or too large
      alignment <= MI_ARENA_SLICE_ALIGN && align_offset == 0)                 // and good alignment
  {
    const size_t slice_count = mi_slice_count_of_size(size);
    void* p = mi_arenas_try_alloc(heap, slice_count, alignment, commit, allow_large, req_arena, tseq, numa_node, memid);
    if (p != NULL) return p;
  }

  // fall back to the OS
  void* p = mi_arena_os_alloc_aligned(heap->subproc, size, alignment, align_offset, commit, allow_large, req_arena, memid);
  return p;
}

void* _mi_arenas_alloc(mi_heap_t* heap, size_t size, bool commit, bool allow_large, mi_arena_t* req_arena, size_t tseq, int numa_node, mi_memid_t* memid)
{
  return _mi_arenas_alloc_aligned(heap, size, MI_ARENA_SLICE_SIZE, 0, commit, allow_large, req_arena, tseq, numa_node, memid);
}



/* -----------------------------------------------------------
  Arena page allocation
----------------------------------------------------------- */

// release ownership of a page. This may free the page if all blocks were concurrently
// freed in the meantime. Returns true if the page was freed.
static bool mi_abandoned_page_unown(mi_page_t* page, mi_theap_t* current_theap /* can be NULL */) {
  mi_assert_internal(mi_page_is_owned(page));
  mi_assert_internal(mi_page_is_abandoned(page));
  mi_assert_internal(_mi_theap_can_touch(current_theap));
  mi_thread_free_t tf_new;
  mi_thread_free_t tf_old = mi_atomic_load_relaxed(&page->xthread_free);
  do {
    mi_assert_internal(mi_tf_is_owned(tf_old));
    while mi_unlikely(mi_tf_block(tf_old) != NULL) {
      _mi_page_free_collect(page, false);  // update used
      if (mi_page_all_free(page)) {        // it may become free just before unowning it
        _mi_arenas_page_unabandon(page, current_theap);
        _mi_arenas_page_free(page, current_theap);
        return true;
      }
      tf_old = mi_atomic_load_relaxed(&page->xthread_free);
    }
    mi_assert_internal(mi_tf_block(tf_old)==NULL);
    tf_new = mi_tf_create(NULL, false);
  } while (!mi_atomic_cas_weak_acq_rel(&page->xthread_free, &tf_old, tf_new));
  return false;
}


static bool mi_arena_try_claim_abandoned(size_t slice_index, mi_arena_t* arena, bool* keep_abandoned) {
  // found an abandoned page of the right size
  mi_page_t* const page  = mi_arena_page_at_slice(arena, slice_index);
  // can we claim ownership?
  if (!mi_page_claim_ownership(page)) {
    // there was a concurrent free that reclaims this page ..
    // we need to keep it in the abandoned map as the free will call `mi_arena_page_unabandon`,
    // and wait for readers (us!) to finish. This is why it is very important to set the abandoned
    // bit again (or otherwise the unabandon will never stop waiting).
    *keep_abandoned = true;
    return false;
  }
  else {
    // yes, we can reclaim it, keep the abandoned map entry clear
    *keep_abandoned = false;
    return true;
  }
}

// allocate initial arena_pages from the main heap
static mi_arena_pages_t* mi_arena_pages_alloc(mi_arena_t* arena);

static mi_arena_pages_t* mi_heap_arena_pages(mi_heap_t* heap, mi_arena_t* arena) {
  mi_assert_internal(arena!=NULL);
  mi_assert_internal(heap!=NULL);
  mi_assert(arena->arena_idx < MI_MAX_ARENAS);
  return mi_atomic_load_ptr_acquire(mi_arena_pages_t, &heap->arena_pages[arena->arena_idx]);
}

static mi_arena_t* mi_page_arena_pages(mi_page_t* page, size_t* slice_index, size_t* slice_count, mi_arena_pages_t** parena_pages) {
  // todo: maybe store the arena* directly in the page?
  mi_assert_internal(mi_page_is_owned(page));
  mi_arena_t* const arena = mi_arena_from_memid(page->memid, slice_index, slice_count);
  mi_assert_internal(arena != NULL);
  if (parena_pages != NULL) {
    mi_heap_t* heap = mi_page_heap(page);
    mi_arena_pages_t* const arena_pages = mi_heap_arena_pages(heap, arena);
    mi_assert_internal(arena_pages != NULL);
    mi_assert_internal(slice_index==NULL || mi_bitmap_is_set(arena_pages->pages, *slice_index));
    *parena_pages = arena_pages;
  }
  return arena;
}

static mi_arena_pages_t* mi_heap_ensure_arena_pages(mi_heap_t* heap, mi_arena_t* arena) {
  mi_assert_internal(arena!=NULL);
  mi_assert_internal(heap!=NULL);
  mi_assert(arena->arena_idx < MI_MAX_ARENAS);
  mi_arena_pages_t* arena_pages = mi_heap_arena_pages(heap, arena);
  if (arena_pages==NULL) {
    mi_lock(&heap->arena_pages_lock) {
      arena_pages = mi_atomic_load_ptr_acquire(mi_arena_pages_t, &heap->arena_pages[arena->arena_idx]);
      if (arena_pages == NULL) {  // still NULL?
        if (_mi_is_heap_main(heap)) {
          // the page info for the main heap is always allocated as part of an arena
          arena_pages = &arena->pages_main;
        }
        else {
          // always allocate the arena pages info from the main heap
          // todo: allocate into the current arena?
          arena_pages = mi_arena_pages_alloc(arena);
        }
        mi_atomic_store_ptr_release(mi_arena_pages_t, &heap->arena_pages[arena->arena_idx], arena_pages);
      }
    }
  }
  if (_mi_is_heap_main(heap)) { mi_assert(arena_pages != NULL); }  // can never fail
  return arena_pages;
}

static mi_page_t* mi_arenas_page_try_find_abandoned(mi_theap_t* theap, size_t slice_count, size_t block_size)
{
  mi_heap_t* const heap = _mi_theap_heap(theap);
  const size_t tseq = theap->tld->thread_seq;
  mi_arena_t* const req_arena = heap->exclusive_arena;

  MI_UNUSED(slice_count);
  const size_t bin = _mi_bin(block_size);
  if (bin >= MI_ARENA_BIN_COUNT) {
    return NULL; // singleton page size
  }

  // any abandoned in our size class?
  mi_assert_internal(heap != NULL);
  if (mi_atomic_load_relaxed(&heap->abandoned_count[bin]) == 0) {
    return NULL;
  }

  // search arena's
  const bool allow_large = true;
  const int  any_numa = -1;
  const bool match_numa = true;
  mi_forall_suitable_arenas(heap, req_arena, tseq, match_numa, any_numa, allow_large, arena)
  {
    mi_arena_pages_t* const arena_pages = mi_heap_arena_pages(heap, arena);
    if (arena_pages != NULL) {
      size_t slice_index;
      mi_bitmap_t* const bitmap = arena_pages->pages_abandoned[bin];

      if (mi_bitmap_try_find_and_claim(bitmap, tseq, &slice_index, &mi_arena_try_claim_abandoned, arena)) {
        // found an abandoned page of the right size
        // and claimed ownership.
        mi_page_t* page = mi_arena_page_at_slice(arena, slice_index);
        mi_assert_internal(mi_page_is_owned(page));
        mi_assert_internal(mi_page_is_abandoned(page));
        mi_assert_internal(mi_heap_has_page(heap, arena, page));
        mi_atomic_decrement_relaxed(&heap->abandoned_count[bin]);
        mi_theap_stat_decrease(theap, pages_abandoned, 1);
        mi_theap_stat_counter_increase(theap, pages_reclaim_on_alloc, 1);

        _mi_page_free_collect(page, false);  // update `used` count
        mi_assert_internal(mi_bbitmap_is_clearN(arena->slices_free, slice_index, slice_count));
        mi_assert_internal(page->slice_committed > 0 || mi_bitmap_is_setN(arena->slices_committed, slice_index, slice_count));
        mi_assert_internal(mi_bitmap_is_setN(arena->slices_dirty, slice_index, slice_count));
        mi_assert_internal(_mi_is_aligned(mi_page_slice_start(page), MI_PAGE_ALIGN));
        mi_assert_internal(_mi_ptr_page(mi_page_start(page))==page);
        mi_assert_internal(mi_page_block_size(page) == block_size);
        mi_assert_internal(!mi_page_is_full(page));
        return page;
      }
    }
  }
  mi_forall_suitable_arenas_end();
  return NULL;
}

static uint8_t* mi_arenas_page_alloc_fresh_area(mi_theap_t* theap, size_t slice_count, size_t block_size, size_t block_alignment, bool os_align, bool commit, mi_memid_t* memid, mi_arena_pages_t** parena_pages ) {
  MI_UNUSED_RELEASE(block_size);
  mi_assert_internal(parena_pages!=NULL);

  *parena_pages = NULL;
  const bool allow_large = (MI_SECURE < 5); // 5 = guard page at end of each arena page
  const size_t page_alignment = MI_ARENA_SLICE_ALIGN;

  mi_heap_t*  const heap = _mi_theap_heap(theap);
  mi_tld_t*   const tld  = theap->tld;
  mi_arena_t* const req_arena = heap->exclusive_arena;
  const int numa_node = (heap->numa_node >= 0 ? heap->numa_node : tld->numa_node);

  // try to allocate from free space in arena's
  uint8_t* start = NULL;
  *memid = _mi_memid_none();
  const size_t alloc_size = mi_size_of_slices(slice_count);
  if (!mi_option_is_enabled(mi_option_disallow_arena_alloc) &&       // allowed to allocate from arena's?
      !os_align &&                                                   // not large alignment
      slice_count <= mi_arena_max_object_size()/MI_ARENA_SLICE_SIZE) // and not too large
  {
    start = (uint8_t*)mi_arenas_try_alloc(heap, slice_count, page_alignment, commit, allow_large, req_arena, tld->thread_seq, numa_node, memid);
    if (start != NULL) {
      mi_arena_pages_t* const arena_pages = mi_heap_ensure_arena_pages(heap, memid->mem.arena.arena);
      *parena_pages = arena_pages;
      if (arena_pages==NULL) {
        _mi_arenas_free(heap->subproc, start, mi_size_of_slices(slice_count), *memid); // roll back
        start = NULL;
      }
      else {
        // note: the following assert should hold if we could check it atomically, but in a concurrent setting we may already allocate in slice_count
        // mi_assert_internal(mi_bitmap_is_clearN(arena_pages->pages, memid->mem.arena.slice_index, memid->mem.arena.slice_count));
        mi_assert_internal(mi_bitmap_is_clear(arena_pages->pages, memid->mem.arena.slice_index));
        // don't set yet: mi_bitmap_set(arena_pages->pages, memid->mem.arena.slice_index);
      }
    }
  }

  // otherwise fall back to the OS
  if (start == NULL) {
    if (os_align) {
      // note: slice_count already includes the page
      mi_assert_internal(slice_count >= mi_slice_count_of_size(block_size) + mi_slice_count_of_size(page_alignment));
      start = (uint8_t*)mi_arena_os_alloc_aligned(heap->subproc, alloc_size, block_alignment, page_alignment /* align offset */, commit, allow_large, req_arena, memid);
    }
    else {
      start = (uint8_t*)mi_arena_os_alloc_aligned(heap->subproc, alloc_size, page_alignment, 0 /* align offset */, commit, allow_large, req_arena, memid);
    }
  }

  if (start == NULL) return NULL;
  mi_assert_internal(_mi_is_aligned(start, MI_PAGE_ALIGN));
  mi_assert_internal(!os_align || _mi_is_aligned(start + page_alignment, block_alignment));
  return start;
}

static size_t mi_page_block_start(size_t block_size, bool os_align)
{
  #if MI_GUARDED
  // in a guarded build, we align pages with blocks a multiple of an OS page size, to the OS page size
  // this ensures that all blocks in such pages are OS page size aligned (which is needed for the guard pages)
  const size_t os_page_size = _mi_os_page_size();
  mi_assert_internal(MI_PAGE_ALIGN >= os_page_size);
  if (!os_align && block_size % os_page_size == 0 && block_size > os_page_size /* at least 2 or more */ ) {
    return _mi_align_up(mi_page_info_size(), os_page_size);
  }
  else
  #endif
  if (os_align) {
    return MI_PAGE_ALIGN;
  }
  else if (_mi_is_power_of_two(block_size) && block_size <= MI_PAGE_MAX_START_BLOCK_ALIGN2) {
    // naturally align power-of-2 blocks up to MI_PAGE_MAX_START_BLOCK_ALIGN2 size (4KiB)
    return _mi_align_up(mi_page_info_size(), block_size);
  }
  else if (block_size != 0 && (block_size % MI_PAGE_OSPAGE_BLOCK_ALIGN2) == 0) {
    // also align large pages that are a multiple of MI_PAGE_OSPAGE_BLOCK_ALIGN2 (4KiB)
    return _mi_align_up(mi_page_info_size(), MI_PAGE_OSPAGE_BLOCK_ALIGN2);
  }
  else {
    // otherwise start after the info
    return mi_page_info_size();
  }
}

// Free a page without modifying page_bin stats
static void mi_arenas_page_free_prim(mi_page_t* page);

// Allocate a fresh page
static mi_page_t* mi_arenas_page_alloc_fresh(mi_theap_t* theap, size_t slice_count, size_t block_size, size_t block_alignment, bool commit)
{
  const bool os_align           = (block_alignment > MI_PAGE_MAX_OVERALLOC_ALIGN);
  const size_t alloc_size       = mi_size_of_slices(slice_count);
  mi_memid_t memid              = _mi_memid_none();
  mi_arena_pages_t* arena_pages = NULL;
  uint8_t* const slice_start    = mi_arenas_page_alloc_fresh_area(theap,slice_count,block_size,block_alignment,os_align,commit,&memid,&arena_pages);
  if (!slice_start) return NULL;

  // guard page at the end of mimalloc page?
  #if MI_SECURE>=5
  mi_assert(alloc_size > _mi_os_secure_guard_page_size());
  const size_t page_noguard_size = alloc_size - _mi_os_secure_guard_page_size();
  #else
  const size_t page_noguard_size = alloc_size;
  #endif

  // allocate the page meta info
  mi_page_t* page = NULL;
  bool page_meta_is_separate = false;
  size_t block_start = 0;

  // allocate page meta info at the arena start?
  if (memid.memkind == MI_MEM_ARENA) {
    mi_arena_t* const arena = memid.mem.arena.arena;
    if (arena->pages_meta != NULL) {
      mi_assert_internal(MI_PAGE_META_IS_SEPARATED!=0);
      mi_page_t* const page_meta = &arena->pages_meta[memid.mem.arena.slice_index];
      #if MI_PAGE_META_ALIGNED_FREE_SMALL
      // Only pre-zeroed in this configuration; see the `pages_meta` note in
      // `mi_arena_initialize`. Otherwise an unclaimed entry may hold anything
      // (external memory we were not told was zero) until the memzero below.
      mi_assert_internal(page_meta->block_size == 0);
      // if `block_size <= MI_SMALL_SIZE_MAX` we put the page info in front of the slice,
      // (note: it is important that `page_meta->block_size == 0` for `mi_arena_page_at_slice`)
      if (block_size > MI_SMALL_SIZE_MAX)
      #endif
      {
        page = page_meta;
        page_meta_is_separate = true;
        block_start = 0;
        #if !defined(MI_PAGE_BLOCK_START_MAX_OFFSET)
        #define MI_PAGE_BLOCK_START_MAX_OFFSET  (8*MI_INTPTR_BITS) /* 512 */
        #endif
        if (block_size >= MI_INTPTR_SIZE && block_size <= MI_PAGE_BLOCK_START_MAX_OFFSET && _mi_is_power_of_two(block_size)) {
          block_start += block_size;
        }
        _mi_memzero_aligned(page, sizeof(*page));
      }
    }
  }
  if (page == NULL) {
    // put page meta info in front of the slice
    page = (mi_page_t*)slice_start;
    block_start = mi_page_block_start(block_size, os_align);
  }

  // commit first block?
  size_t commit_size = 0;
  if (!memid.initially_committed) {
    commit_size = _mi_align_up(block_start + block_size, MI_PAGE_MIN_COMMIT_SIZE);
    if (commit_size > page_noguard_size) { commit_size = page_noguard_size; }
    bool is_zero = false;
    if mi_unlikely(!mi_arena_commit( _mi_theap_subproc(theap), mi_memid_arena(memid), slice_start, commit_size, &is_zero, 0)) {
      _mi_arenas_free(_mi_theap_subproc(theap), slice_start, alloc_size, memid);
      return NULL;
    }
  }
  // now we can finish initalization and use `mi_arenas_free_page_prim` on error
  
  // zero initialize the page meta data
  if (!memid.initially_zero && !page_meta_is_separate) {
    _mi_memzero_aligned(page, sizeof(*page));
  }

  // set the guard page
  #if MI_SECURE>=5
  if (memid.initially_committed) {
    _mi_os_secure_guard_page_set_at(slice_start + page_noguard_size, memid);
  }
  #endif
  
  // claimed free slices: initialize the page partly
  if (!memid.initially_zero && memid.initially_committed) {
    mi_track_mem_undefined(slice_start, slice_count * MI_ARENA_SLICE_SIZE);
  }
  else if (memid.initially_committed) {
    mi_track_mem_defined(slice_start, slice_count * MI_ARENA_SLICE_SIZE);
  }
  #if MI_DEBUG > 1
  if (memid.initially_zero && memid.initially_committed) {
    if (!mi_mem_is_zero(slice_start, page_noguard_size)) {
      _mi_error_message(EFAULT, "internal error: page memory was not zero initialized.\n");
      memid.initially_zero = false;
      if (block_start > 0) { _mi_memzero_aligned(page, sizeof(*page)); }
    }
  }
  #endif
  const size_t reserved = (os_align ? 1 : (page_noguard_size - block_start) / block_size);
  mi_assert_internal(reserved > 0 && reserved <= UINT16_MAX);

  // initialize the page start
  uint8_t* const start = slice_start + block_start;
  mi_assert_internal(start > (uint8_t*)page);
  const size_t offset = start - (uint8_t*)page;
  mi_assert_internal((offset % MI_SIZE_SIZE) == 0 && (offset / MI_SIZE_SIZE) < UINT32_MAX);
  page->page_woffset = (uint32_t)(offset / MI_SIZE_SIZE);

  // initialize page meta-data
  page->reserved = (uint16_t)reserved;  
  page->block_size = block_size;
  page->memid = memid;
  page->free_is_zero = memid.initially_zero;

  mi_assert_internal((commit && commit_size==0) || (!commit && commit_size < UINT32_MAX));
  page->slice_committed = (uint32_t)commit_size;

  page->heap = _mi_theap_heap(theap);
  mi_page_set_theap(page,theap);
  // mi_assert_internal(mi_page_theap(page) == _mi_heap_theap_peek(page->heap));
  
  mi_assert_internal(page->free==NULL);
  mi_assert_internal(page_meta_is_separate == mi_page_meta_is_separated(page));
  mi_assert_internal(mi_page_slice_start(page) == slice_start);

  // now register in the arena_pages
  if (arena_pages!=NULL) {
    mi_assert_internal(memid.memkind == MI_MEM_ARENA);
    mi_bitmap_set(arena_pages->pages, memid.mem.arena.slice_index);
  }

  // and own it
  mi_page_claim_ownership(page);

  // register in the page map
  if mi_unlikely(!_mi_page_map_register(page)) {
    mi_arenas_page_free_prim(page);
    return NULL;
  }

  // publish in the heap's arena_pages bitmap only now that the page struct and page-map entry are
  // both in place; mi_heap_visit_page_at walks this bitmap and dereferences the page.
  if (memid.memkind == MI_MEM_ARENA) {
    mi_arena_pages_t* const arena_pages = mi_heap_arena_pages(_mi_theap_heap(theap), memid.mem.arena.arena);
    mi_assert_internal(arena_pages != NULL);  // mi_arenas_page_alloc_fresh_area ensured it
    if (arena_pages != NULL) { mi_bitmap_set(arena_pages->pages, memid.mem.arena.slice_index); }
  }

  // stats
  mi_theap_stat_increase(theap, pages, 1);
  mi_theap_stat_increase(theap, page_bins[_mi_page_stats_bin(page)], 1);

  mi_assert_internal(_mi_is_aligned(mi_page_slice_start(page),MI_PAGE_ALIGN));
  mi_assert_internal(_mi_ptr_page(mi_page_start(page))==page);
  mi_assert_internal(mi_page_block_size(page) == block_size);
  // mi_assert_internal(mi_page_is_abandoned(page));
  mi_assert_internal(mi_page_is_owned(page));

  return page;
}

// Allocate a regular small/medium/large page.
static mi_page_t* mi_arenas_page_regular_alloc(mi_theap_t* theap, size_t slice_count, size_t block_size)
{
  // 1. look for an abandoned page
  mi_page_t* page = mi_arenas_page_try_find_abandoned(theap, slice_count, block_size);
  if (page != NULL) {
    return page;  // return as abandoned
  }

  // 2. find a free block, potentially allocating a new arena
  const long commit_on_demand = mi_option_get(mi_option_page_commit_on_demand);
  const bool commit = (slice_count <= mi_slice_count_of_size(MI_PAGE_MIN_COMMIT_SIZE) ||  // always commit small pages
                       (slice_count >= mi_slice_count_of_size(UINT32_MAX)) ||             // always commit pages too large to hold a 32-bit slice_committed
                        (commit_on_demand == 2 && _mi_os_has_overcommit()) || (commit_on_demand == 0));
  page = mi_arenas_page_alloc_fresh(theap, slice_count, block_size, 1, commit);
  if (page == NULL) return NULL;

  mi_assert_internal(page->memid.memkind != MI_MEM_ARENA || page->memid.mem.arena.slice_count == slice_count);
  if (!_mi_page_init(theap, page)) {
    mi_arenas_page_free_prim(page);
    return NULL;
  }

  return page;
}

// Allocate a page containing one block (very large, or with large alignment)
static mi_page_t* mi_arenas_page_singleton_alloc(mi_theap_t* theap, size_t block_size, size_t block_alignment)
{
  const bool os_align = (block_alignment > MI_PAGE_MAX_OVERALLOC_ALIGN);
  const size_t info_size = (os_align ? MI_PAGE_ALIGN : mi_page_info_size());
  #if MI_SECURE < 2
  const size_t slice_count = mi_slice_count_of_size(info_size + block_size);
  #else
  const size_t slice_count = mi_slice_count_of_size(_mi_align_up(info_size + block_size, _mi_os_secure_guard_page_size()) + _mi_os_secure_guard_page_size());
  #endif

  mi_page_t* page = mi_arenas_page_alloc_fresh(theap, slice_count, block_size, block_alignment, true /* commit singletons always */);
  if (page == NULL) return NULL;

  mi_assert(page->reserved == 1);
  if (!_mi_page_init(theap, page)) {
    mi_arenas_page_free_prim(page);
    return NULL;
  }

  return page;
}


mi_page_t* _mi_arenas_page_alloc(mi_theap_t* theap, size_t block_size, size_t block_alignment) {
  mi_page_t* page;
  // semi static assert: ensure that all non-singleton block size bins are covered.
  mi_assert(_mi_bin(MI_LARGE_MAX_OBJ_SIZE)  < MI_ARENA_BIN_COUNT);
  if mi_unlikely(block_alignment > MI_PAGE_MAX_OVERALLOC_ALIGN) {
    mi_assert_internal(_mi_is_power_of_two(block_alignment));
    page = mi_arenas_page_singleton_alloc(theap, block_size, block_alignment);
  }
  else if (block_size <= MI_SMALL_MAX_OBJ_SIZE) {
    page = mi_arenas_page_regular_alloc(theap, mi_slice_count_of_size(MI_SMALL_PAGE_SIZE), block_size);
  }
  else if (block_size <= MI_MEDIUM_MAX_OBJ_SIZE) {
    page = mi_arenas_page_regular_alloc(theap, mi_slice_count_of_size(MI_MEDIUM_PAGE_SIZE), block_size);
  }
  #if MI_ENABLE_LARGE_PAGES
  else if (block_size <= MI_LARGE_MAX_OBJ_SIZE) {
    page = mi_arenas_page_regular_alloc(theap, mi_slice_count_of_size(MI_LARGE_PAGE_SIZE), block_size);
  }
  #endif
  else {
    page = mi_arenas_page_singleton_alloc(theap, block_size, block_alignment);
  }
  if mi_unlikely(page == NULL) {
    return NULL;
  }
  // mi_assert_internal(page == NULL || _mi_page_segment(page)->subproc == tld->subproc);
  mi_assert_internal(_mi_is_aligned(mi_page_slice_start(page), MI_PAGE_ALIGN));
  mi_assert_internal(_mi_ptr_page(mi_page_start(page))==page);
  mi_assert_internal(block_alignment <= MI_PAGE_MAX_OVERALLOC_ALIGN || _mi_is_aligned(mi_page_start(page), block_alignment));

  return page;
}

static void mi_arenas_page_free_prim(mi_page_t* page) {
  mi_assert_internal(_mi_is_aligned(mi_page_slice_start(page), MI_PAGE_ALIGN));
  mi_assert_internal(_mi_ptr_page(mi_page_start(page))==page);
  mi_assert_internal(mi_page_is_owned(page));
  mi_assert_internal(mi_page_all_free(page));
  mi_assert_internal(page->next==NULL && page->prev==NULL);
  
  #if MI_DEBUG>1
  if (page->memid.memkind==MI_MEM_ARENA && !mi_page_is_full(page)) {
    size_t bin = _mi_bin(mi_page_block_size(page));
    size_t slice_index;
    size_t slice_count;
    mi_arena_pages_t* arena_pages = NULL;
    mi_arena_t* const arena = mi_page_arena_pages(page, &slice_index, &slice_count, &arena_pages);
    mi_assert_internal(mi_bbitmap_is_clearN(arena->slices_free, slice_index, slice_count));
    mi_assert_internal(page->slice_committed > 0 || mi_bitmap_is_setN(arena->slices_committed, slice_index, slice_count));
    mi_assert_internal(bin >= MI_ARENA_BIN_COUNT || mi_bitmap_is_clearN(arena_pages->pages_abandoned[bin], slice_index, 1));
    mi_assert_internal(mi_bitmap_is_setN(arena_pages->pages, slice_index, 1));
    // note: we cannot check for `!mi_page_is_abandoned_and_mapped` since that may
    // be (temporarily) not true if the free happens while trying to reclaim
    // see `mi_arena_try_claim_abandoned`
  }
  #endif

  // recommit guard page at the end?
  // we must do this since we may later allocate large spans over this page and cannot have a guard page in between
  #if MI_SECURE >= 5
  if (!page->memid.is_pinned) {
    _mi_os_secure_guard_page_reset_before(mi_page_slice_start(page) + mi_page_full_size(page), page->memid);
  }
  #endif

  // unpublish from the heap's arena_pages bitmap before unregistering the page-map: visitors
  // (mi_heap_visit_page_at) walk this bitmap and call _mi_ptr_page on the result, and a fork()
  // between page-map-unregister and bitmap-clear would freeze that inconsistency in the child.
  if (page->memid.memkind == MI_MEM_ARENA) {
    mi_arena_pages_t* arena_pages;
    size_t slice_index;
    size_t slice_count; MI_UNUSED(slice_count);
    mi_arena_t* const arena = mi_page_arena_pages(page, &slice_index, &slice_count, &arena_pages);
    mi_assert_internal(arena_pages!=NULL);
    mi_assert_internal(arena->subproc == mi_page_subproc(page));
    mi_bitmap_clear(arena_pages->pages, slice_index);
    if (page->slice_committed > 0) {
      // if committed on-demand, set the commit bits to account commit properly
      mi_assert_internal(mi_page_full_size(page) >= page->slice_committed);
      const size_t total_slices = page->slice_committed / MI_ARENA_SLICE_SIZE;  // conservative
      //mi_assert_internal(mi_bitmap_is_clearN(arena->slices_committed, slice_index, total_slices));
      mi_assert_internal(slice_count >= total_slices);
      if (total_slices > 0) {
        mi_bitmap_setN(arena->slices_committed, slice_index, total_slices, NULL);
      }
      // any left over?
      const size_t extra = page->slice_committed % MI_ARENA_SLICE_SIZE;
      if (extra > 0) {
        // pretend it was decommitted already
        mi_subproc_stat_decrease(arena->subproc, committed, extra);
      }
    }
    else {
      mi_assert_internal(mi_bitmap_is_setN(arena->slices_committed, slice_index, slice_count));
    }
  }
  // unregister page (after the arena_pages bitmap clear above)
  _mi_page_map_unregister(page);
  if (mi_page_meta_is_separated(page)) { page->block_size = 0; }  // for assertion checking
  _mi_arenas_free( mi_page_subproc(page), mi_page_slice_start(page), mi_page_full_size(page), page->memid);
}

void _mi_arenas_page_free(mi_page_t* page, mi_theap_t* current_theapx) {
  mi_assert_internal(_mi_is_aligned(mi_page_slice_start(page), MI_PAGE_ALIGN));
  mi_assert_internal(_mi_ptr_page(mi_page_start(page))==page);
  mi_assert_internal(mi_page_is_owned(page));
  mi_assert_internal(mi_page_all_free(page));
  mi_assert_internal(mi_page_is_abandoned(page));
  mi_assert_internal(page->next==NULL && page->prev==NULL);
  mi_assert_internal(_mi_theap_can_touch(current_theapx));

  // Undo any hole in the page: the arena can hand this memory out again as committed without
  // any further `reuse` call, and on macOS a discarded page stays reclaimable by the kernel
  // until it is MADV_FREE_REUSE'd.
  _mi_page_unpurge_all(page);

  if (current_theapx != NULL) {
    mi_theap_stat_decrease(current_theapx, page_bins[_mi_page_stats_bin(page)], 1);
    mi_theap_stat_decrease(current_theapx, pages, 1);
  }
  else {
    mi_heap_t* const heap = mi_page_heap(page);
    mi_heap_stat_decrease(heap, page_bins[_mi_page_stats_bin(page)], 1);
    mi_heap_stat_decrease(heap, pages, 1);
  }
  mi_arenas_page_free_prim(page);
}

/* -----------------------------------------------------------
  Arena abandon
----------------------------------------------------------- */

void _mi_arenas_page_abandon(mi_page_t* page, mi_theap_t* current_theap) {
  mi_assert_internal(_mi_is_aligned(mi_page_slice_start(page), MI_PAGE_ALIGN));
  mi_assert_internal(_mi_ptr_page(mi_page_start(page))==page);
  mi_assert_internal(mi_page_is_owned(page));
  mi_assert_internal(mi_page_is_abandoned(page));
  mi_assert_internal(!mi_page_all_free(page));
  mi_assert_internal(page->next==NULL && page->prev == NULL);
  mi_assert_internal(_mi_thread_id()==current_theap->tld->thread_id);
  // mi_assert_internal(current_theap == _mi_page_associated_theap(page));

  // add to abandoned?
  mi_heap_t* heap = mi_page_heap(page); 
  mi_assert_internal(heap==_mi_theap_heap(current_theap));
  if (page->memid.memkind==MI_MEM_ARENA && !mi_page_is_full(page)) {
    // make available for allocations
    size_t bin = _mi_bin(mi_page_block_size(page));
    mi_assert_internal(bin < MI_ARENA_BIN_COUNT);
    if (bin < MI_ARENA_BIN_COUNT) { // paranoia
      size_t slice_index;
      size_t slice_count;
      mi_arena_pages_t* arena_pages = NULL;
      mi_arena_t* const arena = mi_page_arena_pages(page, &slice_index, &slice_count, &arena_pages); MI_UNUSED(arena);

      mi_assert_internal(!mi_page_is_singleton(page));
      mi_assert_internal(mi_bbitmap_is_clearN(arena->slices_free, slice_index, slice_count));
      mi_assert_internal(page->slice_committed > 0 || mi_bitmap_is_setN(arena->slices_committed, slice_index, slice_count));
      mi_assert_internal(mi_bitmap_is_setN(arena->slices_dirty, slice_index, slice_count));

      mi_page_set_abandoned_mapped(page);
      const bool was_clear = mi_bitmap_set(arena_pages->pages_abandoned[bin], slice_index);
      MI_UNUSED(was_clear); mi_assert_internal(was_clear);
      mi_atomic_increment_relaxed(&heap->abandoned_count[bin]);
      mi_theap_stat_increase(current_theap, pages_abandoned, 1);
      mi_abandoned_page_unown(page, current_theap);
      return;
    }
  }
  // otherwise,
  // page is full (or a singleton), or the page is OS/externally allocated
  // leave as is; it will be reclaimed when an object is free'd in the page
  // but for non-arena pages, add to the subproc list so these can be visited
  if (page->memid.memkind != MI_MEM_ARENA) {
    mi_lock(&heap->os_abandoned_pages_lock) {
      // push in front
      page->prev = NULL;
      page->next = heap->os_abandoned_pages;
      if (page->next != NULL) { page->next->prev = page; }
      heap->os_abandoned_pages = page;
    }
  }
  mi_theap_stat_increase(current_theap, pages_abandoned, 1);
  mi_abandoned_page_unown(page, current_theap);
}


// this is called from `free.c:mi_free_try_collect_mt` only.
bool _mi_arenas_page_try_reabandon_to_mapped(mi_page_t* page) {
  mi_assert_internal(_mi_is_aligned(mi_page_slice_start(page), MI_PAGE_ALIGN));
  mi_assert_internal(_mi_ptr_page(mi_page_start(page))==page);
  mi_assert_internal(mi_page_is_owned(page));
  mi_assert_internal(mi_page_is_abandoned(page));
  mi_assert_internal(!mi_page_is_abandoned_mapped(page));
  mi_assert_internal(!mi_page_is_full(page));
  mi_assert_internal(!mi_page_all_free(page));
  mi_assert_internal(!mi_page_is_singleton(page));
  if (mi_page_is_full(page) || mi_page_is_abandoned_mapped(page) || page->memid.memkind != MI_MEM_ARENA) {
    return false;
  }
  else {
    // do not use _mi_heap_theap as we may call this during shutdown of threads and don't want to reinitialize the theap
    mi_theap_t* const theap = _mi_page_associated_theap_peek(page);
    if (theap == NULL) {
      return false;
    }
    else {
      mi_theap_stat_counter_increase(theap, pages_reabandon_full, 1);
      mi_theap_stat_adjust_decrease(theap, pages_abandoned, 1);  // adjust as we are not abandoning fresh
      _mi_arenas_page_abandon(page, theap);
      return true;
    }
  }
}

// called from `mi_free` if trying to unabandon an abandoned page
void _mi_arenas_page_unabandon(mi_page_t* page, mi_theap_t* current_theapx) {
  mi_assert_internal(_mi_is_aligned(mi_page_slice_start(page), MI_PAGE_ALIGN));
  mi_assert_internal(_mi_ptr_page(mi_page_start(page))==page);
  mi_assert_internal(mi_page_is_owned(page));
  mi_assert_internal(mi_page_is_abandoned(page));
  mi_assert_internal(_mi_theap_can_touch(current_theapx));

  mi_heap_t* const heap = mi_page_heap(page);
  if (mi_page_is_abandoned_mapped(page)) {
    mi_assert_internal(page->memid.memkind==MI_MEM_ARENA);
    // remove from the abandoned map
    const size_t bin = _mi_bin(mi_page_block_size(page));
    mi_assert_internal(bin < MI_ARENA_BIN_COUNT);
    size_t slice_index;
    size_t slice_count;
    mi_arena_pages_t* arena_pages;
    mi_arena_t* arena = mi_page_arena_pages(page, &slice_index, &slice_count, &arena_pages);  MI_UNUSED(arena);

    mi_assert_internal(mi_bbitmap_is_clearN(arena->slices_free, slice_index, slice_count));
    mi_assert_internal(page->slice_committed > 0 || mi_bitmap_is_setN(arena->slices_committed, slice_index, slice_count));

    // this busy waits until a concurrent reader (from alloc_abandoned) is done
    mi_bitmap_clear_once_set(arena->subproc, arena_pages->pages_abandoned[bin], slice_index);
    mi_page_clear_abandoned_mapped(page);
    mi_atomic_decrement_relaxed(&heap->abandoned_count[bin]);
  }
  else {
    // page is full (or a singleton), page is OS allocated
    // if not an arena page, remove from the subproc os pages list
    if (page->memid.memkind != MI_MEM_ARENA) {
      mi_lock(&heap->os_abandoned_pages_lock) {
        if (page->prev != NULL) { page->prev->next = page->next; }
        if (page->next != NULL) { page->next->prev = page->prev; }
        if (heap->os_abandoned_pages == page) { heap->os_abandoned_pages = page->next; }
        page->next = NULL;
        page->prev = NULL;
      }
    }
  }
  if (current_theapx!=NULL) {
    mi_theap_stat_decrease(current_theapx, pages_abandoned, 1);
  }
  else {
    mi_heap_stat_decrease(heap, pages_abandoned, 1);
  }
}


/* -----------------------------------------------------------
  Purge the holes in abandoned pages

  Abandoned pages have no owning thread, so the idle sweep of a theap never sees them --
  yet with the default `allow_page_abandon` every page that ever became full ends up here.
  We claim each page with the arena's ownership protocol before touching its free list.
----------------------------------------------------------- */

typedef struct mi_purge_holes_arg_s {
  mi_bitmap_t* bitmap;
  mi_tld_t*    tld;      // whose park we are sweeping under; NULL when not a parked sweep
} mi_purge_holes_arg_t;

static bool mi_arena_page_purge_holes_at(size_t slice_index, size_t slice_count, mi_arena_t* arena, void* arg) {
  MI_UNUSED(slice_count);
  mi_purge_holes_arg_t* const parg = (mi_purge_holes_arg_t*)arg;
  // this pass holds every page that ever became full, so it is most of a cold sweep: an owner
  // waiting in `_mi_park_leave` cannot allocate until we stop
  if (parg->tld != NULL && mi_atomic_load_relaxed(&parg->tld->park_reclaim) != 0) return false;
  mi_bitmap_t* const bitmap = parg->bitmap;

  // Take the page out of the abandoned map first: this is the reader side of the protocol in
  // `mi_arena_try_claim_abandoned`. A concurrent `_mi_arenas_page_unabandon` busy-waits for the
  // bit to reappear (`mi_bitmap_clear_once_set`), so while we hold it cleared the page cannot be
  // freed under us. If the bit is already clear, someone else has the page: skip it.
  if (!mi_bitmap_clear(bitmap, slice_index)) return true;

  mi_page_t* const page = mi_arena_page_at_slice(arena, slice_index);
  if (!mi_page_claim_ownership(page)) {
    mi_bitmap_set(bitmap, slice_index);   // a concurrent free owns it: keep it abandoned (as `mi_arena_try_claim_abandoned` does)
    return true;
  }

  // We own the page: no other thread can reclaim, unabandon, or free it now, and only the
  // atomic `xthread_free` can still change under us.
  _mi_page_free_collect(page, true);
  if (mi_page_all_free(page)) {
    mi_bitmap_set(bitmap, slice_index);   // `_mi_arenas_page_unabandon` expects it in the map
    _mi_arenas_page_unabandon(page, NULL);
    _mi_arenas_page_free(page, NULL);
    _mi_page_holes_count_page_freed();
    return true;
  }
  _mi_page_purge_holes(page, parg->tld);
  mi_bitmap_set(bitmap, slice_index);     // back in the map *before* unowning: unown may free the page
  mi_abandoned_page_unown(page, NULL);
  return true;
}

// note: this only reaches the *mapped* abandoned pages (the ones in `pages_abandoned`).
// A page abandoned while full is not mapped; it has no free blocks at that point, and once
// enough blocks are freed in it, `_mi_arenas_page_try_reabandon_to_mapped` puts it in the map.
void _mi_arenas_purge_abandoned_holes(mi_heap_t* heap, mi_tld_t* tld) {
  if (heap == NULL) return;
  if (!mi_option_is_enabled(mi_option_purge_holes)) return;
  _mi_page_purge_holes_begin(tld);
  mi_forall_arenas(heap, ((mi_arena_t*)NULL), 0, arena) {
    mi_arena_pages_t* const arena_pages = mi_heap_arena_pages(heap, arena);
    if (arena_pages != NULL) {
      // pages_abandoned[] is MI_ARENA_BIN_COUNT wide, not MI_BIN_COUNT: bins above the
      // singleton bins have no abandoned bitmap (upstream ad1bcdbf, to shrink arena meta).
      for (size_t bin = 0; bin < MI_ARENA_BIN_COUNT; bin++) {
        if (mi_atomic_load_relaxed(&heap->abandoned_count[bin]) == 0) continue;
        mi_bitmap_t* const bitmap = arena_pages->pages_abandoned[bin];
        mi_purge_holes_arg_t parg = { bitmap, tld };
        (void)_mi_bitmap_forall_set(bitmap, &mi_arena_page_purge_holes_at, arena, &parg);
      }
    }
  }
  mi_forall_arenas_end();
  _mi_page_purge_holes_end(tld);
}

// The read-only counterpart of the sweep above: account for the holes in the abandoned pages
// instead of purging them. Same claim protocol -- the page must not be reclaimed or freed
// while we read its free lists -- but nothing inside the page is modified.
typedef struct mi_arena_holes_report_arg_s {
  mi_bitmap_t*       bitmap;
  mi_holes_report_t* rep;
} mi_arena_holes_report_arg_t;

static bool mi_arena_page_holes_report_at(size_t slice_index, size_t slice_count, mi_arena_t* arena, void* arg) {
  MI_UNUSED(slice_count);
  mi_arena_holes_report_arg_t* const ra = (mi_arena_holes_report_arg_t*)arg;
  if (!mi_bitmap_clear(ra->bitmap, slice_index)) return true;   // someone else has the page

  mi_page_t* const page = mi_arena_page_at_slice(arena, slice_index);
  if (!mi_page_claim_ownership(page)) {
    mi_bitmap_set(ra->bitmap, slice_index);   // a concurrent free owns it: keep it abandoned
    return true;
  }
  _mi_page_holes_report_page(page, ra->rep);
  mi_bitmap_set(ra->bitmap, slice_index);     // back in the map *before* unowning: unown may free the page
  // Unown collects a pending `xthread_free`, but that collect always lands a block on `page->free`,
  // so it can never take the `free == NULL` branch that would un-purge a run of holes.
  mi_abandoned_page_unown(page, NULL);
  return true;
}

void _mi_arenas_holes_report(mi_heap_t* heap, mi_holes_report_t* rep) {
  if (heap == NULL || rep == NULL) return;
  mi_forall_arenas(heap, ((mi_arena_t*)NULL), 0, arena) {
    mi_arena_pages_t* const arena_pages = mi_heap_arena_pages(heap, arena);
    if (arena_pages != NULL) {
      for (size_t bin = 0; bin < MI_ARENA_BIN_COUNT; bin++) {   // see above: not MI_BIN_COUNT
        if (mi_atomic_load_relaxed(&heap->abandoned_count[bin]) == 0) continue;
        mi_arena_holes_report_arg_t ra = { arena_pages->pages_abandoned[bin], rep };
        (void)_mi_bitmap_forall_set(ra.bitmap, &mi_arena_page_holes_report_at, arena, &ra);
      }
    }
  }
  mi_forall_arenas_end();
}

// Where the memory IS: the arena slack, i.e. the memory mimalloc holds OUTSIDE any page. If what
// we are chasing lands here instead of inside the pages, the problem is the arena / purge delay
// and not free blocks contaminating pages -- a completely different fix.
//
// A slice in `slices_free` belongs to no page. Of those, a slice that was never touched costs
// nothing, so residency is carried by `slices_dirty` (ever handed out, hence written) and
// `slices_purge` (queued for purge, so still resident right now). `slices_committed` is NOT a
// residency signal: it is set for the whole arena at reserve time for any `initially_committed`
// memory (every POSIX mmap) and a reset-style purge does not clear it -- we report it only so the
// caveat is visible in the output rather than silently misleading.
void _mi_arenas_holes_committed(mi_heap_t* heap, mi_holes_report_t* rep) {
  if (heap == NULL || rep == NULL) return;
  mi_forall_arenas(heap, ((mi_arena_t*)NULL), 0, arena) {
    rep->arena_meta_bytes += mi_size_of_slices(mi_arena_info_slices(arena));
    rep->arena_reserved_bytes += mi_size_of_slices(arena->slice_count);
    const size_t slice_count = arena->slice_count;
    for (size_t i = 0; i < slice_count; i++) {
      if (mi_bitmap_is_set(arena->slices_committed, i)) { rep->arena_committed_bytes += MI_ARENA_SLICE_SIZE; }
      if (!mi_bbitmap_is_setN(arena->slices_free, i, 1)) continue;   // in a page (or reserved meta): not slack
      if (mi_bitmap_is_set(arena->slices_dirty, i)) { rep->arena_free_dirty_bytes += MI_ARENA_SLICE_SIZE; }
      if (mi_bitmap_is_set(arena->slices_purge, i)) { rep->arena_purge_pending_bytes += MI_ARENA_SLICE_SIZE; }
    }
  }
  mi_forall_arenas_end();
}


// Heap-image restore: every arena that exists right now holds image memory. Make them exclusive (to nobody) so no
// theap on any thread places new blocks in their free space; new memory comes from arenas created after this call.
void mi_arenas_seal_existing(void) mi_attr_noexcept {
  mi_subproc_t* subproc = _mi_subproc_main();
  const size_t n = mi_arenas_get_count(subproc);
  for (size_t i = 0; i < n; i++) {
    mi_arena_t* arena = mi_arena_from_index(subproc, i);
    if (arena != NULL) { arena->is_exclusive = true; }
  }
}

static bool mi_arena_page_freeze(size_t slice_index, size_t slice_count, mi_arena_t* arena, void* arg) {
  MI_UNUSED(slice_count); MI_UNUSED(arg);
  mi_page_t* page = mi_arena_page_at_slice(arena, slice_index);
  mi_atomic_store_release(&page->xthread_id, (mi_threadid_t)MI_THREADID_FROZEN);
  return true;
}

// Heap image build: every page that exists right now is about to be written into the image. Owned by MI_THREADID_FROZEN,
// frees of their blocks in the restored process (or in what is left of this one) take the cross-thread path and are dropped
// there, so image pages are never dirtied by the allocator. Done here, in the builder, so the restore writes nothing.
void mi_arenas_freeze_pages(void) mi_attr_noexcept {
  mi_subproc_t* subproc = _mi_subproc_main();
  const size_t n = mi_arenas_get_count(subproc);
  mi_lock(&subproc->heaps_lock) {
    for (mi_heap_t* heap = subproc->heaps; heap != NULL; heap = heap->next) {   // page bitmaps are kept per heap
      for (size_t i = 0; i < n; i++) {
        mi_arena_t* arena = mi_arena_from_index(subproc, i);
        if (arena == NULL) continue;
        mi_arena_pages_t* arena_pages = mi_heap_arena_pages(heap, arena);
        if (arena_pages != NULL) { (void)_mi_bitmap_forall_set(arena_pages->pages, &mi_arena_page_freeze, arena, NULL); }
      }
    }
  }
}

// Visit every maximal run of free slices (belonging to no page) across all arenas of `heap`'s subproc.
void mi_arenas_visit_free_ranges(mi_heap_t* heap, void (*visit)(void* start, size_t size, void* arg), void* arg) mi_attr_noexcept {
  if (heap == NULL || visit == NULL) return;
  mi_forall_arenas(heap, ((mi_arena_t*)NULL), 0, arena) {
    const size_t slice_count = arena->slice_count;
    size_t i = 0;
    while (i < slice_count) {
      if (!mi_bbitmap_is_setN(arena->slices_free, i, 1)) { i++; continue; }
      size_t j = i; while (j < slice_count && mi_bbitmap_is_setN(arena->slices_free, j, 1)) j++;
      visit(mi_arena_slice_start(arena, i), mi_size_of_slices(j - i), arg);
      i = j;
    }
  }
  mi_forall_arenas_end();
}

/* -----------------------------------------------------------
  Arena free
----------------------------------------------------------- */
static void mi_arena_schedule_purge(mi_arena_t* arena, size_t slice_index, size_t slices);

void _mi_arenas_free(mi_subproc_t* subproc, void* p, size_t size, mi_memid_t memid) {
  if (p==NULL) return;
  if (size==0) return;

  // need to set all memory to undefined as some parts may still be marked as no_access (like padding etc.)
  mi_track_mem_undefined(p, size);

  if (mi_memkind_is_os(memid.memkind)) {
    // was a direct OS allocation, pass through
    _mi_os_free(subproc, p, size, memid);
  }
  else if (memid.memkind == MI_MEM_ARENA) {
    // allocated in an arena
    size_t slice_count;
    size_t slice_index;
    mi_arena_t* arena = mi_arena_from_memid(memid, &slice_index, &slice_count);
    mi_assert_internal(arena!=NULL);
    mi_assert_internal(arena->subproc == subproc);
    mi_assert_internal((size%MI_ARENA_SLICE_SIZE)==0);
    mi_assert_internal((slice_count*MI_ARENA_SLICE_SIZE)==size);
    mi_assert_internal(mi_arena_slice_start(arena,slice_index) <= (uint8_t*)p);
    mi_assert_internal(mi_arena_slice_start(arena,slice_index) + mi_size_of_slices(slice_count) > (uint8_t*)p);
    // checks
    if (arena == NULL) {
      _mi_error_message(EINVAL, "trying to free from an invalid arena: %p, size %zu, memkind: 0x%x\n", p, size, memid.memkind);
      return;
    }
    mi_assert_internal(slice_index < arena->slice_count);
    mi_assert_internal(slice_index >= mi_arena_info_slices(arena));
    if (slice_index < mi_arena_info_slices(arena) || slice_index >= arena->slice_count) {
      _mi_error_message(EINVAL, "trying to free from an invalid arena block: %p, size %zu, memkind: 0x%x\n", p, size, memid.memkind);
      return;
    }

    // potentially decommit
    if (!arena->memid.is_pinned /* && !arena->memid.initially_committed */) { // todo: allow decommit even if initially committed?
      // (delay) purge the page
      mi_arena_schedule_purge(arena, slice_index, slice_count);
    }

    // and make it available to others again
    bool all_inuse = mi_bbitmap_setN(arena->slices_free, slice_index, slice_count);
    if (!all_inuse) {
      _mi_error_message(EAGAIN, "trying to free an already freed arena block: %p, size %zu\n", mi_arena_slice_start(arena,slice_index), mi_size_of_slices(slice_count));
      return;
    };
  }
  else if (memid.memkind == MI_MEM_META) {
    _mi_meta_free(subproc, p, size, memid);
  }
  else {
    // arena was none, external, or static; nothing to do
    mi_assert_internal(mi_memid_needs_no_free(memid));
  }

  // try to purge expired decommits
  // _mi_arenas_try_purge(false, false, NULL);
}

// Purge the arenas; if `force_purge` is true, amenable parts are purged even if not yet expired
void _mi_arenas_collect(bool force_purge, bool visit_all, mi_tld_t* tld) {
  _mi_arenas_try_purge(force_purge, visit_all, tld->subproc, tld->thread_seq);
}


// Is a pointer contained in the given arena area?
static bool mi_arena_strictly_contains(mi_arena_t* arena, const void* p) {
  return (arena != NULL &&
          mi_arena_start(arena) <= (const uint8_t*)p &&
          mi_arena_start(arena) + mi_size_of_slices(arena->slice_count) >(const uint8_t*)p);
}

// Is a pointer inside any of our arenas?
static bool mi_arenas_contain_ex(const void* p, mi_arena_t* parent) {
  mi_subproc_t* subproc = _mi_subproc();
  const size_t max_arena = mi_arenas_get_count(subproc);
  for (size_t i = 0; i < max_arena; i++) {
    mi_arena_t* arena = mi_atomic_load_ptr_acquire(mi_arena_t, &subproc->arenas[i]);
    if (arena != NULL) {
      if (parent==NULL || arena==parent || arena->parent==parent) {
        if (mi_arena_strictly_contains(arena, p)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Is a pointer inside any of our arenas?
bool _mi_arenas_contain(const void* p) {
  return mi_arenas_contain_ex(p, NULL);
}

// Is a pointer contained in the given arena area?
bool mi_arena_contains(mi_arena_id_t arena_id, const void* p) {
  mi_arena_t* arena = _mi_arena_from_id(arena_id);
  if (arena==NULL) return false;
  else if (mi_arena_strictly_contains(arena, p)) return true;
  else return mi_arenas_contain_ex(p, arena);  // maybe a subarena?
}


/* -----------------------------------------------------------
  Remove an arena.
----------------------------------------------------------- */

// destroy owned arenas; this is unsafe and should only be done using `mi_option_destroy_on_exit`
// for dynamic libraries that are unloaded and need to release all their allocated memory.
static void mi_arenas_unsafe_destroy(mi_subproc_t* subproc) {
  mi_assert_internal(subproc != NULL);
  const size_t arena_count = mi_arenas_get_count(subproc);
  for (size_t i = 0; i < arena_count; i++) {
    mi_arena_t* arena = mi_atomic_load_ptr_acquire(mi_arena_t, &subproc->arenas[i]);
    if (arena != NULL) {
      // mi_lock_done(&arena->abandoned_visit_lock);
      mi_atomic_store_ptr_release(mi_arena_t, &subproc->arenas[i], NULL);
      if (mi_memkind_is_os(arena->memid.memkind)) {
        _mi_os_free_ex(subproc, mi_arena_start(arena), mi_arena_size(arena), true, arena->memid);
      }
    }
  }
  // try to lower the max arena.
  size_t expected = arena_count;
  mi_atomic_cas_strong_acq_rel(&subproc->arena_count, &expected, (size_t)0);
}


// destroy owned arenas; this is unsafe and should only be done using `mi_option_destroy_on_exit`
// for dynamic libraries that are unloaded and need to release all their allocated memory.
void _mi_arenas_unsafe_destroy_all(mi_subproc_t* subproc) {
  mi_arenas_unsafe_destroy(subproc);
  // _mi_arenas_try_purge(true /* force purge */, true /* visit all*/, subproc, 0 /* thread seq */);  // purge non-owned arenas
}


/* -----------------------------------------------------------
  Add an arena.
----------------------------------------------------------- */

static bool mi_arenas_add(mi_subproc_t* subproc, mi_arena_t* arena, mi_arena_id_t* arena_id)
{
  mi_assert_internal(arena != NULL);
  mi_assert_internal(arena->slice_count > 0);
  if (arena_id != NULL) { *arena_id = _mi_arena_id_none(); }

  // try to find a NULL entry
  mi_arena_t* expected;
  size_t count = mi_arenas_get_count(subproc);
  for( size_t i = 0; i < count; i++) {
    if (mi_arena_from_index(subproc,i) == NULL) {
      arena->arena_idx = i;
      expected = NULL;
      if (mi_atomic_cas_ptr_strong_release(mi_arena_t, &subproc->arenas[i], &expected, arena)) {
        // success
        if (arena_id != NULL) { *arena_id = mi_arena_id_from_arena(arena); }
        return true;
      }
    }
  }

  // otherwise, try to allocate a fresh slot
  while(count<MI_MAX_ARENAS) {
    if (mi_atomic_cas_strong_release(&subproc->arena_count, &count, count+1)) {
      arena->arena_idx = count;
      expected = NULL;
      if (mi_atomic_cas_ptr_strong_release(mi_arena_t, &subproc->arenas[count], &expected, arena)) {
        mi_subproc_stat_counter_increase(arena->subproc, arena_count, 1);
        if (arena_id != NULL) { *arena_id = mi_arena_id_from_arena(arena); }
        return true;
      }
    }
  }

  // failed
  arena->arena_idx = 0;
  arena->subproc = NULL;
  return false;
}

static size_t mi_arena_pages_size(size_t slice_count, size_t* bitmap_base) {
  if (slice_count == 0) slice_count = MI_BCHUNK_BITS;
  mi_assert_internal((slice_count % MI_BCHUNK_BITS) == 0);
  const size_t base_size = _mi_align_up(sizeof(mi_arena_pages_t), MI_BCHUNK_SIZE);
  const size_t bitmaps_count = 1 + MI_ARENA_BIN_COUNT; // pages, and abandoned
  const size_t bitmaps_size = bitmaps_count * mi_bitmap_size(slice_count, NULL);
  const size_t size = base_size + bitmaps_size;
  if (bitmap_base != NULL) *bitmap_base = base_size;
  return size;
}

static size_t mi_arena_info_slices_needed(size_t slice_count, size_t* bitmap_base, size_t* pages_meta_offset) {
  if (slice_count == 0) slice_count = MI_BCHUNK_BITS;
  mi_assert_internal((slice_count % MI_BCHUNK_BITS) == 0);
  const size_t base_size = _mi_align_up(sizeof(mi_arena_t), MI_BCHUNK_SIZE);
  const size_t bitmaps_count = 4 + MI_ARENA_BIN_COUNT; // commit, dirty, purge, pages, and abandoned
  const size_t bitmaps_size = bitmaps_count * mi_bitmap_size(slice_count, NULL) + mi_bbitmap_size(slice_count, NULL); // + free
  #if MI_PAGE_META_IS_SEPARATED
  const size_t pages_size = slice_count * sizeof(mi_page_t);
  #else
  const size_t pages_size = 0;
  #endif
  const size_t size = base_size + bitmaps_size + pages_size;

  const size_t os_page_size = _mi_os_page_size();
  const size_t info_size = _mi_align_up(size, os_page_size) + _mi_os_secure_guard_page_size();
  const size_t info_slices = mi_slice_count_of_size(info_size);

  if (bitmap_base != NULL) *bitmap_base = base_size;
  if (pages_meta_offset != NULL) *pages_meta_offset = base_size + bitmaps_size;
  return info_slices;
}

static mi_bitmap_t* mi_arena_bitmap_init(size_t slice_count, uint8_t** base) {
  mi_bitmap_t* bitmap = (mi_bitmap_t*)(*base);
  *base = (*base) + mi_bitmap_init(bitmap, slice_count, true /* already zero */);
  return bitmap;
}

static mi_bbitmap_t* mi_arena_bbitmap_init(mi_subproc_t* subproc, size_t slice_count, uint8_t** base) {
  mi_bbitmap_t* bbitmap = (mi_bbitmap_t*)(*base);
  *base = (*base) + mi_bbitmap_init(subproc, bbitmap, slice_count, true /* already zero */);
  return bbitmap;
}

static mi_arena_pages_t* mi_arena_pages_alloc(mi_arena_t* arena) {
  const size_t slice_count = arena->slice_count;
  size_t bitmap_base = 0;
  const size_t size = mi_arena_pages_size(slice_count, &bitmap_base);
  mi_arena_pages_t* arena_pages = (mi_arena_pages_t*)mi_heap_zalloc_aligned(arena->subproc->heap_main, size, MI_BCHUNK_SIZE);
  if (arena_pages==NULL) return NULL;
  uint8_t* base = (uint8_t*)arena_pages + bitmap_base;
  mi_assert_internal(_mi_is_aligned(base, MI_BCHUNK_SIZE));
  arena_pages->pages = mi_arena_bitmap_init(slice_count, &base);
  for (size_t i = 0; i < MI_ARENA_BIN_COUNT; i++) {
    arena_pages->pages_abandoned[i] = mi_arena_bitmap_init(slice_count, &base);
  }
  return arena_pages;
}

static mi_arena_t* mi_arena_initialize(mi_subproc_t* subproc, void* start,
                                        size_t slice_count, mi_arena_t* parent, size_t total_size,
                                        int numa_node, bool exclusive,
                                        mi_memid_t memid, mi_commit_fun_t* commit_fun, void* commit_fun_arg, mi_arena_id_t* arena_id)
{
  mi_assert_internal(_mi_is_aligned(start,MI_ARENA_SLICE_ALIGN));
  mi_assert_internal(mi_size_of_slices(slice_count)>=MI_ARENA_MIN_SIZE);

  if (slice_count > MI_BITMAP_MAX_BIT_COUNT) {  // 16 GiB for now
    // note: this should never happen if called from `mi_manage_os_memory` (as that allocates sub-arenas when needed)
    _mi_warning_message("cannot use OS memory since it is too large (size %zu MiB, maximum is %zu MiB)", mi_size_of_slices(slice_count)/MI_MiB, mi_size_of_slices(MI_BITMAP_MAX_BIT_COUNT)/MI_MiB);
    return NULL;
  }

  size_t bitmap_base;
  size_t pages_meta_offset;
  const size_t info_slices = mi_arena_info_slices_needed(slice_count, &bitmap_base, &pages_meta_offset);
  if (slice_count < info_slices+1) {
    _mi_warning_message("cannot use OS memory since it is not large enough (size %zu KiB, minimum required is %zu KiB)", mi_size_of_slices(slice_count)/MI_KiB, mi_size_of_slices(info_slices+1)/MI_KiB);
    return NULL;
  }
  // else if (info_slices >= MI_ARENA_MAX_CHUNK_OBJ_SLICES) {
  //   _mi_warning_message("cannot use OS memory since it is too large with respect to the maximum object size (size %zu MiB, meta-info slices %zu, maximum object slices are %zu)", mi_size_of_slices(slice_count)/MI_MiB, info_slices, MI_ARENA_MAX_CHUNK_OBJ_SLICES);
  //   return NULL;
  // }

  mi_arena_t* arena = (mi_arena_t*)start;

  // commit & zero if needed
  if (!memid.initially_committed) {
    size_t commit_size = mi_size_of_slices(info_slices);
    // leave a guard OS page decommitted at the end?
    if (!memid.is_pinned) { commit_size -= _mi_os_secure_guard_page_size(); }
    bool ok = false;
    if (commit_fun != NULL) {
      ok = (*commit_fun)(true /* commit */, arena, commit_size, NULL, commit_fun_arg);
    }
    else {
      ok = _mi_os_commit(subproc, arena, commit_size, NULL);
    }
    if (!ok) {
      _mi_warning_message("unable to commit meta-data for OS memory");
      return NULL;
    }
  }
  else if (!memid.is_pinned) {
    // if MI_SECURE, set a guard page at the end of the arena info
    // todo: this does not respect the commit_fun as the memid is of external memory
    _mi_os_secure_guard_page_set_before(subproc, (uint8_t*)arena + mi_size_of_slices(info_slices), memid);
  }
  if (!memid.initially_zero) {
    size_t zero_size = mi_size_of_slices(info_slices) - _mi_os_secure_guard_page_size();
    #if MI_PAGE_META_IS_SEPARATED && !MI_PAGE_META_ALIGNED_FREE_SMALL
    // Only the header and the bitmaps have to start out zeroed. `pages_meta` is one
    // mi_page_t per slice -- ~2.5 MiB per GiB of arena -- and every entry is zeroed
    // when its slice is claimed (`mi_arenas_page_alloc_fresh`); no one reads an entry
    // for a slice that was never claimed. Zeroing it here would fault in megabytes of
    // meta-info the arena may never use. (Under MI_PAGE_META_ALIGNED_FREE_SMALL,
    // `mi_arena_page_at_slice` does read `block_size` of unclaimed entries, so the
    // array must be zeroed up front and this shortcut does not apply.)
    mi_assert_internal(pages_meta_offset <= zero_size);
    if (pages_meta_offset <= zero_size) { zero_size = pages_meta_offset; }
    #endif
    _mi_memzero(arena, zero_size);
  }

  // init
  arena->subproc = subproc;
  arena->memid = memid;
  arena->is_exclusive = exclusive;
  arena->slice_count = slice_count;
  arena->info_slices = info_slices;
  if (numa_node<0 && mi_option_is_enabled(mi_option_arena_is_numa_local)) {
    arena->numa_node = _mi_os_numa_node();
  }
  else {
    arena->numa_node = numa_node;
  }
  arena->purge_expire = 0;
  arena->commit_fun = commit_fun;
  arena->commit_fun_arg = commit_fun_arg;
  arena->parent = parent;
  arena->total_size = total_size;

  // init bitmaps
  uint8_t* base = mi_arena_start(arena) + bitmap_base;
  arena->slices_free = mi_arena_bbitmap_init(subproc, slice_count, &base);
  arena->slices_committed = mi_arena_bitmap_init(slice_count, &base);
  arena->slices_dirty = mi_arena_bitmap_init(slice_count, &base);
  arena->slices_purge = mi_arena_bitmap_init(slice_count, &base);
  arena->pages_main.pages = mi_arena_bitmap_init(slice_count, &base);
  for (size_t i = 0; i < MI_ARENA_BIN_COUNT; i++) {
    arena->pages_main.pages_abandoned[i] = mi_arena_bitmap_init(slice_count, &base);
  }
  #if MI_PAGE_META_IS_SEPARATED
  arena->pages_meta = (mi_page_t*)base;
  base += (slice_count * sizeof(mi_page_t));
  #else
  arena->pages_meta = NULL;
  #endif
  mi_assert_internal(mi_size_of_slices(info_slices) >= (size_t)(base - mi_arena_start(arena)));

  // reserve our meta info (and reserve slices outside the memory area)
  mi_bbitmap_unsafe_setN(arena->slices_free, info_slices /* start */, arena->slice_count - info_slices);
  if (memid.initially_committed) {
    mi_bitmap_unsafe_setN(arena->slices_committed, 0, arena->slice_count);
  }
  if (!memid.initially_zero) {
    mi_bitmap_unsafe_setN(arena->slices_dirty, 0, arena->slice_count);
  }

  if (!mi_arenas_add(subproc, arena, arena_id)) { return NULL;  }
  return arena;
}

static bool mi_manage_os_memory_ex2(mi_subproc_t* subproc, void* start, size_t size, int numa_node, bool exclusive,
  mi_memid_t memid, mi_commit_fun_t* commit_fun, void* commit_fun_arg, mi_arena_id_t* arena_id) mi_attr_noexcept
{
  // checks
  mi_assert(start!=NULL);
  if (arena_id != NULL) { *arena_id = _mi_arena_id_none(); }
  if (start==NULL) return false;
  if (!_mi_is_aligned(start, MI_ARENA_SLICE_SIZE)) {
    // we can align the start since the memid tracks the real base of the memory.
    void* const aligned_start = _mi_align_up_ptr(start, MI_ARENA_SLICE_SIZE);
    const size_t diff = (uint8_t*)aligned_start - (uint8_t*)start;
    if (diff >= size || (size - diff) < MI_ARENA_SLICE_SIZE) {
      _mi_warning_message("after alignment, the size of the arena becomes too small (memory at %p with size %zu)\n", start, size);
      return false;
    }
    start = aligned_start;
    size = size - diff;
  }

  // allocate enough arena's to span the full memory area
  // the first arena is the owner, the rest are "sub-arena" (with `parent` pointing to the first one)
  size_t total_slice_count = _mi_align_down(size / MI_ARENA_SLICE_SIZE, MI_BCHUNK_BITS);
  size_t total_size = mi_size_of_slices(total_slice_count);
  if (total_size < MI_ARENA_MIN_SIZE) {
    _mi_warning_message("cannot use OS memory since it is not large enough (size %zu KiB, minimum required is %zu KiB)", size/MI_KiB, MI_ARENA_MIN_SIZE/MI_KiB);
    return false;
  }

  mi_arena_t* parent = NULL;
  do {
    // counting down on the total_slice_count
    size_t slice_count = total_slice_count;
    if (slice_count > MI_BITMAP_MAX_BIT_COUNT) {  // 16 GiB for now (with 64KiB slices)
      slice_count = MI_BITMAP_MAX_BIT_COUNT;
    }

    // initialize
    mi_arena_t* arena = mi_arena_initialize( subproc, start, slice_count, parent,
                                              (parent==NULL ? total_size : 0), numa_node, exclusive,
                                              memid, commit_fun, commit_fun_arg,
                                              (parent==NULL ? arena_id : NULL));
    if (arena==NULL) {
      // failed to initialize due to failing commit or too many arena's
      if (parent==NULL) {
        return false;
      }
      else {
        // partial success, but failed to use the full area..
        // todo: roll-back in this case? that requires a lock on the arena's array though
        mi_assert(mi_size_of_slices(total_slice_count) <= parent->total_size);
        parent->total_size -= mi_size_of_slices(total_slice_count);
        return true;
      }
    }

    // success
    if (parent==NULL) {
      parent = arena;
      memid.memkind = MI_MEM_NONE;
    }
    mi_assert(slice_count <= total_slice_count);
    total_slice_count -= slice_count;
    start = (uint8_t*)start + mi_size_of_slices(slice_count);
  }
  while (total_slice_count > 0);

  return true;
}

bool mi_manage_os_memory_ex(void* start, size_t size, bool is_committed, bool is_pinned, bool is_zero, int numa_node, bool exclusive, mi_arena_id_t* arena_id) mi_attr_noexcept {
  mi_memid_t memid = _mi_memid_create(MI_MEM_EXTERNAL);
  memid.mem.os.base = start;
  memid.mem.os.size = size;
  memid.initially_committed = is_committed;
  memid.initially_zero = is_zero;
  memid.is_pinned = is_pinned;
  return mi_manage_os_memory_ex2(_mi_subproc(), start, size, numa_node, exclusive, memid, NULL, NULL, arena_id);
}

bool mi_manage_memory(void* start, size_t size, bool is_committed, bool is_pinned, bool is_zero, int numa_node, bool exclusive, mi_commit_fun_t* commit_fun, void* commit_fun_arg, mi_arena_id_t* arena_id) mi_attr_noexcept
{
  mi_memid_t memid = _mi_memid_create(MI_MEM_EXTERNAL);
  memid.mem.os.base = start;
  memid.mem.os.size = size;
  memid.initially_committed = is_committed;
  memid.initially_zero = is_zero;
  memid.is_pinned = is_pinned;
  return mi_manage_os_memory_ex2(_mi_subproc(), start, size, numa_node, exclusive, memid, commit_fun, commit_fun_arg, arena_id);
}


// Reserve a range of regular OS memory
static int mi_reserve_os_memory_ex2(mi_subproc_t* subproc, size_t size, bool commit, bool allow_large, bool exclusive, mi_arena_id_t* arena_id) {
  if (arena_id != NULL) *arena_id = _mi_arena_id_none();
  size = _mi_align_up(size, MI_ARENA_SLICE_SIZE); // at least one slice
  mi_memid_t memid;
  void* start = _mi_os_alloc_aligned(subproc, size, MI_ARENA_SLICE_ALIGN, commit, allow_large, &memid);
  if (start == NULL) return ENOMEM;
  if (!mi_manage_os_memory_ex2(subproc, start, size, -1 /* numa node */, exclusive, memid, NULL, NULL, arena_id)) {
    _mi_os_free_ex(subproc, start, size, commit, memid);
    _mi_verbose_message("failed to reserve %zu KiB memory\n", _mi_divide_up(size, 1024));
    return ENOMEM;
  }
  _mi_verbose_message("reserved %zu KiB memory%s\n", _mi_divide_up(size, 1024), memid.is_pinned ? " (in large os pages)" : "");
  // mi_debug_show_arenas(true, true, false);

  return 0;
}

// Reserve a range of regular OS memory
int mi_reserve_os_memory_ex(size_t size, bool commit, bool allow_large, bool exclusive, mi_arena_id_t* arena_id) mi_attr_noexcept {
  return mi_reserve_os_memory_ex2(_mi_subproc(), size, commit, allow_large, exclusive, arena_id);
}

// Manage a range of regular OS memory
bool mi_manage_os_memory(void* start, size_t size, bool is_committed, bool is_large, bool is_zero, int numa_node) mi_attr_noexcept {
  return mi_manage_os_memory_ex(start, size, is_committed, is_large, is_zero, numa_node, false /* exclusive? */, NULL);
}

// Reserve a range of regular OS memory
int mi_reserve_os_memory(size_t size, bool commit, bool allow_large) mi_attr_noexcept {
  return mi_reserve_os_memory_ex(size, commit, allow_large, false, NULL);
}


/* -----------------------------------------------------------
  Debugging
----------------------------------------------------------- */

// Return idx of the slice past the last used slice
static size_t mi_arena_used_slices(mi_arena_t* arena) {
  size_t idx;
  if (mi_bbitmap_bsr_inv(arena->slices_free, &idx)) {
    return (idx + 1);
  }
  else {
    return mi_arena_info_slices(arena);
  }
}

static size_t mi_debug_show_bfield(mi_bfield_t field, char* buf, size_t* k) {
  size_t bit_set_count = 0;
  for (int bit = 0; bit < MI_BFIELD_BITS; bit++) {
    bool is_set = ((((mi_bfield_t)1 << bit) & field) != 0);
    if (is_set) bit_set_count++;
    buf[*k] = (is_set ? 'x' : '.');
    *k = *k + 1;
  }
  return bit_set_count;
}

typedef enum mi_ansi_color_e {
  MI_BLACK = 30,
  MI_MAROON,
  MI_DARKGREEN,
  MI_ORANGE,
  MI_NAVY,
  MI_PURPLE,
  MI_TEAL,
  MI_GRAY,
  MI_DARKGRAY = 90,
  MI_RED,
  MI_GREEN,
  MI_YELLOW,
  MI_BLUE,
  MI_MAGENTA,
  MI_CYAN,
  MI_WHITE
} mi_ansi_color_t;

static void mi_debug_color(char* buf, size_t* k, mi_ansi_color_t color) {
  *k += _mi_snprintf(buf + *k, 32, "\x1B[%dm", (int)color);
}

static int mi_page_commit_usage(mi_page_t* page) {
  // if (mi_page_size(page) <= MI_PAGE_MIN_COMMIT_SIZE) return 100;
  const size_t committed_size = mi_page_committed(page);
  const size_t used_size = page->used * mi_page_block_size(page);
  return (int)(used_size * 100 / committed_size);
}

static size_t mi_debug_show_page_bfield(char* buf, size_t* k, mi_arena_t* arena, size_t slice_index, long* pbit_of_page, mi_ansi_color_t* pcolor_of_page ) {
  size_t bit_set_count = 0;
  long bit_of_page = *pbit_of_page;
  mi_ansi_color_t color = *pcolor_of_page;
  mi_ansi_color_t prev_color = MI_GRAY;
  for (int bit = 0; bit < MI_BFIELD_BITS; bit++, bit_of_page--) {
    // bool is_set = ((((mi_bfield_t)1 << bit) & field) != 0);
    void* start = mi_arena_slice_start(arena, slice_index + bit);
    mi_page_t* page = _mi_safe_ptr_page(start);
    char c = ' ';
    if (page!=NULL && start==mi_page_slice_start(page)) {
      mi_assert_internal(bit_of_page <= 0);
      bit_set_count++;
      c = 'p';
      color = MI_GRAY;
      if (mi_page_is_singleton(page)) { c = 's'; }
      else if (mi_page_is_full(page)) { c = 'f'; }
      if (!mi_page_is_abandoned(page)) { c = _mi_toupper(c); }
      int commit_usage = mi_page_commit_usage(page);
      if (commit_usage < 25) { color = MI_MAROON; }
      else if (commit_usage < 50) { color = MI_ORANGE; }
      else if (commit_usage < 75) { color = MI_TEAL; }
      else color = MI_DARKGREEN;
      bit_of_page = (long)page->memid.mem.arena.slice_count;
    }
    else {
      c = '?';
      if (bit_of_page > 0) { c = '-'; }
      else if (_mi_meta_is_meta_page(arena->subproc,start)) { c = 'm'; color = MI_GRAY; }
      else if (slice_index + bit < arena->info_slices) { c = 'i'; color = MI_GRAY; }
      // else if (mi_bitmap_is_setN(arena->pages_purge, slice_index + bit, NULL)) { c = '*'; }
      else if (mi_bbitmap_is_setN(arena->slices_free, slice_index+bit,1)) {
        if (mi_bitmap_is_set(arena->slices_purge, slice_index + bit)) { c = '~'; color = MI_ORANGE; }
        else if (mi_bitmap_is_set(arena->slices_committed, slice_index + bit)) { c = '_'; color = MI_GRAY; }
        else { c = '.'; color = MI_GRAY; }
      }
      if (bit==MI_BFIELD_BITS-1 && bit_of_page > 1) { c = '>'; }
    }
    if (color != prev_color) {
      mi_debug_color(buf, k, color);
      prev_color = color;
    }
    buf[*k] = c; *k += 1;
  }
  mi_debug_color(buf, k, MI_GRAY);
  *pbit_of_page = bit_of_page;
  *pcolor_of_page = color;
  return bit_set_count;
}

static size_t mi_debug_show_chunks(const char* header1, const char* header2, const char* header3,
                                   size_t slice_count, size_t chunk_count,
                                   mi_bchunk_t* chunks, mi_bchunkmap_t* chunk_bins, bool invert, mi_arena_t* arena, bool narrow)
{
  _mi_raw_message("\x1B[37m%s%s%s (use/commit: \x1B[31m0 - 25%%\x1B[33m - 50%%\x1B[36m - 75%%\x1B[32m - 100%%\x1B[0m)\n", header1, header2, header3);
  const size_t fields_per_line = (narrow ? 2 : 4);
  const size_t used_slice_count = mi_arena_used_slices(arena);
  size_t bit_count = 0;
  size_t bit_set_count = 0;
  long bit_of_page = 0;
  mi_ansi_color_t color_of_page = MI_GRAY;
  for (size_t i = 0; i < chunk_count && bit_count < slice_count; i++) {
    char buf[5*MI_BCHUNK_BITS + 64]; _mi_memzero(buf, sizeof(buf));
    if (bit_count > used_slice_count && i+2 < chunk_count) {
      const size_t diff = chunk_count - 1 - i;
      bit_count += diff*MI_BCHUNK_BITS;
      _mi_raw_message("  |\n");
      i = chunk_count-1;
    }

    size_t k = 0;

    if (i<10)        { buf[k++] = ('0' + (char)i); buf[k++] = ' '; buf[k++] = ' '; }
    else if (i<100)  { buf[k++] = ('0' + (char)(i/10)); buf[k++] = ('0' + (char)(i%10)); buf[k++] = ' '; }
    else if (i<1000) { buf[k++] = ('0' + (char)(i/100)); buf[k++] = ('0' + (char)((i%100)/10)); buf[k++] = ('0' + (char)(i%10)); }

    char chunk_kind = ' ';
    if (chunk_bins != NULL) {
      switch (mi_bbitmap_debug_get_bin(chunk_bins,i)) {
        case MI_CBIN_SMALL:  chunk_kind = 'S'; break;
        case MI_CBIN_MEDIUM: chunk_kind = 'M'; break;
        case MI_CBIN_LARGE:  chunk_kind = 'L'; break;
        case MI_CBIN_HUGE:   chunk_kind = 'H'; break;
        case MI_CBIN_OTHER:  chunk_kind = 'X'; break;
        default: chunk_kind = ' '; break; // suppress warning
        // case MI_CBIN_NONE: chunk_kind = 'N'; break;
      }
    }
    buf[k++] = chunk_kind;
    buf[k++] = ' ';

    for (size_t j = 0; j < MI_BCHUNK_FIELDS; j++) {
      if (j > 0 && (j % fields_per_line) == 0) {
        // buf[k++] = '\n'; _mi_memset(buf+k,' ',7); k += 7;
        _mi_raw_message("  %s\n\x1B[37m", buf);
        _mi_memzero(buf, sizeof(buf));
        _mi_memset(buf, ' ', 5); k = 5;
      }
      if (bit_count < slice_count) {
        mi_bfield_t bfield = 0;
        if (chunks!=NULL) {
          bfield = chunks[i].bfields[j];
        }
        if (invert) bfield = ~bfield;
        size_t xcount = (chunks==NULL ? mi_debug_show_page_bfield(buf, &k, arena, bit_count, &bit_of_page, &color_of_page)
                                      : mi_debug_show_bfield(bfield, buf, &k));
        if (invert) xcount = MI_BFIELD_BITS - xcount;
        bit_set_count += xcount;
        buf[k++] = ' ';
      }
      else {
        _mi_memset(buf + k, 'o', MI_BFIELD_BITS);
        k += MI_BFIELD_BITS;
      }
      bit_count += MI_BFIELD_BITS;
    }
    _mi_raw_message("  %s\n\x1B[37m", buf);
  }
  _mi_raw_message("\x1B[0m  total pages: %zu\n", bit_set_count);
  return bit_set_count;
}

//static size_t mi_debug_show_bitmap_binned(const char* header1, const char* header2, const char* header3, size_t slice_count,
//                                           mi_bitmap_t* bitmap, mi_bchunkmap_t* chunk_bins, bool invert, mi_arena_t* arena, bool narrow) {
//  return mi_debug_show_chunks(header1, header2, header3, slice_count, mi_bitmap_chunk_count(bitmap), &bitmap->chunks[0], chunk_bins, invert, arena, narrow);
//}

static void mi_debug_show_arenas_ex(mi_heap_t* heap, bool show_pages, bool narrow) mi_attr_noexcept {
  mi_subproc_t* subproc = heap->subproc;
  size_t max_arenas = mi_arenas_get_count(subproc);
  //size_t free_total = 0;
  //size_t slice_total = 0;
  //size_t abandoned_total = 0;
  size_t page_total = 0;
  for (size_t i = 0; i < max_arenas; i++) {
    mi_arena_t* arena = mi_atomic_load_ptr_acquire(mi_arena_t, &subproc->arenas[i]);
    if (arena == NULL) break;
    mi_assert(arena->subproc == subproc);
    // slice_total += arena->slice_count;
    _mi_raw_message("%sarena %zu at %p: %zu slices (%zu MiB)%s%s, subproc: %zu, numa: %i\n",
        (arena->parent==NULL ? "" : "(sub)"), i, arena, arena->slice_count, (size_t)(mi_size_of_slices(arena->slice_count)/MI_MiB),
        (arena->memid.is_pinned ? ", pinned" : ""), (arena->is_exclusive ? ", exclusive" : ""),
        arena->subproc->subproc_seq, arena->numa_node);
    //if (show_inuse) {
    //  free_total += mi_debug_show_bbitmap("in-use slices", arena->slice_count, arena->slices_free, true, NULL);
    //}
    //if (show_committed) {
    //  mi_debug_show_bitmap("committed slices", arena->slice_count, arena->slices_committed, false, NULL);
    //}
    // todo: abandoned slices
    //if (show_purge) {
    //  purge_total += mi_debug_show_bitmap("purgeable slices", arena->slice_count, arena->slices_purge, false, NULL);
    //}
    if (show_pages) {
      // mi_arena_pages_t* arena_pages = mi_heap_arena_pages(heap, arena);
      // if (arena_pages != NULL)
      {
        const char* header1 = "chunks (p:page, f:full, s:singleton, P,F,S:not abandoned, i:arena-info, m:meta-data, ~:free-purgable, _:free-committed, .:free-reserved)";
        const char* header2 = (narrow ? "\n       " : " ");
        const char* header3 = "(chunk bin: S:small, M : medium, L : large, X : other)";
        page_total += mi_debug_show_chunks(header1, header2, header3, arena->slice_count,
                                           mi_bbitmap_chunk_count(arena->slices_free), NULL,
                                           arena->slices_free->chunkmap_bins, false, arena, narrow);
      }
    }
  }
  // if (show_inuse)     _mi_raw_message("total inuse slices    : %zu\n", slice_total - free_total);
  // if (show_abandoned) _mi_raw_message("total abandoned slices: %zu\n", abandoned_total);
  if (show_pages) _mi_raw_message("total pages in arenas: %zu\n", page_total);
}

void mi_debug_show_arenas(void) mi_attr_noexcept {
  mi_debug_show_arenas_ex(mi_heap_main(), true /* show pages */, true /* narrow? */);
}

void mi_arenas_print(void) mi_attr_noexcept {
  mi_debug_show_arenas();
}


/* -----------------------------------------------------------
  Reserve a huge page arena.
----------------------------------------------------------- */
// reserve at a specific numa node
int mi_reserve_huge_os_pages_at_ex(size_t pages, int numa_node, size_t timeout_msecs, bool exclusive, mi_arena_id_t* arena_id) mi_attr_noexcept {
  if (arena_id != NULL) *arena_id = NULL;
  if (pages==0) return 0;
  if (numa_node < -1) numa_node = -1;
  if (numa_node >= 0) numa_node = numa_node % _mi_os_numa_node_count();
  mi_subproc_t* subproc = _mi_subproc();
  size_t hsize = 0;
  size_t pages_reserved = 0;
  mi_memid_t memid;
  void* p = _mi_os_alloc_huge_os_pages(subproc, pages, numa_node, timeout_msecs, &pages_reserved, &hsize, &memid);
  if (p==NULL || pages_reserved==0) {
    _mi_warning_message("failed to reserve %zu GiB huge pages\n", pages);
    return ENOMEM;
  }
  _mi_verbose_message("numa node %i: reserved %zu GiB huge pages (of the %zu GiB requested)\n", numa_node, pages_reserved, pages);

  if (!mi_manage_os_memory_ex2(subproc, p, hsize, numa_node, exclusive, memid, NULL, NULL, arena_id)) {
    _mi_os_free(subproc, p, hsize, memid);
    return ENOMEM;
  }
  return 0;
}

int mi_reserve_huge_os_pages_at(size_t pages, int numa_node, size_t timeout_msecs) mi_attr_noexcept {
  return mi_reserve_huge_os_pages_at_ex(pages, numa_node, timeout_msecs, false, NULL);
}

// reserve huge pages evenly among the given number of numa nodes (or use the available ones as detected)
int mi_reserve_huge_os_pages_interleave(size_t pages, size_t numa_nodes, size_t timeout_msecs) mi_attr_noexcept {
  if (pages == 0) return 0;

  // pages per numa node
  int numa_count = (numa_nodes > 0 && numa_nodes <= INT_MAX ? (int)numa_nodes : _mi_os_numa_node_count());
  if (numa_count <= 0) { numa_count = 1; }
  const size_t pages_per = pages / numa_count;
  const size_t pages_mod = pages % numa_count;
  const size_t timeout_per = (timeout_msecs==0 ? 0 : (timeout_msecs / numa_count) + 50);

  // reserve evenly among numa nodes
  for (int numa_node = 0; numa_node < numa_count && pages > 0; numa_node++) {
    size_t node_pages = pages_per;  // can be 0
    if ((size_t)numa_node < pages_mod) { node_pages++; }
    int err = mi_reserve_huge_os_pages_at(node_pages, numa_node, timeout_per);
    if (err) return err;
    if (pages < node_pages) {
      pages = 0;
    }
    else {
      pages -= node_pages;
    }
  }

  return 0;
}

int mi_reserve_huge_os_pages(size_t pages, double max_secs, size_t* pages_reserved) mi_attr_noexcept {
  MI_UNUSED(max_secs);
  _mi_warning_message("mi_reserve_huge_os_pages is deprecated: use mi_reserve_huge_os_pages_interleave/at instead\n");
  if (pages_reserved != NULL) *pages_reserved = 0;
  int err = mi_reserve_huge_os_pages_interleave(pages, 0, (size_t)(max_secs * 1000.0));
  if (err==0 && pages_reserved!=NULL) *pages_reserved = pages;
  return err;
}





/* -----------------------------------------------------------
  Arena purge
----------------------------------------------------------- */

static long mi_arena_purge_delay(void) {
  // <0 = no purging allowed, 0=immediate purging, >0=milli-second delay
  const long delay = mi_option_get(mi_option_purge_delay);
  const long mult  = mi_option_get(mi_option_arena_purge_mult);
  if (delay<0 || mult<0)   { return -1; }
  if (delay==0 || mult==0) { return 0; }
  size_t total;
  if (mi_mul_overflow((size_t)delay, (size_t)mult, &total)) { return delay; }
  if (total > LONG_MAX) { return delay; }
  return (long)total;
}

// reset or decommit in an arena and update the commit bitmap
// assumes we own the area (i.e. slices_free is claimed by us)
// returns if the memory is no longer committed (versus reset which keeps the commit)
static bool mi_arena_purge(mi_arena_t* arena, size_t slice_index, size_t slice_count) {
  mi_assert_internal(!arena->memid.is_pinned);
  mi_assert_internal(mi_bbitmap_is_clearN(arena->slices_free, slice_index, slice_count));

  const size_t size = mi_size_of_slices(slice_count);
  void* const p = mi_arena_slice_start(arena, slice_index);
  //const bool all_committed = mi_bitmap_is_setN(arena->slices_committed, slice_index, slice_count);
  size_t already_committed;
  mi_bitmap_setN(arena->slices_committed, slice_index, slice_count, &already_committed); // pretend all committed.. (as we lack a clearN call that counts the already set bits..)
  const bool all_committed = (already_committed == slice_count);
  // The zero-claim is only sound for memory WE mapped: `mi_manage_os_memory` /
  // `mi_arena_reload` hand us external regions (MI_MEM_EXTERNAL) that may be MAP_SHARED or
  // file-backed, where MADV_DONTNEED does NOT zero-fill -- it refaults the file's contents.
  // A custom commit callback is likewise opaque to us. And an arena that is not itself
  // `initially_zero` never sets `memid->initially_zero` on allocation (see the dirty-bit
  // block in `mi_arena_try_alloc_at`), so clearing its dirty bits buys nothing and would
  // only corrupt the bitmap.
  const bool can_claim_zero = (arena->commit_fun == NULL
                               && mi_memkind_is_os(arena->memid.memkind)
                               && arena->memid.initially_zero);
  bool needs_recommit;
  if (!can_claim_zero) {
    needs_recommit = _mi_os_purge_ex(arena->subproc, p, size, all_committed /* allow reset? */, mi_size_of_slices(already_committed), arena->commit_fun, arena->commit_fun_arg);
  }
  else {
    bool is_zero = false;
    needs_recommit = _mi_os_purge_zero(arena->subproc, p, size, mi_size_of_slices(already_committed), &is_zero);
    if (is_zero) {
      // The OS guarantees this range reads back zero, so forget that it was ever dirty: the
      // next `mi_arenas_alloc` hands it out with `initially_zero`, `mi_zalloc` skips the
      // memset, and pages the caller never writes are never made resident again.
      mi_bitmap_clearN(arena->slices_dirty, slice_index, slice_count);
      // Do NOT touch the `committed` stat here. `committed` is keyed on the COMMIT bits, not the
      // dirty bits: it is credited in `mi_arena_try_alloc_at` only for slices whose commit bit was
      // clear (`slice_count - already_committed`, and the whole block is skipped when the range is
      // already fully committed). A zero-claim purge deliberately KEEPS the commit bits set, so the
      // next allocation credits nothing -- and debiting here would be an unmatched debit that walks
      // `committed` down without bound (it is an int64; `mi_process_info` casts it to size_t, so it
      // wraps). The real ratchet is the partial-commit branch below, which *clears* commit bits.
    }
  }

  if (needs_recommit) {
    // no longer committed
    mi_bitmap_clearN(arena->slices_committed, slice_index, slice_count);
    // we just counted in the purge to decommit all, but the some part was not committed so adjust that here
    // mi_subproc_stat_decrease(arena->subproc, committed, mi_size_of_slices(slice_count - already_committed));
  }
  else if (!all_committed) {
    // we cannot assume any of these are committed any longer (even with reset since we did setN and may have marked uncommitted slices as committed)
    mi_bitmap_clearN(arena->slices_committed, slice_index, slice_count);
    // we adjust the commit count as parts will be re-committed
    // mi_subproc_stat_decrease(arena->subproc, committed, mi_size_of_slices(already_committed));
  }

  return needs_recommit;
}


// Schedule a purge. This is usually delayed to avoid repeated decommit/commit calls.
// Note: assumes we (still) own the area as we may purge immediately
static void mi_arena_schedule_purge(mi_arena_t* arena, size_t slice_index, size_t slice_count) {
  const long delay = mi_arena_purge_delay();
  if (arena->memid.is_pinned || delay < 0 || _mi_preloading()) return;  // is purging allowed at all?

  mi_assert_internal(mi_bbitmap_is_clearN(arena->slices_free, slice_index, slice_count));
  if (delay == 0) {
    // purge directly
    mi_arena_purge(arena, slice_index, slice_count);
  }
  else {
    // schedule purge
    const mi_msecs_t expire = _mi_clock_now() + delay;
    mi_msecs_t expire0 = 0;
    if (mi_atomic_casi64_strong_acq_rel(&arena->purge_expire, &expire0, expire)) {
      // expiration was not yet set
      // maybe set the global arenas expire as well (if it wasn't set already)
      mi_assert_internal(expire0==0);
      if (mi_atomic_casi64_strong_acq_rel(&arena->subproc->purge_expire, &expire0, expire)) {
        // subproc expire went 0 -> set: this is the only transition the scavenger
        // actually needs to observe, so wake it here instead of on every free.
        _mi_scavenger_wake(arena->subproc);
      }
    }
    else {
      // already an expiration was set
    }
    mi_bitmap_setN(arena->slices_purge, slice_index, slice_count, NULL);
  }
}

typedef struct mi_purge_visit_info_s {
  mi_msecs_t now;
  mi_msecs_t delay;
  bool all_purged;
  bool any_purged;
} mi_purge_visit_info_t;

static bool mi_arena_try_purge_range(mi_arena_t* arena, size_t slice_index, size_t slice_count) {
  mi_assert(slice_count < MI_BCHUNK_BITS);
  if (mi_bbitmap_try_clearNC(arena->slices_free, slice_index, slice_count)) {
    // purge
    bool decommitted = mi_arena_purge(arena, slice_index, slice_count); MI_UNUSED(decommitted);
    mi_assert_internal(!decommitted || mi_bitmap_is_clearN(arena->slices_committed, slice_index, slice_count));
    // and reset the free range
    mi_bbitmap_setN(arena->slices_free, slice_index, slice_count);
    return true;
  }
  else {
    // was allocated again already
    return false;
  }
}

static bool mi_arena_try_purge_visitor(size_t slice_index, size_t slice_count, mi_arena_t* arena, void* arg) {
  mi_purge_visit_info_t* vinfo = (mi_purge_visit_info_t*)arg;
  // try to purge: first claim the free blocks
  if (mi_arena_try_purge_range(arena, slice_index, slice_count)) {
    vinfo->any_purged = true;
    vinfo->all_purged = true;
  }
  else if (slice_count > 1)
  {
    // failed to claim the full range, try per slice instead
    for (size_t i = 0; i < slice_count; i++) {
      const bool purged = mi_arena_try_purge_range(arena, slice_index + i, 1);
      vinfo->any_purged = vinfo->any_purged || purged;
      vinfo->all_purged = vinfo->all_purged && purged;
    }
  }
  // don't clear the purge bits as that is done atomically be the _bitmap_forall_set_ranges
  // mi_bitmap_clearN(arena->slices_purge, slice_index, slice_count);
  return true; // continue
}

// returns
// -1 = nothing was purged
// 0  = nothing was purged yet because have not yet reached the expire time
// 1  = some pages in the arena were purged
static int mi_arena_try_purge(mi_arena_t* arena, mi_msecs_t now, bool force)
{
  // check pre-conditions
  if (arena->memid.is_pinned) return -1;

  // expired yet?
  mi_msecs_t expire = mi_atomic_loadi64_relaxed(&arena->purge_expire);
  if (!force) {
    if (expire==0) return -1;
    if (expire > now) return 0;
  }

  // reset expire
  mi_atomic_storei64_release(&arena->purge_expire, (mi_msecs_t)0);
  mi_subproc_stat_counter_increase(arena->subproc, arena_purges, 1);

  // go through all purge info's  (with max MI_BFIELD_BITS ranges at a time)
  // this also clears those ranges atomically (so any newly freed blocks will get purged next
  // time around)
  mi_purge_visit_info_t vinfo = { now, mi_arena_purge_delay(), true /*all?*/, false /*any?*/};

  // we purge by at least `minslices` to not fragment transparent huge pages for example
  const size_t minslices = mi_slice_count_of_size(_mi_os_minimal_purge_size());
  _mi_bitmap_forall_setc_rangesn(arena->slices_purge, minslices, &mi_arena_try_purge_visitor, arena, &vinfo);

  return (vinfo.any_purged ? 1 : -1);
}


// The calling thread just went idle. `purge_delay` exists to avoid churning the OS while a
// thread is actively allocating -- idle voids that premise -- so pull every scheduled arena
// purge forward to `now` and wake the scavenger, which does the madvise off-thread. Arena
// slices sit in no page and are owned by no thread, so this is the scavenger's job; only the
// theap collect and the hole sweep have to run on the owner.
void _mi_arenas_purge_now(mi_subproc_t* subproc) {
  if (subproc == NULL) return;
  const long delay = mi_arena_purge_delay();
  if (delay <= 0) return;   // purging disabled, or already immediate at free time
  const mi_msecs_t now = _mi_clock_now();
  const size_t max_arena = mi_arenas_get_count(subproc);
  bool any_scheduled = false;
  for (size_t i = 0; i < max_arena; i++) {
    mi_arena_t* const arena = mi_arena_from_index(subproc, i);
    if (arena == NULL) continue;
    const mi_msecs_t expire = mi_atomic_loadi64_relaxed(&arena->purge_expire);
    if (expire == 0) continue;                 // nothing queued for this arena
    any_scheduled = true;
    if (expire > now) { mi_atomic_storei64_release(&arena->purge_expire, now); }
  }
  if (!any_scheduled) return;
  const mi_msecs_t sexpire = mi_atomic_loadi64_relaxed(&subproc->purge_expire);
  if (sexpire == 0 || sexpire > now) { mi_atomic_storei64_release(&subproc->purge_expire, now); }
  if (!_mi_scavenger_is_running()) { _mi_scavenger_start_if_forked(); }
  if (_mi_scavenger_is_running()) {
    _mi_scavenger_wake(subproc);
  }
  else {
    _mi_arenas_try_purge(false /* force */, true /* visit all */, subproc, 0 /* tseq */);  // no scavenger: purge here
  }
}

void _mi_arenas_try_purge(bool force, bool visit_all, mi_subproc_t* subproc, size_t tseq)
{
  // try purge can be called often so try to only run when needed
  const long delay = mi_arena_purge_delay();
  if (_mi_preloading() || delay <= 0) return;  // nothing will be scheduled

  // check if any arena needs purging?
  const mi_msecs_t now = _mi_clock_now();
  const mi_msecs_t arenas_expire = mi_atomic_loadi64_acquire(&subproc->purge_expire);
  if (!visit_all && !force && (arenas_expire == 0 || arenas_expire > now)) return;

  const size_t max_arena = mi_arenas_get_count(subproc);
  if (max_arena == 0) return;

  // allow only one thread to purge at a time (todo: allow concurrent purging?)
  static mi_atomic_guard_t purge_guard;
  mi_atomic_guard(&purge_guard)
  {
    // increase global expire: at most one purge per delay cycle
    if (arenas_expire > now) { mi_atomic_storei64_release(&subproc->purge_expire, now + (delay/10)); }
    const size_t arena_start = tseq % max_arena;
    size_t max_purge_count = (visit_all ? max_arena : (max_arena/4)+1);
    bool all_visited = true;
    bool any_purged = false;
    mi_msecs_t next_expire = 0;   // earliest still-pending per-arena expire
    for (size_t _i = 0; _i < max_arena; _i++) {
      size_t i = _i + arena_start;
      if (i >= max_arena) { i -= max_arena; }
      mi_arena_t* arena = mi_arena_from_index(subproc,i);
      if (arena != NULL) {
        const int purged = mi_arena_try_purge(arena, now, force);
        if (purged >= 0) {      // purged, or arena expire is not yet reached
          any_purged = true;
          if (purged >= 1) {    // purged
            if (max_purge_count <= 1) {
              all_visited = false;
              break;
            }
            max_purge_count--;
          }
        }
        const mi_msecs_t aexpire = mi_atomic_loadi64_relaxed(&arena->purge_expire);
        if (aexpire != 0 && (next_expire == 0 || aexpire < next_expire)) { next_expire = aexpire; }
      }
    }
    MI_UNUSED(any_purged);
    if (all_visited) {
      // we saw every arena: subproc->purge_expire becomes the earliest pending
      // per-arena expire (0 if none) so the scavenger's next wait is exact.
      mi_msecs_t expected = arenas_expire;
      mi_atomic_casi64_strong_acq_rel(&subproc->purge_expire, &expected, next_expire);
    }
  }
}


/* -----------------------------------------------------------
  Visit all pages and blocks in a heap
----------------------------------------------------------- */

typedef struct mi_heap_visit_info_s {
  mi_heap_t* heap;
  mi_block_visit_fun* visitor;
  void* arg;
  bool visit_blocks;
  bool claim_pages;                // claim ownership before visiting (for delete/destroy)
  mi_arena_pages_t* arena_pages;   // current arena's pages bitmap (for re-check during claim)
} mi_heap_visit_info_t;

static bool mi_heap_visit_page(mi_page_t* page, mi_heap_visit_info_t* vinfo) {
  mi_heap_area_t area;
  _mi_heap_area_init(&area, page);
  mi_assert_internal(vinfo->heap == mi_page_heap(page));
  if (!vinfo->visitor(vinfo->heap, &area, NULL, area.block_size, vinfo->arg)) {
    return false;
  }
  if (vinfo->visit_blocks) {
    return _mi_theap_area_visit_blocks(&area, page, vinfo->visitor, vinfo->arg);
  }
  else {
    return true;
  }
}

static bool mi_heap_visit_page_at(size_t slice_index, size_t slice_count, mi_arena_t* arena, void* arg) {
  MI_UNUSED(slice_count);
  mi_heap_visit_info_t* vinfo = (mi_heap_visit_info_t*)arg;
  mi_page_t* page = mi_arena_page_at_slice(arena, slice_index);
  if (vinfo->claim_pages) {
    if mi_unlikely(_mi_process_is_forked_child) {
      // After a multithreaded fork() the child may inherit a torn snapshot of pages that another
      // thread was allocating: the arena_pages bit (atomic) propagated but earlier plain stores
      // (page-map entry, page->xthread_free owned bit) did not, and that thread is now gone so the
      // state will never converge. Re-derive the page-map entry from `page` and force ownership.
      if (mi_page_start(page) == NULL) {  // page struct itself never made it across; unpublish and skip
        mi_bitmap_clear(vinfo->arena_pages->pages, slice_index);
        return true;
      }
      if (_mi_safe_ptr_page(mi_page_start(page)) != page) {
        if (!_mi_page_map_register(page)) {
          mi_bitmap_clear(vinfo->arena_pages->pages, slice_index);
          return true;
        }
      }
      mi_page_claim_ownership(page);  // either succeeds, or the dead thread held it — both end with owned=1
    }
    // Invariant: during heap delete/destroy, no theaps remain on this heap, so no new pages are
    // allocated into it. `arena_pages->pages` bits therefore only ever clear (via `_mi_arenas_page_free`
    // from a concurrent `mi_free`). While the bit is set the page at this slice has been continuously
    // ours; if we ever observe it clear, the page was freed and we must skip. The intermediate reads
    // of `xthread_free`/`xthread_id` may race with page reuse, but every loop exit is gated by the
    // final bit re-check below, so a stale read at worst costs an extra yield.
    while (mi_bitmap_is_set(vinfo->arena_pages->pages, slice_index)) {
      if (mi_page_claim_ownership(page)) break;      // we transitioned the owned bit 0->1
      if (!mi_page_is_abandoned(page)) break;        // theap-owned: bit was set at alloc, no concurrent claimer
      if (_mi_process_is_forked_child) break;        // owner thread is dead; we already hold owned=1 from above
      _mi_prim_thread_yield();                       // abandoned and a concurrent `mi_free` owns it: wait
    }
    if (!mi_bitmap_is_set(vinfo->arena_pages->pages, slice_index)) return true;
    mi_assert_internal(mi_page_is_owned(page));
  }
  return mi_heap_visit_page(page, vinfo);
}

bool _mi_heap_visit_blocks(mi_heap_t* heap, bool abandoned_only, bool visit_blocks, bool claim_pages, mi_block_visit_fun* visitor, void* arg) {
  mi_assert(visitor!=NULL);
  if (visitor==NULL) return false;
  if (heap==NULL) { heap = mi_heap_main(); }
  // visit all pages in a heap
  // note: when `claim_pages` is set we claim each page before visiting so that concurrent
  // `mi_free` calls (which may briefly own abandoned pages) cannot race with the visitor.
  mi_heap_visit_info_t visit_info = { heap, visitor, arg, visit_blocks, claim_pages, NULL };
  bool ok = true;
  mi_forall_arenas(heap, NULL, 0, arena) {
    mi_arena_pages_t* arena_pages = mi_heap_arena_pages(heap, arena);
    visit_info.arena_pages = arena_pages;
    if (ok && arena_pages != NULL) {
      if (abandoned_only) {
        for (size_t bin = 0; ok && bin < MI_ARENA_BIN_COUNT; bin++) {
          // todo: if we had a single abandoned page map as well, this can be faster.
          if (mi_atomic_load_relaxed(&heap->abandoned_count[bin]) > 0) {
            ok = _mi_bitmap_forall_set(arena_pages->pages_abandoned[bin], &mi_heap_visit_page_at, arena, &visit_info);
          }
        }
      }
      else {
        ok = _mi_bitmap_forall_set(arena_pages->pages, &mi_heap_visit_page_at, arena, &visit_info);
      }
    }
  }
  mi_forall_arenas_end();
  if (!ok) return false;

  // visit abandoned pages in OS allocated memory
  // Other threads can still mi_free() into these abandoned pages and, on the
  // last free, win the owned-bit, unlink under the lock, and unmap the page.
  // Hold the list lock while we read `next` and (when claiming) only proceed
  // if we actually win ownership; otherwise skip — the freeing thread will
  // dispose of the page.
  mi_lock(&heap->os_abandoned_pages_lock) {
    mi_page_t* page = heap->os_abandoned_pages;
    while (ok && page != NULL) {
      mi_page_t* next = page->next;  // safe under lock
      if (claim_pages && !mi_page_claim_ownership(page)) {
        page = next;
        continue;  // a concurrent free owns it; it will unlink/free the page
      }
      // release the list lock around the visitor (which may take it again to unlink)
      mi_lock_release(&heap->os_abandoned_pages_lock);
      ok = mi_heap_visit_page(page, &visit_info);
      mi_lock_acquire(&heap->os_abandoned_pages_lock);
      // `next` may have been unlinked while we were unlocked; re-read from head
      // if it no longer appears (cheap: list is short, OS pages are rare)
      if (next != NULL) {
        bool found = false;
        for (mi_page_t* p = heap->os_abandoned_pages; p != NULL; p = p->next) {
          if (p == next) { found = true; break; }
        }
        if (!found) next = heap->os_abandoned_pages;
      }
      page = next;
    }
  }

  return ok;
}

bool mi_heap_visit_blocks(mi_heap_t* heap, bool visit_blocks, mi_block_visit_fun* visitor, void* arg) {
  return _mi_heap_visit_blocks(heap, false, visit_blocks, false, visitor, arg);
}

bool mi_heap_visit_abandoned_blocks(mi_heap_t* heap, bool visit_blocks, mi_block_visit_fun* visitor, void* arg) {
  return _mi_heap_visit_blocks(heap, true, visit_blocks, false, visitor, arg);
}


typedef struct mi_heap_delete_visit_info_s {
  mi_heap_t*  heap_target;
  mi_theap_t* theap_target;
  mi_theap_t* theap;
} mi_heap_delete_visit_info_t;

static bool mi_heap_delete_page(const mi_heap_t* heap, const mi_heap_area_t* area, void* block, size_t block_size, void* arg) {
  MI_UNUSED(block); MI_UNUSED(block_size); MI_UNUSED(heap);
  mi_heap_delete_visit_info_t* info = (mi_heap_delete_visit_info_t*)arg;
  mi_heap_t*  heap_target           = info->heap_target;
  mi_theap_t* const theap           = NULL; // info->theap;       mi_assert_internal(_mi_theap_heap(theap) == heap);
  mi_page_t*  const page            = (mi_page_t*)area->reserved1;

  mi_assert_internal(mi_page_is_owned(page));   // pre-claimed by `_mi_heap_visit_blocks(..., claim_pages=true, ...)`
  if (mi_page_is_abandoned(page)) {
    _mi_arenas_page_unabandon(page,theap);
  }
  else {
    page->next = page->prev = NULL;    // yikes.. better not to try to access this from a thread later on..
    mi_page_set_theap(page,NULL);      // set threadid to abandoned
  }
  mi_assert_internal(mi_page_is_abandoned(page));
  mi_assert_internal(mi_page_is_owned(page));

  if (page->used==0) {
    // free the page
    _mi_arenas_page_free(page, theap);
  }
  else if (heap_target==NULL) {
    #if MI_GUARDED
    _mi_page_unguard_all(page);          // remove potential interior guard pages 
    #endif
    // destroy the page
    page->used=0;                        // note: invariant `|local_free| + |free| == reserved - used`  does not hold in this case
    _mi_arenas_page_free(page, theap);
  }
  else if (page->memid.memkind != MI_MEM_ARENA) {
    // OS/external page: no arena bitmaps to update. Re-home and re-abandon it
    // into the target heap's `os_abandoned_pages` list via the normal path.
    const size_t sbin = _mi_page_stats_bin(page);
    if (theap != NULL) { mi_theap_stat_decrease(theap, page_bins[sbin], 1); mi_theap_stat_decrease(theap, pages, 1); }
    else               { mi_heap_stat_decrease((mi_heap_t*)heap, page_bins[sbin], 1); mi_heap_stat_decrease((mi_heap_t*)heap, pages, 1); }
    mi_theap_t* theap_target = info->theap_target;
    page->heap = heap_target;
    mi_theap_stat_increase(theap_target, page_bins[sbin], 1);
    mi_theap_stat_increase(theap_target, pages, 1);
    _mi_arenas_page_abandon(page, theap_target);
  }
  else {
    // move the page to `heap_target` as an abandoned page
    // first remove it from the current heap
    const size_t sbin = _mi_page_stats_bin(page);
    mi_arena_t* arena = NULL;
    size_t slice_index = 0;
    if (page->memid.memkind == MI_MEM_ARENA) {
      size_t slice_count;
      mi_arena_pages_t* arena_pages = NULL;
      arena = mi_page_arena_pages(page, &slice_index, &slice_count, &arena_pages);
      mi_assert_internal(mi_bitmap_is_set(arena_pages->pages, slice_index));
      mi_bitmap_clear(arena_pages->pages, slice_index);
    }
    else {
      // os allocated
      mi_assert_internal(mi_memid_is_os(page->memid) && page->next == NULL);
    }
    if (theap != NULL) {
      mi_theap_stat_decrease(theap, page_bins[sbin], 1);
      mi_theap_stat_decrease(theap, pages, 1);
    }
    else {
      mi_heap_stat_decrease((mi_heap_t*)heap, page_bins[_mi_page_stats_bin(page)], 1);
      mi_heap_stat_decrease((mi_heap_t*)heap, pages, 1);
    }
    mi_theap_t* theap_target = info->theap_target;

    // and then add it to the new target heap
    if (arena != NULL) {
      mi_arena_pages_t* arena_pages_target = mi_heap_ensure_arena_pages(heap_target, arena);
      if mi_unlikely(arena_pages_target==NULL) {
        // if we cannot allocate this, we move it to the main heap instead (which does not require allocation)
        heap_target = mi_arena_heap_main(arena);
        theap_target = mi_heap_theap(heap_target);  // todo: find through theap_target tld?
        arena_pages_target = mi_heap_ensure_arena_pages(heap_target, arena);
        mi_assert_internal(arena_pages_target!=NULL);
      }
      mi_assert_internal(mi_bitmap_is_clear(arena_pages_target->pages, slice_index));
      mi_bitmap_set(arena_pages_target->pages, slice_index);    
    }
    page->heap = heap_target;
    mi_theap_stat_increase(theap_target, page_bins[sbin], 1);
    mi_theap_stat_increase(theap_target, pages, 1);

    // and abandon in the new heap
    _mi_arenas_page_abandon(page,theap_target);
  }
  return true;
}

static void mi_heap_delete_pages(mi_heap_t* heap, mi_heap_t* heap_target) {
  mi_theap_t* const theap_target = (heap_target != NULL ? _mi_heap_theap(heap_target) : NULL);
  // mi_theap_t* const theap = _mi_heap_theap(heap);
  mi_heap_delete_visit_info_t info = { heap_target, theap_target, NULL };
  _mi_heap_visit_blocks(heap, false, false, true /* claim each page */, &mi_heap_delete_page, &info);
  #if MI_DEBUG>1
  // no more arena pages?
  for (size_t i = 0; i < MI_ARENA_BIN_COUNT; i++) {
    mi_arena_pages_t* const arena_pages = mi_atomic_load_ptr_relaxed(mi_arena_pages_t, &heap->arena_pages[i]);
    if (arena_pages!=NULL) {
      mi_assert_internal(mi_bitmap_is_all_clear(arena_pages->pages));
    }
  }
  // nor os abandoned pages?
  mi_lock(&heap->os_abandoned_pages_lock) {

    mi_assert_internal(heap->os_abandoned_pages == NULL);
  }
  // nor arena abandoned pages?
  for (size_t i = 0; i < MI_ARENA_BIN_COUNT; i++) {
    mi_assert_internal(mi_atomic_load_relaxed(&heap->abandoned_count[i])==0);
  }
  #endif
}

void _mi_heap_move_pages(mi_heap_t* heap_from, mi_heap_t* heap_to) {
  if (_mi_is_heap_main(heap_from)) return;
  if (heap_to==NULL) { heap_to = heap_from->subproc->heap_main; }
  mi_heap_delete_pages(heap_from, heap_to);
}

void _mi_heap_destroy_pages(mi_heap_t* heap_from) {
  if (_mi_is_heap_main(heap_from)) return;
  mi_heap_delete_pages(heap_from, NULL);
}

/* -----------------------------------------------------------
  Unloading and reloading an arena.
----------------------------------------------------------- */
/*
static bool mi_arena_page_register(size_t slice_index, size_t slice_count, mi_arena_t* arena, void* arg) {
  MI_UNUSED(arg); MI_UNUSED(slice_count);
  mi_assert_internal(slice_count == 1);
  mi_page_t* page = mi_arena_page_at_slice(arena, slice_index);
  mi_assert_internal(mi_bitmap_is_setN(page->memid.mem.arena.arena->pages, page->memid.mem.arena.slice_index, 1));
  if (!_mi_page_map_register(page)) return false; // break
  mi_assert_internal(_mi_ptr_page(page)==page);
  return true;
}

mi_decl_nodiscard static bool mi_arena_pages_reregister(mi_arena_t* arena) {
  return _mi_bitmap_forall_set(arena->pages, &mi_arena_page_register, arena, NULL);
}

mi_decl_export bool mi_arena_unload(mi_arena_id_t arena_id, void** base, size_t* accessed_size, size_t* full_size) {
  mi_arena_t* arena = _mi_arena_from_id(arena_id);
  if (arena==NULL) {
    return false;
  }
  else if (!arena->is_exclusive) {
    _mi_warning_message("cannot unload a non-exclusive arena (id %zu at %p)\n", arena_id, arena);
    return false;
  }
  else if (arena->memid.memkind != MI_MEM_EXTERNAL) {
    _mi_warning_message("can only unload managed arena's for external memory (id %zu at %p)\n", arena_id, arena);
    return false;
  }

  // find accessed size
  const size_t asize = mi_size_of_slices(mi_arena_used_slices(arena));
  if (base != NULL) { *base = (void*)arena; }
  if (full_size != NULL) { *full_size = arena->memid.mem.os.size;  }
  if (accessed_size != NULL) { *accessed_size = asize; }

  // adjust abandoned page count
  mi_subproc_t* const subproc = arena->subproc;
  for (size_t bin = 0; bin < MI_ARENA_BIN_COUNT; bin++) {
    const size_t count = mi_bitmap_popcount(arena->pages_abandoned[bin]);
    if (count > 0) { mi_atomic_decrement_acq_rel(&subproc->abandoned_count[bin]); }
  }

  // unregister the pages
  _mi_page_map_unregister_range(arena, asize);

  // set arena entry to NULL
  const size_t count = mi_arenas_get_count(subproc);
  for(size_t i = 0; i < count; i++) {
    if (mi_arena_from_index(subproc, i) == arena) {
      mi_atomic_store_ptr_release(mi_arena_t, &subproc->arenas[i], NULL);
      if (i + 1 == count) { // try adjust the count?
        size_t expected = count;
        mi_atomic_cas_strong_acq_rel(&subproc->arena_count, &expected, count-1);
      }
      break;
    }
  }
  return true;
}

mi_decl_export bool mi_arena_reload(void* start, size_t size, mi_commit_fun_t* commit_fun, void* commit_fun_arg, mi_arena_id_t* arena_id) {
  // assume the memory area is already containing the arena
  if (arena_id != NULL) { *arena_id = _mi_arena_id_none(); }
  if (start == NULL || size == 0) return false;
  mi_arena_t* arena = (mi_arena_t*)start;
  mi_memid_t memid = arena->memid;
  if (memid.memkind != MI_MEM_EXTERNAL) {
    _mi_warning_message("can only reload arena's from external memory (%p)\n", arena);
    return false;
  }
  if (memid.mem.os.base != start) {
    _mi_warning_message("the reloaded arena base address differs from the external memory (arena: %p, external: %p)\n", arena, start);
    return false;
  }
  if (memid.mem.os.size != size) {
    _mi_warning_message("the reloaded arena size differs from the external memory (arena size: %zu, external size: %zu)\n", arena->memid.mem.os.size, size);
    return false;
  }
  if (!arena->is_exclusive) {
    _mi_warning_message("the reloaded arena is not exclusive\n");
    return false;
  }

  // re-initialize
  arena->is_exclusive = true;
  arena->commit_fun = commit_fun;
  arena->commit_fun_arg = commit_fun_arg;
  arena->subproc = _mi_subproc();
  if (!mi_arenas_add(arena->subproc, arena, arena_id)) {
    return false;
  }
  if (!mi_arena_pages_reregister(arena)) {
    // todo: clear arena entry in the subproc?
    return false;
  }

  // adjust abandoned page count
  for (size_t bin = 0; bin < MI_ARENA_BIN_COUNT; bin++) {
    const size_t count = mi_bitmap_popcount(arena->pages_abandoned[bin]);
    if (count > 0) { mi_atomic_decrement_acq_rel(&arena->subproc->abandoned_count[bin]); }
  }

  return true;
}

*/
