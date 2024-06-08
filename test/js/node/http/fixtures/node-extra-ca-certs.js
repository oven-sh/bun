(async () => {
  const port = process.argv[2] ? parseInt(process.argv[2]) : null;

  try {
    const res = await fetch(`https://localhost:${port}`, {
      tls: {
        rejectUnauthorized: true,
      },
    });
    const t = await res.text();
    console.log(`res: ${t}`);
    process.exit(0);
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
})();
