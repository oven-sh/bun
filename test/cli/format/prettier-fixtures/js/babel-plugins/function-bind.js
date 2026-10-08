// https://babeljs.io/docs/babel-plugin-proposal-function-bind

obj::func
// is equivalent to:
func.bind(obj)

::obj.func
// is equivalent to:
obj.func.bind(obj)

obj::func(val)
// is equivalent to:
func.call(obj, val)

::obj.func(val)
// is equivalent to:
obj.func.call(obj, val)
