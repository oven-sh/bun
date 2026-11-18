//! Where `unsafe` is allowed, such a container can be used for as long as nothing may collect.

use std::mem::ManuallyDrop;

use bun_engine_vm::*;

fn allocate(vm: &Vm) -> Value {
    JsString::from_literal(vm, "new").into()
}

fn allocates_nothing(vm: &Vm, values: &[Value]) -> usize {
    values.len() + usize::from(vm.has_exception())
}

pub fn scratch(vm: &Vm, values: &[Value]) -> Option<Value> {
    let mut list = values.to_vec();
    list.reverse();
    allocates_nothing(vm, &list);
    let first = list.into_iter().next();
    allocate(vm);
    first
}

pub fn taken_apart(boxed: Option<Box<Value>>) -> Option<Value> {
    boxed.map(|it| *it)
}

pub fn passed_to_what_allocates(cx: &Cx, values: &[Value]) -> JsResult<Gc<JsArray>> {
    cx.new_array_from(&values.to_vec()) //~ hidden: held while this may collect
}

pub fn filled_in_a_loop(vm: &Vm) -> Vec<Value> {
    let mut list = Vec::new(); //~ hidden: held while this may collect
    for _ in 0..4 {
        list.push(allocate(vm));
    }
    list
}

pub fn through_a_box(vm: &Vm, boxed: Box<Value>) -> Value { //~ hidden: held while this may collect
    let value = &*boxed;
    allocate(vm);
    *value
}

pub fn through_a_box_in_a_field(vm: &Vm, pair: (u8, Box<Value>)) -> Value { //~ hidden: held while this may collect
    let value = &*pair.1;
    allocate(vm);
    *value
}

pub fn never_dropped(vm: &Vm, value: Value) -> Value {
    let list = ManuallyDrop::new(vec![value]); //~ hidden: held while this may collect
    let slice = &list[..];
    allocate(vm);
    slice[0]
}

pub fn never_dropped_parameter(vm: &Vm, list: ManuallyDrop<Vec<Value>>) -> Value { //~ hidden: held while
    let slice = &list[..];
    allocate(vm);
    slice[0]
}

pub fn never_left(vm: &Vm, value: Value) -> ! {
    let list = vec![value]; //~ hidden: held while this may collect
    let slice = &list[..];
    loop {
        allocate(vm);
        allocates_nothing(vm, slice);
    }
}

pub fn unknown_code(run: &dyn Fn(), list: Vec<Value>) -> Vec<Value> { //~ hidden: held while this may collect
    run();
    list
}

pub fn unknown_code_through_the_standard_library(run: &dyn Fn(u8), list: Vec<Value>) -> Vec<Value> { //~ hidden: held
    (0..4).for_each(run);
    list
}

pub fn function_pointer(vm: &Vm, run: fn(&Vm), list: Vec<Value>) -> Vec<Value> { //~ hidden: held while
    run(vm);
    list
}

pub fn function_pointer_without_a_vm(run: fn(), list: Vec<Value>) -> Vec<Value> {
    run();
    list
}

unsafe extern "C" {
    safe fn embedder();
}

pub fn foreign_code(list: Vec<Value>) -> Vec<Value> { //~ hidden: held while this may collect
    embedder();
    list
}

fn makes_its_own_realm(global: Gc<GlobalObject>) {
    // SAFETY: a test.
    allocate(unsafe { Cx::from_global(global) });
}

fn no_vm_in_the_signature(global: Gc<GlobalObject>, list: Vec<Value>) -> Vec<Value> { //~ hidden: held while
    makes_its_own_realm(global);
    list
}

pub fn formatting(number: u8, list: Vec<Value>) -> (String, Vec<Value>) {
    (format!("{number}"), list)
}

struct Allocates<'a>(&'a Vm);

impl std::fmt::Display for Allocates<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        allocate(self.0).is_cell().fmt(formatter)
    }
}

pub fn formatting_what_allocates(vm: &Vm, list: Vec<Value>) -> (String, Vec<Value>) { //~ hidden: held while
    (format!("{}", Allocates(vm)), list)
}

pub fn unknown_code_that_is_not_called(run: Option<&dyn Fn()>, list: Vec<Value>) -> (bool, Vec<Value>) {
    (run.as_ref().is_some(), list)
}

pub fn dropping_unknown_code(run: Box<dyn Fn() + '_>, list: Vec<Value>) -> Vec<Value> { //~ hidden: held while
    drop(run);
    list
}

pub fn dropping_what_a_cell_can_own(run: Box<dyn Watcher>, list: Vec<Value>) -> Vec<Value> {
    drop(run);
    list
}

pub fn assembly(list: Vec<Value>) -> Vec<Value> { //~ hidden: held while this may collect
    // SAFETY: a test.
    unsafe { std::arch::asm!("") };
    list
}

pub fn assembly_that_cannot_call(object: Gc<JsObject>, list: Vec<Value>) -> Vec<Value> {
    object.keep_alive();
    list
}

pub struct Wrapped<'a>(&'a dyn Fn());

pub fn unknown_code_in_a_struct(run: fn(&Wrapped<'_>), it: &dyn Fn(), list: Vec<Value>) -> Vec<Value> { //~ hidden: held
    run(&Wrapped(it));
    list
}

pub fn static_trait_object(any: &dyn std::any::Any, list: Vec<Value>) -> (bool, Vec<Value>) {
    (any.is::<u8>(), list)
}

fn defers(vm: &Vm) -> Value {
    let _defer = vm.heap.defer_collection();
    allocate(vm)
}

pub fn deferred_by_the_callee(vm: &Vm, list: Vec<Value>) -> (Value, Vec<Value>) {
    (defers(vm), list)
}

pub fn deferred(vm: &Vm) -> Value {
    let _defer = vm.heap.defer_collection();
    let list: Vec<Value> = vec![allocate(vm), allocate(vm)];
    allocate(vm);
    list[0]
}

pub fn deferred_too_late(vm: &Vm, list: Vec<Value>) -> Value { //~ hidden: held while this may collect
    allocate(vm);
    let _defer = vm.heap.defer_collection();
    list[0]
}

pub fn deferred_too_briefly(vm: &Vm, list: Vec<Value>) -> Value { //~ hidden: held while this may collect
    let defer = vm.heap.defer_collection();
    drop(defer);
    allocate(vm);
    list[0]
}

pub fn deferred_on_one_path(vm: &Vm, list: Vec<Value>, flag: bool) -> Value { //~ hidden: held while this may collect
    let _defer;
    if flag {
        _defer = vm.heap.defer_collection();
    }
    allocate(vm);
    list[0]
}
