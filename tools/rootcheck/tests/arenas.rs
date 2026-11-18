//! Memory of an arena.

use bun_alloc::{Arena, ArenaBox, ArenaVec};
use bun_engine_vm::*;

pub fn lent_out(arena: &Arena, value: Value, values: &[Value], vm: &Vm) {
    arena.alloc(value); //~ hidden: memory that the collector does not know
    arena.alloc(None::<Gc<JsObject>>); //~ hidden: memory that the collector does not know
    arena.alloc_slice_copy(values); //~ hidden: memory that the collector does not know
    arena.alloc_slice_fill_with(2, |_| value); //~ hidden: memory that the collector does not know
    arena.alloc_slice_fill_default::<Option<Value>>(2); //~ hidden: memory that the collector does not know
    arena.alloc_uninit_slice::<Value>(2); //~ hidden: memory that the collector does not know
    arena.alloc(1);
}

pub struct Containers<'a> {
    list: ArenaVec<'a, Value>, //~ hidden: BabyVec<
    boxed: ArenaBox<'a, Value>, //~ hidden: Box<
}

pub fn not_an_arena<'a>(values: &'a mut [Value], option: &'a mut Option<Value>) -> &'a [Value] {
    option.insert(values[0]);
    std::cell::Cell::from_mut(&mut values[0]);
    values.first().map(std::slice::from_ref).unwrap_or_default();
    (&values[0] as &dyn std::any::Any).downcast_ref::<Value>();
    <&[Value]>::default()
}
