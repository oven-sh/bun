// Fetches process.env.SERVER under the process's NODE_TLS_REJECT_UNAUTHORIZED
// setting and prints the outcome as one JSON line: the body, or the error code.
try {
  const body = await fetch(process.env.SERVER).then(res => res.text());
  console.log(JSON.stringify({ body }));
} catch (err) {
  console.log(JSON.stringify({ code: err.code }));
}
