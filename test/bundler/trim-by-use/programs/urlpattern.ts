declare const URLPattern: any;
const pattern = new URLPattern({ pathname: "/users/:id/posts/:post(\\d+)" });
console.log(
  pattern.test("https://example.com/users/7/posts/9"),
  pattern.test("https://example.com/users/7/posts/nine"),
);
console.log(JSON.stringify(pattern.exec("https://example.com/users/7/posts/9")?.pathname.groups));
const whole = new URLPattern("https://*.example.com/:rest*");
console.log(whole.hostname, whole.pathname, whole.exec("https://a.example.com/x/y")?.hostname.groups[0]);
try {
  new URLPattern({ pathname: "/(" });
} catch (error) {
  console.log((error as Error).name);
}
