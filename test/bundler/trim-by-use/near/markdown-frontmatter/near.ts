// A renderer skips front matter and reads none of it.
console.log(Bun.markdown.html("---\ntitle: trim\n---\n# Body\n"));
console.log(Bun.markdown.html('+++\ntitle = "trim"\n+++\n# Body\n', { frontmatter: false }));
