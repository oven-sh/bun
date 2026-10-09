//! `bun format --check .` and `bun lint .` as a whole, in a directory whose configuration file is the input: how configuration
//! files, ignore files and `.editorconfig` are found, read and applied, the globs of overrides, the options of rules.
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
    fn with_vm(&self, _among: usize, _then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
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
    let _ = std::fs::write(directory.join(name), config);
    let _ = std::fs::write(directory.join("a.ts"), source);
    let mut run = Run::new(data);
    run.how = format!("{} with {name}", if is_for_lint { "bun lint ." } else { "bun format --check ." });
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
    let outcome: Option<Outcome> = run.guarded(|| match is_for_lint {
        true => {
            let mut arguments: Vec<&[u8]> = vec![b"--threads=1", b"."];
            if input.has(0) {
                arguments.push(b"--fix-dry-run");
            }
            bun_lint_driver::cli::Options::parse(&arguments).ok().map(|it| bun_lint_driver::run(&it, &environment))
        }
        false => bun_lint_driver::fmt::cli::Options::parse(&[b"--threads=1", b"--check", b"."])
            .ok()
            .map(|it| bun_lint_driver::fmt::run(&it, &environment)),
    })
    .flatten();
    let _ = std::fs::remove_file(directory.join(name));
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
