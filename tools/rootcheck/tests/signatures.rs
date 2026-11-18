//! What a function may do is in its signature.

#![feature(negative_impls)]

use bun_engine_macros::cell;
use bun_engine_vm::*;

fn conjure<'a>(global: Gc<GlobalObject>) -> &'a Vm {
    // SAFETY: a test.
    unsafe { Cx::from_global(global) }
}

fn allocate(global: Gc<GlobalObject>) -> Value {
    JsString::from_literal(conjure(global), "new").into()
}

pub fn allocates(global: Gc<GlobalObject>) -> Value { //~ signature: without being given the right
    allocate(global)
}

pub fn hands_out(global: Gc<GlobalObject>) -> &'static Vm { //~ signature: without being given the right
    conjure(global)
}

pub fn only_looks(global: Gc<GlobalObject>) -> bool {
    conjure(global).has_exception()
}

pub fn says_so(_: &Vm, global: Gc<GlobalObject>) -> Value {
    allocate(global)
}

pub unsafe fn has_a_contract(global: Gc<GlobalObject>) -> Value {
    allocate(global)
}

fn given_a_token(global: Gc<GlobalObject>, _: &NoGc<'_>) -> Value {
    allocate(global) //~ no_gc: says that nothing does
}

pub fn under_a_token(cx: &mut Cx, object: Gc<JsObject>) -> bool {
    let global = cx.global();
    let no_gc = cx.no_gc();
    let elements = object.elements(&no_gc);
    allocate(global); //~ no_gc: says that nothing does
    elements.is_some()
}

pub fn after_a_token(cx: &mut Cx, object: Gc<JsObject>) -> bool {
    let no_gc = cx.no_gc();
    let has_elements = object.elements(&no_gc).is_some();
    allocate(cx.global());
    has_elements
}

#[cell]
pub struct Owner {
    base: JsCell,
    state: GcCell<Vec<Value>>,
}

pub fn under_a_guard(cx: &mut Cx, owner: &Owner) {
    let global = cx.global();
    let mut state = owner.state().borrow_mut(cx);
    state.push(allocate(global)); //~ no_gc: says that nothing does
}

pub fn in_a_callback(cx: &mut Cx, owner: &Owner) {
    let global = cx.global();
    owner.state().borrow_mut(cx).retain(|_| allocate(global).is_cell()); //~ no_gc: says that nothing does
}

pub fn after_dropping_a_guard(cx: &mut Cx, owner: &Owner, flag: bool) {
    let state = owner.state().borrow_mut(cx);
    if flag {
        drop(state);
        allocate(cx.global());
    }
}

pub fn after_a_guard(cx: &mut Cx, owner: &Owner) {
    owner.state().borrow_mut(cx).clear();
    allocate(cx.global());
}

pub fn under_a_lock(vm: &Vm, state: &std::cell::RefCell<Vec<Value>>) {
    state.borrow_mut().push(JsString::from_literal(vm, "new").into()); //~ no_gc: borrowed exclusively
    for value in state.borrow_mut().drain(..) {
        vm.heap.collect(None); //~ no_gc: borrowed exclusively
    }
    let value = JsString::from_literal(vm, "new").into();
    state.borrow_mut().push(value);
    for value in state.borrow().iter() {
        vm.heap.collect(None);
    }
}

pub fn under_a_lock_on_root_memory(vm: &Vm, list: &std::cell::RefCell<RootVec<Value>>) {
    list.borrow_mut().push(JsString::from_literal(vm, "new").into());
}
