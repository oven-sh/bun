//! What the fuzzers share: the natives that Bun's C and C++ side provides, what the first bytes of
//! an input mean, and where a finding goes. See README.md.

#![feature(linkage)]

mod mimalloc;
/// Compiled with `--cfg bun_sema_mimalloc`, which leaves mimalloc to `mimalloc.rs`.
#[path = "../../../../../../src/sema/standalone/native.rs"]
pub mod native;

use core::ffi::{c_char, c_int, c_void};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

// For `bun_core::output::stdio::init`, which the threads of Bun's pool count on.
#[unsafe(no_mangle)]
extern "C" fn bun_initialize_process() {}
#[unsafe(no_mangle)]
#[allow(non_upper_case_globals)]
static bun_is_stdio_null: [core::sync::atomic::AtomicI32; 3] = [const { core::sync::atomic::AtomicI32::new(0) }; 3];

// Two more natives, which only a build with debug assertions refers to. Nothing that is fuzzed calls them.
#[unsafe(no_mangle)]
extern "C" fn WTF__DumpStackTrace(_trace: *const usize, _count: usize) {}
#[unsafe(no_mangle)]
extern "C" fn posix_spawn_bun(
    _pid: *mut c_int,
    _path: *const c_char,
    _request: *const c_void,
    _argv: *const *const c_char,
    _envp: *const *const c_char,
) -> isize {
    libc::ENOSYS as isize
}

/// An input: ten bytes that choose the language and the options, then the text.
pub struct Input<'a> {
    /// Which of the variants of the target: a parser, a kind of file.
    pub variant: u8,
    pub width: u8,
    pub flags: u32,
    pub offsets: [u16; 2],
    pub text: &'a [u8],
}

impl<'a> Input<'a> {
    pub const HEADER: usize = 10;

    pub fn new(data: &'a [u8]) -> Option<Input<'a>> {
        let (&[variant, width, a, b, c, d, e, f, g, h], text) = data.split_first_chunk()?;
        Some(Input {
            variant,
            width,
            flags: u32::from_le_bytes([a, b, c, d]),
            offsets: [u16::from_le_bytes([e, f]), u16::from_le_bytes([g, h])],
            text,
        })
    }

    pub fn has(&self, bit: u32) -> bool {
        self.flags & (1 << bit) != 0
    }
}

struct Settings {
    /// `FUZZ_FINDINGS`: findings are written there, the smallest input for each, and the fuzzer goes
    /// on. Without it a finding ends the process, which libFuzzer takes for a crash.
    directory: Option<PathBuf>,
    /// `FUZZ_ONLY`: only findings whose `kind/key` has this in it count. To minimize one.
    only: Option<String>,
    /// `FUZZ_SLOW_MS`
    slow: Duration,
    target: String,
}

static SETTINGS: OnceLock<Settings> = OnceLock::new();

thread_local! {
    static PANIC: RefCell<Option<(String, String)>> = const { RefCell::new(None) };
    /// Whether this thread is in [`Run::guarded`], where a panic is caught.
    static IS_GUARDED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// The size of the smallest input that is known for each finding.
    static KNOWN: RefCell<HashMap<String, usize>> = RefCell::new(HashMap::new());
}

/// At most this many findings of a kind are kept.
const MOST_OF_A_KIND: usize = 400;

/// `FUZZ_TARGET`, or what follows `fuzz_` in the name that the program was started by.
pub fn target_name() -> String {
    std::env::var("FUZZ_TARGET").ok().unwrap_or_else(|| {
        let program = std::env::args().next().unwrap_or_default();
        let name = program.rsplit('/').next().unwrap_or_default();
        name.strip_prefix("fuzz_").unwrap_or(name).to_owned()
    })
}

/// Before the first input, on the thread that runs them.
fn settings() -> &'static Settings {
    SETTINGS.get_or_init(|| {
        let variable = |name: &str| std::env::var(name).ok().filter(|it| !it.is_empty());
        // That of a thread of Bun's pool, which is what formats and lints. `run.sh` limits the stack
        // of the process to the same size. `FUZZ_STACK_KB`: a smaller one, with which a recursion
        // that nothing checks runs out of stack on a short input.
        let stack = (variable("FUZZ_STACK_KB").and_then(|it| it.parse::<usize>().ok()))
            .map_or(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize, |it| it << 10);
        native::set_stack_size(stack - (256 << 10));
        std::panic::set_hook(Box::new(|info| {
            let place = info.location().map_or_else(String::new, |it| {
                // From the root of the repository.
                let file = it.file().find("/src/").map_or(it.file(), |at| &it.file()[at + 1..]);
                format!("{file}:{}:{}", it.line(), it.column())
            });
            let payload = info.payload();
            let message = (payload.downcast_ref::<&str>().map(|it| (*it).to_owned()))
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_default();
            // On a thread of the pool nobody catches it, and whoever waits for that thread waits for ever. In Bun it ends the process.
            if !IS_GUARDED.get() {
                eprintln!("PANIC ON ANOTHER THREAD {place}: {message}");
                std::process::abort();
            }
            PANIC.set(Some((place, message)));
        }));
        Settings {
            directory: variable("FUZZ_FINDINGS").map(PathBuf::from),
            only: variable("FUZZ_ONLY"),
            slow: Duration::from_millis(
                variable("FUZZ_SLOW_MS").and_then(|it| it.parse().ok()).unwrap_or(1000),
            ),
            target: target_name(),
        }
    })
}

