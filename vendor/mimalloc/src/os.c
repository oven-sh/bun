/* ----------------------------------------------------------------------------
Copyright (c) 2018-2026, Microsoft Research, Daan Leijen
This is free software; you can redistribute it and/or modify it under the
terms of the MIT license. A copy of the license can be found in the file
"LICENSE" at the root of this distribution.
-----------------------------------------------------------------------------*/
#include "mimalloc.h"
#include "mimalloc/internal.h"
#include "mimalloc/atomic.h"
#include "mimalloc/prim.h"
#include <stdlib.h>
#include "mimalloc/prim-tls.h"  // _mi_theap_default for random

/* -----------------------------------------------------------
  Initialization.
----------------------------------------------------------- */
#ifndef MI_DEFAULT_PHYSICAL_MEMORY_IN_KIB
#if MI_INTPTR_SIZE < 8
#define MI_DEFAULT_PHYSICAL_MEMORY_IN_KIB   4*MI_MiB    // 4 GiB
#else
#define MI_DEFAULT_PHYSICAL_MEMORY_IN_KIB   32*MI_MiB   // 32 GiB
#endif
#endif

static mi_os_mem_config_t mi_os_mem_config = {
  4096,     // page size
  0,        // large page size (usually 2MiB)
  4096,     // allocation granularity
  MI_DEFAULT_PHYSICAL_MEMORY_IN_KIB,
  MI_MAX_VABITS, // in `bits.h`
  true,     // has overcommit?  (if true we use MAP_NORESERVE on mmap systems)
  false,    // can we partially free allocated blocks? (on mmap systems we can free anywhere in a mapped range, but on Windows we must free the entire span)
  true,     // has virtual reserve? (if true we can reserve virtual address space without using commit or physical memory)
  false     // has transparent huge pages? (if true we purge in (aligned) large page size chunks only to not fragment such pages)
};

bool _mi_os_has_overcommit(void) {
  return mi_os_mem_config.has_overcommit;
}

bool _mi_os_has_virtual_reserve(void) {
  return mi_os_mem_config.has_virtual_reserve;
}


// OS (small) page size
size_t _mi_os_page_size(void) {
  return mi_os_mem_config.page_size;
}

// if large OS pages are supported (2 or 4MiB), then return the size, otherwise return the small page size (4KiB)
size_t _mi_os_large_page_size(void) {
  return (mi_os_mem_config.large_page_size != 0 ? mi_os_mem_config.large_page_size : _mi_os_page_size());
}

// minimal purge size. Can be larger than the page size if transparent huge pages are enabled.
size_t _mi_os_minimal_purge_size(void) {
  size_t minsize = mi_option_get_size(mi_option_minimal_purge_size);
  if (minsize != 0) {
    return _mi_align_up(minsize, _mi_os_page_size());
  }
  else if (mi_os_mem_config.has_transparent_huge_pages && mi_option_get(mi_option_allow_thp) == 2) {
    return _mi_os_large_page_size();
  }
  else {
    return _mi_os_page_size();
  }
}

size_t _mi_os_guard_page_size(void) {
  const size_t gsize = _mi_os_page_size();
  mi_assert(gsize <= (MI_ARENA_SLICE_SIZE/4)); // issue #1166
  return gsize;
}

size_t _mi_os_virtual_address_bits(void) {
  const size_t vbits = mi_os_mem_config.virtual_address_bits;
  mi_assert(vbits <= MI_MAX_VABITS);
  return vbits;
}

bool _mi_os_canuse_large_page(size_t size, size_t alignment) {
  // if we have access, check the size and alignment requirements
  if (mi_os_mem_config.large_page_size == 0) return false;
  return ((size % mi_os_mem_config.large_page_size) == 0 && (alignment % mi_os_mem_config.large_page_size) == 0);
}

// round to a good OS allocation size (bounded by max 12.5% waste)
size_t _mi_os_good_alloc_size(size_t size) {
  size_t align_size;
  if (size < 512*MI_KiB) align_size = _mi_os_page_size();
  else if (size < 2*MI_MiB) align_size = 64*MI_KiB;
  else if (size < 8*MI_MiB) align_size = 256*MI_KiB;
  else if (size < 32*MI_MiB) align_size = 1*MI_MiB;
  else align_size = 4*MI_MiB;
  if mi_unlikely(size >= (SIZE_MAX - align_size)) return size; // possible overflow?
  return _mi_align_up(size, align_size);
}

void _mi_os_init(void) {
  _mi_prim_mem_init(&mi_os_mem_config);
}


/* -----------------------------------------------------------
  Util
-------------------------------------------------------------- */
bool _mi_os_decommit(mi_subproc_t* subproc, void* addr, size_t size);

#if MI_DEBUG > 0
mi_decl_export volatile long mi_debug_fail_os_commit_after = 0;
#endif
bool _mi_os_commit(mi_subproc_t* subproc, void* addr, size_t size, bool* is_zero);

// On systems with enough virtual address bits, we can do efficient aligned allocation by using
// the 2TiB to 30TiB area to allocate those. If we have at least 46 bits of virtual address
// space (64TiB) we use this technique. (but see issue #939)
#if (MI_INTPTR_SIZE >= 8) && !defined(MI_NO_ALIGNED_HINT) // && !defined(WIN32) && !defined(ANDROID)

// Return a MI_HINT_ALIGN (4MiB) aligned address that is probably available.
// If this returns NULL, the OS will determine the address but on some OS's that may not be
// properly aligned which can be more costly as it needs to be adjusted afterwards.
// In secure mode, for a size > 16GiB this always returns NULL in order to guarantee good ASLR randomization;
// (otherwise an initial large allocation of say 2TiB has a 50% chance to include (known) addresses
//  in the middle of the 2TiB - 6TiB address range (see issue #372))

#define MI_HINT_ALIGN ((uintptr_t)4 << 20)  // 4MiB alignment
#define MI_HINT_BASE  ((uintptr_t)2 << 40)  // 2TiB start
#define MI_HINT_AREA  ((uintptr_t)4 << 40)  // upto (2+4) 6TiB  (since before win8 there is "only" 8TiB available to processes)
#define MI_HINT_MAX   ((uintptr_t)30 << 40) // wrap after 30TiB (area after 32TiB is used for huge OS pages)

