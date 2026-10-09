//! What has to be in a text after a step that moves or removes things: sorting imports, sorting the keys of a
//! `package.json`, formatting JSDoc comments. The text that was formatted without the step is compared with the one that was
//! formatted with it, so what the formatter itself changes does not count.

use bun_lint::language::{LanguageOptions, Parser, SourceType};
use bun_sema::atom::{Atom, Intern, Interner};
use bun_sema::hir::{self, StmtKind};
use bun_sema::resolve::Dialect;
use bun_sema::session::Session;
use std::collections::BTreeMap;

/// How often each is there.
pub type Counts = BTreeMap<Vec<u8>, usize>;

fn is_in_a_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$') || byte >= 0x80
}

/// The names, keywords and numbers of `text`, in whatever language it is.
pub fn words(text: &[u8]) -> Counts {
    let mut counts = Counts::new();
    for word in text.split(|&byte| !is_in_a_word(byte)).filter(|it| !it.is_empty()) {
        *counts.entry(word.to_vec()).or_default() += 1;
    }
    counts
}

/// The words that come and go when imports are merged, split, or written in a shorter way.
pub fn is_part_of_an_import(word: &[u8]) -> bool {
    matches!(word, b"import" | b"export" | b"from" | b"as" | b"type" | b"typeof" | b"with" | b"assert" | b"default")
}

/// What is in `a` and not at all in `b`.
pub fn missing<'c>(a: &'c Counts, b: &Counts) -> Vec<&'c [u8]> {
    a.keys().filter(|it| !b.contains_key(*it)).map(|it| &it[..]).collect()
}

/// What is in `a` more often than in `b`.
pub fn fewer<'c>(a: &'c Counts, b: &Counts) -> Vec<&'c [u8]> {
    (a.iter().filter(|(key, count)| b.get(*key).is_some_and(|it| it < *count)))
        .map(|(key, _)| &key[..])
        .collect()
}

/// How often each letter is in `text`, whether capital or small, and how many bytes are not ASCII.
pub fn letters(text: &[u8]) -> [usize; 27] {
    let mut counts = [0; 27];
    for &byte in text {
        match byte {
            _ if byte.is_ascii_alphabetic() => counts[usize::from(byte.to_ascii_lowercase() - b'a')] += 1,
            0x80.. => counts[26] += 1,
            _ => {}
        }
    }
    counts
}

/// What a program has that sorting its imports must keep.
#[derive(Default)]
pub struct Program {
    /// What is imported and what is exported with braces or a star, name by name: in which statement does not count.
    pub names: Counts,
    /// Of each of `names` that is an import with a name here: that name.
    pub locals: BTreeMap<Vec<u8>, Vec<u8>>,
    pub comments: Counts,
    /// The text without those statements, comments and white space.
    pub rest: Vec<u8>,
    /// The words of that.
    pub words: Counts,
}

fn without_white_space(text: &[u8]) -> Vec<u8> {
    text.iter().copied().filter(|it| !it.is_ascii_whitespace()).collect()
}

