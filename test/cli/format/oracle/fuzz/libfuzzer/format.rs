//! `bun format` on bytes. `FUZZ_TARGET`, or the name of the program after `fuzz_`, says which
//! language: html, handlebars, css, yaml, markdown, graphql, json, js. `md` is not the formatter: `bun_md`, which is behind
//! `Bun.markdown`, renders the text as HTML.

#![no_main]

use bun_format::FormatOptions;
use bun_fuzz::{Input, Run, shape, show, shows};
use bun_lint_driver::fmt::{Refusal, format_for_tests};
use std::sync::OnceLock;

/// The name of the file, and Prettier's `parser` if the name does not say it.
type Variant = (&'static str, Option<&'static str>);

struct Target {
    name: &'static str,
    variants: &'static [Variant],
    /// What is printed, less the indentation, is at most this many times as long as the text.
    growth: usize,
}

const TARGETS: &[Target] = &[
    Target {
        name: "html",
        variants: &[
            ("a.html", None),
            ("a.vue", None),
            ("a.component.html", None),
            ("a.html", Some("lwc")),
            ("a.mjml", None),
            ("a.html", Some("__ng_action")),
            ("a.html", Some("__ng_binding")),
            ("a.html", Some("__ng_directive")),
            ("a.html", Some("__ng_interpolation")),
        ],
        growth: 8,
    },
    Target { name: "handlebars", variants: &[("a.hbs", None)], growth: 8 },
    Target {
        name: "css",
        variants: &[("a.css", None), ("a.scss", None), ("a.less", None)],
        growth: 8,
    },
    Target { name: "yaml", variants: &[("a.yaml", None)], growth: 8 },
    // The cells of a table are as wide as the widest of their column.
    Target { name: "markdown", variants: &[("a.md", None), ("a.mdx", None)], growth: usize::MAX },
    Target { name: "md", variants: &[], growth: 32 },
    Target { name: "graphql", variants: &[("a.graphql", None)], growth: 8 },
    Target {
        name: "json",
        variants: &[
            ("a.json", None),
            ("a.json5", None),
            ("a.jsonc", None),
            ("a.json", Some("json-stringify")),
            ("package.json", None),
            (".prettierrc", None),
        ],
        growth: 8,
    },
    Target {
        name: "js",
        variants: &[
            ("a.js", None),
            ("a.jsx", None),
            ("a.ts", None),
            ("a.tsx", None),
            ("a.mjs", None),
            ("a.cjs", None),
            ("a.mts", None),
            ("a.cts", None),
            ("a.d.ts", None),
            ("a.js", Some("flow")),
            ("a.js", Some("babel-flow")),
            ("a.js.flow", None),
            ("a.js", Some("babel-ts")),
            ("a.js", Some("typescript")),
            ("a.js", Some("babel")),
        ],
        growth: 8,
    },
];

/// What each bit of the flags sets.
const FLAGS: [(&str, &str); 30] = [
    ("useTabs", "true"),
    ("tabWidth", "4"),
    ("tabWidth", "0"),
    ("singleQuote", "true"),
    ("bracketSameLine", "true"),
    ("endOfLine", "crlf"),
    ("endOfLine", "auto"),
    ("semi", "false"),
    ("htmlWhitespaceSensitivity", "strict"),
    ("htmlWhitespaceSensitivity", "ignore"),
    ("vueIndentScriptAndStyle", "true"),
    ("embeddedLanguageFormatting", "off"),
    ("singleAttributePerLine", "true"),
    ("proseWrap", "always"),
    ("proseWrap", "never"),
    ("insertPragma", "true"),
    ("requirePragma", "true"),
    ("trailingComma", "none"),
    ("trailingComma", "es5"),
    ("arrowParens", "avoid"),
    ("experimentalTernaries", "true"),
    ("objectWrap", "collapse"),
    ("quoteProps", "consistent"),
    ("experimentalOperatorPosition", "start"),
    ("bracketSpacing", "false"),
    ("jsxSingleQuote", "true"),
    ("embeddedHtml", "true"),
    ("flavor", "oxfmt"),
    ("jsdoc", "true"),
    ("checkIgnorePragma", "true"),
];

fn target() -> &'static Target {
    static TARGET: OnceLock<&'static Target> = OnceLock::new();
    TARGET.get_or_init(|| {
        let name = bun_fuzz::target_name();
        TARGETS.iter().find(|it| it.name == name).unwrap_or_else(|| {
            let names: Vec<_> = TARGETS.iter().map(|it| it.name).collect();
            eprintln!("FUZZ_TARGET={name}: it is none of {names:?}");
            std::process::exit(2)
        })
    })
}

/// The options that `input` asks for, and the same as flags of the command line.
fn options_of(input: &Input, parser: Option<&str>) -> (FormatOptions, String) {
    let (mut options, mut flags) = (FormatOptions::default(), String::new());
    let mut set = |name: &str, value: &str| {
        match name {
            "embeddedHtml" => options.embedded_html = true,
            _ => _ = options.set(name.as_bytes(), value.as_bytes()),
        }
        flags.push_str(&format!(" --{name}={value}"));
    };
    if let Some(parser) = parser {
        set("parser", parser);
    }
    if input.width != 0 {
        set("printWidth", &input.width.to_string());
    }
    for (bit, (name, value)) in FLAGS.iter().enumerate() {
        if input.has(bit as u32) {
            set(name, value);
        }
    }
    let [first, second] = input.offsets.map(|it| it.to_string());
    match input.flags >> 30 {
        2 => set("cursorOffset", &first),
        3 => {
            set("rangeStart", &first);
            set("rangeEnd", &second);
        }
        _ => {}
    }
    (options, flags)
}

