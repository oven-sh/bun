try {
  const response = await fetch(process.env.SERVER, {
    tls: {
      rejectUnauthorized: true,
    },
  }).then(res => res.text());
  process.exit(response === "OK" ? 0 : 1);
} catch (err) {
  console.error(err);
  process.exit(1);
}
