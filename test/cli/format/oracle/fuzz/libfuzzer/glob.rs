//! `bun_glob`: patterns and ignore files, which come from configuration files and the command line. Nothing panics, every mode is
//! bounded, and with debug assertions every linear program is run beside one on sets (`Program::matches`).
//!
//! The variant says who reads the text. 0 to 5: a pattern, a line break, and a path: `Pattern` with each of its `Options`, and
//! `of_oxc_glob_set`. 6 to 15: the last line is a path, the lines before it an ignore file: `IgnoreRules` with each `IgnoreSyntax`,
//! with and without `ignores_case`.
//!
//! With `FUZZ_RECORD=<file>` what variant 0 says, which is `new Minimatch(pattern, { dot: true })`, is written down for
//! glob-oracle.mjs, which asks minimatch.

#![no_main]

use bun_fuzz::{Input, Run, show, shows};
use bun_glob::ignore::{IgnoreOptions, IgnoreRules, IgnoreSyntax, Verdict};
use bun_glob::{How, Options, Pattern};

const OPTIONS: [(&str, Options); 5] = [
    ("minimatch, dot", Options::MINIMATCH_DOT),
    ("minimatch", Options::MINIMATCH),
    ("micromatch, dot", Options::MICROMATCH_DOT),
    ("fast-glob, dot", Options::FAST_GLOB_DOT),
    ("Bun", Options::BUN),
];

const SYNTAXES: [IgnoreSyntax; 5] =
    [IgnoreSyntax::Git, IgnoreSyntax::Globset, IgnoreSyntax::Npm5, IgnoreSyntax::Npm705, IgnoreSyntax::Npm7012];

fn record(parts: [&[u8]; 3]) {
    let Some(file) = std::env::var_os("FUZZ_RECORD") else {
        return;
    };
    let mut all = Vec::new();
    for part in parts {
        all.extend_from_slice(&(part.len() as u32).to_le_bytes());
        all.extend_from_slice(part);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().append(true).create(true).open(file) {
        let _ = std::io::Write::write_all(&mut file, &all);
    }
}

fn pattern(run: &mut Run, which: usize, text: &[u8]) {
    let at = text.iter().position(|&it| it == b'\n').unwrap_or(text.len());
    let (pattern, path) = (&text[..at], text.get(at + 1..).unwrap_or_default());
    let name = OPTIONS.get(which).map_or("oxc's GlobSet", |it| it.0);
    run.how = format!("{name}: {}", String::from_utf8_lossy(pattern));
    if shows() {
        show(&run.how, path);
    }
    let Some(said) = run.guarded(|| {
        let glob = match OPTIONS.get(which) {
            Some(it) => Pattern::new(pattern, it.1),
            None => Pattern::of_oxc_glob_set(pattern),
        };
        let _ = (glob.heads(), bun_glob::pattern::unclosed(pattern).is_some());
        let _ = (bun_glob::scan::is_glob(pattern), bun_glob::scan::glob_parent(pattern));
        [
            glob.matches(path),
            glob.may_match_inside(path),
            glob.matches_with(path, How { flip_negate: true, partial: false }),
            glob.matches_with(path, How { flip_negate: false, partial: true }),
        ]
    }) else {
        return;
    };
    if shows() {
        show(&format!("matches, may match inside, without the `!`, partially: {said:?}"), b"");
    }
    if which == 0 {
        record([pattern, path, &[b'0' + u8::from(said[0]), b'0' + u8::from(said[1])][..]]);
    }
}

fn ignore_file(run: &mut Run, which: usize, text: &[u8]) {
    let at = text.iter().rposition(|&it| it == b'\n').map_or(0, |it| it + 1);
    let (lines, path) = (&text[..at], &text[at..]);
    let options = IgnoreOptions { syntax: SYNTAXES[which / 2], ignores_case: which % 2 == 1 };
    run.how = format!("{options:?}: {}", String::from_utf8_lossy(path));
    if shows() {
        show(&run.how, lines);
    }
    let Some(said) = run.guarded(|| {
        let rules = IgnoreRules::from_text(lines, options);
        let _ = (rules.is_empty(), rules.has_exceptions(), rules.refused().len());
        let verdicts = [false, true].map(|is_directory| {
            (rules.verdict(path, is_directory), rules.verdict_or_of_parents(path, is_directory))
        });
        (verdicts, rules.ignores(path), rules.may_keep_inside(path))
    }) else {
        return;
    };
    if shows() {
        show(&format!("as a file, as a directory; ignores; may keep inside: {said:?}"), b"");
    }
    // What a line says of the path itself counts before what lines say of the directories above it.
    for (own, with_parents) in said.0 {
        if own == Verdict::Ignored && with_parents == Verdict::Unmentioned {
            run.report("ignored-and-unmentioned", &format!("{options:?}"), "");
        }
    }
}

fn run(data: &[u8]) {
    let Some(input) = Input::new(data) else {
        return;
    };
    let mut run = Run::new(data);
    match input.variant as usize % 16 {
        which @ 0..6 => pattern(&mut run, which, input.text),
        which => ignore_file(&mut run, which - 6, input.text),
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
