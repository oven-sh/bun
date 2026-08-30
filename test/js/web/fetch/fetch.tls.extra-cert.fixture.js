// Fetches process.env.SERVER with strict certificate verification, so only
// the CA store (plus NODE_EXTRA_CA_CERTS) decides the outcome. Prints one JSON
// line: the body, or the error code.
try {
  const body = await fetch(process.env.SERVER, {
    tls: {
      rejectUnauthorized: true,
    },
  }).then(res => res.text());
  console.log(JSON.stringify({ body }));
} catch (err) {
  console.log(JSON.stringify({ code: err.code }));
}
