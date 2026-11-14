/** What ./<file>.test.ts tests of the servers `names` (as AOT_SERVERS takes them), as a test file of its own. */
export async function testServers(file: string, names: string) {
  process.env.AOT_SERVERS = names;
  await import(`./${file}.test.ts`);
}
