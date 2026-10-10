//! `bun_lint::regex::Regex`, which is `RegExp`: the patterns in the options of rules and in `importOrder` go to it. The text is a
//! pattern, a line break, and what is searched. The flags of the input are the flags of the regular expression.
//!
//! With `FUZZ_RECORD=<file>` what it finds is written down for regex-oracle.mjs, which asks the `RegExp` of what runs it.
//!
//! With `FUZZ_STRESS=<seconds>` it does something else, once, whatever the input: many threads search with the same regular
//! expressions, make and drop their own, and the shared ones are replaced meanwhile. For a build with AddressSanitizer, with
//! `ASAN_OPTIONS=detect_leaks=1`: what is used after it is freed, freed twice, or never.

#![no_main]
#![feature(linkage)]

use bun_fuzz::{Input, Run, show, shows};
use bun_lint::regex::Regex;

const FLAGS: [u8; 8] = *b"dgimsuvy";

/// `null`, or the start and the end of the match and of each group, `-` for a group that took no part.
fn written(regex: &Regex, text: &[u8], start: usize) -> String {
    match regex.exec_at(text, start) {
        None => "null".to_owned(),
        Some(found) => {
            let groups = (0..found.len()).map(|index| match found.get(index) {
                Some(it) => format!("{},{}", it.start(), it.end()),
                None => "-".to_owned(),
            });
            groups.collect::<Vec<_>>().join(";")
        }
    }
}

fn record(parts: [&[u8]; 4]) {
    let Some(path) = std::env::var_os("FUZZ_RECORD") else {
        return;
    };
    let mut all = Vec::new();
    for part in parts {
        all.extend_from_slice(&(part.len() as u32).to_le_bytes());
        all.extend_from_slice(part);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().append(true).create(true).open(path) {
        let _ = std::io::Write::write_all(&mut file, &all);
    }
}

/// A pattern, its flags, and what is searched.
const SHARED: [(&str, &str, &str); 8] = [
    (r"^(?:[a-z]+[A-Z]?)+\d*$", "u", "abcDefGhiJklmnopQrs123"),
    ("(a|b)*c", "", "xxababababababc ababc abd"),
    ("^_", "u", "_private"),
    ("b+", "y", "bbbabb"),
    (r"(\p{L}+)\s(\p{L}+)", "u", "h\u{e9}llo w\u{f6}rld \u{f1}and\u{fa} \u{4f60}\u{597d} \u{4e16}\u{754c}"),
    (r"(?<year>\d{4})-(?<month>\d{2})", "", "on 2026-10-09 and 1999-12-31"),
    (r"(?<=\$)\d+(?:\.\d+)?", "g", "it costs $12.50 or $7"),
    (r"[\u{1F600}-\u{1F64F}]+", "v", "a\u{1F600}\u{1F601}b\u{1F602}"),
];

unsafe extern "C" {
    /// How many instances of the engine's regular expression have been compiled so far. Only an experiment has it.
    #[linkage = "extern_weak"]
    static bun_yarr_instances_made: Option<unsafe extern "C" fn() -> usize>;
    /// How often, so far: 0: a compilation was made to fail; 1: all places were taken and one more instance was compiled; 2: an instance found no place and was
    /// freed; 3: a thread yielded because it got none. Only an experiment has it.
    #[linkage = "extern_weak"]
    static bun_yarr_count: Option<unsafe extern "C" fn(usize) -> usize>;
}

fn instances_made() -> Option<usize> {
    // SAFETY: null or that function, which takes nothing and reads a counter.
    unsafe { bun_yarr_instances_made.map(|it| it()) }
}

fn count(which: usize) -> Option<usize> {
    // SAFETY: null or that function, which reads a counter.
    unsafe { bun_yarr_count.map(|it| it(which)) }
}

/// More than a regular expression has places for the threads that search with it.
const THREADS_AT_MOST: usize = 96;


fn stress(seconds: u64) {
    // FUZZ_THREADS: fewer, as a control.
    let threads = std::env::var("FUZZ_THREADS").ok().and_then(|it| it.parse().ok()).unwrap_or(THREADS_AT_MOST);
    // FUZZ_PATTERNS: only the first so many, so that more threads search with the same one at a time.
    let patterns = std::env::var("FUZZ_PATTERNS").ok().and_then(|it| it.parse().ok()).unwrap_or(SHARED.len());
    let patterns = patterns.clamp(1, SHARED.len());
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, RwLock};
    let make = |which: usize| Regex::new(SHARED[which].0, SHARED[which].1).expect("the pattern is valid");
    let answer = |regex: &Regex, which: usize| {
        let text = SHARED[which].2.as_bytes();
        let all: Vec<String> = regex.find_iter(text).map(|it| format!("{},{}", it.start(), it.end())).collect();
        format!("{} {} {} {}", regex.test(text), written(regex, text, 0), written(regex, text, 1), all.join(" "))
    };
    let expected: Vec<String> = (0..SHARED.len()).map(|which| answer(&make(which), which)).collect();
    let shared: Vec<RwLock<Arc<Regex>>> = (0..SHARED.len()).map(|which| RwLock::new(Arc::new(make(which)))).collect();
    let (stops, answers, owns, mut replaced) = (AtomicBool::new(false), AtomicUsize::new(0), AtomicUsize::new(0), 0);
    let made_before = instances_made();
    std::thread::scope(|scope| {
        for thread in 0..threads {
            let (shared, expected, stops, answers, owns) = (&shared, &expected, &stops, &answers, &owns);
            scope.spawn(move || {
                let mut turn = thread;
                while !stops.load(Ordering::Relaxed) {
                    let which = turn % patterns;
                    // Not under the lock: the last to drop it may be this thread, after it has been replaced.
                    let regex = Arc::clone(&shared[which].read().expect("nobody panics with the lock"));
                    assert_eq!(answer(&regex, which), expected[which], "a shared /{}/", SHARED[which].0);
                    drop(regex);
                    if turn % 5 == 0 {
                        assert_eq!(answer(&make(which), which), expected[which], "its own /{}/", SHARED[which].0);
                        owns.fetch_add(1, Ordering::Relaxed);
                    }
                    answers.fetch_add(1, Ordering::Relaxed);
                    turn += 1;
                }
            });
        }
        let began = std::time::Instant::now();
        while began.elapsed().as_secs() < seconds {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let which = replaced % patterns;
            *shared[which].write().expect("nobody panics with the lock") = Arc::new(make(which));
            replaced += 1;
        }
        stops.store(true, Ordering::Relaxed);
    });
    drop(shared);
    eprintln!(
        "STRESS: {threads} threads, {patterns} patterns, {} answers, all as expected; {} regular expressions of a thread's own; {replaced} times a shared one was replaced; instances compiled meanwhile: {:?}",
        answers.into_inner(),
        owns.into_inner(),
        made_before.zip(instances_made()).map(|(before, after)| after - before)
    );
    eprintln!(
        "STRESS: made to fail: {:?}; all places taken, one more compiled: {:?}; no place, freed: {:?}; yielded: {:?}; counters 4 to 7 of the experiment: {:?}",
        count(0),
        count(1),
        count(2),
        count(3),
        [count(4), count(5), count(6), count(7)]
    );
}

