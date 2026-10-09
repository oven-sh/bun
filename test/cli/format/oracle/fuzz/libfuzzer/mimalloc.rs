//! mimalloc's functions on top of `malloc`, one block of `malloc` for each block that is asked for,
//! also for the blocks of a heap: AddressSanitizer sees where each of them ends, and that it is
//! gone once its heap is destroyed. In Bun a heap is an arena whose blocks lie side by side.

use core::ffi::c_void;
use core::ptr::null_mut;

#[repr(C)]
struct Header {
    previous: *mut Header,
    next: *mut Header,
    /// Null for a block that is in no heap.
    heap: *mut Heap,
    /// What `malloc` returned.
    base: *mut c_void,
    size: usize,
    unused: usize,
}

const HEADER: usize = core::mem::size_of::<Header>();

struct Heap {
    first: *mut Header,
}

fn main_heap() -> *mut Heap {
    core::ptr::without_provenance_mut(8)
}

unsafe fn allocate(heap: *mut Heap, size: usize, align: usize, zero: bool) -> *mut c_void {
    let align = align.max(16);
    let before = HEADER.next_multiple_of(align);
    let mut base = null_mut();
    // SAFETY: `align` is a power of two and a multiple of the size of a pointer.
    if unsafe { libc::posix_memalign(&raw mut base, align, before + size) } != 0 {
        return null_mut();
    }
    let heap = if heap == main_heap() { null_mut() } else { heap };
    // SAFETY: `before + size` bytes were allocated, and a heap is used by the thread that made it.
    unsafe {
        let block = base.byte_add(before);
        if zero {
            core::ptr::write_bytes(block.cast::<u8>(), 0, size);
        }
        let header = block.cast::<Header>().sub(1);
        let next = if heap.is_null() { null_mut() } else { (*heap).first };
        header.write(Header { previous: null_mut(), next, heap, base, size, unused: 0 });
        if !next.is_null() {
            (*next).previous = header;
        }
        if !heap.is_null() {
            (*heap).first = header;
        }
        block
    }
}

unsafe fn release(block: *mut c_void) {
    if block.is_null() {
        return;
    }
    // SAFETY: every block has a header before it, and the blocks of a heap are in its list.
    unsafe {
        let header = block.cast::<Header>().sub(1);
        let Header { previous, next, heap, base, .. } = header.read();
        if !next.is_null() {
            (*next).previous = previous;
        }
        if !previous.is_null() {
            (*previous).next = next;
        } else if !heap.is_null() {
            (*heap).first = next;
        }
        libc::free(base);
    }
}

#[unsafe(no_mangle)]
extern "C" fn mi_heap_new() -> *mut c_void {
    Box::into_raw(Box::new(Heap { first: null_mut() })).cast()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_destroy(heap: *mut c_void) {
    // SAFETY: made by `mi_heap_new`. The list has the blocks that are not freed yet.
    unsafe {
        let heap = Box::from_raw(heap.cast::<Heap>());
        let mut at = heap.first;
        while !at.is_null() {
            let Header { next, base, .. } = at.read();
            libc::free(base);
            at = next;
        }
    }
}
#[unsafe(no_mangle)]
extern "C" fn mi_heap_main() -> *mut c_void {
    main_heap().cast()
}
#[unsafe(no_mangle)]
extern "C" fn mi_collect(_force: bool) {}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_malloc(heap: *mut c_void, size: usize) -> *mut c_void {
    // SAFETY: `heap` is one of these heaps, as mimalloc requires.
    unsafe { allocate(heap.cast(), size, 16, false) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_zalloc(heap: *mut c_void, size: usize) -> *mut c_void {
    // SAFETY: `heap` is one of these heaps, as mimalloc requires.
    unsafe { allocate(heap.cast(), size, 16, true) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_malloc_aligned(heap: *mut c_void, size: usize, align: usize) -> *mut c_void {
    // SAFETY: `heap` is one of these heaps, as mimalloc requires.
    unsafe { allocate(heap.cast(), size, align, false) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_zalloc_aligned(heap: *mut c_void, size: usize, align: usize) -> *mut c_void {
    // SAFETY: `heap` is one of these heaps, as mimalloc requires.
    unsafe { allocate(heap.cast(), size, align, true) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_heap_realloc_aligned(
    heap: *mut c_void,
    block: *mut c_void,
    size: usize,
    align: usize,
) -> *mut c_void {
    // SAFETY: `heap` is one of these heaps and `block` null or one of these blocks, as mimalloc requires.
    unsafe {
        let new = allocate(heap.cast(), size, align, false);
        if !block.is_null() && !new.is_null() {
            let old = (*block.cast::<Header>().sub(1)).size;
            core::ptr::copy_nonoverlapping(block.cast::<u8>(), new.cast::<u8>(), old.min(size));
            release(block);
        }
        new
    }
}
#[unsafe(no_mangle)]
extern "C" fn mi_malloc(size: usize) -> *mut c_void {
    // SAFETY: no heap.
    unsafe { allocate(null_mut(), size, 16, false) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_zalloc(size: usize) -> *mut c_void {
    // SAFETY: no heap.
    unsafe { allocate(null_mut(), size, 16, true) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_malloc_aligned(size: usize, align: usize) -> *mut c_void {
    // SAFETY: no heap.
    unsafe { allocate(null_mut(), size, align, false) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_zalloc_aligned(size: usize, align: usize) -> *mut c_void {
    // SAFETY: no heap.
    unsafe { allocate(null_mut(), size, align, true) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_realloc(block: *mut c_void, size: usize) -> *mut c_void {
    // SAFETY: no heap, and `block` is null or one of these blocks, as mimalloc requires.
    unsafe { mi_heap_realloc_aligned(null_mut(), block, size, 16) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free(block: *mut c_void) {
    // SAFETY: null or one of these blocks, as mimalloc requires.
    unsafe { release(block) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free_size(block: *mut c_void, _size: usize) {
    // SAFETY: null or one of these blocks, as mimalloc requires.
    unsafe { release(block) }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_free_size_aligned(block: *mut c_void, _size: usize, _align: usize) {
    // SAFETY: null or one of these blocks, as mimalloc requires.
    unsafe { release(block) }
}
#[unsafe(no_mangle)]
extern "C" fn mi_expand(_block: *mut c_void, _size: usize) -> *mut c_void {
    null_mut()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_malloc_usable_size(block: *const c_void) -> usize {
    if block.is_null() {
        return 0;
    }
    // SAFETY: one of these blocks, as mimalloc requires.
    unsafe { (*block.cast::<Header>().sub(1)).size }
}
#[unsafe(no_mangle)]
extern "C" fn mi_is_in_heap_region(_block: *const c_void) -> bool {
    true
}
#[unsafe(no_mangle)]
unsafe extern "C" fn mi_process_info(
    a: *mut usize,
    b: *mut usize,
    c: *mut usize,
    d: *mut usize,
    e: *mut usize,
    f: *mut usize,
    g: *mut usize,
    h: *mut usize,
) {
    for place in [a, b, c, d, e, f, g, h] {
        if !place.is_null() {
            // SAFETY: it is not null, so the caller wants a number there.
            unsafe { *place = 0 };
        }
    }
}
#[unsafe(no_mangle)]
extern "C" fn mi_thread_set_in_threadpool() {}
#[unsafe(no_mangle)]
extern "C" fn mi_on_thread_idle() {}
#[unsafe(no_mangle)]
extern "C" fn mi_on_thread_idle_start() -> bool {
    false
}
#[unsafe(no_mangle)]
extern "C" fn mi_on_thread_idle_end() {}
