//! `bun_sema_parser` on bytes. It has to refuse or to parse. What the parser that stops at the first error parses has no error
//! for the one that recovers, and both make the same HIR of it: as `bun-hir compare`, with coverage.

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

/// Flow is only parsed: it has to end, and not to crash.
fn only_parse(path: &[u8], text: &[u8], dialect: Dialect, scratch: &mut Scratch) {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    if let Ok(parsed) = bun_sema_parser::parse(text, options_for(path, dialect), &atoms, scratch) {
        scratch.recycle(parsed.file);
    }
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
            .filter(|it| it.kind == DiagnosticKind::Parse)
            // In a script only the one that recovers reports the keyword: it has to be the first error, as it is acorn's. Of a
            // text that is valid but for that the linter finds the keyword in the tree.
            .find(|it| {
                let at = text.get(it.start as usize..).unwrap_or_default();
                let is_module_syntax = at.starts_with(b"import") || at.starts_with(b"export");
                !(dialect.ecmascript && dialect.script && it.code == 1128 && is_module_syntax)
            })
            .map(|it| format!("{:?}", (it.kind, it.code))),
        // Too large, too deep and not UTF-8 are no syntax to recover from.
        Err(why) if matches!(why.why, Refusal::TooLarge | Refusal::TooDeep | Refusal::NotUtf8) => return None,
        // An early error of acorn's or Babel's, which TypeScript's parser does not have: whoever calls words it.
        Err(why) if why.why == Refusal::Reported && dialect != Dialect::default() => return None,
        Err(why) => return Some(("recovery-gives-up", format!("{:?} by {}:{}", why.why, why.by.file(), why.by.line()))),
    };
    match (strict, general, error) {
        (Ok(_), _, Some(error)) => Some(("strict-accepts-an-error", error)),
        // It has only the diagnostic that is left out above, which the other has not.
        (Ok(_), Ok(general), None) if general.file.has_parse_diagnostics => None,
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
    let reads_jsdoc = input.has(3) && dialect == Dialect::default();
    run.how = format!("{path} --dialect={name} script={} jsdoc={reads_jsdoc}", input.has(0));
    if shows() {
        show(&run.how, input.text);
    }
    let wrong = run.guarded(|| {
        // After a panic it is in no state to be used again.
        let mut scratch = SCRATCH.take();
        let wrong = match dialect.flow {
            true => {
                only_parse(path.as_bytes(), input.text, dialect, &mut scratch);
                None
            }
            false => agree_one(path.as_bytes(), input.text, reads_jsdoc, dialect, &mut scratch),
        };
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
