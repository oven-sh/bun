for ((async) of []);
for ((foo) of async);
for ((foo) of []) async;

async function f() {
  for await (async of []);
  for await ((async) of []);
  for await ((foo) of async);
  for await ((foo) of []) async;
}