/// `FUZZ_MODE=births`: pairs of threads. One makes a regular expression, and both search with it for the first time at the same
/// moment, a few times, and drop it: whichever is last frees it. `FUZZ_MODE=phases`: one thread searches with it alone, then both,
/// then the first alone again.
fn stress_in_pairs(seconds: u64, has_phases: bool) {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, RwLock};
    let threads: usize = std::env::var("FUZZ_THREADS").ok().and_then(|it| it.parse().ok()).unwrap_or(THREADS_AT_MOST);
    let make = |which: usize| Regex::new(SHARED[which].0, SHARED[which].1).expect("the pattern is valid");
    let answer = |regex: &Regex, which: usize| {
        let text = SHARED[which].2.as_bytes();
        let all: Vec<String> = regex.find_iter(text).map(|it| format!("{},{}", it.start(), it.end())).collect();
        format!("{} {} {} {}", regex.test(text), written(regex, text, 0), written(regex, text, 1), all.join(" "))
    };
    let expected: Vec<String> = (0..SHARED.len()).map(|which| answer(&make(which), which)).collect();
    let (stops, answers, births) = (AtomicBool::new(false), AtomicUsize::new(0), AtomicUsize::new(0));
    let made_before = instances_made();
    // FUZZ_GROUP=3: triples in the place of pairs: one more instance in flight than two threads can have.
    let group: usize = std::env::var("FUZZ_GROUP").ok().and_then(|it| it.parse().ok()).unwrap_or(2).max(2);
    let pairs: Vec<(RwLock<Option<Arc<Regex>>>, Barrier)> =
        (0..(threads / group).max(1)).map(|_| (RwLock::new(None), Barrier::new(group))).collect();
    std::thread::scope(|scope| {
        for (number, pair) in pairs.iter().enumerate() {
            for is_first in (0..group).map(|member| member == 0) {
                let (expected, stops, answers, births) = (&expected, &stops, &answers, &births);
                scope.spawn(move || {
                    let (slot, barrier) = pair;
                    let ask = |regex: &Regex, which: usize, times: usize| {
                        for _ in 0..times {
                            assert_eq!(answer(regex, which), expected[which], "/{}/", SHARED[which].0);
                        }
                        answers.fetch_add(times, Ordering::Relaxed);
                    };
                    for turn in number.. {
                        let (which, times) = (turn % SHARED.len(), 1 + turn % 3);
                        if is_first {
                            // The one who makes them says when it is over.
                            let made = (!stops.load(Ordering::Relaxed)).then(|| Arc::new(make(which)));
                            births.fetch_add(usize::from(made.is_some()), Ordering::Relaxed);
                            if let Some(made) = made.as_ref().filter(|_| has_phases) {
                                ask(made, which, times);
                            }
                            *slot.write().expect("nobody panics with the lock") = made;
                        }
                        barrier.wait();
                        let Some(regex) = slot.read().expect("nobody panics with the lock").clone() else {
                            break;
                        };
                        barrier.wait();
                        // Every other time the slot lets go of it before the searches, so that either thread can be the last.
                        if is_first && turn % 2 == 0 {
                            *slot.write().expect("nobody panics with the lock") = None;
                        }
                        ask(&regex, which, times);
                        if !is_first || !has_phases {
                            drop(regex);
                            barrier.wait();
                            continue;
                        }
                        barrier.wait();
                        ask(&regex, which, times);
                    }
                });
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(seconds));
        stops.store(true, Ordering::Relaxed);
    });
    drop(pairs);
    eprintln!(
        "STRESS in groups of {group}, {}: {} threads, {} answers, all as expected; instances compiled meanwhile: {:?}; regular expressions made, each for one group: {}",
        if has_phases { "alone, shared, alone again" } else { "both from the first search on" },
        (threads / group).max(1) * group,
        answers.into_inner(),
        made_before.zip(instances_made()).map(|(before, after)| after - before),
        births.into_inner()
    );
    eprintln!(
        "STRESS: made to fail: {:?}; all places taken, one more compiled: {:?}; no place, freed: {:?}; yielded: {:?}; counters 4 to 7 of the experiment: {:?}",
        count(0),
        count(1),
        count(2),
        count(3),
        [count(4), count(5), count(6), count(7)]
    );
}

