//! `bun format` on bytes. `FUZZ_TARGET`, or the name of the program after `fuzz_`, says which
//! language: html, handlebars, css, yaml, markdown, graphql, json, js. `embedded`: the text is in a text in another language.
//! `imports`: JavaScript with what plugins of Prettier and oxfmt do: sorted imports, formatted JSDoc comments. `options`: the same, and
//! the options are part of the input.
//! `md` is not the formatter: `bun_md`, which is behind `Bun.markdown`, renders the text as HTML.

#![no_main]

mod kept;

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

/// Where the text of the target `embedded` is: the name of the file, what is before the text, what is after it, and whether that
/// is a template of JavaScript.
type Place = (&'static str, &'static str, &'static str, bool);

/// seeds.ts knows the order.
const PLACES: &[Place] = &[
    ("a.js", "html`", "`;\n", true),
    ("a.js", "/* HTML */ `", "`;\n", true),
    ("a.ts", "@Component({\n  template: `", "`,\n})\nclass A {}\n", true),
    ("a.js", "const a = {\n  b: [\n    html`", "`,\n  ],\n};\n", true),
    ("a.md", "```html\n", "\n```\n", false),
    ("a.md", "```vue\n", "\n```\n", false),
    ("a.md", "- a\n\n  ```html\n  ", "\n  ```\n", false),
    ("a.vue", "<template>\n", "\n</template>\n", false),
    ("a.vue", "<template lang=\"html\">\n", "\n</template>\n", false),
    ("a.vue", "<template lang=\"pug\">\n", "\n</template>\n", false),
    ("a.vue", "<script>\n", "\n</script>\n", false),
    ("a.vue", "<script setup lang=\"ts\">\n", "\n</script>\n", false),
    ("a.vue", "<script lang=\"tsx\">\n", "\n</script>\n", false),
    ("a.vue", "<style>\n", "\n</style>\n", false),
    ("a.vue", "<style lang=\"scss\" scoped>\n", "\n</style>\n", false),
    ("a.vue", "<style lang=\"less\">\n", "\n</style>\n", false),
    ("a.vue", "<i18n>\n", "\n</i18n>\n", false),
    ("a.vue", "<custom lang=\"json\">\n", "\n</custom>\n", false),
    ("a.vue", "<docs lang=\"markdown\">\n", "\n</docs>\n", false),
    ("a.vue", "<custom lang=\"yaml\">\n", "\n</custom>\n", false),
    ("a.vue", "<template><a :b=\"", "\" /></template>\n", false),
    ("a.vue", "<template><a @b=\"", "\" /></template>\n", false),
    ("a.vue", "<template><a v-for=\"", "\" /></template>\n", false),
    ("a.vue", "<template><a #b=\"", "\" /></template>\n", false),
    ("a.vue", "<template>{{ ", " }}</template>\n", false),
    ("a.vue", "<script setup lang=\"ts\" generic=\"", "\"></script>\n", false),
    ("a.html", "<script>\n", "\n</script>\n", false),
    ("a.html", "<script type=\"module\">", "</script>\n", false),
    ("a.html", "<script type=\"application/json\">", "</script>\n", false),
    ("a.html", "<script type=\"text/markdown\">\n", "\n</script>\n", false),
    ("a.html", "<script type=\"text/x-handlebars-template\">\n", "\n</script>\n", false),
    ("a.html", "<script type=\"text/babel\" lang=\"tsx\">", "</script>\n", false),
    ("a.html", "<div><style>\n", "\n</style></div>\n", false),
    ("a.html", "<a style=\"", "\"></a>\n", false),
    ("a.html", "<a class=\"", "\"></a>\n", false),
    ("a.html", "<img srcset=\"", "\" sizes=\"a\" />\n", false),
    ("a.html", "<a onclick=\"", "\"></a>\n", false),
    ("a.html", "---\n", "\n---\n<a></a>\n", false),
    ("a.html", "<pre>\n", "</pre>\n", false),
    ("a.html", "<!-- ", " -->\n", false),
    ("a.component.html", "<a [b]=\"", "\"></a>\n", false),
    ("a.component.html", "<a (b)=\"", "\"></a>\n", false),
    ("a.component.html", "<a *ngFor=\"", "\"></a>\n", false),
    ("a.component.html", "<a i18n=\"", "\"></a>\n", false),
    ("a.component.html", "<a b=\"{{ ", " }}\"></a>\n", false),
    ("a.component.html", "{{ ", " }}\n", false),
    ("a.component.html", "@if (", ") {\n  a\n}\n", false),
    ("a.component.html", "@for (", ") {\n  a\n}\n", false),
    ("a.component.html", "@defer (", ") {\n  a\n}\n", false),
    ("a.component.html", "@let a = ", ";\n", false),
    ("a.js", "css`", "`;\n", true),
    ("a.js", "styled.a`", "`;\n", true),
    ("a.jsx", "<style jsx>{`", "`}</style>;\n", true),
    ("a.js", "graphql`", "`;\n", true),
    ("a.js", "/* GraphQL */ `", "`;\n", true),
    ("a.js", "markdown`", "`;\n", true),
    ("a.md", "```js\n", "\n```\n", false),
    ("a.md", "```tsx\n", "\n```\n", false),
    ("a.md", "```css\n", "\n```\n", false),
    ("a.md", "```json\n", "\n```\n", false),
    ("a.md", "```yaml\n", "\n```\n", false),
    ("a.md", "```graphql\n", "\n```\n", false),
    ("a.md", "```md\n", "\n```\n", false),
    ("a.md", "```hbs\n", "\n```\n", false),
    ("a.md", "---\n", "\n---\n\na\n", false),
    ("a.css", "---\n", "\n---\na {\n}\n", false),
    ("a.mdx", "export const a = ", ";\n\nb\n", false),
    ("a.mdx", "<A b={", "} />\n", false),
];

/// The text that is formatted. In a template the bytes 1, 2 and 3 are substitutions, and a backtick has a backslash before it.
fn in_its_place((_, before, after, is_template): Place, text: &[u8]) -> Vec<u8> {
    let mut whole = before.as_bytes().to_vec();
    for &byte in text {
        match byte {
            1 if is_template => whole.extend_from_slice(b"${x}"),
            2 if is_template => whole.extend_from_slice(b"${a.b(c, d)}"),
            3 if is_template => whole.extend_from_slice(b"${html`<e>${f}</e>`}"),
            b'`' if is_template => whole.extend_from_slice(b"\\`"),
            _ => whole.push(byte),
        }
    }
    whole.extend_from_slice(after.as_bytes());
    whole
}

/// Where the text of the target `imports` is. seeds.ts knows the order.
const PLACES_OF_IMPORTS: [Place; 16] = [
    ("a.ts", "", "", false),
    ("a.js", "", "", false),
    ("a.tsx", "", "", false),
    ("a.jsx", "", "", false),
    ("a.mts", "", "", false),
    ("a.md", "```ts\n", "\n```\n", false),
    ("a.md", "```js\n", "\n```\n", false),
    ("a.md", "```tsx\n", "\n```\n", false),
    ("a.md", "a\n\n```jsx\n", "\n```\n\nb\n", false),
    ("a.mdx", "", "\n\n# a\n", false),
    ("a.mdx", "```ts\n", "\n```\n", false),
    ("a.vue", "<script>\n", "\n</script>\n", false),
    ("a.vue", "<script setup lang=\"ts\">\n", "\n</script>\n\n<template>\n  <a />\n</template>\n", false),
    ("a.vue", "<script lang=\"tsx\">\n", "\n</script>\n", false),
    ("a.html", "<script type=\"module\">\n", "\n</script>\n", false),
    ("a.html", "<script lang=\"ts\">\n", "\n</script>\n", false),
];

/// For the target `imports`: options that are not Prettier's own. seeds.ts and imports-oracle.mjs know the order.
const EXTRAS: [&[(&str, &str)]; 16] = [
    &[
        ("plugins", r#"["@trivago/prettier-plugin-sort-imports"]"#),
        ("importOrder", r#"["^@a/(.*)$", "<THIRD_PARTY_MODULES>", "^[./]"]"#),
        ("importOrderSeparation", "true"),
        ("importOrderSortSpecifiers", "true"),
    ],
    &[
        ("plugins", r#"["@trivago/prettier-plugin-sort-imports"]"#),
        ("importOrder", r#"["<BUILTIN_MODULES>", "^[./]"]"#),
        ("importOrderGroupNamespaceSpecifiers", "true"),
        ("importOrderCaseInsensitive", "true"),
        ("importOrderSideEffects", "false"),
        ("importOrderSortByLength", "asc"),
    ],
    &[
        ("plugins", r#"["@trivago/prettier-plugin-sort-imports"]"#),
        ("importOrder", r#"["<THIRD_PARTY_TS_TYPES>", "<TS_TYPES>^[./]", "^[./]"]"#),
        ("importOrderGroupNamespaceSpecifiers", "true"),
        ("importOrderSeparation", "true"),
    ],
    &[
        ("plugins", r#"["@trivago/prettier-plugin-sort-imports"]"#),
        ("importOrder", r#"["^a", "<SEPARATOR>", "<THIRD_PARTY_MODULES>", "^[./]"]"#),
        ("importOrderSeparation", "true"),
        ("importOrderSortByLength", "desc"),
        ("importOrderImportAttributesKeyword", "assert"),
    ],
    &[("plugins", r#"["@ianvs/prettier-plugin-sort-imports"]"#)],
    &[
        ("plugins", r#"["@ianvs/prettier-plugin-sort-imports"]"#),
        ("importOrder", r#"["<BUILTIN_MODULES>", "", "<THIRD_PARTY_MODULES>", "<TYPES>", "", "^[.]", "<TYPES>^[.]"]"#),
        ("importOrderTypeScriptVersion", "5.0.0"),
        ("importOrderCaseSensitive", "true"),
        ("importOrderSafeSideEffects", r#"["^[.]"]"#),
    ],
    &[
        ("plugins", r#"["@ianvs/prettier-plugin-sort-imports"]"#),
        ("importOrder", r#"["", "<BUILTIN_MODULES>", "", "<THIRD_PARTY_MODULES>", "", "^[./]"]"#),
        ("importOrderTypeScriptVersion", "5.0.0"),
    ],
    &[
        ("plugins", r#"["@ianvs/prettier-plugin-sort-imports"]"#),
        ("importOrder", r#"["^[./]", "<THIRD_PARTY_MODULES>"]"#),
        ("importOrderTypeScriptVersion", "4.0.0"),
    ],
    &[("plugins", r#"["prettier-plugin-organize-imports"]"#)],
    &[
        ("plugins", r#"["prettier-plugin-organize-imports"]"#),
        ("organizeImportsSkipDestructiveCodeActions", "true"),
        ("organizeImportsTypeOrder", "first"),
        ("tsconfig.jsx", "react"),
    ],
    &[
        ("plugins", r#"["prettier-plugin-organize-imports"]"#),
        ("organizeImportsTypeOrder", "inline"),
        ("tsconfig.jsx", "react"),
        ("tsconfig.jsxFactory", "a.b"),
    ],
    &[("flavor", "oxfmt"), ("sortImports", "{}")],
    &[
        ("flavor", "oxfmt"),
        (
            "sortImports",
            r#"{"ignoreCase":false,"newlinesBetween":false,"order":"desc","partitionByComment":true,"partitionByNewline":true,"sortSideEffects":true}"#,
        ),
    ],
    &[
        ("flavor", "oxfmt"),
        (
            "sortImports",
            r#"{"customGroups":[{"groupName":"a","elementNamePattern":["a","a-*"]},{"groupName":"b","elementNamePattern":["@*/**"],"modifiers":["type"]},{"groupName":"c","selector":"style"}],"groups":["a","b",["builtin","external"],{"newlinesBetween":false},"side_effect","unknown","c"],"internalPattern":["@a/"]}"#,
        ),
    ],
    &[("flavor", "oxfmt"), ("jsdoc", "true")],
    &[
        ("flavor", "oxfmt"),
        ("jsdoc", "true"),
        ("jsdoc.capitalizeDescriptions", "false"),
        ("jsdoc.commentLineStrategy", "multiline"),
        ("jsdoc.separateTagGroups", "true"),
        ("jsdoc.descriptionWithDot", "true"),
        ("jsdoc.preferCodeFences", "true"),
        ("jsdoc.lineWrappingStyle", "balance"),
    ],
];

const TARGETS: &[Target] = &[
    // See `PLACES_OF_IMPORTS` and `EXTRAS`.
    Target {
        name: "imports",
        variants: &[],
        growth: 8,
    },
    // The first line of the text is the options, as they are in a configuration file. See `PLACES_OF_IMPORTS`.
    Target {
        name: "options",
        variants: &[],
        growth: 8,
    },
    // See `PLACES`.
    Target {
        name: "embedded",
        variants: &[],
        growth: 8,
    },
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
            // What the name of a file says.
            ("a.htm", None),
            ("a.xhtml", None),
            ("A.HTML", None),
            ("a.hta", None),
            ("a.inc", None),
            ("a.xht", None),
            ("a.html.hl", None),
            ("a.Component.Html", None),
            ("a.VUE", None),
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
    ("sortPackageJson", "true"),
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
    // As `bun format` has it.
    let mut options = FormatOptions {
        embedded_html: true,
        ..FormatOptions::default()
    };
    let mut flags = String::new();
    let mut set = |name: &str, value: &str| {
        let _ = options.set(name.as_bytes(), value.as_bytes());
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
    // `Bun.markdown.ansi` and `bun file.md`. No images: that would read files.
    let theme = bun_md::root::ansi::Theme {
        light: input.has(28),
        columns: u16::from(input.width),
        colors: input.has(29),
        hyperlinks: input.has(30),
        kitty_graphics: false,
        remote_image_paths: None,
        image_base_dir: None,
    };
    let rendered = run.guarded(|| bun_md::root::ansi::render_to_ansi(input.text, options, theme));
    if let Some(Ok(Some(rendered))) = rendered {
        if shows() {
            show("for a terminal", &rendered);
        }
        if str::from_utf8(input.text).is_ok() && str::from_utf8(&rendered).is_err() {
            run.report("not-utf8", "ansi", "");
        }
    }
}

/// An option of a configuration file, as a name and the value as it is written, a string without its quotes. An object that is the
/// value of `jsdoc`: each of its properties by itself.
fn written(name: &[u8], value: &bun_lint::options::Json) -> Vec<(Vec<u8>, Vec<u8>)> {
    use bun_lint::options::Json;
    let text = |value: &Json| match value {
        Json::String(text) => text.clone(),
        other => {
            let mut out = Vec::new();
            other.stringify(&mut out);
            out
        }
    };
    match value {
        Json::Object(properties) if name == b"jsdoc" => std::iter::once((name.to_vec(), b"{}".to_vec()))
            .chain(properties.iter().map(|(property, value)| ([b"jsdoc.", &property[..]].concat(), text(value))))
            .collect(),
        _ => vec![(name.to_vec(), text(value))],
    }
}

/// What `text` says, as Bun's parsers for JSON, JSON5 and YAML read it. Nothing: they do not read it.
fn value_of(target: &str, path: &str, text: &[u8]) -> Option<bun_lint::options::Json> {
    use bun_lint::json::{Notation, parse, parse_as};
    use bun_lint::options::Json;
    /// Prettier drops the blanks at the ends of the lines of a block scalar, and line breaks at its end.
    fn without_blanks_at_ends(value: Json) -> Json {
        let text = |text: Vec<u8>| {
            let lines: Vec<&[u8]> = text.split(|&it| it == b'\n').map(<[u8]>::trim_ascii_end).collect();
            lines.join(&b'\n').trim_ascii_end().to_vec()
        };
        match value {
            Json::String(it) => Json::String(text(it)),
            Json::Array(all) => Json::Array(all.into_iter().map(without_blanks_at_ends).collect()),
            Json::Object(all) => {
                Json::Object(all.into_iter().map(|(key, value)| (text(key), without_blanks_at_ends(value))).collect())
            }
            other => other,
        }
    }
    match target {
        "yaml" => parse_as(Notation::Yaml, text).ok().map(without_blanks_at_ends),
        _ if path.ends_with(".json5") => parse_as(Notation::Json5, text).ok(),
        _ => parse(text),
    }
}

/// `options` without what moves or removes things: sorted imports, sorted keys, formatted JSDoc comments. Nothing: they ask
/// for none of that.
fn without_steps(options: &FormatOptions) -> Option<FormatOptions> {
    let has_steps = options.sort_imports.is_some() || options.jsdoc.is_some() || options.sort_package_json.is_some();
    has_steps.then(|| FormatOptions {
        sort_imports: None,
        jsdoc: None,
        sort_package_json: None,
        ..options.clone()
    })
}

/// The words of the JSDoc comments among `comments`, in small letters, without the names of tags, and the other comments.
fn split_comments(comments: &kept::Counts) -> (kept::Counts, kept::Counts) {
    let (mut words, mut others) = (kept::Counts::new(), kept::Counts::new());
    for (comment, &count) in comments {
        if !comment.starts_with(b"/**") {
            others.insert(comment.clone(), count);
            continue;
        }
        let mut text = comment.to_ascii_lowercase();
        let mut is_in_tag = false;
        for byte in &mut text {
            is_in_tag = *byte == b'@' || (is_in_tag && byte.is_ascii_alphabetic());
            if is_in_tag {
                *byte = b' ';
            }
        }
        for (word, more) in kept::words(&text) {
            *words.entry(word).or_default() += count * more;
        }
    }
    (words, others)
}

/// `plain`: the text formatted without the steps that move or remove things. `stepped`: with them, as `options` has it.
fn check_what_is_kept(run: &Run, variant: &str, path: &str, (plain, stepped): (&[u8], &[u8]), options: &FormatOptions) {
    let report = |kind: &str, all: Vec<&[u8]>| {
        let Some(first) = all.first() else {
            return;
        };
        let readable: Vec<_> = all.iter().map(|it| String::from_utf8_lossy(it).replace('\0', " ")).collect();
        run.report(kind, &format!("{variant}-{}", shape(first)), &readable.join("\n"));
    };
    let is_code = [".ts", ".js", ".tsx", ".jsx", ".mts"].iter().any(|it| path.ends_with(it));
    let program = |text: &[u8]| kept::program(path.as_bytes(), text).filter(|_| is_code);
    let Some((a, b)) = program(plain).zip(program(stepped)) else {
        let (a, b) = (kept::words(plain), kept::words(stepped));
        let missing = |a, b| {
            let mut all = kept::missing(a, b);
            all.retain(|it| !kept::is_part_of_an_import(it));
            all
        };
        // A tag can go, and a word can get a capital letter.
        let (lost, added) = match options.jsdoc {
            Some(_) => ("word-lost-with-jsdoc", "word-added-with-jsdoc"),
            None => ("word-lost", "word-added"),
        };
        report(lost, missing(&a, &b));
        report(added, missing(&b, &a));
        // Merged imports name their module once.
        if options.jsdoc.is_none() {
            let mut less_often = kept::fewer(&a, &b);
            less_often.retain(|it| !kept::is_part_of_an_import(it));
            report("word-less-often", less_often);
        }
        let applies = options.sort_imports.as_deref().is_none_or(|it| it.applies_to_embedded_code());
        if !applies && !is_code && options.jsdoc.is_none() && plain != stepped {
            run.report("changed-by-a-step-that-does-not-apply", variant, "");
        }
        if options.sort_package_json.is_some() {
            report("word-more-often", kept::fewer(&b, &a));
        }
        return;
    };
    // `prettier-plugin-organize-imports` removes what nothing uses. A name that is nowhere else is not used.
    let removes_unused = options.sort_imports.as_deref().is_some_and(|it| it.needs_symbols());
    let is_named = |import: &&[u8]| a.locals.get(*import).is_none_or(|local| a.words.contains_key(local));
    let (lost, removed): (Vec<&[u8]>, Vec<&[u8]>) =
        kept::missing(&a.names, &b.names).into_iter().partition(|it| !removes_unused || is_named(it));
    report(if removes_unused { "import-removed-though-named" } else { "import-lost" }, lost);
    report("import-added", kept::missing(&b.names, &a.names));
    report("import-less-often", kept::fewer(&a.names, &b.names));
    report("import-more-often", kept::fewer(&b.names, &a.names));
    if a.rest != b.rest {
        let same = a.rest.iter().zip(&b.rest).take_while(|(x, y)| x == y).count();
        let from = |rest: &[u8]| String::from_utf8_lossy(&rest[same.min(rest.len())..(same + 60).min(rest.len())]).into_owned();
        let (x, y) = (from(&a.rest), from(&b.rest));
        run.report("rest-changed", &format!("{variant}-{}~{}", shape(x.as_bytes()), shape(y.as_bytes())), &format!("- {x}\n+ {y}"));
    }
    let ((words, others), (words_after, others_after)) = match options.jsdoc {
        Some(_) => (split_comments(&a.comments), split_comments(&b.comments)),
        None => ((kept::Counts::new(), a.comments), (kept::Counts::new(), b.comments)),
    };
    report("jsdoc-word-lost", kept::missing(&words, &words_after));
    report("jsdoc-word-added", kept::missing(&words_after, &words));
    // The comments of an import go with it.
    if removed.is_empty() {
        report("comment-lost", kept::missing(&others, &others_after));
        report("comment-less-often", kept::fewer(&others, &others_after));
    }
    report("comment-added", kept::missing(&others_after, &others));
    report("comment-more-often", kept::fewer(&others_after, &others));
}

/// With `FUZZ_RECORD=<file>`: what was formatted, how, what has become of it, and what becomes of it without the steps that
/// move or remove things, is appended to the file, for imports-oracle.mjs. Each part has its length before it, in four bytes.
fn record(how: &str, text: &[u8], results: [Option<&Result<Vec<u8>, Refusal>>; 2]) {
    let Some(path) = std::env::var_os("FUZZ_RECORD") else {
        return;
    };
    let mut all = Vec::new();
    let mut add = |part: &[u8]| {
        all.extend_from_slice(&(part.len() as u32).to_le_bytes());
        all.extend_from_slice(part);
    };
    add(how.as_bytes());
    add(text);
    for result in results {
        match result {
            Some(Ok(out)) => [b"formatted", &out[..]].map(&mut add),
            Some(Err(refusal)) => [format!("{refusal:?}").as_bytes(), b""].map(&mut add),
            None => [&b""[..], b""].map(&mut add),
        };
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().append(true).create(true).open(path) {
        let _ = std::io::Write::write_all(&mut file, &all);
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
    let which = input.variant as usize;
    let whole;
    let (first_line, rest) = match input.text.iter().position(|&it| it == b'\n') {
        Some(at) if target.name == "options" => (&input.text[..at], &input.text[at + 1..]),
        _ => (&b""[..], input.text),
    };
    let (path, parser, mut variant, text) = match (target.name, target.variants) {
        ("imports" | "options", _) => {
            let place = PLACES_OF_IMPORTS[which % PLACES_OF_IMPORTS.len()];
            whole = in_its_place(place, rest);
            (place.0, None, format!("{}", which % PLACES_OF_IMPORTS.len()), &whole[..])
        }
        (_, []) => {
            whole = in_its_place(PLACES[which % PLACES.len()], input.text);
            (PLACES[which % PLACES.len()].0, None, format!("{}", which % PLACES.len()), &whole[..])
        }
        (_, variants) => {
            let (path, parser) = variants[which % variants.len()];
            (path, parser, parser.unwrap_or(path).to_owned(), input.text)
        }
    };
    let (mut options, mut flags) = options_of(&input, parser);
    let _ = options.set(b"filepath", path.as_bytes());
    if target.name == "imports" {
        let mut settings = bun_format::sort_imports::Settings::default();
        let extra = which / PLACES_OF_IMPORTS.len() % EXTRAS.len();
        variant.push_str(&format!("-{extra}"));
        for (name, value) in EXTRAS[extra] {
            if !settings.set(name.as_bytes(), value.as_bytes()) {
                let _ = options.set(name.as_bytes(), value.as_bytes());
            }
            flags.push_str(&format!(" --{name}={value}"));
        }
        options.sort_imports = settings.compile().ok().flatten();
    }
    let mut run = Run::new(data);
    if target.name == "options" {
        let Some(bun_lint::options::Json::Object(all)) = bun_lint::json::parse(first_line) else {
            return;
        };
        run.how = format!("{path} {}", String::from_utf8_lossy(first_line));
        let mut settings = bun_format::sort_imports::Settings::default();
        let compiled = run.guarded(|| {
            for (name, value) in &all {
                for (name, value) in written(name, value) {
                    if !settings.set(&name, &value) {
                        let _ = options.set(&name, &value);
                    }
                    flags.push_str(&format!(" --{}={}", String::from_utf8_lossy(&name), String::from_utf8_lossy(&value)));
                }
            }
            settings.compile()
        });
        // What is wrong with them is for the user.
        let Some(Ok(compiled)) = compiled else {
            return;
        };
        options.sort_imports = compiled;
    }
    run.how = format!("{path}{flags}");
    // For triage.ts.
    if let Some(path) = std::env::var_os("FUZZ_TEXT") {
        let _ = std::fs::write(path, text);
    }
    if shows() {
        show(&run.how, text);
    }
    let format_with = |text: &[u8], options: &FormatOptions| {
        run.guarded(|| format_for_tests(path.as_bytes(), text, options, true).map(|it| it.0))
    };
    let format = |text: &[u8]| format_with(text, &options);
    let size = text.len().max(1).ilog2();
    let Some(result) = format(text) else {
        return;
    };
    let plain = without_steps(&options).and_then(|plain| format_with(text, &plain));
    record(&run.how, text, [Some(&result), plain.as_ref()]);
    let once = match result {
        Err(refusal) => {
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
                Refusal::Syntax if matches!(plain, Some(Ok(_))) => {
                    run.report("refused-only-with-the-step", &format!("{variant}-2e{size}"), "");
                }
                Refusal::Syntax => {}
                Refusal::Bug(what) => run.report("alarm", &format!("{variant}-{what}-2e{size}"), what),
                // Prettier damages it too, or the check is wrong, or the formatter is.
                Refusal::Loss(what) => run.report("loss", &format!("{variant}-2e{size}"), what),
            }
            return;
        }
        Ok(once) => once,
    };
    // To see that the checks notice: the first line that imports something is dropped.
    let once = match std::env::var_os("FUZZ_SABOTAGE") {
        Some(_) => {
            let mut lines: Vec<&[u8]> = once.split_inclusive(|&it| it == b'\n').collect();
            if let Some(at) = lines.iter().position(|it| it.trim_ascii_start().starts_with(b"import ")) {
                lines.remove(at);
            }
            lines.concat()
        }
        None => once,
    };
    if shows() {
        show("formatted", &once);
    }
    // For triage.ts.
    if let Some(path) = std::env::var_os("FUZZ_OUT") {
        let _ = std::fs::write(path, &once);
    }
    if str::from_utf8(text).is_ok() && str::from_utf8(&once).is_err() {
        run.report("not-utf8", &variant, "");
    }
    let printed = len_without_indentation(&once);
    if printed / target.growth.max(1) > text.len() + 64 && target.growth != usize::MAX {
        let detail = format!("{} bytes become {printed}, and {} with the indentation", text.len(), once.len());
        run.report("growth", &variant, &detail);
    }
    // The value that Bun's own parser reads is the same before and after.
    let wraps_prose = input.has(13) || input.has(14);
    let is_text = str::from_utf8(text).is_ok();
    if matches!(target.name, "json" | "yaml") && plain.is_none() && input.flags >> 30 < 2 && !wraps_prose && is_text {
        let values = run.guarded(|| (value_of(target.name, path, text), value_of(target.name, path, &once)));
        // Most are Prettier's own: one of each shape, for triage.ts to ask it.
        let key = format!("{variant}-{}", shape(&once));
        match values {
            Some((Some(before), Some(after))) if before != after => run.report("value-changed", &key, ""),
            Some((Some(_), None)) => run.report("value-cannot-be-read", &key, ""),
            _ => {}
        }
    }
    match &plain {
        Some(Ok(plain)) => {
            if shows() {
                show("formatted without the steps", plain);
            }
            check_what_is_kept(&run, &variant, path, (plain, &once), &options);
        }
        Some(Err(refusal)) => run.report("accepted-only-with-the-step", &format!("{variant}-{refusal:?}-2e{size}"), ""),
        // No formatter adds or drops a letter. The pragma has some.
        None if !options.insert_pragma && without_steps(&options).is_none() => {
            let (before, after) = (kept::letters(text), kept::letters(&once));
            // U+FFFD can take the place of a NUL and of what is not UTF-8.
            let counted = if str::from_utf8(text).is_ok() && !text.contains(&0) { before.len() } else { 26 };
            if let Some(at) = (0..counted).find(|&at| before[at] != after[at]) {
                let letter = if at < 26 { (b'a' + at as u8) as char } else { '~' };
                let way = if before[at] > after[at] { "lost" } else { "added" };
                let detail = format!("{letter}: {} times, then {} times", before[at], after[at]);
                run.report(&format!("letter-{way}"), &format!("{variant}-{letter}"), &detail);
            }
        }
        None => {}
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
            // There are many of these.
            let kind = if options.jsdoc.is_some() { "unstable-with-jsdoc" } else { "unstable" };
            run.report(kind, &format!("{variant}-{}~{}", shape(a), shape(b)), &detail);
        }
        Some(Err(Refusal::Loss(what))) => run.report("loss-in-its-own", &format!("{variant}-2e{size}"), what),
        Some(Err(refusal)) => {
            run.report("refuses-its-own", &format!("{variant}-{refusal:?}-2e{size}"), &format!("{refusal:?}"));
        }
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
