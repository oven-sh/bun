const [one, two = null, three = null] = arr;
a = ([s=1,]) => 1
const { children, ...props } = this.props

const { user: { firstName, lastName } } = this.props;

const {
  name: { first, last },
  organisation: { address: { street: orgStreetAddress, postcode: orgPostcode } }
} = user;

function f({ data: { name } }) {}

const UserComponent = function({
  name: { first, last },
  organisation: { address: { street: orgStreetAddress, postcode: orgPostcode } },
}) {
  return
};

const { a, b, c, d: { e } } = someObject;

try {
  // code
} catch ({ data: { message }}) {
  // code
}

try {
  // code
} catch ({ data: { message: { errors }}}) {
  // code
}

const obj = {
  func(id, { blog: { title } }) {
    return id + title;
  },
};

class A {
  func(id, { blog: { title } }) {
    return id + title;
  }
}
