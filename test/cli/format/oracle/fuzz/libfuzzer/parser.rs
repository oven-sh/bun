//! `bun_sema_parser` on bytes. It has to refuse or to parse. What it parses has to be valid for the
//! parser that recovers from errors too, with the same HIR: as `bun-hir fuzz`, with coverage.

#![no_main]

#[path = "../../../../../../src/sema/parser/standalone/compare.rs"]
mod compare;

use bun_fuzz::{Input, Run, shape, show, shows};
use bun_sema::atom::Interner;
use bun_sema::hir::{DiagnosticKind, ExprKind};
use bun_sema::resolve::{Dialect, ScriptKind};
use bun_sema::session::Session;
use bun_sema_parser::{Options, Refusal, Scratch};
use std::cell::RefCell;

const PATHS: [&str; 10] = ["a.ts", "a.tsx", "a.js", "a.jsx", "a.d.ts", "a.mts", "a.cts", "a.mjs", "a.cjs", "a.json"];

fn dialect_of(which: u32, script: bool) -> (&'static str, Dialect) {
    match which % 6 {
        0 => ("tsc", Dialect::default()),
        1 => ("estree", Dialect::typescript_estree(script)),
        2 => ("espree", Dialect::espree(script)),
        3 => ("babel", Dialect::babel(script)),
        4 => ("flow", Dialect::flow(script)),
        _ => ("flow-parser", Dialect::flow_parser(script)),
    }
}

/// As in src/sema/parser/standalone/main.rs.
fn options_for(path: &[u8], dialect: Dialect) -> Options {
    let kind = ScriptKind::from_file_name(path);
    let is_json = path.ends_with(b".json");
    let is_javascript = kind.is_some_and(ScriptKind::is_javascript) || is_json;
    Options {
        is_declaration_file: bun_sema::resolve::is_declaration_file_name(path),
        is_jsx: is_javascript || kind == Some(ScriptKind::Tsx),
        is_javascript,
        is_json,
        await_is_a_name: is_json || is_javascript && dialect.ecmascript && dialect.script,
        dialect,
        ..Options::default()
    }
}

/// What is wrong, and what it is about. As `compare_one` there.
fn compare_one(
    path: &[u8],
    text: &[u8],
    decorators: bool,
    recovers: bool,
    dialect: Dialect,
    scratch: &mut Scratch,
) -> Option<(&'static str, String)> {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    // The other parser does not read Flow.
    if dialect.flow {
        if let Ok(parsed) = bun_sema_parser::parse(text, options_for(path, dialect), &atoms, scratch) {
            scratch.recycle(parsed.file);
        }
        return None;
    }
    let every_file_is_a_module = dialect != Dialect::default() && !dialect.script;
    let (reference, _) = bun_js_parser::sema::summarize_with_recovery(
        dialect,
        false,
        (session.arena(), &session),
        path,
        None,
        text,
        &atoms,
        decorators,
        every_file_is_a_module,
    );
    let is_refused_by_reference = reference.has_errors
        || reference.has_parse_diagnostics
        || (reference.diagnostics.iter()).any(|it| it.kind == DiagnosticKind::Parse)
        || reference.ran_out_of_stack;
    let mut options = options_for(path, dialect);
    options.recovers = recovers;
    let mut parsed = bun_sema_parser::parse(text, options, &atoms, scratch);
    if let Ok(first) = &parsed
        && first.has_top_level_await
        && !every_file_is_a_module
        && !first.file.has_module_syntax
        && (dialect.script
            || ![&b".mts"[..], b".cts", b".mjs", b".cjs"].iter().any(|it| path.ends_with(it)))
        && !(first.file.exprs.iter()).any(|e| matches!(e.kind, ExprKind::ImportMeta))
    {
        options.await_is_a_name = true;
        parsed = bun_sema_parser::parse(text, options, &atoms, scratch);
    }
    let parsed = parsed.ok()?;
    // How it goes on after an error is not compared yet: it has to end, and not to crash.
    let wrong = if is_refused_by_reference && parsed.file.has_parse_diagnostics {
        None
    } else if is_refused_by_reference {
        let first = reference.diagnostics.first();
        Some(("accepted", format!("{:?}", first.map(|it| (it.kind, it.code)))))
    } else {
        let mut comparison = compare::Comparison::new(&reference, &parsed.file);
        comparison.run();
        comparison.difference.take().map(|it| ("different", it))
    };
    scratch.recycle(parsed.file);
    wrong
}