// Host is a `bun build --compile` executable? (BUN_COMPILED = the embedded-module section header; size != 0 only in compiled outputs.)
// Those get deterministic address hints from the first allocation so a heap image can be built from / mapped into them without any env.
struct mi_bun_blob_header_s { uint64_t size; };
extern struct mi_bun_blob_header_s BUN_COMPILED __attribute__((weak));
#define bun_heap_image_mode ((&BUN_COMPILED != NULL) ? (BUN_COMPILED.size != 0) : 0)
static mi_decl_cache_align _Atomic(uintptr_t) aligned_base; // = 0  (hint bump pointer; file scope so mi_os_hint_floor can move it)

// Heap image restore: make sure every hinted OS allocation from now on lands at or above `floor` (the image occupies the area below).
void mi_os_hint_floor(void* floor) mi_attr_noexcept {
  uintptr_t f = _mi_align_up((uintptr_t)floor, MI_HINT_ALIGN);
  uintptr_t cur = mi_atomic_load_acquire(&aligned_base);
  while (cur < f && !mi_atomic_cas_weak_acq_rel(&aligned_base, &cur, f)) { }
}

void* _mi_os_get_aligned_hint(size_t try_alignment, size_t size)
{

  // todo: perhaps only do alignment hints if THP is enabled?
  // Deterministic hinting: on when the executable is image-capable (link-time flag in the host binary) or requested via env.
  static int deterministic_env = -1;
  if (deterministic_env < 0) {
    const char* e = getenv("MIMALLOC_DETERMINISTIC_HINT"); deterministic_env = (e && *e == '1') ? 1 : 0;
    // MIMALLOC_HINT_FLOOR=0x...: start hinted OS allocations at/above this address (a heap image will be mapped below it)
    const char* fl = getenv("MIMALLOC_HINT_FLOOR"); if (fl && *fl) { unsigned long long v = strtoull(fl, NULL, 0); if (v) mi_os_hint_floor((void*)(uintptr_t)v); }
  }
  // deterministic mode: every OS allocation gets a bump-pointer hint in the hint area (so nothing lands at kernel-chosen addresses)
  const int deterministic_all = deterministic_env || bun_heap_image_mode;
  if (!deterministic_all && (try_alignment <= mi_os_mem_config.alloc_granularity || try_alignment > MI_HINT_ALIGN)) return NULL;
  if (deterministic_all && try_alignment > MI_HINT_ALIGN) return NULL;
  if (mi_os_mem_config.virtual_address_bits < 46) return NULL;  // < 64TiB virtual address space
  size = _mi_align_up(size, MI_HINT_ALIGN);
  #if (MI_SECURE>=1)
  if (size > 16*MI_GiB) return NULL;  // guarantee the chance of fixed valid address is at most 1/(MI_HINT_AREA / 1<<34) = 1/256
  #endif
  size += MI_HINT_ALIGN;              // put in virtual gaps between hinted blocks; this splits VLA's but increases guarded areas.

  uintptr_t hint = mi_atomic_add_acq_rel(&aligned_base, size);
  if (hint == 0 || hint > MI_HINT_MAX) {   // wrap or initialize
    uintptr_t init = MI_HINT_BASE;
    // Experiment: MIMALLOC_DETERMINISTIC_HINT=1 disables hint randomization (heap-image determinism tests).
    const int deterministic = deterministic_all;
    #if (MI_SECURE>=1 || defined(NDEBUG))  // security: randomize start of aligned allocations unless in debug mode
    if (!deterministic) {
    mi_theap_t* const theap = _mi_theap_default();     // don't use `mi_theap_get_default()` as that can cause allocation recursively (issue #1267)
    if (!mi_theap_is_initialized(theap)) return NULL;  // no hint as we lack randomness at this point
    const uintptr_t r = _mi_theap_random_next(theap);
    init = init + ((MI_HINT_ALIGN * ((r>>17) & 0xFFFFF)) % MI_HINT_AREA);  // (randomly 20 bits)*4MiB == 0 to 4TiB
    }
    #endif
    uintptr_t expected = hint + size;
    mi_atomic_cas_strong_acq_rel(&aligned_base, &expected, init);
    hint = mi_atomic_add_acq_rel(&aligned_base, size); // this may still give 0 or > MI_HINT_MAX but that is ok, it is a hint after all
  }
  mi_assert_internal(hint%MI_HINT_ALIGN == 0);
  if (hint%try_alignment != 0) return NULL;
  return (void*)hint;
}
#else
void* _mi_os_get_aligned_hint(size_t try_alignment, size_t size) {
   MI_UNUSED(try_alignment); MI_UNUSED(size);
   return NULL;
}
#endif


/* -----------------------------------------------------------
  Guard page allocation
----------------------------------------------------------- */

// In secure mode, return the size of a guard page, otherwise 0
size_t _mi_os_secure_guard_page_size(void) {
  #if MI_SECURE > 0
  return _mi_os_guard_page_size();
  #else
  return 0;
  #endif
}

// In secure mode, try to decommit an area and output a warning if this fails.
bool _mi_os_secure_guard_page_set_at(mi_subproc_t* subproc, void* addr, mi_memid_t memid) {
  if (addr == NULL) return true;
  #if MI_SECURE > 0
  bool ok = false;
  if (!memid.is_pinned) {
    mi_arena_t* const arena = mi_memid_arena(memid);
    if (arena != NULL && arena->commit_fun != NULL) {
      ok = (*(arena->commit_fun))(false /* decommit */, addr, _mi_os_secure_guard_page_size(), NULL, arena->commit_fun_arg);
    }
    else {
      ok = _mi_os_decommit(subproc, addr, _mi_os_secure_guard_page_size());
    }
  }
  if (!ok) {
    _mi_error_message(EINVAL, "secure level %d, but failed to commit guard page (at %p of size %zu)\n", MI_SECURE, addr, _mi_os_secure_guard_page_size());
  }
  return ok;
  #else
  MI_UNUSED(subproc); MI_UNUSED(memid);
  return true;
  #endif
}

