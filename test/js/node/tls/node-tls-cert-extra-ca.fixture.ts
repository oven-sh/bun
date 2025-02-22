import tls from "node:tls";

tls
  .connect(
    {
      host: "localhost",
      port: Number(process.env.SERVER_PORT),
      rejectUnauthorized: true,
    },
    () => {
      console.log("Connected Successfully");
      process.exit(0);
    },
  )
  .on("error", err => {
    console.error("Failed to connect:", err);
    process.exit(1);
  });
