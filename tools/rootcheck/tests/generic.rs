//! Generic code, seen with the types that it is used with.

#![forbid(unsafe_code)]
#![feature(allocator_ext)]

use std::any::Any;

use bun_engine_vm::*;

fn allocate(vm: &Vm) -> Value {
    JsString::from_literal(vm, "new").into()
}

fn count<T>(items: impl Iterator<Item = T>) -> usize {
    let list: Vec<T> = items.collect(); //~ hidden: as instantiated here
    list.iter().len()
}

fn erase<T: 'static>(value: T) -> Box<dyn Any> {
    Box::new(value) //~ hidden: as instantiated here
}

fn only_for_numbers<T>(value: T) -> usize {
    vec![value].iter().len()
}

fn singleton<T>(value: T) -> Vec<T> {
    vec![value]
}

fn around<F: FnOnce()>(list: Vec<Value>, run: F) -> Vec<Value> { //~ hidden: held while this may collect
    run();
    list
}

fn around_nothing<F: FnOnce()>(list: Vec<Value>, run: F) -> Vec<Value> {
    run();
    list
}

pub fn never_instantiated<T>(value: Value, other: T) -> usize {
    let list = vec![value]; //~ hidden: borrowed here
    list.iter().len()
}

pub fn callers(vm: &Vm, values: &[Value], out: &mut Vec<Value>) {
    count(values.iter().copied());
    erase(values[0]);
    only_for_numbers(1);
    singleton(values[0]).iter().len(); //~ hidden: borrowed here
    *out = around(Vec::new(), || _ = allocate(vm));
    *out = around_nothing(Vec::new(), || ());
}

trait Source {
    type Item;

    fn item(&self, vm: &Vm) -> Self::Item;

    fn twice(&self, vm: &Vm) -> usize {
        let mut list = Vec::new(); //~ hidden: as instantiated here
        list.push(self.item(vm));
        list.iter().len()
    }
}

impl Source for u8 {
    type Item = Value;

    fn item(&self, vm: &Vm) -> Value {
        allocate(vm)
    }
}

pub fn associated_type(vm: &Vm) -> usize {
    0u8.twice(vm)
}

trait Run {
    fn run(&self) -> usize;
}

struct Wrapper<T>(T);

impl<T: Copy> Run for Wrapper<T> {
    fn run(&self) -> usize {
        Box::new(self.0).as_ref(); //~ hidden: as instantiated here
        0
    }
}

pub fn through_a_vtable(value: Value) -> usize {
    (&Wrapper(value) as &dyn Run).run()
}

fn by_address<T: Copy>(value: T) -> usize {
    [value].to_vec().iter().len() //~ hidden: as instantiated here
}

pub static TABLE: fn(Value) -> usize = by_address::<Value>;

fn by_promoted_address<T: Copy>(value: T) -> usize {
    [value].to_vec().iter().len() //~ hidden: as instantiated here
}

pub fn promoted() -> &'static [fn(Value) -> usize] {
    &[by_promoted_address::<Value>]
}

trait Table {
    const ENTRY: fn(Self) -> usize;
}

impl<T: Copy> Table for T {
    const ENTRY: fn(T) -> usize = |value| [value].to_vec().iter().len(); //~ hidden: as instantiated here
}

pub fn associated_constant(value: Value) -> usize {
    <Value as Table>::ENTRY(value)
}

struct Dropped<T: Copy>(T);

impl<T: Copy> Drop for Dropped<T> {
    fn drop(&mut self) {
        [self.0].repeat(2).iter().len(); //~ hidden: as instantiated here
    }
}

pub fn in_a_destructor(value: Value) {
    let _dropped = Dropped(value);
}

pub fn scratch_memory_of_the_standard_library(cx: &mut Cx, list: &mut RootVec<Value>) {
    list.sort_by(|_, _| allocate(cx).is_cell().cmp(&true)); //~ hidden: which this leads to
    list.sort_by_key(|_| allocate(cx).is_cell()); //~ hidden: which this leads to
    list.sort_by_cached_key(|_| Ordered(allocate(cx))); //~ hidden: which this leads to
    list.splice(0..1, (0..9).map(|_| allocate(cx))); //~ hidden: which this leads to
    list.sort_by_key(|it| it.to_bits());
    list.sort_unstable_by(|_, _| allocate(cx).is_cell().cmp(&true));
    list.splice(0..1, [Value::NULL, Value::TRUE]);
}

#[derive(PartialEq, Eq)]
struct Ordered(Value);

impl PartialOrd for Ordered {
    fn partial_cmp(&self, other: &Ordered) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Ordered {
    fn cmp(&self, other: &Ordered) -> std::cmp::Ordering {
        self.0.to_bits().cmp(&other.0.to_bits())
    }
}
