//! `bun format --check .` and `bun lint .` as a whole, in a directory whose configuration file is the input: how configuration
//! files, ignore files and `.editorconfig` are found, read and applied, the globs of overrides, the options of rules.
//!
//! After a line `-----` in the configuration: the text of `base.json`, for the first to extend. With the second flag of the input
//! the command writes: `bun format --write .`, after which `bun format --check .` has to find nothing, and `bun lint --fix .`.
//!
//! The directory is in `FUZZ_DIRECTORY`, which should be in memory, or in the directory for temporary files. Nothing is written
//! but there. A configuration that is a program is not run, and no plugin is loaded.

#![no_main]

use bun_fuzz::{Input, Run, show, shows};
use bun_lint_driver::js_plugin::{Engine, Vm};
use bun_lint_driver::{Environment, Outcome, Script, Stream};
use std::path::PathBuf;
use std::sync::OnceLock;

/// The name of the file that the text is written to, and whether `bun lint` reads it.
const FILES: [(&str, bool); 24] = [
    (".prettierrc", false),
    (".prettierrc.json", false),
    (".prettierrc.json5", false),
    (".prettierrc.yaml", false),
    (".prettierrc.yml", false),
    (".prettierrc.toml", false),
    ("package.json", false),
    ("package.yaml", false),
    (".editorconfig", false),
    (".prettierignore", false),
    (".gitignore", false),
    (".oxfmtrc.json", false),
    (".oxfmtrc.jsonc", false),
    ("sub/.prettierrc", false),
    ("sub/.editorconfig", false),
    ("sub/.oxfmtrc.json", false),
    (".oxlintrc.json", true),
    (".eslintrc.json", true),
    (".eslintrc", true),
    (".eslintrc.yaml", true),
    ("package.json", true),
    (".eslintignore", true),
    (".gitignore", true),
    ("sub/.oxlintrc.json", true),
];

/// What is formatted and linted, unless the input has a text of its own for `a.ts`.
const SOURCES: [(&str, &str); 8] = [
    ("a.ts", "import { b, a } from \"./x\";\nimport fs from \"node:fs\";\n/** @param {string} c d */\nexport function f(c: string) {\n  if (c == null) var d = [1, 2,];\n  return a(b, fs, d)\n}\n"),
    ("b.css", "a{color:RED;margin:0 0 0 0}\n"),
    ("c.md", "# a\n\n* b\n* c\n\n```js\nlet x=1\n```\n"),
    ("d.json", "{\"a\":1,\"b\":[1,2]}\n"),
    ("e.yaml", "a:   1\nb: [c,d]\n"),
    ("f.html", "<div><p class=\"b a\">c</p><script>let x=1</script></div>\n"),
    ("sub/g.jsx", "export const G = () => <a b='c'>{d}</a>\n"),
    ("sub/h.vue", "<template><a :b=\"c\"/></template>\n<script>export default {}</script>\n"),
];

struct NoEngine;

impl Engine for NoEngine {
    fn with_vm(&self, _size: usize, _then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        Err(b"no JavaScript here".to_vec())
    }
}

fn run_script(_script: &Script) -> Result<Vec<u8>, Vec<u8>> {
    Err(b"no JavaScript here".to_vec())
}

fn directory() -> &'static PathBuf {
    static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
    DIRECTORY.get_or_init(|| {
        // As Bun does when it starts. The command runs on the threads of Bun's pool.
        bun_core::output::stdio::init();
        let parent = std::env::var_os("FUZZ_DIRECTORY").map_or_else(std::env::temp_dir, PathBuf::from);
        let directory = parent.join(format!("fuzz-config-{}", std::process::id()));
        let _ = std::fs::create_dir_all(directory.join("sub"));
        // Where the search for configuration files ends.
        let _ = std::fs::create_dir_all(directory.join(".git"));
        for (name, text) in SOURCES {
            let _ = std::fs::write(directory.join(name), text);
        }
        directory
    })
}

fn format(how: &[u8], environment: &Environment) -> Option<Outcome> {
    let options = bun_lint_driver::fmt::cli::Options::parse(&[b"--threads=1", how, b"."]).ok()?;
    Some(bun_lint_driver::fmt::run(&options, environment))
}

fn lint(more: &[&[u8]], environment: &Environment) -> Option<Outcome> {
    let mut arguments: Vec<&[u8]> = vec![b"--threads=1", b"."];
    arguments.extend_from_slice(more);
    let options = bun_lint_driver::cli::Options::parse(&arguments).ok()?;
    Some(bun_lint_driver::run(&options, environment))
}