// In secure mode, try to decommit an area and output a warning if this fails.
bool _mi_os_secure_guard_page_set_before(mi_subproc_t* subproc, void* addr, mi_memid_t memid) {
  return _mi_os_secure_guard_page_set_at(subproc, (uint8_t*)addr - _mi_os_secure_guard_page_size(), memid);
}

// In secure mode, try to recommit an area
bool _mi_os_secure_guard_page_reset_at(mi_subproc_t* subproc, void* addr, mi_memid_t memid) {
  if (addr == NULL) return true;
  #if MI_SECURE > 0
  if (!memid.is_pinned) {
    mi_arena_t* const arena = mi_memid_arena(memid);
    if (arena != NULL && arena->commit_fun != NULL) {
      return (*(arena->commit_fun))(true, addr, _mi_os_secure_guard_page_size(), NULL, arena->commit_fun_arg);
    }
    else {
      return _mi_os_commit(subproc, addr, _mi_os_secure_guard_page_size(), NULL);
    }
  }
  #else
  MI_UNUSED(subproc); MI_UNUSED(memid);
  #endif
  return true;
}

// In secure mode, try to recommit an area
bool _mi_os_secure_guard_page_reset_before(mi_subproc_t* subproc, void* addr, mi_memid_t memid) {
  return _mi_os_secure_guard_page_reset_at(subproc, (uint8_t*)addr - _mi_os_secure_guard_page_size(), memid);
}


/* -----------------------------------------------------------
  Free memory
-------------------------------------------------------------- */

static void mi_os_free_huge_os_pages(mi_subproc_t* subproc, void* p, size_t size);

static void mi_os_prim_free(mi_subproc_t* subproc, void* addr, size_t size, size_t commit_size) {
  mi_assert_internal(subproc!=NULL);
  mi_assert_internal((size % _mi_os_page_size()) == 0);
  if (addr == NULL) return; // || _mi_os_is_huge_reserved(addr)
  int err = _mi_prim_free(addr, size);  // allow size==0 (issue #1041)
  if (err != 0) {
    _mi_warning_message("unable to free OS memory (error: %d (0x%x), size: 0x%zx bytes, address: %p)\n", err, err, size, addr);
  }
  if (commit_size > 0) {
    mi_subproc_stat_decrease(subproc, committed, commit_size);
  }
  mi_subproc_stat_decrease(subproc, reserved, size);
}

void _mi_os_free_ex(mi_subproc_t* subproc, void* addr, size_t size, bool still_committed, mi_memid_t memid) {
  if (mi_memkind_is_os(memid.memkind)) {
    size_t csize = memid.mem.os.size;
    if (csize==0) { csize = _mi_os_good_alloc_size(size); }
    mi_assert_internal(csize >= size);
    size_t commit_size = (still_committed ? csize : 0);
    void* base = addr;
    // different base? (due to alignment)
    if (memid.mem.os.base != base) {
      mi_assert(memid.mem.os.base <= addr);
      base = memid.mem.os.base;
      const size_t diff = (uint8_t*)addr - (uint8_t*)memid.mem.os.base;
      if (memid.mem.os.size==0) {
        csize += diff;
      }
      if (still_committed) {
        commit_size -= diff;  // the (addr-base) part was already un-committed
      }
    }
    // free it
    if (memid.memkind == MI_MEM_OS_HUGE) {
      mi_assert(memid.is_pinned);
      mi_os_free_huge_os_pages(subproc, base, csize);
    }
    else {
      mi_os_prim_free(subproc, base, csize, (still_committed ? commit_size : 0));
    }
  }
  else {
    // nothing to do
    mi_assert(memid.memkind < MI_MEM_OS);
  }
}

void  _mi_os_free(mi_subproc_t* subproc, void* p, size_t size, mi_memid_t memid) {
  _mi_os_free_ex(subproc, p, size, true, memid);
}


/* -----------------------------------------------------------
   Primitive allocation from the OS.
-------------------------------------------------------------- */

// Note: the `try_alignment` is just a hint and the returned pointer is not guaranteed to be aligned.
// Also `hint_addr` is a hint and may be ignored.
static void* mi_os_prim_alloc_at(mi_subproc_t* subproc, void* hint_addr, size_t size, size_t try_alignment, bool commit, bool allow_large, bool* is_large, bool* is_zero) {
  mi_assert_internal(size > 0 && (size % _mi_os_page_size()) == 0);
  mi_assert_internal(is_zero != NULL);
  mi_assert_internal(is_large != NULL);
  if (size == 0) return NULL;
  if (!commit) { allow_large = false; }
  if (try_alignment == 0) { try_alignment = 1; } // avoid 0 to ensure there will be no divide by zero when aligning

  // try to align along large OS page size for larger allocations
  const size_t large_page_size = mi_os_mem_config.large_page_size;
  if (large_page_size > 0 && hint_addr == NULL && size >= 8*large_page_size && _mi_is_power_of_two(try_alignment) && try_alignment < large_page_size) {
    try_alignment = large_page_size;
  }

  *is_zero = false;
  void* p = NULL;
  int err = _mi_prim_alloc(hint_addr, size, try_alignment, commit, allow_large, is_large, is_zero, &p);
  if (err != 0) {
    _mi_warning_message("unable to allocate OS memory (error: %d (0x%x), addr: %p, size: 0x%zx bytes, align: 0x%zx, commit: %d, allow large: %d)\n", err, err, hint_addr, size, try_alignment, commit, allow_large);
  }

  mi_subproc_stat_counter_increase(subproc, mmap_calls, 1);
  if (p != NULL) {
    mi_subproc_stat_increase(subproc, reserved, size);
    if (commit) {
      mi_subproc_stat_increase(subproc, committed, size);
      // seems needed for asan (or `mimalloc-test-api` fails)
      #ifdef MI_TRACK_ASAN
      if (*is_zero) { mi_track_mem_defined(p,size); }
               else { mi_track_mem_undefined(p,size); }
      #endif
    }
  }
  return p;
}

static void* mi_os_prim_alloc(mi_subproc_t* subproc, size_t size, size_t try_alignment, bool commit, bool allow_large, bool* is_large, bool* is_zero) {
  return mi_os_prim_alloc_at(subproc, NULL /* hint addr */, size, try_alignment, commit, allow_large, is_large, is_zero);
}


