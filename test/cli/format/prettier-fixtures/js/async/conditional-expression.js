async function f() {
  const result = typeof fn === 'function' ? await fn() : null;
}

(async function() {
  console.log(
    await (true ? Promise.resolve("A") : Promise.resolve("B"))
  );
})()

async function f2() {
  await (spellcheck && spellcheck.setChecking(false));
  await spellcheck && spellcheck.setChecking(false)
}
