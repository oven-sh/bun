export function ComponentInAnotherFile1() {
  return <p className="another-file">Component in another file 1</p>;
}

export function MyList({ children }) {
  return <div className="list">{children}</div>;
}
