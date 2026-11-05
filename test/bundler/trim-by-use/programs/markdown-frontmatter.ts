const yaml = Bun.markdown.frontmatter("---\ntitle: trim\ntags: [a, b]\n---\n# Body\n");
const toml = Bun.markdown.frontmatter('+++\ntitle = "trim"\ndate = 2024-01-31\n+++\n# Body\n');
console.log(JSON.stringify(yaml));
console.log(JSON.stringify(toml), (toml.data as { date: object }).date.constructor.name);
console.log(JSON.stringify(Bun.markdown.frontmatter("# Body\n")));
try {
  Bun.markdown.frontmatter("---\ntitle: [\n---\n");
} catch (error) {
  console.log((error as Error).name, (error as Error).message);
}