fn run(data: &[u8]) {
    static STRESS: std::sync::Once = std::sync::Once::new();
    if let Some(seconds) = std::env::var("FUZZ_STRESS").ok().and_then(|it| it.parse().ok()) {
        // For what it does to a panic on another thread: it ends the process.
        let _ = Run::new(data);
        STRESS.call_once(|| match std::env::var("FUZZ_MODE").as_deref() {
            Ok("births") => stress_in_pairs(seconds, false),
            Ok("phases") => stress_in_pairs(seconds, true),
            _ => stress(seconds),
        });
        return;
    }
    let Some(input) = Input::new(data) else {
        return;
    };
    let at = input.text.iter().position(|&it| it == b'\n').unwrap_or(input.text.len());
    let (pattern, text) = (&input.text[..at], input.text.get(at + 1..).unwrap_or_default());
    let flags: Vec<u8> = (0..8).filter(|&bit| input.has(bit)).map(|bit| FLAGS[bit as usize]).collect();
    let mut run = Run::new(data);
    run.how = format!("/{}/{}", String::from_utf8_lossy(pattern), String::from_utf8_lossy(&flags));
    if shows() {
        show(&run.how, text);
    }
    let Some(compiled) = run.guarded(|| Regex::from_bytes(pattern, &flags)) else {
        return;
    };
    let Ok(regex) = compiled else {
        record([pattern, &flags, text, b"SyntaxError"]);
        return;
    };
    let Some(first) = run.guarded(|| written(&regex, text, 0)) else {
        return;
    };
    if shows() {
        show("exec", first.as_bytes());
    }
    record([pattern, &flags, text, first.as_bytes()]);
    let key = format!("flags-{}", String::from_utf8_lossy(&flags));
    // What says the same in another way says the same.
    let _ = run.guarded(|| {
        if regex.test(text) != (first != "null") {
            run.report("test-and-exec-differ", &key, &first);
        }
        let found = regex.find(text).map(|it| format!("{},{}", it.start(), it.end()));
        if found.as_deref() != first.split(';').next().filter(|_| first != "null") {
            run.report("find-and-exec-differ", &key, &first);
        }
        // They end, and each match starts where the one before it has ended, or after that.
        let mut end = 0;
        for (count, it) in regex.find_iter(text).enumerate() {
            if it.start() < end || it.end() < it.start() || it.end() > text.len() || count > text.len() + 1 {
                run.report("matches-out-of-order", &key, &format!("{},{} after {end}", it.start(), it.end()));
                break;
            }
            end = it.end();
        }
        let parts = regex.split(text);
        let replaced = regex.replace(text, b"$&");
        if !regex.flags().sticky && first == "null" && (parts.len() != 1 || &*replaced != text) {
            run.report("split-or-replace-without-a-match", &key, "");
        }
        let _ = regex.replace(text, b"[$1$<a>$`$'$$]");
        let _ = regex.source();
        // `new RegExp(regex.source, regex.flags)` is the same regular expression.
        match Regex::from_bytes(regex.source(), &flags) {
            Ok(again) if written(&again, text, 0) == first => {}
            Ok(_) => run.report("source-is-another-regex", &key, &String::from_utf8_lossy(regex.source())),
            Err(_) => run.report("source-is-invalid", &key, &String::from_utf8_lossy(regex.source())),
        }
    });
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