fn run(data: &[u8]) {
    let Some(input) = Input::new(data) else {
        return;
    };
    let (name, is_for_lint) = FILES[input.variant as usize % FILES.len()];
    let directory = directory();
    // The text for `a.ts` follows a line of five `=`.
    let separator = b"\n=====\n";
    let at = input.text.windows(separator.len()).position(|it| it == separator);
    let (config, source) = match at {
        Some(at) => (&input.text[..at], &input.text[at + separator.len()..]),
        None => (input.text, SOURCES[0].1.as_bytes()),
    };
    // What it can extend follows a line of five `-`.
    let separator = b"\n-----\n";
    let at = config.windows(separator.len()).position(|it| it == separator);
    let (config, base) = match at {
        Some(at) => (&config[..at], Some(&config[at + separator.len()..])),
        None => (config, None),
    };
    let _ = std::fs::write(directory.join(name), config);
    let _ = std::fs::write(directory.join("a.ts"), source);
    if let Some(base) = base {
        let _ = std::fs::write(directory.join("base.json"), base);
    }
    let writes = input.has(1);
    let mut run = Run::new(data);
    run.how = match (is_for_lint, writes) {
        (true, true) => format!("bun lint --fix . with {name}"),
        (true, false) => format!("bun lint . with {name}"),
        (false, true) => format!("bun format --write . with {name}"),
        (false, false) => format!("bun format --check . with {name}"),
    };
    if shows() {
        show(&run.how, config);
    }
    let stream = Stream { is_tty: false, colors: false };
    let environment = Environment {
        cwd: directory.clone().into_os_string().into_encoded_bytes(),
        stdout: stream,
        stderr: stream,
        is_ai_agent: false,
        is_github_action: false,
        libs: bun_sema_driver::Libs::Directory(b""),
        run_script: &run_script,
        js_engine: &NoEngine,
        version: b"0.0.0-fuzz",
    };
    let has_parsing_error = |it: &Outcome| [&it.stdout, &it.stderr].iter().any(|it| it.windows(13).any(|it| it == b"Parsing error"));
    // Whether all files are parsed before anything is fixed.
    let parsed_before = (writes && is_for_lint)
        .then(|| run.guarded(|| lint(&[], &environment)).flatten())
        .flatten()
        .is_some_and(|it| !has_parsing_error(&it));
    let outcome: Option<Outcome> = run.guarded(|| match is_for_lint {
        true => {
            let mut more: Vec<&[u8]> = Vec::new();
            if input.has(0) {
                more.push(b"--fix-dry-run");
            }
            if writes {
                more.push(b"--fix");
            }
            lint(&more, &environment)
        }
        false => format(if writes { b"--write" } else { b"--check" }, &environment),
    })
    .flatten();
    // What has been written is formatted. Not a text of the fuzzer's: Prettier itself does not always print what it leaves alone.
    if let Some(first) = outcome.as_ref().filter(|it| writes && !is_for_lint && it.exit_code == 0 && source == SOURCES[0].1.as_bytes())
        && let Some(Some(second)) = run.guarded(|| format(b"--check", &environment))
        && second.exit_code != 0
        // Not the files of the fuzzer's, which are formatted too: garbage is not always printed as what is left alone.
        && SOURCES.iter().any(|(name, _)| {
            let line = format!("] {name}");
            [&second.stdout, &second.stderr].iter().any(|it| it.windows(line.len()).any(|it| it == line.as_bytes()))
        })
    {
        let detail = [&first.stdout[..], &first.stderr, b"\n", &second.stdout, &second.stderr].concat();
        run.report("not-formatted-after-write", name, &String::from_utf8_lossy(&detail));
    }
    // No fix that is written makes a text that is not parsed of one that was.
    if parsed_before
        && let Some(Some(after)) = run.guarded(|| lint(&[], &environment))
        && has_parsing_error(&after)
    {
        run.report("fix-breaks-the-syntax", name, &String::from_utf8_lossy(&[&after.stdout[..], &after.stderr].concat()));
    }
    let _ = std::fs::remove_file(directory.join(name));
    let _ = std::fs::remove_file(directory.join("base.json"));
    if writes {
        for (name, text) in SOURCES {
            let _ = std::fs::write(directory.join(name), text);
        }
    }
    let Some(outcome) = outcome else {
        return;
    };
    if shows() {
        show(&format!("exit code {}", outcome.exit_code), &[&outcome.stdout[..], &outcome.stderr].concat());
    }
    if outcome.exit_code > 2 {
        run.report("exit-code", &format!("{name}-{}", outcome.exit_code), "");
    }
    // What says that there is a bug in Bun.
    if outcome.stderr.windows(10).any(|it| it == b"bug in Bun") {
        run.report("alarm", name, &String::from_utf8_lossy(&outcome.stderr));
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