// Primitive aligned allocation from the OS.
// This function guarantees the allocated memory is aligned.
static void* mi_os_prim_alloc_aligned(mi_subproc_t* subproc, size_t size, size_t alignment, bool commit, bool allow_large, mi_memid_t* memid) {
  mi_assert_internal(memid!=NULL);
  mi_assert_internal(alignment >= _mi_os_page_size() && ((alignment & (alignment - 1)) == 0));
  mi_assert_internal(size > 0 && (size % _mi_os_page_size()) == 0);
  *memid = _mi_memid_none();
  if (!commit) allow_large = false;
  if (!(alignment >= _mi_os_page_size() && ((alignment & (alignment - 1)) == 0))) return NULL;
  size = _mi_align_up(size, _mi_os_page_size());

  // try a direct allocation if the alignment is below the default, or less than or equal to 1/4 fraction of the size.
  const bool try_direct_alloc = (alignment <= mi_os_mem_config.alloc_granularity || alignment <= size/4);

  bool os_is_large = false;
  bool os_is_zero = false;
  void*  os_base = NULL;
  size_t os_size = size;
  void* p = NULL;
  if (try_direct_alloc) {
    p = mi_os_prim_alloc(subproc, size, alignment, commit, allow_large, &os_is_large, &os_is_zero);
  }

  // aligned already?
  if (p != NULL && _mi_is_aligned(p,alignment)) {
    os_base = p;
  }
  else {
    // if not aligned, free it, overallocate, and unmap around it
    #if !MI_TRACK_ASAN
    if (try_direct_alloc) {
      _mi_warning_message("unable to allocate aligned OS memory directly, fall back to over-allocation (size: 0x%zx bytes, address: %p, alignment: 0x%zx, commit: %d)\n", size, p, alignment, commit);
    }
    #endif
    if (p != NULL) { mi_os_prim_free(subproc, p, size, (commit ? size : 0)); }
    if (size >= (SIZE_MAX - alignment)) return NULL; // overflow
    const size_t over_size = size + alignment;

    if (!mi_os_mem_config.has_partial_free) {  // win32 virtualAlloc cannot free parts of an allocated block
      // over-allocate uncommitted (virtual) memory
      p = mi_os_prim_alloc(subproc, over_size, 1 /*alignment*/, false /* commit? */, false /* allow_large */, &os_is_large, &os_is_zero);
      if (p == NULL) return NULL;

      // set p to the aligned part in the full region
      // note: Windows VirtualFree needs the actual base pointer
      // this is handled though by having the `base` field in the memid
      os_base = p; // remember the base
      os_size = over_size;
      p = _mi_align_up_ptr(p, alignment);

      // explicitly commit only the aligned part
      if (commit) {
        if (!_mi_os_commit(subproc, p, size, NULL)) {
          mi_os_prim_free(subproc, os_base, over_size, 0);
          return NULL;
        }
      }
    }
    else  { // mmap can free inside an allocation
      // overallocate...
      p = mi_os_prim_alloc(subproc, over_size, 1, commit, false, &os_is_large, &os_is_zero);
      if (p == NULL) return NULL;

      // and selectively unmap parts around the over-allocated area.
      void* const aligned_p = _mi_align_up_ptr(p, alignment);
      const size_t pre_size = (uint8_t*)aligned_p - (uint8_t*)p;
      const size_t mid_size = _mi_align_up(size, _mi_os_page_size());
      const size_t post_size = over_size - pre_size - mid_size;
      mi_assert_internal(pre_size < over_size&& post_size < over_size&& mid_size >= size);
      if (pre_size > 0)  { mi_os_prim_free(subproc, p, pre_size, (commit ? pre_size : 0)); }
      if (post_size > 0) { mi_os_prim_free(subproc, (uint8_t*)aligned_p + mid_size, post_size, (commit ? post_size : 0)); }
      // we can return the aligned pointer on `mmap` systems
      p = aligned_p;
      os_base = aligned_p; // since we freed the pre part, `*base == p`.
      os_size = mid_size;
    }
  }

  mi_assert_internal(p != NULL && os_base != NULL && _mi_is_aligned(p,alignment));
  mi_assert_internal(os_base <= p && size <= os_size);
  *memid = _mi_memid_create_os(os_base,os_size,commit,os_is_zero,os_is_large);
  return p;
}


/* -----------------------------------------------------------
  OS API: alloc and alloc_aligned
----------------------------------------------------------- */

void* _mi_os_alloc(mi_subproc_t* subproc, size_t size, mi_memid_t* memid) {
  *memid = _mi_memid_none();
  if (size == 0) return NULL;
  size = _mi_os_good_alloc_size(size);
  bool os_is_large = false;
  bool os_is_zero  = false;
  void* p = mi_os_prim_alloc(subproc, size, 0, true, false, &os_is_large, &os_is_zero);
  if (p == NULL) return NULL;

  *memid = _mi_memid_create_os(p, size, true, os_is_zero, os_is_large);
  mi_assert_internal(memid->mem.os.size >= size);
  mi_assert_internal(memid->initially_committed);
  return p;
}

void* _mi_os_alloc_aligned(mi_subproc_t* subproc, size_t size, size_t alignment, bool commit, bool allow_large, mi_memid_t* memid)
{
  MI_UNUSED(&_mi_os_get_aligned_hint); // suppress unused warnings
  *memid = _mi_memid_none();
  if (size == 0) return NULL;
  size = _mi_os_good_alloc_size(size);
  alignment = _mi_align_up(alignment, _mi_os_page_size());

  void* p = mi_os_prim_alloc_aligned(subproc, size, alignment, commit, allow_large, memid );
  if (p == NULL) return NULL;

  mi_assert_internal(memid->mem.os.size >= size);
  mi_assert_internal(_mi_is_aligned(p,alignment));
  if (commit) { mi_assert_internal(memid->initially_committed); }
  return p;
}


