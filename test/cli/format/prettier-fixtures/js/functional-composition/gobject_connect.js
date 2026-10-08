button.connect(
  "clicked",
  () => doSomething()
);
app.connect(
  "activate",
  async () => {
    await data.load();
    win.show_all();
  }
);
