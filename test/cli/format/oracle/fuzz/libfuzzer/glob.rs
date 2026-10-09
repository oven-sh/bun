//! `bun_lint::linter::Glob`, which is `new Minimatch(pattern, { dot: true })`: the patterns of configuration files and of the
//! command line. The text is a pattern, a line break, and a path.
//!
//! With `FUZZ_RECORD=<file>` what it says is written down for glob-oracle.mjs, which asks minimatch.

#![no_main]

use bun_fuzz::{Input, Run, show, shows};
use bun_lint::linter::Glob;

fn run(data: &[u8]) {
    let Some(input) = Input::new(data) else {
        return;
    };
    let at = input.text.iter().position(|&it| it == b'\n').unwrap_or(input.text.len());
    let (pattern, path) = (&input.text[..at], input.text.get(at + 1..).unwrap_or_default());
    let mut run = Run::new(data);
    run.how = String::from_utf8_lossy(pattern).into_owned();
    if shows() {
        show(&run.how, path);
    }
    let Some((matches, matches_partially)) = run.guarded(|| {
        let glob = Glob::new(pattern);
        (glob.matches(path), glob.matches_partially(path))
    }) else {
        return;
    };
    if shows() {
        show(&format!("matches: {matches}, partially: {matches_partially}"), b"");
    }
    let Some(file) = std::env::var_os("FUZZ_RECORD") else {
        return;
    };
    let mut all = Vec::new();
    let said = [b'0' + u8::from(matches), b'0' + u8::from(matches_partially)];
    for part in [pattern, path, &said[..]] {
        all.extend_from_slice(&(part.len() as u32).to_le_bytes());
        all.extend_from_slice(part);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().append(true).create(true).open(file) {
        let _ = std::io::Write::write_all(&mut file, &all);
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
