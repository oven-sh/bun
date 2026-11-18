//! Statics and thread-locals.

#![feature(thread_local)]

use std::cell::{Cell, RefCell};

use bun_engine_vm::*;

thread_local! { static VALUE: Cell<Option<Value>> = const { Cell::new(None) } } //~ static: does not scan
thread_local! { static LIST: RefCell<Vec<Gc<JsObject>>> = RefCell::default() } //~ static: does not scan
thread_local! { static ROOTED: RefCell<RootVec<Value>> = RefCell::new(root_vec()) } //~ static: does not scan
thread_local! { static HANDLES: RefCell<Vec<Strong<Value>>> = RefCell::default() }
thread_local! { static COUNT: Cell<u32> = const { Cell::new(0) } }

#[thread_local]
static NATIVE: Cell<Option<Gc<JsObject>>> = Cell::new(None); //~ static: does not scan

static mut MUTABLE: Value = Value::NULL; //~ static: does not scan

static FUNCTIONS: [fn(Value) -> Value; 1] = [|value| value];

pub fn inside_a_function() {
    static mut LAST: Option<&JsObject> = None; //~ static: does not scan
}

const EMPTY: Vec<Value> = Vec::new();
const IMMEDIATES: [Value; 2] = [Value::NULL, Value::TRUE];

pub fn from_a_constant(vm: &Vm, value: Value) -> Value {
    let mut list = EMPTY; //~ hidden: held while this may collect
    list.push(value);
    vm.heap.collect(None);
    list[0]
}
