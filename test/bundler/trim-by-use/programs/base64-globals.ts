console.log(btoa("hello"), atob("aGVsbG8="), btoa("\u00ff"), atob(" aGk "));
try {
  btoa("\u20ac");
} catch (error: any) {
  console.log(error.name);
}
try {
  atob("!");
} catch (error: any) {
  console.log(error.name);
}
