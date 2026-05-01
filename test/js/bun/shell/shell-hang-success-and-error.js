Bun.$.throws(true);
await Bun.$`echo 1 && not-found-command-1234`;
