const s = Bun.file(0).stream();
// {
//   const r = s.getReader();
//   console.log(await r.read());
//   r.releaseLock();
// }
// {
//   const r = s.getReader();
//   console.log(await r.read());
//   r.releaseLock();
// }
// {
//   const r = s.getReader();
//   console.log(await r.read());
//   r.releaseLock();
// }
// {
//   const r = s.getReader();
//   console.log(await r.read());
//   r.releaseLock();
// }
{
  const r = s.getReader();
  console.log(await r.read());
  r.cancel();
}
{
  try {
    const r = s.getReader();
  } catch (e) {
    console.log("win", e);
  }
}