/// The length of `text` without the blanks at the start of each line.
fn len_without_indentation(text: &[u8]) -> usize {
    text.split(|&byte| byte == b'\n')
        .map(|line| line.trim_ascii_start().len() + 1)
        .sum()
}

fn first_difference<'t>(a: &'t [u8], b: &'t [u8]) -> (&'t [u8], &'t [u8]) {
    let lines = |text: &'t [u8]| text.split(|&byte| byte == b'\n').chain(std::iter::repeat(&b""[..]));
    let count = a.len().max(b.len());
    (lines(a).zip(lines(b)).take(count + 1))
        .find(|(a, b)| a != b)
        .unwrap_or_default()
}

/// `bun_md`: each bit of the flags is one of its options.
fn render_markdown(data: &[u8], input: &Input) {
    let (mut options, mut run) = (bun_md::root::Options::default(), Run::new(data));
    for (bit, (name, _, set)) in bun_md::root::Options::BOOL_FIELD_SETTERS.iter().enumerate() {
        set(&mut options, input.has(bit as u32));
        if input.has(bit as u32) {
            run.how.push_str(&format!(" {name}"));
        }
    }
    if shows() {
        show(&run.how, input.text);
    }
    let Some(Ok(html)) = run.guarded(|| bun_md::root::render_to_html_with_options(input.text, options)) else {
        return;
    };
    if shows() {
        show("rendered", &html);
    }
    if str::from_utf8(input.text).is_ok() && str::from_utf8(&html).is_err() {
        run.report("not-utf8", "md", "");
    }
    if html.len() / 32 > input.text.len() + 64 {
        run.report("growth", "md", &format!("{} bytes become {}", input.text.len(), html.len()));
    }
}

fn run(data: &[u8]) {
    let Some(input) = Input::new(data) else {
        return;
    };
    let target = target();
    if target.name == "md" {
        return render_markdown(data, &input);
    }
    let (path, parser) = target.variants[input.variant as usize % target.variants.len()];
    let (options, flags) = options_of(&input, parser);
    let variant = parser.unwrap_or(path);
    let mut run = Run::new(data);
    run.how = format!("{path}{flags}");
    let text = input.text;
    if shows() {
        show(&run.how, text);
    }
    let format = |text: &[u8]| {
        run.guarded(|| format_for_tests(path.as_bytes(), text, &options, true).map(|it| it.0))
    };
    let size = text.len().max(1).ilog2();
    let once = match format(text) {
        None => return,
        Some(Err(refusal)) => {
            if shows() {
                show(&format!("{refusal:?}"), b"");
            }
            // For triage.ts: what would have been printed.
            if let Some(out) = std::env::var_os("FUZZ_OUT").filter(|_| refusal != Refusal::Syntax)
                && let Some(Ok(printed)) = run.guarded(|| format_for_tests(path.as_bytes(), text, &options, false))
            {
                let _ = std::fs::write(out, printed.0);
            }
            match refusal {
                Refusal::Syntax => {}
                Refusal::Bug(what) => run.report("alarm", &format!("{variant}-{what}-2e{size}"), what),
                // Prettier damages it too, or the check is wrong, or the formatter is.
                Refusal::Loss(what) => run.report("loss", &format!("{variant}-2e{size}"), what),
            }
            return;
        }
        Some(Ok(once)) => once,
    };
    if shows() {
        show("formatted", &once);
    }
    // For triage.ts.
    if let Some(path) = std::env::var_os("FUZZ_OUT") {
        let _ = std::fs::write(path, &once);
    }
    if str::from_utf8(text).is_ok() && str::from_utf8(&once).is_err() {
        run.report("not-utf8", variant, "");
    }
    let printed = len_without_indentation(&once);
    if printed / target.growth.max(1) > text.len() + 64 && target.growth != usize::MAX {
        let detail = format!("{} bytes become {printed}, and {} with the indentation", text.len(), once.len());
        run.report("growth", variant, &detail);
    }
    // Only a whole text is formatted to what stays as it is.
    if input.flags >> 30 >= 2 {
        return;
    }
    match format(&once) {
        None => {}
        Some(Ok(twice)) if twice == once => {}
        Some(Ok(twice)) => {
            if shows() {
                show("formatted again", &twice);
            }
            let (a, b) = first_difference(&once, &twice);
            let detail = format!("- {}\n+ {}", String::from_utf8_lossy(a), String::from_utf8_lossy(b));
            run.report("unstable", &format!("{variant}-{}~{}", shape(a), shape(b)), &detail);
        }
        Some(Err(Refusal::Loss(_))) => {}
        Some(Err(refusal)) => {
            run.report("refuses-its-own", &format!("{variant}-{refusal:?}-2e{size}"), &format!("{refusal:?}"));
        }
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
