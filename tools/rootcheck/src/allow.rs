//! `#[cfg_attr(rootcheck, rootcheck::allow("reason"))]` and `rootcheck::stays("reason")`

use std::cell::RefCell;

use rustc_ast::token::{LitKind, TokenKind};
use rustc_ast::tokenstream::TokenTree;
use rustc_attr_ir::{AttrArgs, AttrItem, Attribute};
use rustc_data_structures::fx::{FxHashMap, FxHashSet};
use rustc_hir::HirId;
use rustc_hir::def::DefKind;
use rustc_hir::def_id::DefId;
use rustc_lint_defs::Level;
use rustc_lint_defs::builtin::UNSAFE_CODE;
use rustc_middle::ty::TyCtxt;
use rustc_span::Symbol;

use crate::engine::{Engine, init_of};
use crate::types::Types;

pub struct Allows {
    used: RefCell<FxHashSet<DefId>>,
    /// From a field of an `Init` to that of the cell, which is what has the attribute.
    declared_at: FxHashMap<DefId, DefId>,
    allow: [Symbol; 2],
    stays: [Symbol; 2],
}

pub fn allows_unsafe(tcx: TyCtxt<'_>, hir_id: HirId) -> bool {
    tcx.lint_level_spec_at_node(UNSAFE_CODE, hir_id).level() == Level::Allow
}

fn path(name: &str) -> [Symbol; 2] {
    [Symbol::intern("rootcheck"), Symbol::intern(name)]
}

impl Allows {
    pub fn new(tcx: TyCtxt<'_>, engine: &Engine) -> Allows {
        let mut declared_at = FxHashMap::default();
        for impl_id in tcx.all_impls(engine.cell_kind) {
            if let Some(cell) = tcx.type_of(impl_id).skip_binder().ty_adt_def()
                && let Some(init) = tcx.type_of(init_of(tcx, impl_id)).skip_binder().ty_adt_def()
            {
                declared_at.extend(init.all_fields().filter_map(|field| {
                    Some((field.did, cell.all_fields().find(|it| it.name == field.name)?.did))
                }));
            }
        }
        Allows { used: RefCell::default(), declared_at, allow: path("allow"), stays: path("stays") }
    }

    pub fn has(&self, tcx: TyCtxt<'_>, def_id: DefId) -> bool {
        let def_id = *self.declared_at.get(&def_id).unwrap_or(&def_id);
        tcx.tool_attrs(def_id, &self.allow).next().is_some()
    }

    pub fn stays(&self, tcx: TyCtxt<'_>, def_id: DefId) -> bool {
        tcx.tool_attrs(def_id, &self.stays).next().is_some()
    }

    /// To be asked only when there is something to report.
    pub fn is_on(&self, tcx: TyCtxt<'_>, def_id: DefId) -> bool {
        self.has(tcx, def_id) && {
            self.used.borrow_mut().insert(*self.declared_at.get(&def_id).unwrap_or(&def_id));
            true
        }
    }

    /// On the item or, for a closure or a constant expression, on the item that it is in.
    pub fn covers_body(&self, tcx: TyCtxt<'_>, def_id: DefId) -> bool {
        self.is_on(tcx, tcx.typeck_root_def_id(def_id))
    }
}

fn has_reason(attribute: &AttrItem) -> bool {
    let AttrArgs::Delimited(arguments) = &attribute.args else {
        return false;
    };
    let mut tokens = arguments.tokens.iter();
    matches!(
        (tokens.next(), tokens.next()),
        (Some(TokenTree::Token(token, _)), None) if matches!(
            token.kind,
            TokenKind::Literal(literal)
                if literal.kind == LitKind::Str && !literal.symbol.as_str().trim().is_empty()
        )
    )
}

/// After everything else.
pub fn check(cx: &Types<'_>) {
    let tcx = cx.tcx;
    for owner in tcx.hir_crate_items(()).owners() {
        for &(local_id, attributes) in tcx.hir_attr_map(owner).map.iter() {
            let hir_id = HirId { owner, local_id };
            // It repeats the attributes of its struct.
            if let rustc_hir::Node::Ctor(_) = tcx.hir_node(hir_id) {
                continue;
            }
            for attribute in attributes {
                let Attribute::Tool(attribute) = attribute else {
                    continue;
                };
                if attribute.path.segments[0].as_str() != "rootcheck" {
                    continue;
                }
                let is = |name| *attribute.path.segments == path(name);
                let problem = match tcx.hir_node(hir_id).associated_def_id() {
                    _ if !is("allow") && !is("stays") => "unknown attribute",
                    _ if !has_reason(attribute) => "this takes a reason",
                    _ if !allows_unsafe(tcx, hir_id) => {
                        "this is only for where `unsafe` is allowed"
                    }
                    None => "this goes on a function, a static, a type or a field",
                    Some(it) if is("allow") && is_unused(cx, it) => "this allows nothing",
                    Some(_) => continue,
                };
                cx.report("allow", attribute.span, problem.into()).emit();
            }
        }
    }
}

/// What is generic may be instantiated only in another crate.
fn is_unused(cx: &Types<'_>, def_id: DefId) -> bool {
    let owner = match cx.tcx.def_kind(def_id) {
        DefKind::Field => cx.tcx.parent(def_id),
        _ => def_id,
    };
    !cx.allows.used.borrow().contains(&def_id)
        && !cx.tcx.generics_of(owner).requires_monomorphization(cx.tcx)
}

trait AssociatedDefId {
    fn associated_def_id(self) -> Option<DefId>;
}

impl AssociatedDefId for rustc_hir::Node<'_> {
    fn associated_def_id(self) -> Option<DefId> {
        use rustc_hir::{ImplItemKind, ItemKind, Node, TraitItemKind};
        match self {
            Node::Field(field) => Some(field.def_id.to_def_id()),
            Node::Item(item) => matches!(
                item.kind,
                ItemKind::Fn { .. }
                    | ItemKind::Static(..)
                    | ItemKind::Struct(..)
                    | ItemKind::Enum(..)
                    | ItemKind::Union(..)
            )
            .then(|| item.owner_id.to_def_id()),
            Node::ImplItem(item) => {
                matches!(item.kind, ImplItemKind::Fn(..)).then(|| item.owner_id.to_def_id())
            }
            Node::TraitItem(item) => {
                matches!(item.kind, TraitItemKind::Fn(..)).then(|| item.owner_id.to_def_id())
            }
            _ => None,
        }
    }
}
