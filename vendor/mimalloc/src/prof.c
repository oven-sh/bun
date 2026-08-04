/* ----------------------------------------------------------------------------
Copyright (c) 2026, Microsoft Research, Daan Leijen
This is free software; you can redistribute it and/or modify it under the
terms of the MIT license. A copy of the license can be found in the file
"LICENSE" at the root of this distribution.
-----------------------------------------------------------------------------*/

// Sampling heap profiler that emits pprof's profile.proto format so the
// output can be read directly by `go tool pprof`, Polar Signals, etc.
//
// Design: zero overhead on the malloc/free fast paths when profiling is
// disabled at runtime. When enabled:
//   - `theap->prof_force_slow` poisons `pages_free_direct` so every malloc
//     routes through `_mi_malloc_generic`, where the byte countdown lives.
//   - sampled blocks set `MI_PAGE_HAS_PROF_SAMPLES` on their page so frees
//     route through the existing generic-free path, which calls `_mi_prof_free`.
//
// Samples are stored in a flat array (so allocation totals survive frees) plus
// an open-addressed hash map from block address -> sample index for inuse
// tracking. Backtraces are deduplicated at dump time.

#include "mimalloc.h"
#include "mimalloc/internal.h"
#include "mimalloc/atomic.h"
#include "mimalloc/prim.h"
#include "mimalloc/prim-tls.h"

#if defined(_WIN32)
  #include <windows.h>
  #include <io.h>
  #include <fcntl.h>
  #define mi_prof_write(fd,buf,n)  _write(fd,buf,(unsigned)(n))
  #define mi_prof_open(p)          _open(p, _O_WRONLY|_O_CREAT|_O_TRUNC|_O_BINARY, 0644)
  #define mi_prof_close(fd)        _close(fd)
#else
  #include <unistd.h>
  #include <fcntl.h>
  #if defined(__linux__) || defined(__FreeBSD__)
    #include <stdio.h>
    #include <link.h>
    #include <elf.h>
  #endif
  #if defined(__APPLE__)
    #include <mach-o/dyld.h>
    #include <mach-o/loader.h>
  #endif
  #if defined(__GLIBC__) || defined(__APPLE__)
    #include <execinfo.h>   // backtrace() fallback; musl/bionic don't ship this (FP walk is primary)
  #endif
  #define mi_prof_write(fd,buf,n)  write(fd,buf,n)
  #define mi_prof_open(p)          open(p, O_WRONLY|O_CREAT|O_TRUNC, 0644)
  #define mi_prof_close(fd)        close(fd)
#endif

#define MI_PROF_MAX_FRAMES   32
#define MI_PROF_SKIP_FRAMES  1     // skip backtrace() itself; mimalloc frames are filtered by pprof via mapping

typedef struct mi_prof_sample_s {
  uintptr_t addr;      // block address (0 once freed; kept for alloc totals)
  size_t    size;      // requested size
  uint8_t   nframes;
  uintptr_t frames[MI_PROF_MAX_FRAMES];
} mi_prof_sample_t;

typedef struct mi_prof_state_s {
  mi_lock_t          lock;
  _Atomic(size_t)    rate;        // bytes per sample (0 = disabled); read in _mi_malloc_generic
  // samples (grow-only)
  mi_prof_sample_t*  samples;
  size_t             sample_count;
  size_t             sample_cap;
  // open-addressed hash: addr -> sample index+1 (0 = empty, tombstone = ~0)
  uintptr_t*         ht_keys;
  uint32_t*          ht_vals;
  size_t             ht_cap;      // power of two
  size_t             ht_used;
} mi_prof_state_t;

static mi_prof_state_t mi_prof;

// ---------------------------------------------------------------------------
// Hash table (addr -> sample index)
// ---------------------------------------------------------------------------

static inline size_t mi_prof_hash(uintptr_t k, size_t cap) {
  k ^= k >> 33; k *= 0xff51afd7ed558ccdull; k ^= k >> 33;
  return (size_t)(k & (cap - 1));
}

static void mi_prof_ht_grow(size_t want);

static void mi_prof_ht_put(uintptr_t key, uint32_t val) {
  if (mi_prof.ht_used * 4 >= mi_prof.ht_cap * 3) mi_prof_ht_grow(mi_prof.ht_cap * 2);
  size_t i = mi_prof_hash(key, mi_prof.ht_cap);
  while (mi_prof.ht_keys[i] != 0 && mi_prof.ht_keys[i] != key) {
    i = (i + 1) & (mi_prof.ht_cap - 1);
  }
  if (mi_prof.ht_keys[i] == 0) mi_prof.ht_used++;
  mi_prof.ht_keys[i] = key;
  mi_prof.ht_vals[i] = val;
}

