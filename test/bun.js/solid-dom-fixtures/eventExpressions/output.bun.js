var _tmpl$1 = _template$(
  '<div id="main"><button>Change Bound</button><button>Change Bound</button><button>Change Bound</button><button>Change Bound</button><button>Change Bound</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Delegated</button><button>Click Listener</button><button>Click Capture</button></div>',
  26
);
function hoisted1() {
  console.log("hoisted");
}
const hoisted2 = () => console.log("hoisted delegated");
const template = () => {
  var _el = _tmpl.cloneNode(true),
    _el$1 = _el.firstChild,
    _el$2 = _el$1.nextSibling,
    _el$3 = _el$2.nextSibling,
    _el$4 = _el$3.nextSibling,
    _el$5 = _el$4.nextSibling,
    _el$6 = _el$5.nextSibling,
    _el$7 = _el$6.nextSibling,
    _el$8 = _el$7.nextSibling,
    _el$9 = _el$8.nextSibling,
    _el$10 = _el$9.nextSibling,
    _el$11 = _el$10.nextSibling;
  effect(() => {
    return setAttribute(_el, "onchange", () => console.log("bound"));
  });
  effect(() => {
    return setAttribute(_el$1, "onChange", [
      (id) => console.log("bound", id),
      id,
    ]);
  });
  setAttribute(_el$2, "onchange", handler);
  effect(() => {
    return setAttribute(_el$3, "onchange", [handler]);
  });
  setAttribute(_el$4, "onchange", hoisted1);
  _el$5.$$click = () => console.log("delegated");
  effect(() => {
    return (_el$6.$$click = [(id) => console.log("delegated", id), rowId]);
  });
  effect(() => {
    return (_el$7.$$click = handler);
  });
  effect(() => {
    return (_el$8.$$click = [handler]);
  });
  effect(() => {
    return (_el$9.$$click = hoisted2);
  });
  _el$10.addEventListener("click", () => console.log("listener"));
  _el$10.addEventListener("CAPS-ev", () => console.log("custom"));
  _el$11.addEventListener(
    "apture:camelClick",
    () => console.log("listener"),
    true
  );
  return _el;
};
