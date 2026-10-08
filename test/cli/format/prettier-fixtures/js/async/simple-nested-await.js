async function f() {
  const a = await (await request()).json();
  const b = await fs.writeFile(file, await (await request()).text());
}
