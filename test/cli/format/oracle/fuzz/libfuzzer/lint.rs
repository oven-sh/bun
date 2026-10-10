//! `bun lint` on bytes: every rule that needs neither types nor other files, with its default
//! options, and with the comments of the text that configure rules. Or, with flag 6, with a configuration of
//! its own: the first line of the text is a configuration object, whose rules are on with its options, alone or
//! (flag 7) beside all the others.

#![no_main]

use bun_fuzz::{Input, Run, show, shows};
use bun_lint::ast::File;
use bun_lint::language::{Parser, SourceType};
use bun_lint::context::Severity;
use bun_lint::linter::{LintOptions, LintResult, Registry, ResolvedConfig};
use bun_lint::options::Json;
use bun_lint::runner::RuleEntry;
use bun_sema::atom::{Intern, Interner};
use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
use bun_sema::session::Session;
use std::sync::OnceLock;

type Linter = bun_lint::linter::Linter<bun_lint_driver::rules::Rules>;

const VARIANTS: [(&str, Parser, SourceType); 20] = [
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
    // Some rules go by the name of the file.
    ("a.test.js", Parser::Espree, SourceType::Module),
    ("a.test.ts", Parser::TypeScript, SourceType::Module),
    ("a.spec.tsx", Parser::TypeScript, SourceType::Module),
    ("__tests__/a.jsx", Parser::Espree, SourceType::Module),
    ("pages/a.jsx", Parser::Espree, SourceType::Module),
    ("pages/_document.tsx", Parser::TypeScript, SourceType::Module),
    ("app/layout.tsx", Parser::TypeScript, SourceType::Module),
    ("a.stories.tsx", Parser::TypeScript, SourceType::Module),
];

/// What rules of plugins read beside their options.
const SETTINGS: &[u8] = br#"{"settings":{
"react":{"version":"16.0","linkComponents":["Link",{"name":"A","linkAttribute":"to"}],"formComponents":["Form"]},
"jsx-a11y":{"components":{"Button":"button","Img":"img"},"polymorphicPropName":"as","attributes":{"for":["htmlFor","for"]}},
"next":{"rootDir":"app"},
"jsdoc":{"tagNamePreference":{"returns":"return","param":"arg"},"ignorePrivate":true,"ignoreInternal":true},
"vitest":{"typecheck":true}}}"#;

struct Setup {
    linter: Linter,
    /// For each of `VARIANTS`, as ESLint and as oxlint have it, without and with `SETTINGS`.
    configs: Vec<[ResolvedConfig; 4]>,
}

/// Not by their names: what a name stands for depends on whose configuration it is in.
fn needs_only_the_file(rule: &RuleEntry) -> bool {
    !rule.meta.requires_types && !rule.meta.needs_modules
}

/// Every rule that `config` says nothing of, with its default options.
fn turn_on_the_rest(linter: &Linter, config: &mut ResolvedConfig) {
    for &rule in linter.registry().all().iter().filter(|it| needs_only_the_file(it)) {
        if config.rule(rule).is_none() {
            config.configure(rule, Severity::Error, &[]);
        }
    }
}

fn set_language(config: &mut ResolvedConfig, variant: usize, is_oxlint: bool) {
    let (path, parser, source_type) = VARIANTS[variant];
    // How the comments of a text name rules.
    config.prefers_typescript_rules = is_oxlint;
    config.language.parser = parser;
    config.language.source_type = source_type;
    config.language.jsx = path.ends_with('x');
    config.language.is_oxlint = is_oxlint;
    config.understands_oxlint_comments = is_oxlint;
}

/// `None`: it is no JSON, the command would stop at it, or it turns on a rule that needs more than the file.
fn own_config(json: &[u8], variant: usize, is_oxlint: bool, with_the_rest: bool) -> Option<ResolvedConfig> {
    let linter = &setup().linter;
    let json = bun_lint::json::parse(json)?;
    let mut config = ResolvedConfig::from_json(linter.registry(), &json, &mut Vec::new());
    if config.error.is_some() || !config.configured().all(|it| needs_only_the_file(it.entry)) {
        return None;
    }
    if with_the_rest {
        turn_on_the_rest(linter, &mut config);
    }
    set_language(&mut config, variant, is_oxlint);
    Some(config)
}

fn setup() -> &'static Setup {
    static SETUP: OnceLock<Setup> = OnceLock::new();
    SETUP.get_or_init(|| {
        let all = [
            bun_lint_eslint::RULES,
            bun_lint_typescript::RULES,
            bun_lint_plugins::RULES,
            bun_lint_unicorn::RULES,
            bun_lint_react::RULES,
            bun_lint_jest::RULES,
        ];
        let linter = Linter::new(Registry::new(&all));
        let configs = (0..VARIANTS.len()).map(|variant| {
            [0, 1, 2, 3].map(|which| {
                let json = if which & 2 != 0 { bun_lint::json::parse(SETTINGS) } else { None };
                let json = json.unwrap_or(Json::Null);
                let mut config = ResolvedConfig::from_json(linter.registry(), &json, &mut Vec::new());
                turn_on_the_rest(&linter, &mut config);
                set_language(&mut config, variant, which & 1 != 0);
                config
            })
        });
        let configs: Vec<_> = configs.collect();
        Setup { linter, configs }
    })
}

/// As `verify_as` in src/lint/driver/lint.rs. `None`: the text is nested too deeply.
fn lint(path: &[u8], text: &[u8], config: &ResolvedConfig, options: &LintOptions) -> Option<LintResult> {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let how = config.language.parse_options(path);
    bun_sema_parser::with_summary(
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
    let mut run = Run::new(data);
    let mut text = input.text;
    let own;
    let config = if input.has(6) {
        let end = text.iter().position(|&it| it == b'\n').unwrap_or(text.len());
        run.how = format!("the configuration {}", String::from_utf8_lossy(&text[..end]));
        let made = run.guarded(|| own_config(&text[..end], which, input.has(0), input.has(7)));
        let Some(made) = made.flatten() else {
            return;
        };
        own = made;
        text = text.get(end + 1..).unwrap_or_default();
        &own
    } else {
        &setup().configs[which][usize::from(input.has(0)) + 2 * usize::from(input.has(5))]
    };
    let fixes = input.has(1);
    let options = LintOptions {
        allow_inline_config: !input.has(2),
        wants_fixes: fixes || input.has(3),
        wants_suppressions: input.has(4),
        ..LintOptions::default()
    };
    run.how = format!(
        "{path} {parser:?} {source_type:?} oxlint={} settings={} own={} rest={} fix={fixes} inline={} fixes={} suppressions={}",
        input.has(0),
        input.has(5),
        input.has(6),
        input.has(7),
        options.allow_inline_config,
        options.wants_fixes,
        options.wants_suppressions
    );
    if shows() {
        show(&run.how, input.text);
    }
    if shows() && input.has(6) {
        show("rules that are configured", config.configured().count().to_string().as_bytes());
    }
    let too_deep = || LintResult::default();
    let Some(first) = run.guarded(|| lint(path.as_bytes(), text, config, &options)) else {
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
        bun_lint::linter::verify_and_fix(text, &|_| true, &mut |text| {
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
        if str::from_utf8(text).is_ok() && str::from_utf8(&fixed.output).is_err() {
            run.report("not-utf8", path, "");
        }
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
