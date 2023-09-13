const { SERVER } = process.env;

try {
  const result = await fetch(SERVER).then(res => res.text());
  if (result !== "Hello World") process.exit(2);
} catch (err) {
  process.exit(err.code === "ERR_TLS_CERT_ALTNAME_INVALID" ? 1 : 3);
}
