//! `bun_lint::regex::Regex`, which is `RegExp`: the patterns in the options of rules and in `importOrder` go to it. The text is a
//! pattern, a line break, and what is searched. The flags of the input are the flags of the regular expression.
//!
//! With `FUZZ_RECORD=<file>` what it finds is written down for regex-oracle.mjs, which asks the `RegExp` of what runs it.

#![no_main]

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

fn run(data: &[u8]) {
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
