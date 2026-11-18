#![forbid(unsafe_code)]

#[cfg_attr(rootcheck, rootcheck::allow("a reason"))] //~ allow: only for where `unsafe` is allowed
pub fn function(value: bun_engine_vm::Value) -> usize {
    vec![value].iter().len()
}
