//! The way out.

#![feature(negative_impls)]

use std::marker::PhantomData;
use std::ptr::NonNull;

use bun_engine_vm::*;

#[cfg_attr(rootcheck, rootcheck::allow("a reason"))]
pub fn function(value: Value, list: &mut RootVec<Value>, vm: &Vm) -> usize {
    list.sort_by_key(|_| JsString::from_literal(vm, "new").len());
    let in_closure = || vec![value].leak().len();
    vec![value].leak().len() + in_closure()
}

#[cfg_attr(rootcheck, rootcheck::allow("a reason"))]
static mut STATIC: Value = Value::NULL;

#[cfg_attr(rootcheck, rootcheck::allow("a reason"))]
pub struct Type(Part);

pub struct Part(Vec<Value>);

pub struct HasField {
    #[cfg_attr(rootcheck, rootcheck::allow("a reason"))]
    allowed: Vec<Value>,
    other: Vec<Value>, //~ hidden: neither traced
}

pub fn locals(vm: &Vm, a: Type, b: HasField, c: Part) -> (Type, HasField, Part) { //~ hidden: may collect
    vm.heap.collect(None);
    (a, b, c)
}

pub fn not_inherited_by_containers(a: Type) -> usize {
    vec![a].leak().len() //~ hidden: leaked here
}

#[bun_engine_macros::cell]
pub struct Cell {
    base: JsCell,
    #[cfg_attr(rootcheck, rootcheck::allow("a reason"))]
    values: Box<[Value]>,
}

#[cfg_attr(rootcheck, rootcheck::allow)] //~ allow: takes a reason
pub fn no_reason(value: Value) -> usize {
    vec![value].leak().len()
}

#[cfg_attr(rootcheck, rootcheck::allow(" "))] //~ allow: takes a reason
pub fn blank_reason(value: Value) -> usize {
    vec![value].leak().len()
}

#[cfg_attr(rootcheck, rootcheck::allow("a reason"))] //~ allow: allows nothing
pub fn nothing_to_allow() {}

#[cfg_attr(rootcheck, rootcheck::allow("a reason"))] //~ allow: goes on a function
pub mod module {}

#[cfg_attr(rootcheck, rootcheck::alow("a reason"))] //~ allow: unknown attribute
pub fn misspelt() {}

#[deny(unsafe_code)]
#[cfg_attr(rootcheck, rootcheck::allow("a reason"))] //~ allow: only for where `unsafe` is allowed
pub fn denied(value: Value) -> usize {
    vec![value].leak().len()
}

pub struct Visited {
    seen: Vec<Value>,
    weak: std::cell::Cell<Option<Gc<JsObject>>>,
    forgotten: Vec<Value>, //~ unvisited: nothing that the collector calls looks at it
    #[cfg_attr(rootcheck, rootcheck::allow("a reason"))]
    number: Value,
    nested: Nested,
}

struct Nested {
    seen: Value,
    forgotten: Value, //~ unvisited: nothing that the collector calls looks at it
}

// SAFETY: a test.
unsafe impl GcFree for Visited {}

impl Visited {
    fn seen(&self) -> &[Value] {
        &self.seen
    }

    pub fn visit(&self, visitor: &mut Visitor) {
        self.seen().trace(visitor);
        self.nested.seen.trace(visitor);
    }

    pub fn reconcile(&self, survivors: &heap::Survivors) {
        self.weak.update(|it| it.filter(|&it| survivors.contains(it)));
    }
}

#[repr(packed)]
pub struct Packed(u8, Value); //~ hidden: only words that are aligned

pub fn implemented_by_hand(visited: Visited) -> usize {
    vec![visited].leak().len()
}

pub struct OwnBox<T>(NonNull<T>, PhantomData<T>);

pub struct Counted<T>(NonNull<T>);

impl<T> Drop for Counted<T> {
    fn drop(&mut self) {}
}

pub struct Borrowing<'a, T>(NonNull<T>, PhantomData<&'a T>);

pub struct Declared(*mut Value);

impl !GcFree for Declared {}

impl Drop for Declared {
    fn drop(&mut self) {}
}

pub fn own_pointers(
    vm: &Vm,
    declared: Declared, //~ hidden: Declared
    a: OwnBox<Value>, //~ hidden: OwnBox<
    b: Counted<Value>, //~ hidden: Counted<
    c: Borrowing<'_, Value>,
    d: NonNull<Value>,
) {
    let all = (&declared, &a, &b, &c, &d);
    vm.heap.collect(None);
    std::hint::black_box(all);
}
