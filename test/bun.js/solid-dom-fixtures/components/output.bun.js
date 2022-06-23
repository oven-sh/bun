var _tmpl = _template$("<div><div>From Parent</div><div</div></div>", 9), _tmpl$1 = _template$("<div> |  |  |  |  | </div>", 8), _tmpl$2 = _template$("<div> |  |  | </div>", 8);
import {Show} from "somewhere";
const Child = (props) => {
  const [s, set] = createSignal();
  return ;
};
const template = (props) => {
  let childRef;
  const { content } = props;
  return () => {
    var _tmpl = _tmpl.cloneNode(true);
    insert(_tmpl, createComponent(Child, {
      name: "John",
      ref: childRef,
      booleanProperty: true
    }), null);
    insert(_tmpl, content, null);
    insert(_tmpl, createComponent(Child, {
      name: "Jason",
      ref: props.ref
    }), null);
    insert(_tmpl, createComponent(Context.Consumer, {
      ref: props.consumerRef(),
      get children: [
        (context) => context
      ]
    }), null);
    return _tmpl;
  };
};
const template2 = createComponent(Child, {
  name: "Jake",
  dynamic: state.data,
  stale: state.data,
  handleClick: clickHandler,
  "hyphen-ated": state.data,
  get ref: () => {
    return (el) => e = el;
  }
});
const template3 = createComponent(Child, {
  get children: [
    "After"
  ]
});
const [s, set] = createSignal();
const template4 = createComponent(Child, {
  ref: set
});
const template5 = createComponent(Child, {
  dynamic: state.dynamic,
  get children: [
    state.dynamic
  ]
});
const template6 = createComponent(For, {
  each: state.list,
  fallback: ,
  get children: [
    (item) => createComponent(Show, {
      when: state.condition,
      get children: [
        item
      ]
    })
  ]
});
const template7 = createComponent(Child, {
  get children: [
    state.dynamic
  ]
});
const template8 = createComponent(Child, {
  get children: [
    (item) => item,
    (item) => item
  ]
});
const template9 = createComponent(_garbage, {
  get children: [
    "Hi"
  ]
});
const template10 = () => {
  var _tmpl$1 = _tmpl$1.cloneNode(true);
  insert(_tmpl$1, createComponent(Link, {
    get children: [
      "new"
    ]
  }), null);
  insert(_tmpl$1, createComponent(Link, {
    get children: [
      "comments"
    ]
  }), null);
  insert(_tmpl$1, createComponent(Link, {
    get children: [
      "show"
    ]
  }), null);
  insert(_tmpl$1, createComponent(Link, {
    get children: [
      "ask"
    ]
  }), null);
  insert(_tmpl$1, createComponent(Link, {
    get children: [
      "jobs"
    ]
  }), null);
  insert(_tmpl$1, createComponent(Link, {
    get children: [
      "submit"
    ]
  }), null);
  return _tmpl$1;
};
const template11 = () => {
  var _tmpl$2 = _tmpl$2.cloneNode(true);
  insert(_tmpl$2, createComponent(Link, {
    get children: [
      "new"
    ]
  }), null);
  insert(_tmpl$2, createComponent(Link, {
    get children: [
      "comments"
    ]
  }), null);
  insert(_tmpl$2, createComponent(Link, {
    get children: [
      "show"
    ]
  }), null);
  insert(_tmpl$2, createComponent(Link, {
    get children: [
      "ask"
    ]
  }), null);
  insert(_tmpl$2, createComponent(Link, {
    get children: [
      "jobs"
    ]
  }), null);
  insert(_tmpl$2, createComponent(Link, {
    get children: [
      "submit"
    ]
  }), null);
  return _tmpl$2;
};
const template12 = () => {
  var _tmpl$1 = _tmpl$1.cloneNode(true);
  insert(_tmpl$1, createComponent(Link, {
    get children: [
      "comments"
    ]
  }), null);
  insert(_tmpl$1, createComponent(Link, {
    get children: [
      "show"
    ]
  }), null);
  return _tmpl$1;
};

class Template13 {
  render() {
    createComponent(Component, {
      prop: this.something,
      get onClick: () => {
        return () => this.shouldStay;
      },
      get children: [
        createComponent(Nested, {
          prop: this.data,
          get children: [
            this.content
          ]
        })
      ]
    });
  }
}
const Template14 = createComponent(Component, {
  get children: [
    data()
  ]
});
const Template15 = createComponent(Component, {});
const Template16 = createComponent(Component, {
  something
});
const Template17 = createComponent(Pre, {
  get children: [
    " ",
    " "
  ]
});
const Template18 = createComponent(Pre, {});
const Template19 = createComponent(Component, {});
const Template20 = createComponent(Component, {
  class: prop.red ? "red" : "green"
});
const template21 = createComponent(Component, {});
