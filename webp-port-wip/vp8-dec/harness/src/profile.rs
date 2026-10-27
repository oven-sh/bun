//! A sampling profiler for the harness itself: SIGPROF every 100 us of CPU time, the handler records the instruction
//! pointer. `profile.py` turns the addresses into functions and lines.
use std::ffi::{c_int, c_void};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};

const MAX: usize = 1 << 20;
static SAMPLES: [AtomicUsize; MAX] = [const { AtomicUsize::new(0) }; MAX];
static COUNT: AtomicUsize = AtomicUsize::new(0);

#[repr(C)]
struct Timeval {
    sec: i64,
    usec: i64,
}
#[repr(C)]
struct Itimerval {
    interval: Timeval,
    value: Timeval,
}
#[repr(C)]
struct Sigaction {
    handler: usize,
    mask: [u64; 16],
    flags: c_int,
    restorer: usize,
}

unsafe extern "C" {
    fn sigaction(sig: c_int, act: *const Sigaction, old: *mut Sigaction) -> c_int;
    fn setitimer(which: c_int, new: *const Itimerval, old: *mut Itimerval) -> c_int;
}

extern "C" fn on_sigprof(_sig: c_int, _info: *mut c_void, ctx: *mut c_void) {
    // x86-64 Linux: ucontext_t { flags: u64, link: *mut, stack: stack_t (24 bytes), mcontext: { gregs: [i64; 23], .. } }
    let rip = unsafe { *(ctx as *const usize).add(5 + 16) };
    let i = COUNT.fetch_add(1, Relaxed);
    if i < MAX {
        SAMPLES[i].store(rip, Relaxed);
    }
}

pub fn start() {
    let act = Sigaction { handler: on_sigprof as *const () as usize, mask: [0; 16], flags: 4 | 0x1000_0000, restorer: 0 };
    let t = || Timeval { sec: 0, usec: 100 };
    unsafe {
        assert_eq!(sigaction(27, &act, std::ptr::null_mut()), 0);
        assert_eq!(setitimer(2, &Itimerval { interval: t(), value: t() }, std::ptr::null_mut()), 0);
    }
}

/// Writes the samples as offsets into the executable.
pub fn stop(path: &str) {
    let zero = || Timeval { sec: 0, usec: 0 };
    unsafe { setitimer(2, &Itimerval { interval: zero(), value: zero() }, std::ptr::null_mut()) };
    let maps = std::fs::read_to_string("/proc/self/maps").unwrap();
    let base = usize::from_str_radix(maps.split('-').next().unwrap(), 16).unwrap();
    let n = COUNT.load(Relaxed).min(MAX);
    let out: String = (0..n).map(|i| format!("{:x}\n", SAMPLES[i].load(Relaxed).wrapping_sub(base))).collect();
    std::fs::write(path, out).unwrap();
    eprintln!("{n} samples");
}