fn read(file: &hir::File<'_>, atoms: &dyn Intern, text: &[u8]) -> Program {
    let mut program = Program::default();
    let name = |atom: Atom| if atom.is_none() { &b""[..] } else { atoms.bytes(atom) };
    let span = |id: hir::StmtId| file.stmts.get(id.idx()).map_or(0..0, |it| it.start as usize..it.loc.end as usize);
    // From its `{`: one plugin writes `with` for `assert`. Without the comments, which are compared by themselves.
    let attributes = |id: hir::StmtId| {
        let span = span(id);
        let Some(found) = file.import_attributes.iter().find(|it| span.contains(&(it.0 as usize))) else {
            return Vec::new();
        };
        let mut written = Vec::new();
        let mut at = found.0 as usize;
        for &(start, end) in file.comments.iter().filter(|it| span.contains(&(it.0 as usize)) && it.0 >= found.0) {
            written.extend(without_white_space(text.get(at..start as usize).unwrap_or_default()));
            at = end as usize;
        }
        written.extend(without_white_space(text.get(at..span.end).unwrap_or_default()));
        let from = written.iter().position(|&it| it == b'{').unwrap_or(written.len());
        written.drain(..from);
        written.retain(|&it| !matches!(it, b',' | b';'));
        written
    };
    let mut cut: Vec<core::ops::Range<usize>> = Vec::new();
    let add = |program: &mut Program, parts: &[&[u8]], local: Option<&[u8]>| {
        let key = parts.join(&0);
        if let Some(local) = local {
            program.locals.insert(key.clone(), local.to_vec());
        }
        *program.names.entry(key).or_default() += 1;
    };
    for import in file.imports.iter() {
        cut.push(span(import.stmt));
        let (from, with) = (name(import.spec), attributes(import.stmt));
        let kind = |is_type: bool| match (is_type || import.type_only, import.is_deferred) {
            (true, _) => &b"import type"[..],
            (false, true) => b"import defer",
            (false, false) => b"import",
        };
        for (what, local) in [(&b"default"[..], import.default), (b"*", import.namespace)] {
            if !local.is_none() {
                add(&mut program, &[kind(false), from, &with, what, name(local)], Some(name(local)));
            }
        }
        let named = file.import_specs.get(import.named.range()).unwrap_or_default();
        for it in named {
            let local = name(it.local);
            add(&mut program, &[kind(it.type_only), from, &with, name(it.imported), local], Some(local));
        }
        // For what it does, or `import {} from "a"`.
        if import.default.is_none() && import.namespace.is_none() && named.is_empty() {
            add(&mut program, &[b"import", from, &with], None);
        }
    }
    for export in file.exports.iter() {
        cut.push(span(export.stmt));
        let (from, with) = (name(export.spec), attributes(export.stmt));
        let items = file.export_specs.get(export.items.range()).unwrap_or_default();
        for it in items {
            let kind: &[u8] = if export.type_only || it.type_only { b"export type" } else { b"export" };
            add(&mut program, &[kind, from, &with, name(it.local), name(it.exported)], None);
        }
        if items.is_empty() {
            add(&mut program, &[b"export", from, &with], None);
        }
    }
    for statement in file.stmts.iter() {
        if matches!(statement.kind, StmtKind::ImportEquals(_) | StmtKind::ExportStar { .. }) {
            let span = statement.start as usize..statement.loc.end as usize;
            let written = without_white_space(text.get(span.clone()).unwrap_or_default());
            add(&mut program, &[written.strip_suffix(b";").unwrap_or(&written)], None);
            cut.push(span);
        }
    }
    for &(start, end) in file.comments.iter() {
        let comment = text.get(start as usize..end as usize).unwrap_or_default();
        *program.comments.entry(without_white_space(comment)).or_default() += 1;
        cut.push(start as usize..end as usize);
    }
    cut.sort_by_key(|it| it.start);
    cut.push(text.len()..text.len());
    let mut at = 0;
    for span in cut {
        let between = text.get(at..span.start).unwrap_or_default();
        for (word, count) in words(between) {
            *program.words.entry(word).or_default() += count;
        }
        program.rest.extend(without_white_space(between));
        at = at.max(span.end);
    }
    // What is left of a statement that was cut, what `semi: false` puts before the next, and the comma after the last of a list
    // that is broken because a comment in it has become longer.
    program.rest.retain(|&it| !matches!(it, b';' | b','));
    program
}

/// `text`, which the formatter has printed for the file at `path`, as it parses it. Nothing: it has errors.
pub fn program(path: &[u8], text: &[u8]) -> Option<Program> {
    let is_typescript = [&b".ts"[..], b".tsx", b".mts", b".cts"].iter().any(|it| path.ends_with(it));
    let language = LanguageOptions {
        parser: if is_typescript { Parser::TypeScript } else { Parser::Espree },
        source_type: SourceType::Module,
        ..LanguageOptions::default()
    };
    let how = language.parse_options(path);
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    bun_js_parser::sema::with_summary(
        Dialect::babel(false),
        (session.arena(), &session),
        path,
        how.script_kind,
        text,
        atoms.of_this_thread(),
        how.experimental_decorators,
        how.every_file_is_a_module,
        |file, atoms| (!file.has_errors && !file.has_parse_diagnostics).then(|| read(&file, atoms, text)),
    )
}
