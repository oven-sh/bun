const envSpecific = {
  domain:
    do {
      if(env === 'production') 'https://abc.mno.com/';
      else if(env === 'development') 'http://localhost:4000';
    }
};

let x = do {
  let tmp = f();
  tmp * tmp + 1
};

let y = do {
  if (foo()) { f() }
  else if (bar()) { g() }
  else { h() }
};

function foo() {
  return (
    <nav>
      <Home />
      {
        do {
          if (loggedIn) {
            <LogoutButton />
          } else {
            <LoginButton />
          }
        }
      }
    </nav>
  );
}

(do {});
(do {} + 1);
(1 + do {});
() => do {};

(do {
  switch(0) {
    case 0: "foo";
    case 1: break;
  }
});

() => do {
  var obj = { foo: "bar", bar: "foo" };
  for (var key in obj) {
    obj[key];
  }
};

() => (    ) => do {
  var obj = { foo: "bar", bar: "foo" };
  for (var key in obj) {
    obj[key];
  }
};

a =>b=>     c => do {
  var obj = { foo: "bar", bar: "foo" };
  for (var key in obj) {
    obj[key];
  }
};