static void mi_prof_ht_grow(size_t want) {
  size_t old_cap = mi_prof.ht_cap;
  uintptr_t* old_keys = mi_prof.ht_keys;
  uint32_t*  old_vals = mi_prof.ht_vals;
  size_t cap = (want < 1024 ? 1024 : want);
  // use OS memory directly so we don't recurse into mimalloc
  mi_memid_t memid;
  uintptr_t* nk = (uintptr_t*)_mi_os_zalloc(_mi_subproc_main(), cap * (sizeof(uintptr_t) + sizeof(uint32_t)), &memid);
  if (nk == NULL) return;
  mi_prof.ht_keys = nk;
  mi_prof.ht_vals = (uint32_t*)(nk + cap);
  mi_prof.ht_cap  = cap;
  mi_prof.ht_used = 0;
  for (size_t i = 0; i < old_cap; i++) {
    if (old_keys[i] != 0 && old_keys[i] != (uintptr_t)~0ull) {
      mi_prof_ht_put(old_keys[i], old_vals[i]);
    }
  }
  // leak old table (process-lifetime; freed at exit by OS)
  MI_UNUSED(old_keys); MI_UNUSED(old_vals);
}

static bool mi_prof_ht_remove(uintptr_t key, uint32_t* out_val) {
  if (mi_prof.ht_cap == 0) return false;
  size_t i = mi_prof_hash(key, mi_prof.ht_cap);
  while (mi_prof.ht_keys[i] != 0) {
    if (mi_prof.ht_keys[i] == key) {
      if (out_val) *out_val = mi_prof.ht_vals[i];
      mi_prof.ht_keys[i] = (uintptr_t)~0ull;  // tombstone
      return true;
    }
    i = (i + 1) & (mi_prof.ht_cap - 1);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Sample storage
// ---------------------------------------------------------------------------

static mi_prof_sample_t* mi_prof_samples_push(void) {
  if (mi_prof.sample_count == mi_prof.sample_cap) {
    size_t ncap = (mi_prof.sample_cap == 0 ? 1024 : mi_prof.sample_cap * 2);
    mi_memid_t memid;
    mi_prof_sample_t* ns = (mi_prof_sample_t*)_mi_os_zalloc(_mi_subproc_main(), ncap * sizeof(mi_prof_sample_t), &memid);
    if (ns == NULL) return NULL;
    if (mi_prof.samples != NULL) {
      _mi_memcpy(ns, mi_prof.samples, mi_prof.sample_count * sizeof(mi_prof_sample_t));
    }
    mi_prof.samples = ns;
    mi_prof.sample_cap = ncap;
  }
  return &mi_prof.samples[mi_prof.sample_count++];
}

// ---------------------------------------------------------------------------
// Backtrace
// ---------------------------------------------------------------------------

static uint8_t mi_prof_backtrace(uintptr_t* frames) {
  #if defined(_WIN32)
    void* stack[MI_PROF_MAX_FRAMES + MI_PROF_SKIP_FRAMES];
    USHORT n = RtlCaptureStackBackTrace(MI_PROF_SKIP_FRAMES, MI_PROF_MAX_FRAMES, stack, NULL);
    for (USHORT i = 0; i < n; i++) frames[i] = (uintptr_t)stack[i];
    return (uint8_t)n;
  #else
    // Frame-pointer walk. Works on stripped binaries without .eh_frame as long
    // as the program is built with -fno-omit-frame-pointer (Bun does; macOS arm64
    // mandates it by ABI). ~10x faster than _Unwind_Backtrace.
    // Layout (SysV x86_64 / AAPCS64): fp[0] = prev_fp, fp[1] = return_addr.
    uintptr_t* fp = (uintptr_t*)__builtin_frame_address(0);
    uintptr_t lo = (uintptr_t)fp;
    uintptr_t hi = lo + (8 * 1024 * 1024);  // conservative upper bound on remaining stack
    uint8_t n = 0, skip = MI_PROF_SKIP_FRAMES;
    while (fp != NULL && (uintptr_t)fp >= lo && (uintptr_t)fp < hi
           && ((uintptr_t)fp & (sizeof(void*)-1)) == 0
           && n < MI_PROF_MAX_FRAMES)
    {
      uintptr_t ret = fp[1];
      uintptr_t* prev = (uintptr_t*)fp[0];
      if (ret == 0) break;
      if (skip > 0) { skip--; }
      else { frames[n++] = ret; }
      if (prev <= fp) break;  // not strictly ascending -> end of chain or corrupt
      fp = prev;
    }
    #if defined(__GLIBC__) || defined(__APPLE__)
    // Fallback if FP chain yielded nothing (caller compiled with -fomit-frame-pointer):
    // try DWARF/compact-unwind. Harmless if .eh_frame is stripped (returns ~0).
    if (n == 0) {
      void* stack[MI_PROF_MAX_FRAMES + MI_PROF_SKIP_FRAMES];
      int bn = backtrace(stack, MI_PROF_MAX_FRAMES + MI_PROF_SKIP_FRAMES);
      int sk = (bn > MI_PROF_SKIP_FRAMES ? MI_PROF_SKIP_FRAMES : 0);
      for (int i = sk; i < bn && n < MI_PROF_MAX_FRAMES; i++) frames[n++] = (uintptr_t)stack[i];
    }
    #endif
    return n;
  #endif
}

// ---------------------------------------------------------------------------
// Geometric next-sample interval (so sampling is bytes-unbiased).
// Approximation of -ln(U)*rate using integer math; close enough for profiling.
// ---------------------------------------------------------------------------

static intptr_t mi_prof_next_countdown(mi_theap_t* theap) {
  MI_UNUSED(theap);
  if (mi_prof.rate == 0) return 0;
  // Fixed rate. (Go/jemalloc use a geometric draw to avoid bias with periodic
  // allocation patterns; can be added later. Fixed rate is unbiased for
  // typical workloads and keeps the math simple.)
  return (intptr_t)mi_prof.rate;
}

// ---------------------------------------------------------------------------
// Hooks called from page.c / free.c
// ---------------------------------------------------------------------------

void _mi_prof_sample(mi_theap_t* theap, mi_page_t* page, void* p, size_t req_size) {
  // reset countdown first so re-entrancy can't loop
  theap->prof_countdown = mi_prof_next_countdown(theap);
  if (p == NULL || mi_prof.rate == 0) return;

  uintptr_t frames[MI_PROF_MAX_FRAMES];
  uint8_t n = mi_prof_backtrace(frames);

  mi_lock(&mi_prof.lock) {
    mi_prof_sample_t* s = mi_prof_samples_push();
    if (s == NULL) return;
    s->addr = (uintptr_t)p;
    s->size = req_size;
    s->nframes = n;
    for (uint8_t i = 0; i < n; i++) s->frames[i] = frames[i];
    mi_prof_ht_put((uintptr_t)p, (uint32_t)(mi_prof.sample_count - 1) + 1);
  }
  // mark the page so frees on it route through the generic path
  mi_atomic_or_relaxed(&page->xthread_id, (mi_threadid_t)MI_PAGE_HAS_PROF_SAMPLES);
}

void _mi_prof_free(const void* p) {
  uint32_t idx1;
  mi_lock(&mi_prof.lock) {
    if (mi_prof_ht_remove((uintptr_t)p, &idx1)) {
      mi_prof.samples[idx1 - 1].addr = 0;  // mark not-inuse; keep for alloc totals
    }
  }
}

// ---------------------------------------------------------------------------
// Enable / theap init
// ---------------------------------------------------------------------------

static void mi_prof_set_theap(mi_theap_t* theap, bool on) {
  theap->prof_force_slow = on;
  theap->prof_countdown  = (on ? mi_prof_next_countdown(theap) : 0);
  // poison/restore pages_free_direct
  for (size_t i = 0; i < MI_PAGES_DIRECT; i++) {
    theap->pages_free_direct[i] = (mi_page_t*)&_mi_page_empty;
  }
  // (when turning off, the slots refill lazily via mi_theap_queue_first_update)
}

void _mi_prof_theap_init(mi_theap_t* theap) {
  if (mi_atomic_load_relaxed(&mi_prof.rate) > 0) mi_prof_set_theap(theap, true);
}

// Called from _mi_malloc_generic when the global rate is on but this theap
// hasn't been enabled yet (e.g., another thread called mi_prof_enable).
void _mi_prof_theap_lazy_enable(mi_theap_t* theap) {
  if (theap->prof_countdown == 0 && mi_atomic_load_relaxed(&mi_prof.rate) > 0) {
    mi_prof_set_theap(theap, true);
  }
}

// Read by _mi_malloc_generic's hot-path gate.
size_t _mi_prof_rate(void) {
  return mi_atomic_load_relaxed(&mi_prof.rate);
}

// Walk every theap in the process (all subprocs -> heaps -> theaps) and toggle.
// Writes to other threads' theap fields are aligned word stores; the worst case
// is a few fast-path allocs slip through before the target thread observes the
// poisoned slot, after which queue_first_update keeps it poisoned.
static void mi_prof_set_all_theaps(bool on) {
  mi_subproc_t* sp = _mi_subproc_main();
  for (; sp != NULL; sp = sp->next) {
    mi_lock(&sp->heaps_lock) {
      for (mi_heap_t* h = sp->heaps; h != NULL; h = h->next) {
        mi_lock(&h->theaps_lock) {
          for (mi_theap_t* t = h->theaps; t != NULL; t = t->hnext) {
            mi_prof_set_theap(t, on);
          }
        }
      }
    }
  }
}

void _mi_prof_init(void) {
  long rate = mi_option_get(mi_option_prof_sample_rate);
  if (rate <= 0) return;
  mi_lock_init(&mi_prof.lock);
  mi_atomic_store_release(&mi_prof.rate, (size_t)rate);
  mi_prof_ht_grow(1024);
  mi_prof_set_all_theaps(true);
}

// Visit live sampled allocations (addr != 0). Callback returns false to stop.
#ifdef __cplusplus
extern "C"
#endif
mi_decl_export void mi_prof_visit_live(bool (*cb)(uintptr_t addr, size_t size, const uintptr_t* frames, uint8_t nframes, void* arg), void* arg) {
  mi_lock_acquire(&mi_prof.lock);
  for (size_t i = 0; i < mi_prof.sample_count; i++) {
    mi_prof_sample_t* smp = &mi_prof.samples[i];
    if (smp->addr == 0) continue;
    if (!cb(smp->addr, smp->size, smp->frames, smp->nframes, arg)) break;
  }
  mi_lock_release(&mi_prof.lock);
}

void mi_prof_reset(void) mi_attr_noexcept {
  if (mi_prof.ht_cap == 0) return;  // never initialized
  mi_lock(&mi_prof.lock) {
    mi_prof.sample_count = 0;
    _mi_memzero(mi_prof.ht_keys, mi_prof.ht_cap * sizeof(uintptr_t));
    mi_prof.ht_used = 0;
    // note: pages with MI_PAGE_HAS_PROF_SAMPLES keep the flag (frees still
    // route to slow path) but the hash lookup misses harmlessly. The flag
    // clears naturally on page re-init.
  }
}

void mi_prof_enable(size_t sample_rate_bytes) mi_attr_noexcept {
  if (sample_rate_bytes == 0) {
    mi_atomic_store_release(&mi_prof.rate, 0);
    mi_prof_set_all_theaps(false);
    return;
  }
  if (mi_atomic_load_relaxed(&mi_prof.rate) == 0) mi_lock_init(&mi_prof.lock);
  mi_atomic_store_release(&mi_prof.rate, sample_rate_bytes);
  if (mi_prof.ht_cap == 0) mi_prof_ht_grow(1024);
  mi_prof_set_all_theaps(true);
}

// ---------------------------------------------------------------------------
// profile.proto writer
// (https://github.com/google/pprof/blob/main/proto/profile.proto)
// All integers are varint; submessages are length-delimited (wire type 2).
// ---------------------------------------------------------------------------

typedef struct mi_pb_s {
  int      fd;       // -1 -> write to out_buf instead
  bool     err;
  uint8_t* out_buf;  // user buffer (NULL -> count only)
  size_t   out_cap;
  size_t   total;    // total bytes produced (regardless of cap)
  size_t   pos;
  uint8_t  buf[16*1024];
} mi_pb_t;

static void pb_flush(mi_pb_t* w) {
  if (w->err || w->pos == 0) return;
  if (w->fd >= 0) {
    if (mi_prof_write(w->fd, w->buf, w->pos) != (long)w->pos) w->err = true;
  }
  else if (w->out_buf != NULL) {
    if (w->total < w->out_cap) {
      size_t take = w->out_cap - w->total; if (take > w->pos) take = w->pos;
      _mi_memcpy(w->out_buf + w->total, w->buf, take);
    }
  }
  w->total += w->pos;
  w->pos = 0;
}
static void pb_raw(mi_pb_t* w, const void* p, size_t n) {
  const uint8_t* s = (const uint8_t*)p;
  while (n > 0) {
    if (w->pos == sizeof(w->buf)) pb_flush(w);
    size_t take = sizeof(w->buf) - w->pos; if (take > n) take = n;
    _mi_memcpy(w->buf + w->pos, s, take); w->pos += take; s += take; n -= take;
  }
}
static void pb_varint(mi_pb_t* w, uint64_t v) {
  uint8_t tmp[10]; size_t i = 0;
  while (v >= 0x80) { tmp[i++] = (uint8_t)(v | 0x80); v >>= 7; }
  tmp[i++] = (uint8_t)v;
  pb_raw(w, tmp, i);
}
static size_t pb_varint_len(uint64_t v) { size_t n=1; while(v>=0x80){n++;v>>=7;} return n; }
static void pb_tag(mi_pb_t* w, uint32_t field, uint32_t wt) { pb_varint(w, (uint64_t)((field<<3)|wt)); }

// ValueType { type=1, unit=2 }
static void pb_value_type(mi_pb_t* w, uint32_t field, int64_t type_str, int64_t unit_str) {
  size_t len = pb_varint_len((1<<3)|0)+pb_varint_len((uint64_t)type_str)
             + pb_varint_len((2<<3)|0)+pb_varint_len((uint64_t)unit_str);
  pb_tag(w, field, 2); pb_varint(w, len);
  pb_tag(w, 1, 0); pb_varint(w, (uint64_t)type_str);
  pb_tag(w, 2, 0); pb_varint(w, (uint64_t)unit_str);
}

// Location { id=1, mapping_id=2, address=3 }
static void pb_location(mi_pb_t* w, uint64_t id, uint64_t mapping_id, uint64_t addr) {
  size_t len = pb_varint_len((1<<3))+pb_varint_len(id)
             + pb_varint_len((2<<3))+pb_varint_len(mapping_id)
             + pb_varint_len((3<<3))+pb_varint_len(addr);
  pb_tag(w, 4, 2); pb_varint(w, len);
  pb_tag(w, 1, 0); pb_varint(w, id);
  pb_tag(w, 2, 0); pb_varint(w, mapping_id);
  pb_tag(w, 3, 0); pb_varint(w, addr);
}

// Mapping { id=1, memory_start=2, memory_limit=3, file_offset=4, filename=5, build_id=6 }
static void pb_mapping(mi_pb_t* w, uint64_t id, uint64_t start, uint64_t end, uint64_t off, int64_t name_str, int64_t bid_str) {
  size_t len = pb_varint_len(1<<3)+pb_varint_len(id)
             + pb_varint_len(2<<3)+pb_varint_len(start)
             + pb_varint_len(3<<3)+pb_varint_len(end)
             + pb_varint_len(4<<3)+pb_varint_len(off)
             + pb_varint_len(5<<3)+pb_varint_len((uint64_t)name_str)
             + pb_varint_len(6<<3)+pb_varint_len((uint64_t)bid_str);
  pb_tag(w, 3, 2); pb_varint(w, len);
  pb_tag(w, 1, 0); pb_varint(w, id);
  pb_tag(w, 2, 0); pb_varint(w, start);
  pb_tag(w, 3, 0); pb_varint(w, end);
  pb_tag(w, 4, 0); pb_varint(w, off);
  pb_tag(w, 5, 0); pb_varint(w, (uint64_t)name_str);
  pb_tag(w, 6, 0); pb_varint(w, (uint64_t)bid_str);
}

// String table entry (field 6)
static void pb_string(mi_pb_t* w, const char* s) {
  size_t n = _mi_strlen(s);
  pb_tag(w, 6, 2); pb_varint(w, n); pb_raw(w, s, n);
}

// ---------------------------------------------------------------------------
// Sample emission: aggregate by (stack, size_bucket) for compactness.
// We emit each raw sample as its own Sample with values scaled by `rate/size`
// (the inverse sampling probability) so pprof shows correct totals.
// ---------------------------------------------------------------------------

typedef struct mi_prof_loc_s { uintptr_t addr; uint64_t id; uint64_t mapping_id; } mi_prof_loc_t;
typedef struct mi_prof_map_s { uint64_t start, end, off; const char* name; char build_id[48]; } mi_prof_map_t;

static void mi_prof_hex(char* dst, const uint8_t* src, size_t n) {
  static const char hx[] = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) { dst[2*i] = hx[src[i]>>4]; dst[2*i+1] = hx[src[i]&0xf]; }
  dst[2*n] = 0;
}

static inline size_t mi_prof_loc_find(mi_prof_loc_t* locs, size_t cap, uintptr_t a) {
  size_t h = (size_t)(a * 0x9E3779B97F4A7C15ull) & (cap - 1);
  while (locs[h].addr != 0 && locs[h].addr != a) h = (h + 1) & (cap - 1);
  return h;
}

#if defined(__linux__) || defined(__FreeBSD__)
typedef struct { mi_prof_map_t* maps; size_t* n; size_t cap; char* strbuf; size_t strcap; size_t soff; } mi_prof_dlctx_t;

static int mi_prof_dl_cb(struct dl_phdr_info* info, size_t sz, void* arg) {
  MI_UNUSED(sz);
  mi_prof_dlctx_t* c = (mi_prof_dlctx_t*)arg;
  if (*c->n >= c->cap) return 0;
  uint64_t start = 0, end = 0, off = 0;
  const uint8_t* bid = NULL; size_t bid_len = 0;
  for (int i = 0; i < info->dlpi_phnum; i++) {
    const ElfW(Phdr)* ph = &info->dlpi_phdr[i];
    if (ph->p_type == PT_LOAD && (ph->p_flags & PF_X)) {
      uint64_t s = info->dlpi_addr + ph->p_vaddr;
      if (start == 0) { start = s; off = ph->p_offset; }
      if (s + ph->p_memsz > end) end = s + ph->p_memsz;
    }
    else if (ph->p_type == PT_NOTE) {
      const uint8_t* p = (const uint8_t*)(info->dlpi_addr + ph->p_vaddr);
      const uint8_t* e = p + ph->p_memsz;
      while (p + 12 <= e) {
        uint32_t namesz = *(const uint32_t*)p, descsz = *(const uint32_t*)(p+4), type = *(const uint32_t*)(p+8);
        const uint8_t* name = p + 12; const uint8_t* desc = name + ((namesz+3)&~3u);
        if (type == 3 /*NT_GNU_BUILD_ID*/ && namesz == 4 && name[0]=='G'&&name[1]=='N'&&name[2]=='U') {
          bid = desc; bid_len = descsz; break;
        }
        p = desc + ((descsz+3)&~3u);
      }
    }
  }
  if (start == 0) return 0;
  mi_prof_map_t* m = &c->maps[(*c->n)++];
  m->start = start; m->end = end; m->off = off;
  m->build_id[0] = 0;
  if (bid != NULL && bid_len > 0 && bid_len <= 20) mi_prof_hex(m->build_id, bid, bid_len);
  const char* nm = (info->dlpi_name && info->dlpi_name[0]) ? info->dlpi_name : "";
  size_t plen = _mi_strlen(nm)+1;
  if (c->soff + plen <= c->strcap) { _mi_memcpy(c->strbuf+c->soff, nm, plen); m->name = c->strbuf+c->soff; c->soff += plen; }
  else m->name = "";
  return 0;
}
#endif

static void mi_prof_collect_mappings(mi_prof_map_t* maps, size_t* nmaps, size_t cap, char* strbuf, size_t strbuf_cap) {
  size_t n = 0;
  size_t soff = 0;
  #if defined(__linux__) || defined(__FreeBSD__)
    // dl_iterate_phdr gives us PT_LOAD + PT_NOTE for every loaded object,
    // including the main executable, so we get build-id without opening files.
    mi_prof_dlctx_t ctx = { maps, &n, cap, strbuf, strbuf_cap, 0 };
    dl_iterate_phdr(mi_prof_dl_cb, &ctx);
    soff = ctx.soff;
    // dl_iterate_phdr reports the main exe with empty name; fill from /proc/self/exe
    if (n > 0 && maps[0].name[0] == 0) {
      ssize_t r = readlink("/proc/self/exe", strbuf + soff, strbuf_cap - soff - 1);
      if (r > 0) { strbuf[soff+r] = 0; maps[0].name = strbuf+soff; soff += (size_t)r+1; }
    }
  #elif defined(__APPLE__)
    uint32_t cnt = _dyld_image_count();
    for (uint32_t i = 0; i < cnt && n < cap; i++) {
      const struct mach_header_64* mh = (const struct mach_header_64*)_dyld_get_image_header(i);
      if (mh == NULL || mh->magic != MH_MAGIC_64) continue;
      // walk load commands to find __TEXT extent and LC_UUID
      uint64_t start = (uint64_t)(uintptr_t)mh, end = start;
      uint64_t text_vmaddr = 0;   // unslid vmaddr of the executable segment
      maps[n].build_id[0] = 0;
      const struct load_command* lc = (const struct load_command*)((const uint8_t*)mh + sizeof(*mh));
      for (uint32_t c = 0; c < mh->ncmds; c++) {
        if (lc->cmd == LC_SEGMENT_64) {
          const struct segment_command_64* sc = (const struct segment_command_64*)lc;
          intptr_t slide = _dyld_get_image_vmaddr_slide(i);
          uint64_t s = sc->vmaddr + (uint64_t)slide;
          if (sc->initprot & 0x4 /* VM_PROT_EXECUTE */) {
            if (end == start) { start = s; text_vmaddr = sc->vmaddr; }
            if (s + sc->vmsize > end) end = s + sc->vmsize;
          }
        }
        else if (lc->cmd == LC_UUID) {
          const struct uuid_command* uc = (const struct uuid_command*)lc;
          mi_prof_hex(maps[n].build_id, uc->uuid, 16);
        }
        lc = (const struct load_command*)((const uint8_t*)lc + lc->cmdsize);
      }
      if (end <= start) end = start + 0x1000;
      // pprof reconstructs a file address as `addr - memory_start + file_offset`.
      // Mach-O symbols are recorded at their (unslid) vmaddr, not at an offset
      // from __TEXT, so file_offset must be that vmaddr or nothing symbolizes.
      maps[n].start = start; maps[n].end = end; maps[n].off = text_vmaddr;
      const char* nm = _dyld_get_image_name(i);
      size_t plen = _mi_strlen(nm)+1;
      if (soff + plen <= strbuf_cap) { _mi_memcpy(strbuf+soff, nm, plen); maps[n].name = strbuf+soff; soff += plen; }
      else maps[n].name = nm;
      n++;
    }
  #else
    MI_UNUSED(strbuf); MI_UNUSED(strbuf_cap); MI_UNUSED(soff);
  #endif
  *nmaps = n;
}

static uint64_t mi_prof_mapping_for(mi_prof_map_t* maps, size_t nmaps, uintptr_t addr) {
  for (size_t i = 0; i < nmaps; i++) {
    if (addr >= maps[i].start && addr < maps[i].end) return (uint64_t)(i + 1);
  }
  return 0;
}

static int mi_prof_dump_pb(mi_pb_t* wp) {
  mi_pb_t w = *wp;

  // string table (index 0 must be "")
  // 0:"" 1:alloc_objects 2:count 3:alloc_space 4:bytes 5:inuse_objects 6:inuse_space 7:space
  // 8.. : mapping filenames
  static const char* fixed_strs[] = { "", "alloc_objects","count","alloc_space","bytes","inuse_objects","inuse_space","space" };
  enum { STR_EMPTY=0, STR_ALLOC_OBJ, STR_COUNT, STR_ALLOC_SPACE, STR_BYTES, STR_INUSE_OBJ, STR_INUSE_SPACE, STR_SPACE, STR_FIXED_N };

  // collect mappings (executable regions) for symbolization
  mi_prof_map_t maps[256]; size_t nmaps = 0;
  static char map_strbuf[32*1024];
  mi_prof_collect_mappings(maps, &nmaps, 256, map_strbuf, sizeof(map_strbuf));

  // sample_type: alloc_objects/count, alloc_space/bytes, inuse_objects/count, inuse_space/bytes
  pb_value_type(&w, 1, STR_ALLOC_OBJ, STR_COUNT);
  pb_value_type(&w, 1, STR_ALLOC_SPACE, STR_BYTES);
  pb_value_type(&w, 1, STR_INUSE_OBJ, STR_COUNT);
  pb_value_type(&w, 1, STR_INUSE_SPACE, STR_BYTES);

  // We emit Locations on the fly as we see new addresses; dedup via a small
  // open-addressed table (locations are typically few — call sites).
  // To keep this simple, do two passes: pass 1 collect unique frame addrs,
  // pass 2 emit samples referencing location ids.
  // Unique-address collection:
  size_t loc_cap = 4096; while (loc_cap < mi_prof.sample_count * 8) loc_cap <<= 1;
  mi_memid_t lm;
  mi_prof_loc_t* locs = (mi_prof_loc_t*)_mi_os_zalloc(_mi_subproc_main(), loc_cap * sizeof(mi_prof_loc_t), &lm);
  size_t nlocs = 0;

  mi_lock(&mi_prof.lock) {
    for (size_t i = 0; i < mi_prof.sample_count; i++) {
      mi_prof_sample_t* s = &mi_prof.samples[i];
      for (uint8_t f = 0; f < s->nframes; f++) {
        uintptr_t a = s->frames[f]; if (a==0) continue;
        size_t h = mi_prof_loc_find(locs, loc_cap, a);
        if (locs[h].addr == 0) {
          locs[h].addr = a;
          locs[h].id = ++nlocs;
          locs[h].mapping_id = mi_prof_mapping_for(maps, nmaps, a);
        }
      }
    }

    // emit samples (field 2): location_id[] (packed), value[] (packed)
    for (size_t i = 0; i < mi_prof.sample_count; i++) {
      mi_prof_sample_t* s = &mi_prof.samples[i];
      // scale: a sample triggers after `rate` bytes of countdown, decremented by
      // block_size per alloc. So a sample of size s represents ~max(rate, s) bytes:
      //   s >= rate -> every such alloc triggers (1 sample = 1 alloc = s bytes)
      //   s <  rate -> ~rate/s allocs per sample (1 sample = rate bytes)
      uint64_t scale_bytes = (mi_prof.rate > (size_t)s->size ? (uint64_t)mi_prof.rate : (uint64_t)s->size);
      uint64_t scale_objs  = (s->size > 0 ? (scale_bytes + s->size/2) / s->size : 1);
      if (scale_objs == 0) scale_objs = 1;
      uint64_t inuse = (s->addr != 0 ? 1 : 0);
      uint64_t v[4] = { scale_objs, scale_bytes, inuse*scale_objs, inuse*scale_bytes };

      // packed location ids
      size_t loc_len = 0;
      for (uint8_t f = 0; f < s->nframes; f++) {
        size_t h = mi_prof_loc_find(locs, loc_cap, s->frames[f]); loc_len += pb_varint_len(locs[h].id);
      }
      // packed values
      size_t val_len = 0; for (int k=0;k<4;k++) val_len += pb_varint_len(v[k]);
      size_t body = pb_varint_len((1<<3)|2)+pb_varint_len(loc_len)+loc_len
                  + pb_varint_len((2<<3)|2)+pb_varint_len(val_len)+val_len;
      pb_tag(&w, 2, 2); pb_varint(&w, body);
      pb_tag(&w, 1, 2); pb_varint(&w, loc_len);
      for (uint8_t f = 0; f < s->nframes; f++) { size_t h = mi_prof_loc_find(locs, loc_cap, s->frames[f]); pb_varint(&w, locs[h].id); }
      pb_tag(&w, 2, 2); pb_varint(&w, val_len);
      for (int k=0;k<4;k++) pb_varint(&w, v[k]);
    }
  } // unlock

  // mappings (field 3) — string indices start after fixed strings
  for (size_t i = 0; i < nmaps; i++) {
    int64_t bid_str = (maps[i].build_id[0] != 0 ? (int64_t)(STR_FIXED_N + nmaps + i) : 0);
    pb_mapping(&w, (uint64_t)(i+1), maps[i].start, maps[i].end, maps[i].off, (int64_t)(STR_FIXED_N + i), bid_str);
  }

  // locations (field 4)
  for (size_t i = 0; i < loc_cap; i++) {
    if (locs[i].addr != 0) pb_location(&w, locs[i].id, locs[i].mapping_id, (uint64_t)locs[i].addr);
  }

  // string_table (field 6)
  for (size_t i = 0; i < STR_FIXED_N; i++) pb_string(&w, fixed_strs[i]);
  for (size_t i = 0; i < nmaps; i++) pb_string(&w, maps[i].name);
  for (size_t i = 0; i < nmaps; i++) pb_string(&w, maps[i].build_id);

  // period_type (field 11), period (field 12), default_sample_type (field 14)
  pb_value_type(&w, 11, STR_SPACE, STR_BYTES);
  pb_tag(&w, 12, 0); pb_varint(&w, (uint64_t)mi_prof.rate);
  pb_tag(&w, 14, 0); pb_varint(&w, STR_INUSE_SPACE);  // string-table index of the default sample type name

  pb_flush(&w);
  *wp = w;
  _mi_os_free(_mi_subproc_main(), locs, loc_cap * sizeof(mi_prof_loc_t), lm);
  return (w.err ? -1 : 0);
}

int mi_prof_dump(int fd) mi_attr_noexcept {
  if (fd < 0) return -1;
  mi_pb_t w; _mi_memzero(&w, sizeof(w)); w.fd = fd;
  return mi_prof_dump_pb(&w);
}

// Write profile.proto into `buf` (up to `cap` bytes). Returns the total
// encoded size; if the return value > cap the output is truncated (call again
// with a larger buffer). Pass buf=NULL, cap=0 to query the size.
size_t mi_prof_dump_buf(void* buf, size_t cap) mi_attr_noexcept {
  mi_pb_t w; _mi_memzero(&w, sizeof(w));
  w.fd = -1; w.out_buf = (uint8_t*)buf; w.out_cap = cap;
  mi_prof_dump_pb(&w);
  return w.total;
}

int mi_prof_dump_to_file(const char* path) mi_attr_noexcept {
  if (path == NULL) return -1;
  int fd = mi_prof_open(path);
  if (fd < 0) return -1;
  int rc = mi_prof_dump(fd);
  mi_prof_close(fd);
  return rc;
}

void _mi_prof_on_exit(void) {
  if (mi_prof.rate == 0 || mi_prof.sample_count == 0) return;
  char path[512];
  if (!_mi_getenv("MIMALLOC_PROF_PATH", path, sizeof(path))) {
    _mi_snprintf(path, sizeof(path), "mimalloc-prof.%lu.pb", (unsigned long)_mi_prim_thread_id());
  }
  if (mi_prof_dump_to_file(path) == 0) {
    _mi_message("heap profile written to %s (%zu samples; view with: go tool pprof %s)\n",
                path, mi_prof.sample_count, path);
  }
}