mi_decl_nodiscard static void* mi_os_ensure_zero(mi_subproc_t* subproc, void* p, size_t size, mi_memid_t* memid) {
  if (p==NULL || size==0) return p;
  // ensure committed
  if (!memid->initially_committed) {
    bool is_zero = false;
    if (!_mi_os_commit(subproc, p, size, &is_zero)) {
      _mi_os_free(subproc, p, size, *memid);
      return NULL;
    }
    memid->initially_committed = true;
  }
  // ensure zero'd
  if (memid->initially_zero) return p;
  _mi_memzero_aligned(p,size);
  memid->initially_zero = true;
  return p;
}

void*  _mi_os_zalloc(mi_subproc_t* subproc, size_t size, mi_memid_t* memid) {
  void* p = _mi_os_alloc(subproc, size,memid);
  return mi_os_ensure_zero(subproc, p, size, memid);
}

/* -----------------------------------------------------------
  OS aligned allocation with an offset. This is used
  for large alignments > MI_BLOCK_ALIGNMENT_MAX. We use a large mimalloc
  page where the object can be aligned at an offset from the start of the segment.
  As we may need to overallocate, we need to free such pointers using `mi_free_aligned`
  to use the actual start of the memory region.
----------------------------------------------------------- */

void* _mi_os_alloc_aligned_at_offset(mi_subproc_t* subproc, size_t size, size_t alignment, size_t offset, bool commit, bool allow_large, mi_memid_t* memid) {
  mi_assert(offset <= size);
  mi_assert((alignment % _mi_os_page_size()) == 0);
  *memid = _mi_memid_none();
  if (offset > size) return NULL;
  if (offset == 0) {
    // regular aligned allocation
    return _mi_os_alloc_aligned(subproc, size, alignment, commit, allow_large, memid);
  }
  else {
    // overallocate to align at an offset
    const size_t extra = _mi_align_up(offset, alignment) - offset;
    if (size >= SIZE_MAX - extra) return NULL;  // too large
    const size_t oversize = size + extra;
    void* const start = _mi_os_alloc_aligned(subproc, oversize, alignment, commit, allow_large, memid);
    if (start == NULL) return NULL;

    void* const p = (uint8_t*)start + extra;
    mi_assert(_mi_is_aligned((uint8_t*)p + offset, alignment));
    // decommit the overallocation at the start
    if (commit && extra >= _mi_os_page_size()) {
      _mi_os_decommit(subproc, start, extra);
    }
    return p;
  }
}

/* -----------------------------------------------------------
  OS memory API: reset, commit, decommit, protect, unprotect.
----------------------------------------------------------- */

// OS page align within a given area, either conservative (pages inside the area only),
// or not (straddling pages outside the area is possible)
static void* mi_os_page_align_areax(bool conservative, void* addr, size_t size, size_t* newsize) {
  mi_assert(addr != NULL && size > 0);
  if (newsize != NULL) *newsize = 0;
  if (size == 0 || addr == NULL) return NULL;

  // page align conservatively within the range, or liberally straddling pages outside the range
  void* start = (conservative ? _mi_align_up_ptr(addr, _mi_os_page_size())
                              : _mi_align_down_ptr(addr, _mi_os_page_size()));
  void* end   = (conservative ? _mi_align_down_ptr((uint8_t*)addr + size, _mi_os_page_size())
                              : _mi_align_up_ptr((uint8_t*)addr + size, _mi_os_page_size()));
  ptrdiff_t diff = (uint8_t*)end - (uint8_t*)start;
  if (diff <= 0) return NULL;

  mi_assert_internal((conservative && (size_t)diff <= size) || (!conservative && (size_t)diff >= size));
  if (newsize != NULL) *newsize = (size_t)diff;
  return start;
}

static void* mi_os_page_align_area_conservative(void* addr, size_t size, size_t* newsize) {
  return mi_os_page_align_areax(true, addr, size, newsize);
}

bool _mi_os_commit_ex(mi_subproc_t* subproc, void* addr, size_t size, bool* is_zero, size_t stat_size) {
  if (is_zero != NULL) { *is_zero = false; }
  mi_subproc_stat_counter_increase(subproc, commit_calls, 1);

  // page align range
  size_t csize;
  void* start = mi_os_page_align_areax(false /* conservative? */, addr, size, &csize);
  if (csize == 0) return true;

  // commit
  bool os_is_zero = false;
  #if MI_DEBUG > 0
  if (mi_debug_fail_os_commit_after > 0 && --mi_debug_fail_os_commit_after == 0) {
    _mi_warning_message("mi_debug_fail_os_commit_after: injecting commit failure at %p, size 0x%zx\n", start, csize);
    return false;
  }
  #endif
  int err = _mi_prim_commit(start, csize, &os_is_zero);
  if (err != 0) {
    _mi_warning_message("cannot commit OS memory (error: %d (0x%x), address: %p, size: 0x%zx bytes)\n", err, err, start, csize);
    return false;
  }
  if (os_is_zero && is_zero != NULL) {
    *is_zero = true;
    mi_assert_expensive(mi_mem_is_zero(start, csize));
  }
  // note: the following seems required for asan (otherwise `mimalloc-test-stress` fails)
  #ifdef MI_TRACK_ASAN
  if (os_is_zero) { mi_track_mem_defined(start,csize); }
             else { mi_track_mem_undefined(start,csize); }
  #endif
  mi_subproc_stat_increase(subproc, committed, stat_size);  // use size for precise commit vs. decommit
  return true;
}

bool _mi_os_commit(mi_subproc_t* subproc, void* addr, size_t size, bool* is_zero) {
  return _mi_os_commit_ex(subproc, addr, size, is_zero, size);
}

static bool mi_os_decommit_ex(mi_subproc_t* subproc, void* addr, size_t size, bool* needs_recommit, size_t stat_size) {
  mi_assert_internal(needs_recommit!=NULL);

  // page align
  size_t csize;
  void* start = mi_os_page_align_area_conservative(addr, size, &csize);
  if (csize == 0) return true;

  // decommit
  *needs_recommit = true;
  int err = _mi_prim_decommit(start,csize,needs_recommit);
  if (err != 0) {
    _mi_warning_message("cannot decommit OS memory (error: %d (0x%x), address: %p, size: 0x%zx bytes)\n", err, err, start, csize);
  }
  else if (*needs_recommit) {
    mi_subproc_stat_decrease(subproc, committed, stat_size);
  }
  mi_assert_internal(err == 0);
  return (err == 0);
}

