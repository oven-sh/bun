async function f1() { (await f()).length }
async function g() {
  invariant(
    (await driver.navigator.getUrl()).substr(-7)
  );
}
function *f2(){
  !(yield a);
}
async function f3() {
  a = !await f();
}
async () => {
  new A(await x);
  obj[await x];
}
