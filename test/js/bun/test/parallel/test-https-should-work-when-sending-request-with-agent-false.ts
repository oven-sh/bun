import https from "node:https";

const { promise, resolve, reject } = Promise.withResolvers();
const client = https.request("https://example.com/", { agent: false });
client.on("error", reject);
client.on("close", resolve);
client.end();
await promise;
