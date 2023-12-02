const { SERVER } = process.env;

try {
  const result = await fetch(SERVER).then(res => res.text());
  if (result !== "Hello World") process.exit(2);
} catch (err) {
  process.exit(err.code.indexOf("CERT") !== -1 ? 1 : 3);
}
