const bar = (...varargs:any[]) => {
  console.log(varargs);
};

const foo = (x:string):void => (
  bar(
    x,
    () => {},
    () => {}
  )
);

app.get("/", (req, res): void => {
  res.send("Hello world");
});
