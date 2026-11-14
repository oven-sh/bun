try {
  console.log(typeof Bun.markdown.render("![a](b)", new Blob([]) as any));
} catch (error) {
  console.log("threw", (error as Error).name, (error as Error).message);
}
