//! What the collector scans, and what has nothing to show it.

#![forbid(unsafe_code)]
#![feature(allocator_ext)]

use std::collections::BTreeMap;
use std::rc::Rc;

use bun_engine_text::{Identifier, Text};
use bun_engine_vm::heap::{RootAlloc, RootBox, RootDeque, RootMap, RootSet, root_box};
use bun_engine_vm::*;

fn allocate(vm: &Vm) -> Value {
    JsString::from_literal(vm, "new").into()
}

pub fn root_containers(cx: &mut Cx, object: Gc<JsObject>) -> JsResult<usize> {
    let mut values = ValueVec::new();
    values.push(allocate(cx));
    let mut list = root_vec();
    list.extend((0..4).map(|_| allocate(cx)));
    let mut deque = RootDeque::new_in(RootAlloc::default());
    deque.push_back(allocate(cx));
    let mut map = RootMap::default();
    map.insert(object, allocate(cx));
    let set: RootSet<_> = (0..4).map(|_| cx.new_object()).collect();
    let boxed = root_box(allocate(cx));
    let mut nested = root_vec();
    nested.push(list.clone());
    for value in list.drain(..).chain(deque).chain(map.into_values()) {
        values.push(value);
        allocate(cx);
    }
    list.retain(|_| allocate(cx).is_cell());
    list.sort_unstable_by_key(|_| allocate(cx).is_cell());
    cx.new_array_from(&[*boxed])?;
    Ok(values.len() + set.len() + nested.len())
}

pub fn root_closure<'a>(vm: &'a Vm, value: Value) -> RootBox<dyn Fn() -> Value + 'a> {
    root_box(move || if value.is_cell() { value } else { allocate(vm) })
}

pub struct Chain {
    value: Value,
    next: Option<RootBox<Chain>>,
}

pub fn recursive(chain: Chain) -> bool {
    chain.next.as_ref().is_some_and(|next| next.value == chain.value)
}

pub fn handles(vm: &Vm, object: Gc<JsObject>) -> usize {
    let strong = vec![Strong::new(vm, object)];
    let weak = Rc::new(Weak::new(vm, object));
    let callback: Box<dyn Fn(&Vm) -> Gc<JsObject>> = Box::new(move |vm| strong[0].get(vm));
    allocate(vm);
    callback(vm).address() + Rc::strong_count(&weak)
}

pub fn plain_data(vm: &Vm, name: Identifier, text: Text<'_>) -> usize {
    let (names, texts, vms) = (vec![name], vec![text], vec![vm]);
    let functions: Vec<fn(&Vm) -> Value> = vec![allocate];
    let tree = BTreeMap::from([(1, String::new())]);
    names.len() + texts.len() + vms.len() + functions.len() + tree.len()
}

pub fn on_the_stack(vm: &Vm, value: Value) -> Value {
    let array = [value; 4];
    let pick = |index: usize| array[index];
    let dynamic: &dyn Fn(usize) -> Value = &pick;
    allocate(vm);
    array.iter().copied().map(Some).peekable().flatten().last().unwrap_or(dynamic(0))
}

pub fn borrowed(vm: &Vm, list: &Vec<Value>, map: &mut FastHashMap<u32, Value>, boxed: &Box<Value>) -> Value {
    for (value, other) in list.iter().zip(map.values_mut()) {
        *other = *value;
        allocate(vm);
    }
    *map.entry(1).or_insert(**boxed)
}