/// As `parse_as_file` there.
fn parse_as_file(
    path: &[u8],
    text: &[u8],
    mut options: Options,
    atoms: &Interner<'_>,
    scratch: &mut Scratch,
) -> Result<bun_sema_parser::Parsed, bun_sema_parser::Refused> {
    let dialect = options.dialect;
    let parsed = bun_sema_parser::parse(text, options, atoms, scratch);
    if let Ok(first) = &parsed
        && first.has_top_level_await
        && (dialect == Dialect::default() || dialect.script)
        && !first.file.has_module_syntax
        && (dialect.script
            || ![&b".mts"[..], b".cts", b".mjs", b".cjs"].iter().any(|it| path.ends_with(it)))
        && !(first.file.exprs.iter()).any(|e| matches!(e.kind, ExprKind::ImportMeta))
    {
        options.await_is_a_name = true;
        return bun_sema_parser::parse(text, options, atoms, scratch);
    }
    parsed
}

/// The parser that refuses a text at its first error against the one that recovers. As `agree_one` there.
fn agree_one(
    path: &[u8],
    text: &[u8],
    reads_jsdoc: bool,
    dialect: Dialect,
    scratch: &mut Scratch,
) -> Option<(&'static str, String)> {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let mut options = options_for(path, dialect);
    options.reads_jsdoc = reads_jsdoc;
    options.recovers = true;
    let general = parse_as_file(path, text, options, &atoms, scratch);
    options.recovers = false;
    let strict = parse_as_file(path, text, options, &atoms, scratch);
    let error = match &general {
        Ok(general) => (general.file.diagnostics.iter())
            .find(|it| it.kind == DiagnosticKind::Parse)
            .map(|it| format!("{:?}", (it.kind, it.code))),
        // Too large, too deep and not UTF-8 are no syntax to recover from.
        Err(why) if matches!(why.why, Refusal::TooLarge | Refusal::TooDeep | Refusal::NotUtf8) => return None,
        Err(why) => return Some(("recovery-gives-up", format!("{:?} by {}:{}", why.why, why.by.file(), why.by.line()))),
    };
    match (strict, general, error) {
        (Ok(_), _, Some(error)) => Some(("strict-accepts-an-error", error)),
        (Ok(strict), Ok(general), None) => {
            let mut comparison = compare::Comparison::new(&general.file, &strict.file);
            comparison.compares_jsdoc = reads_jsdoc;
            comparison.run();
            comparison.difference.take().map(|it| ("strict-and-recovering-differ", it))
        }
        _ => None,
    }
}

thread_local! {
    static SCRATCH: RefCell<Scratch> = RefCell::default();
}

fn run(data: &[u8]) {
    let Some(input) = Input::new(data) else {
        return;
    };
    let path = PATHS[input.variant as usize % PATHS.len()];
    let (name, dialect) = dialect_of(u32::from(input.width), input.has(0));
    let mut run = Run::new(data);
    // Only this dialect is ever parsed with recovery.
    let recovers = input.has(2) && dialect == Dialect::default();
    let reads_jsdoc = input.has(3) && dialect == Dialect::default();
    run.how = format!(
        "{path} --dialect={name} script={} decorators={} recovers={recovers} jsdoc={reads_jsdoc}",
        input.has(0),
        input.has(1)
    );
    if shows() {
        show(&run.how, input.text);
    }
    let wrong = run.guarded(|| {
        // After a panic it is in no state to be used again.
        let mut scratch = SCRATCH.take();
        let wrong = compare_one(path.as_bytes(), input.text, input.has(1), recovers, dialect, &mut scratch)
            .or_else(|| match dialect.flow {
                true => None,
                false => agree_one(path.as_bytes(), input.text, reads_jsdoc, dialect, &mut scratch),
            });
        SCRATCH.set(scratch);
        wrong
    });
    if let Some(Some((kind, what))) = wrong {
        // One for each line of the parser that gives up.
        let key = if kind == "recovery-gives-up" { what.clone() } else { shape(what.as_bytes()) };
        run.report(kind, &format!("{name}-{key}"), &what);
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
