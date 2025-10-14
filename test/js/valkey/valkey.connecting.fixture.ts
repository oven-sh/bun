import { RedisClient } from "bun";

function getOptions() {
  if (process.env.BUN_VALKEY_TLS) {
    const paths = JSON.parse(process.env.BUN_VALKEY_TLS);
    return {
      tls: {
        key: Bun.file(paths.key),
        cert: Bun.file(paths.cert),
        ca: Bun.file(paths.ca),
      },
    };
  }
  return {};
}

{
  const client = new RedisClient(process.env.BUN_VALKEY_URL, getOptions());
  client
    .connect()
    .then(redis => {
      console.log("connected");
      client.close();
    })
    .catch(err => {
      console.error(err);
    });
}