bool _mi_os_decommit(mi_subproc_t* subproc, void* addr, size_t size) {
  bool needs_recommit;
  return mi_os_decommit_ex(subproc, addr, size, &needs_recommit, size);
}


// Signal to the OS that the address range is no longer in use
// but may be used later again. This will release physical memory
// pages and reduce swapping while keeping the memory committed.
// We page align to a conservative area inside the range to reset.
bool _mi_os_reset(mi_subproc_t* subproc, void* addr, size_t size) {
  // page align conservatively within the range
  size_t csize;
  void* start = mi_os_page_align_area_conservative(addr, size, &csize);
  if (csize == 0) return true;  // || _mi_os_is_huge_reserved(addr)
  mi_subproc_stat_counter_increase(subproc, reset, csize);
  mi_subproc_stat_counter_increase(subproc, reset_calls, 1);

  #if (MI_DEBUG>1) && !MI_SECURE && !MI_TRACK_ENABLED // && !MI_TSAN
  memset(start, 0, csize); // pretend it is eagerly reset
  #endif

  int err = _mi_prim_reset(start, csize);
  if (err != 0) {
    _mi_warning_message("cannot reset OS memory (error: %d (0x%x), address: %p, size: 0x%zx bytes)\n", err, err, start, csize);
  }
  return (err == 0);
}


void _mi_os_reuse( mi_subproc_t* subproc, void* addr, size_t size ) { 
  MI_UNUSED(subproc);
  // page align conservatively within the range
  size_t csize = 0;
  void* const start = mi_os_page_align_area_conservative(addr, size, &csize);
  if (csize == 0) return;
  const int err = _mi_prim_reuse(start, csize);
  if (err != 0) {
    _mi_warning_message("cannot reuse OS memory (error: %d (0x%x), address: %p, size: 0x%zx bytes)\n", err, err, start, csize);
  }
}

// Like the plain-decommit case of `_mi_os_purge_ex`, but also reports whether the purged range
// is guaranteed to read back zero on next use (see `_mi_prim_decommit_zero`). Never claims zero
// for a range we had to page-align away from -- the caller's exact range is what it will reuse.
bool _mi_os_purge_zero(mi_subproc_t* subproc, void* p, size_t size, size_t stat_size, bool* is_zero) {
  *is_zero = false;
  if (mi_option_get(mi_option_purge_delay) < 0) return false;  // purging not allowed
  mi_subproc_stat_counter_increase(subproc, purge_calls, 1);
  mi_subproc_stat_counter_increase(subproc, purged, size);

  size_t csize;
  void* const start = mi_os_page_align_area_conservative(p, size, &csize);
  if (csize == 0) return false;

  bool needs_recommit = true;   // on error the primitive leaves this true: assume decommitted
  bool zero = false;
  const int err = _mi_prim_decommit_zero(start, csize, &needs_recommit, &zero);
  if (err != 0) {
    _mi_warning_message("cannot purge OS memory (error: %d (0x%x), address: %p, size: 0x%zx bytes)\n", err, err, start, csize);
    // Do NOT swallow `needs_recommit` here: the range may have been made inaccessible even
    // though the call reported an error (`_mi_prim_decommit` mprotects on the debug path).
    // Returning false would leave the arena believing those slices are still committed, and
    // the next allocation from them would fault. `*is_zero` stays false.
    return needs_recommit;
  }
  // only the exact range was zeroed; a conservatively page-aligned subrange leaves the edges untouched
  if (zero && start == p && csize == size) { *is_zero = true; }
  if (needs_recommit) { mi_subproc_stat_decrease(subproc, committed, stat_size); }
  return needs_recommit;
}

// either resets or decommits memory, returns true if the memory needs
// to be recommitted if it is to be re-used later on.
bool _mi_os_purge_ex(mi_subproc_t* subproc, void* p, size_t size, bool allow_reset, size_t stat_size, mi_commit_fun_t* commit_fun, void* commit_fun_arg)
{
  if (mi_option_get(mi_option_purge_delay) < 0) return false;  // is purging allowed?
  mi_subproc_stat_counter_increase(subproc, purge_calls, 1);
  mi_subproc_stat_counter_increase(subproc, purged, size);

  if (commit_fun != NULL) {
    bool decommitted = (*commit_fun)(false, p, size, NULL, commit_fun_arg);
    return decommitted; // needs_recommit?
  }
  else if (mi_option_is_enabled(mi_option_purge_decommits) &&   // should decommit?
           !_mi_preloading())                                   // don't decommit during preloading (unsafe)
  {
    bool needs_recommit = true;
    mi_os_decommit_ex(subproc, p, size, &needs_recommit, stat_size);
    return needs_recommit;
  }
  else {
    if (allow_reset) {  // this can sometimes be not allowed if the range is not fully committed (on Windows, we cannot reset uncommitted memory)
      _mi_os_reset(subproc, p, size);
    }
    return false;  // needs no recommit
  }
}

// either resets or decommits memory, returns true if the memory needs
// to be recommitted if it is to be re-used later on.
bool _mi_os_purge(mi_subproc_t* subproc, void* p, size_t size) {
  return _mi_os_purge_ex(subproc, p, size, true, size, NULL, NULL);
}