fn file_name(key: &str) -> String {
    let mut name: String = (key.chars())
        .map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '_' })
        .collect();
    name.truncate(140);
    name
}

/// How long the thread has been running. Not the time of day: other processes want the processor too.
fn cpu_time() -> Duration {
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: a place for the result.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &raw mut time) };
    Duration::new(time.tv_sec as u64, time.tv_nsec as u32)
}

/// One run of a target on one input.
pub struct Run<'a> {
    data: &'a [u8],
    /// For whoever reads the finding: the name of the file and the flags of the command line.
    pub how: String,
}

impl<'a> Run<'a> {
    pub fn new(data: &'a [u8]) -> Run<'a> {
        settings();
        Run { data, how: String::new() }
    }

    /// `kind`: what is wrong. `key`: what tells it from other findings of its kind.
    pub fn report(&self, kind: &str, key: &str, detail: &str) {
        let settings = settings();
        let id = format!("{kind}/{}", file_name(key));
        if settings.only.as_ref().is_some_and(|only| !file_name(&id).contains(&file_name(only))) {
            return;
        }
        let Some(directory) = &settings.directory else {
            eprintln!("FINDING {id}\n{}\n{detail}", self.how);
            std::process::abort();
        };
        let path = directory.join(&settings.target).join(&id);
        let is_news = KNOWN.with_borrow_mut(|known| {
            let smallest = match known.get(&id) {
                Some(&smallest) => smallest,
                None => match std::fs::metadata(&path) {
                    Ok(found) => found.len() as usize,
                    // Each has two files. Other processes write here too.
                    Err(_) => {
                        let all = path.parent().and_then(|it| std::fs::read_dir(it).ok());
                        match all.map_or(0, Iterator::count) >= 2 * MOST_OF_A_KIND {
                            true => 0,
                            false => usize::MAX,
                        }
                    }
                },
            };
            known.insert(id.clone(), smallest.min(self.data.len()));
            self.data.len() < smallest
        });
        if !is_news {
            return;
        }
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(directory));
        // Other processes write here too.
        let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
        if std::fs::write(&temporary, self.data).is_ok() {
            let _ = std::fs::rename(&temporary, &path);
        }
        let mut info = path.into_os_string();
        info.push(".info");
        let _ = std::fs::write(info, format!("{}\n{detail}\n", self.how));
    }

    /// The result of `work`, or nothing if it panics, which is reported. What takes long is too.
    pub fn guarded<R>(&self, work: impl FnOnce() -> R) -> Option<R> {
        let started = cpu_time();
        IS_GUARDED.set(true);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work));
        IS_GUARDED.set(false);
        let elapsed = cpu_time().saturating_sub(started);
        if elapsed > settings().slow {
            let size = self.data.len().max(1).ilog2();
            self.report("slow", &format!("2e{size}"), &format!("{} ms", elapsed.as_millis()));
        }
        result
            .inspect_err(|_| {
                let (place, message) = PANIC.take().unwrap_or_default();
                self.report("panic", &place, &message);
            })
            .ok()
    }
}

/// With `FUZZ_SHOW`, what an input is and what becomes of it is printed.
pub fn shows() -> bool {
    static SHOWS: OnceLock<bool> = OnceLock::new();
    *SHOWS.get_or_init(|| std::env::var_os("FUZZ_SHOW").is_some())
}

pub fn show(title: &str, text: &[u8]) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "──── {title}");
    let _ = out.write_all(text);
    let _ = writeln!(out);
}

/// `line` without what tells one word or number from another.
pub fn shape(line: &[u8]) -> String {
    let mut shape = String::new();
    for &byte in line {
        let c = match byte {
            _ if byte.is_ascii_alphanumeric() || byte >= 0x80 => 'a',
            _ if byte.is_ascii_whitespace() => ' ',
            _ => byte as char,
        };
        if !(shape.ends_with(c) && matches!(c, 'a' | ' ')) {
            shape.push(c);
        }
    }
    shape.truncate(40);
    shape
}
