//! Bun's two readers of JSON, as long as there are two: the index with its second stage, and the one that goes through the text
//! once. They have to say the same about every text: the kind of the error, every message with its place, all rows with the places
//! of keys, values and closing brackets, numbers bit by bit.

#![no_main]

use bun_fuzz::{Input, Run, show, shows};
use bun_lint::json::comparison::describe;

const OPTIONS: [&str; 7] = ["json", "strict-document", "jsonc", "document", "locs", "env", "manifest"];

/// The index says `ParserError` and the other `SyntaxError` about a text over 8 KB that has an error and a bad `/` far behind it.
fn without_the_first_word(said: &[u8]) -> &[u8] {
    let end = said.iter().position(|it| !it.is_ascii_alphabetic()).unwrap_or(said.len());
    match &said[..end] {
        b"ParserError" | b"SyntaxError" => &said[end..],
        _ => said,
    }
}

fn run(data: &[u8]) {
    let Some(input) = Input::new(data) else {
        return;
    };
    let mut run = Run::new(data);
    for name in OPTIONS {
        run.how = name.to_owned();
        let Some((index, one_pass)) = run.guarded(|| (describe(name, false, input.text), describe(name, true, input.text)))
        else {
            return;
        };
        if shows() {
            show(name, &index);
        }
        if without_the_first_word(&index) != without_the_first_word(&one_pass) {
            let at = index.iter().zip(&one_pass).position(|(a, b)| a != b).unwrap_or(index.len().min(one_pass.len()));
            let near = |said: &[u8]| String::from_utf8_lossy(&said[at.saturating_sub(40)..said.len().min(at + 60)]).into_owned();
            run.report("readers-differ", name, &format!("index:    {}\none pass: {}", near(&index), near(&one_pass)));
        }
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| run(data));