// Release the physical memory of a *committed* range while keeping that range
// committed and accessible: the next access demand-faults a fresh page.
// Unlike `_mi_os_purge`, this NEVER decommits -- whatever `purge_decommits`
// says -- since commit is tracked per arena slice and cannot represent a
// sub-slice hole (see the hole purging section in `page.c`).
// Returns `true` if (and only if) the physical memory was actually released.
bool _mi_os_discard(mi_subproc_t* subproc, void* addr, size_t size) {
  #if !MI_PRIM_HAS_DISCARD
  MI_UNUSED(subproc); MI_UNUSED(addr); MI_UNUSED(size);
  return false;   // `_mi_prim_discard` is a no-op here: nothing is released, so nothing is counted
  #else
  // page align conservatively *within* the range: never touch a partially covered OS page
  size_t csize = 0;
  void* const start = mi_os_page_align_area_conservative(addr, size, &csize);
  if (csize == 0) return false;

  #if !MI_TRACK_ENABLED
  // Pretend the discard is eager (as `_mi_os_reset` does): on macOS MADV_FREE_REUSABLE
  // keeps the data until the pages are actually reclaimed, so without this a range that
  // wrongly overlaps a *live* block goes unnoticed. Always on in a debug build; the tests
  // force it on with `purge_holes_eager_zero` so they are not vacuous in a release build.
  #if (MI_DEBUG>1) && !MI_SECURE
  const bool eager_zero = true;
  #else
  const bool eager_zero = mi_option_is_enabled(mi_option_purge_holes_eager_zero);
  #endif
  if (eager_zero) { _mi_memzero(start, csize); }
  #endif

  const int err = _mi_prim_discard(start, csize);
  if (err != 0) {
    _mi_warning_message("cannot discard OS memory (error: %d (0x%x), address: %p, size: 0x%zx bytes)\n", err, err, start, csize);
    return false;
  }
  // count only what was actually discarded
  mi_subproc_stat_counter_increase(subproc, purge_calls, 1);
  mi_subproc_stat_counter_increase(subproc, purged, csize);
  return true;
  #endif
}


// Protect a region in memory to be not accessible.
static  bool mi_os_protectx(void* addr, size_t size, bool protect) {
  // page align conservatively within the range
  size_t csize = 0;
  void* start = mi_os_page_align_area_conservative(addr, size, &csize);
  if (csize == 0) return false;
  /*
  if (_mi_os_is_huge_reserved(addr)) {
	  _mi_warning_message("cannot mprotect memory allocated in huge OS pages\n");
  }
  */
  int err = _mi_prim_protect(start,csize,protect);
  if (err != 0) {
    _mi_warning_message("cannot %s OS memory (error: %d (0x%x), address: %p, size: 0x%zx bytes)\n", (protect ? "protect" : "unprotect"), err, err, start, csize);
  }
  return (err == 0);
}

bool _mi_os_protect(void* addr, size_t size) {
  return mi_os_protectx(addr, size, true);
}

bool _mi_os_unprotect(void* addr, size_t size) {
  return mi_os_protectx(addr, size, false);
}



/* ----------------------------------------------------------------------------
Support for allocating huge OS pages (1Gib) that are reserved up-front
and possibly associated with a specific NUMA node. (use `numa_node>=0`)
-----------------------------------------------------------------------------*/
#define MI_HUGE_OS_PAGE_SIZE  (MI_GiB)


#if (MI_INTPTR_SIZE >= 8)
// To ensure proper alignment, use our own area for huge OS pages
static mi_decl_cache_align _Atomic(uintptr_t)  mi_huge_start; // = 0

// Claim an aligned address range for huge pages
static uint8_t* mi_os_claim_huge_pages(size_t pages, size_t* total_size) {
  if (total_size != NULL) *total_size = 0;
  const size_t size = pages * MI_HUGE_OS_PAGE_SIZE;

  uintptr_t start = 0;
  uintptr_t end = 0;
  uintptr_t huge_start = mi_atomic_load_relaxed(&mi_huge_start);
  do {
    start = huge_start;
    if (start == 0) {
      // Initialize the start address after the 32TiB area
      start = ((uintptr_t)8 << 40);   // 8TiB virtual start address
      #if (MI_SECURE>0 || MI_DEBUG==0)  // security: randomize start of huge pages unless in debug mode
      mi_theap_t* const theap = _mi_theap_default();     // don't use `mi_theap_get_default()` as that can cause allocation recursively (issue #1267)
      if (mi_theap_is_initialized(theap)) {              // todo: or no hint at all if we lack randomness?
        const uintptr_t r = _mi_theap_random_next(theap);
        start = start + ((uintptr_t)MI_HUGE_OS_PAGE_SIZE * ((r>>17) & 0x0FFF));  // (randomly 12bits)*1GiB == between 0 to 4TiB
      }
      else {
        _mi_warning_message("failed to randomize the start address of huge pages allocation (%zu bytes at %p)", size, (void*)start);
      }
      #endif
    }
    end = start + size;
  } while (!mi_atomic_cas_weak_acq_rel(&mi_huge_start, &huge_start, end));

  if (total_size != NULL) *total_size = size;
  return (uint8_t*)start;
}
#else
static uint8_t* mi_os_claim_huge_pages(size_t pages, size_t* total_size) {
  MI_UNUSED(pages);
  if (total_size != NULL) *total_size = 0;
  return NULL;
}
#endif

// Allocate MI_ARENA_SLICE_ALIGN aligned huge pages
void* _mi_os_alloc_huge_os_pages(mi_subproc_t* subproc, size_t pages, int numa_node, mi_msecs_t max_msecs, size_t* pages_reserved, size_t* psize, mi_memid_t* memid) {
  *memid = _mi_memid_none();
  if (psize != NULL) *psize = 0;
  if (pages_reserved != NULL) *pages_reserved = 0;
  size_t size = 0;
  uint8_t* const start = mi_os_claim_huge_pages(pages, &size);
  if (start == NULL) return NULL; // or 32-bit systems

  // Allocate one page at the time but try to place them contiguously
  // We allocate one page at the time to be able to abort if it takes too long
  // or to at least allocate as many as available on the system.
  mi_msecs_t start_t = _mi_clock_start();
  size_t page = 0;
  bool all_zero = true;
  while (page < pages) {
    // allocate a page
    bool is_zero = false;
    void* addr = start + (page * MI_HUGE_OS_PAGE_SIZE);
    void* p = NULL;
    int err = _mi_prim_alloc_huge_os_pages(addr, MI_HUGE_OS_PAGE_SIZE, numa_node, &is_zero, &p);
    if (!is_zero) { all_zero = false;  }
    if (err != 0) {
      _mi_warning_message("unable to allocate huge OS page (error: %d (0x%x), address: %p, size: %zx bytes)\n", err, err, addr, MI_HUGE_OS_PAGE_SIZE);
      break;
    }

    // Did we succeed at a contiguous address?
    if (p != addr) {
      // no success, issue a warning and break
      if (p != NULL) {
        _mi_warning_message("could not allocate contiguous huge OS page %zu at %p\n", page, addr);
        mi_os_prim_free(subproc, p, MI_HUGE_OS_PAGE_SIZE, MI_HUGE_OS_PAGE_SIZE);
      }
      break;
    }

    // success, record it
    page++;  // increase before timeout check (see issue #711)
    mi_subproc_stat_increase(subproc, committed, MI_HUGE_OS_PAGE_SIZE);
    mi_subproc_stat_increase(subproc, reserved, MI_HUGE_OS_PAGE_SIZE);

    // check for timeout
    if (max_msecs > 0) {
      mi_msecs_t elapsed = _mi_clock_end(start_t);
      if (page >= 1) {
        mi_msecs_t estimate = ((elapsed / (page+1)) * pages);
        if (estimate > 2*max_msecs) { // seems like we are going to timeout, break
          elapsed = max_msecs + 1;
        }
      }
      if (elapsed > max_msecs) {
        _mi_warning_message("huge OS page allocation timed out (after allocating %zu page(s))\n", page);
        break;
      }
    }
  }
  const size_t allocated = page * MI_HUGE_OS_PAGE_SIZE;
  mi_assert_internal(allocated <= size);
  if (pages_reserved != NULL) { *pages_reserved = page; }
  if (psize != NULL) { *psize = allocated; }
  if (page != 0) {
    mi_assert(start != NULL);
    *memid = _mi_memid_create_os(start, allocated, true /* is committed */, all_zero, true /* is_large */);
    memid->memkind = MI_MEM_OS_HUGE;
    mi_assert(memid->is_pinned);
    #ifdef MI_TRACK_ASAN
    if (all_zero) { mi_track_mem_defined(start,allocated); }
    #endif
  }
  return (page == 0 ? NULL : start);
}

