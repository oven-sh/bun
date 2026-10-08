//! `bun lint` on bytes: every rule that needs neither types nor other files, with its default
//! options, and with the comments of the text that configure rules.

#![no_main]

use bun_fuzz::{Input, Run, show, shows};
use bun_lint::ast::File;
use bun_lint::language::{Parser, SourceType};
use bun_lint::linter::{LintOptions, LintResult, Linter, Registry, ResolvedConfig, RuleId};
use bun_lint::options::Json;
use bun_sema::atom::{Intern, Interner};
use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
use bun_sema::session::Session;
use std::sync::OnceLock;

const VARIANTS: [(&str, Parser, SourceType); 12] = [
    ("a.js", Parser::Espree, SourceType::Module),
    ("a.js", Parser::Espree, SourceType::Script),
    ("a.js", Parser::Espree, SourceType::CommonJs),
    ("a.jsx", Parser::Espree, SourceType::Module),
    ("a.ts", Parser::TypeScript, SourceType::Module),
    ("a.tsx", Parser::TypeScript, SourceType::Module),
    ("a.d.ts", Parser::TypeScript, SourceType::Module),
    ("a.cts", Parser::TypeScript, SourceType::Script),
    ("a.mts", Parser::TypeScript, SourceType::Module),
    ("a.js", Parser::TypeScript, SourceType::Module),
    ("a.jsx", Parser::TypeScript, SourceType::Module),
    ("a.mjs", Parser::Espree, SourceType::Module),
];

struct Setup {
    linter: Linter,
    /// For each of `VARIANTS`, as ESLint and as oxlint have it.
    configs: Vec<[ResolvedConfig; 2]>,
}

fn setup() -> &'static Setup {
    static SETUP: OnceLock<Setup> = OnceLock::new();
    SETUP.get_or_init(|| {
        let all = [bun_lint_eslint::RULES, bun_lint_typescript::RULES, bun_lint_plugins::RULES];
        let rules = (all.iter().flat_map(|it| it.iter()))
            .filter(|it| !it.meta.requires_types && !it.meta.needs_modules)
            .map(|it| (RuleId::Known(it.meta).to_vec(), Json::Number(2.0)))
            .collect();
        let json = Json::Object(vec![(b"rules".to_vec(), Json::Object(rules))]);
        let linter = Linter::new(Registry::new(&all));
        let configs = VARIANTS.map(|(path, parser, source_type)| {
            [false, true].map(|is_oxlint| {
                let mut config = ResolvedConfig::from_json(linter.registry(), &json, &mut Vec::new());
                config.language.parser = parser;
                config.language.source_type = source_type;
                config.language.jsx = path.ends_with('x');
                config.language.is_oxlint = is_oxlint;
                config.understands_oxlint_comments = is_oxlint;
                config
            })
        });
        Setup { linter, configs: configs.into() }
    })
}

/// As `verify_as` in src/lint/driver/lint.rs. `None`: the text is nested too deeply.
fn lint(path: &[u8], text: &[u8], config: &ResolvedConfig, options: &LintOptions) -> Option<LintResult> {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let how = config.language.parse_options(path);
    bun_js_parser::sema::with_summary(
        how.dialect,
        (session.arena(), &session),
        path,
        how.script_kind,
        text,
        atoms.of_this_thread(),
        how.experimental_decorators,
        how.every_file_is_a_module,
        |hir, atoms| {
            let bind_options = BindOptions {
                emit_standard_class_fields: true,
                before_es2020: false,
                before_es2017: false,
            };
            let mut recycled = Recycled::of_this_thread();
            let bound = bind_for_lint_in(&hir, bind_options, atoms, &mut recycled);
            if hir.ran_out_of_stack || bound.ran_out_of_stack {
                return None;
            }
            let file = File::new(path, &hir, bound, atoms, &config.language, None);
            Some(setup().linter.lint(&file, config, options))
        },
    )
}

fn is_refused(result: &LintResult) -> bool {
    matches!(&result.messages[..], [only] if only.is_fatal)
}

fn run(data: &[u8]) {
    let Some(input) = Input::new(data) else {
        return;
    };
    let which = input.variant as usize % VARIANTS.len();
    let (path, parser, source_type) = VARIANTS[which];
    let config = &setup().configs[which][usize::from(input.has(0))];
    let fixes = input.has(1);
    let options = LintOptions {
        allow_inline_config: !input.has(2),
        wants_fixes: fixes || input.has(3),
        wants_suppressions: input.has(4),
        ..LintOptions::default()
    };
    let mut run = Run::new(data);
    run.how = format!(
        "{path} {parser:?} {source_type:?} oxlint={} fix={fixes} inline={} fixes={} suppressions={}",
        input.has(0),
        options.allow_inline_config,
        options.wants_fixes,
        options.wants_suppressions
    );
    if shows() {
        show(&run.how, input.text);
    }
    let too_deep = || LintResult::default();
    let Some(first) = run.guarded(|| lint(path.as_bytes(), input.text, config, &options)) else {
        return;
    };
    if shows() {
        let count = first.as_ref().map(|it| (it.messages.len(), is_refused(it)));
        show(&format!("(messages, is refused): {count:?}"), b"");
    }
    let Some(first) = first.filter(|it| fixes && !is_refused(it)) else {
        return;
    };
    drop(first);
    let fixed = run.guarded(|| {
        bun_lint::linter::verify_and_fix(input.text, &|_| true, &mut |text| {
            lint(path.as_bytes(), text, config, &options).unwrap_or_else(too_deep)
        })
    });
    if let Some(fixed) = fixed.filter(|it| it.is_fixed) {
        if shows() {
            show("fixed", &fixed.output);
        }
        if is_refused(&fixed.result) {
            let size = data.len().max(1).ilog2();
            run.report("fix-breaks-the-syntax", &format!("{path}-{parser:?}-2e{size}"), "");
        }
        if str::from_utf8(input.text).is_ok() && str::from_utf8(&fixed.output).is_err() {
            run.report("not-utf8", path, "");
        }
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