// free every huge page in a range individually (as we allocated per page)
// note: needed with VirtualAlloc but could potentially be done in one go on mmap'd systems.
static void mi_os_free_huge_os_pages(mi_subproc_t* subproc, void* p, size_t size) {
  if (p==NULL || size==0) return;
  uint8_t* base = (uint8_t*)p;
  while (size >= MI_HUGE_OS_PAGE_SIZE) {
    mi_os_prim_free(subproc, base, MI_HUGE_OS_PAGE_SIZE, MI_HUGE_OS_PAGE_SIZE);
    size -= MI_HUGE_OS_PAGE_SIZE;
    base += MI_HUGE_OS_PAGE_SIZE;
  }
}


/* ----------------------------------------------------------------------------
Support NUMA aware allocation
-----------------------------------------------------------------------------*/

static _Atomic(size_t) mi_numa_node_count; // = 0   // cache the node count

int _mi_os_numa_node_count(void) {
  size_t count = mi_atomic_load_acquire(&mi_numa_node_count);
  if mi_unlikely(count == 0) {
    long ncount = mi_option_get(mi_option_use_numa_nodes); // given explicitly?
    if (ncount > 0 && ncount < INT_MAX) {
      count = (size_t)ncount;
    }
    else {
      const size_t n = _mi_prim_numa_node_count(); // or detect dynamically
      if (n == 0 || n > INT_MAX) { count = 1; }
                            else { count = n; }
    }
    mi_atomic_store_release(&mi_numa_node_count, count); // save it
    if (count>1) { _mi_verbose_message("using %zd numa regions\n", count); }
  }
  mi_assert_internal(count > 0 && count <= INT_MAX);
  return (int)count;
}

static int mi_os_numa_node_get(void) {
  int numa_count = _mi_os_numa_node_count();
  if (numa_count<=1) return 0; // optimize on single numa node systems: always node 0
  // never more than the node count and >= 0
  const size_t n = _mi_prim_numa_node();
  int numa_node = (n < INT_MAX ? (int)n : 0);
  if (numa_node >= numa_count) { numa_node = numa_node % numa_count; }
  return numa_node;
}

int _mi_os_numa_node(void) {
  if mi_likely(mi_atomic_load_relaxed(&mi_numa_node_count) == 1) {
    return 0;
  }
  else {
    return mi_os_numa_node_get();
  }
}


/* ----------------------------------------------------------------------------
  Public API
-----------------------------------------------------------------------------*/
#if 0
mi_decl_export void* mi_os_alloc(size_t size, bool commit, size_t* full_size) {
  return mi_os_alloc_aligned(size, mi_os_mem_config.alloc_granularity, commit, NULL, full_size);
}

static void* mi_os_alloc_aligned_ex(size_t size, size_t alignment, bool commit, bool allow_large, bool* is_committed, bool* is_pinned, void** base, size_t* full_size) {
  mi_memid_t memid = _mi_memid_none();
  void* p = _mi_os_alloc_aligned(size, alignment, commit, allow_large, &memid);
  if (p == NULL) return p;
  if (is_committed != NULL) { *is_committed = memid.initially_committed;  }
  if (is_pinned != NULL) { *is_pinned = memid.is_pinned;  }
  if (base != NULL) { *base = memid.mem.os.base;  }
  if (full_size != NULL) { *full_size = memid.mem.os.size;  }
  if (!memid.initially_zero && memid.initially_committed) {
    _mi_memzero_aligned(memid.mem.os.base, memid.mem.os.size);
  }
  return p;
}

mi_decl_export void* mi_os_alloc_aligned(size_t size, size_t alignment, bool commit, void** base, size_t* full_size) {
  return mi_os_alloc_aligned_ex(size, alignment, commit, false, NULL, NULL, base, full_size);
}

mi_decl_export void* mi_os_alloc_aligned_allow_large(size_t size, size_t alignment, bool commit, bool* is_committed, bool* is_pinned, void** base, size_t* full_size) {
  return mi_os_alloc_aligned_ex(size, alignment, commit, true, is_committed, is_pinned, base, full_size);
}

mi_decl_export void  mi_os_free(void* p, size_t size) {
  if (p==NULL || size == 0) return;
  mi_memid_t memid = _mi_memid_create_os(p, size, true, false, false);
  _mi_os_free(p, size, memid);
}

mi_decl_export void  mi_os_commit(void* p, size_t size) {
  _mi_os_commit(p, size, NULL);
}

mi_decl_export void  mi_os_decommit(void* p, size_t size) {
  _mi_os_decommit(p, size);
}
#endif
