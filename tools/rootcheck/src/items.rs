//! Statics and the fields of types.

use rustc_data_structures::fx::FxHashSet;
use rustc_hir::def::DefKind;
use rustc_hir::def_id::{DefId, LOCAL_CRATE};
use rustc_middle::mir::visit::{PlaceContext, Visitor};
use rustc_middle::mir::{Location, Place, TerminatorKind};
use rustc_middle::ty::{self, ImplPolarity, Ty, TypingEnv};

use crate::bodies::{Frame, field_of};
use crate::calls::Calls;
use crate::engine::init_of;
use crate::types::Types;

pub fn check(cx: &Types<'_>) {
    let tcx = cx.tcx;
    let inits = check_inits(cx);
    let mut traced = with_content(cx, |it| is_visited(cx, it) || cx.allows.has(tcx, it));
    traced.retain(|it| !inits.contains(it));
    cx.traced.set(traced).expect("set once");
    types(cx).for_each(|it| check_fields(cx, it, inits.contains(&it)));
    types(cx).for_each(|it| check_alignment(cx, it));
    definitions(cx, |it| matches!(it, DefKind::Static { .. })).for_each(|it| check_static(cx, it));
}

fn definitions(cx: &Types<'_>, kind: fn(DefKind) -> bool) -> impl Iterator<Item = DefId> {
    let definitions = cx.tcx.hir_crate_items(()).definitions().map(|it| it.to_def_id());
    definitions.filter(move |&it| kind(cx.tcx.def_kind(it)))
}

fn types(cx: &Types<'_>) -> impl Iterator<Item = DefId> {
    definitions(cx, |it| matches!(it, DefKind::Struct | DefKind::Enum | DefKind::Union))
}

fn type_of<'tcx>(cx: &Types<'tcx>, def_id: DefId) -> (TypingEnv<'tcx>, Ty<'tcx>) {
    let env = TypingEnv::post_analysis(cx.tcx, def_id);
    (env, cx.normalize(env, cx.tcx.type_of(def_id).instantiate_identity()))
}

fn is_visited(cx: &Types<'_>, def_id: DefId) -> bool {
    let (ty, engine) = (type_of(cx, def_id).1, &cx.engine);
    [engine.trace, engine.cell_kind, engine.service].iter().any(|&it| cx.implements(ty, it))
        || cx.declared_polarity(ty) == Some(ImplPolarity::Positive)
}

fn with_content(cx: &Types<'_>, is_wanted: impl Fn(DefId) -> bool) -> FxHashSet<DefId> {
    let mut found = FxHashSet::default();
    for def_id in types(cx).filter(|&it| is_wanted(it)) {
        add_with_content(cx, def_id, &mut found);
    }
    found
}

fn add_with_content(cx: &Types<'_>, def_id: DefId, traced: &mut FxHashSet<DefId>) {
    if !def_id.is_local() || !traced.insert(def_id) {
        return;
    }
    for field in cx.tcx.adt_def(def_id).all_fields() {
        let mut walker = type_of(cx, field.did).1.walk();
        while let Some(argument) = walker.next() {
            match argument.as_type().map(|it| it.kind()) {
                Some(ty::Adt(def, _)) => add_with_content(cx, def.did(), traced),
                Some(ty::Ref(..) | ty::FnPtr(..) | ty::Dynamic(..)) => {
                    walker.skip_current_subtree()
                }
                _ => {}
            }
        }
    }
}

const INIT_NOTE: &str = "`Vm::allocate` may collect while it holds what the cell is made from";
const INIT_HELP: &str =
    "use `TracedVec`, `TracedMap` or `GcCell`, which start empty, and fill it afterwards";

/// Returns those that are structs of this crate, which are looked at field by field.
fn check_inits(cx: &Types<'_>) -> FxHashSet<DefId> {
    let tcx = cx.tcx;
    let mut structs = FxHashSet::default();
    for &impl_id in tcx.trait_impls_in_crate(LOCAL_CRATE) {
        if tcx.impl_trait_id(impl_id) != cx.engine.cell_kind {
            continue;
        }
        let init = init_of(tcx, impl_id);
        let (env, ty) = type_of(cx, init);
        if let Some(def) = ty.ty_adt_def().filter(|it| it.did().is_local()) {
            structs.insert(def.did());
        } else if let Some(hidden) = cx.hides(env, ty) {
            cx.report("hidden", tcx.def_span(init), hidden.message())
                .with_note(INIT_NOTE)
                .with_help(INIT_HELP)
                .emit();
        }
    }
    structs
}

fn check_fields(cx: &Types<'_>, def_id: DefId, is_init: bool) {
    let tcx = cx.tcx;
    let def = tcx.adt_def(def_id);
    for field in def.all_fields() {
        let Some(hidden) = cx.hidden_by_field(def, field.did) else {
            continue;
        };
        if cx.allows.is_on(tcx, field.did) {
            continue;
        }
        let span = tcx.def_ident_span(field.did).unwrap_or_else(|| tcx.def_span(field.did));
        let diagnostic = cx.report("hidden", span.source_callsite(), hidden.message());
        if is_init {
            diagnostic.with_note(INIT_NOTE).with_help(INIT_HELP).emit();
        } else {
            let name = tcx.item_name(def_id);
            diagnostic
                .with_note(format!("`{name}` is neither traced by a cell nor visited by the `Vm`"))
                .with_help(crate::bodies::HELP)
                .emit();
        }
    }
}

fn check_alignment(cx: &Types<'_>, def_id: DefId) {
    let (env, ty) = type_of(cx, def_id);
    if cx.tcx.adt_def(def_id).repr().packed()
        && cx.refers(env, ty)
        && !cx.allows.is_on(cx.tcx, def_id)
    {
        let message = "the collector scans only words that are aligned";
        cx.report("hidden", cx.tcx.def_span(def_id).source_callsite(), message.into()).emit();
    }
}

struct Touched<'a, 'tcx> {
    frame: Frame<'a, 'tcx>,
    fields: &'a mut FxHashSet<DefId>,
}

impl<'tcx> Visitor<'tcx> for Touched<'_, 'tcx> {
    fn visit_place(&mut self, place: &Place<'tcx>, _: PlaceContext, _: Location) {
        let (tcx, body) = (self.frame.cx.tcx, self.frame.body);
        let places = place.iter_projections();
        self.fields.extend(places.filter_map(|(base, it)| field_of(base.ty(body, tcx), it)));
    }
}

/// What is said to be visited has to be looked at, at least, by what the collector calls.
pub fn check_visited<'tcx>(cx: &Types<'tcx>, calls: &Calls<'_, 'tcx>) {
    let tcx = cx.tcx;
    let frame_of =
        |def_id| calls.frame(calls.as_declared(def_id), TypingEnv::post_analysis(tcx, def_id));
    let frames = || tcx.hir_body_owners().filter_map(|it| frame_of(it.to_def_id()));
    let function_of = |frame: &Frame<'_, '_>| tcx.typeck_root_def_id(frame.instance.def_id());
    let is_called_by_collector = |frame: &Frame<'_, 'tcx>| {
        calls.is_inside_collection(frame.instance)
            || tcx.opt_item_name(function_of(frame)).is_some_and(|it| it.as_str() == "did_collect")
    };
    let mut functions: FxHashSet<_> =
        frames().filter(is_called_by_collector).map(|it| function_of(&it)).collect();
    // Through accessors, and no further.
    for _ in 0..2 {
        let callers: Vec<_> = frames().filter(|it| functions.contains(&function_of(it))).collect();
        for frame in callers {
            functions.extend(frame.blocks().filter_map(|(_, it)| match &it.terminator().kind {
                TerminatorKind::Call { func, .. } => {
                    Some(calls.resolve(frame, frame.operand_type(func))?.def_id())
                }
                _ => None,
            }));
        }
    }
    let mut fields = FxHashSet::default();
    for frame in frames().filter(|it| functions.contains(&function_of(it))) {
        Touched { frame, fields: &mut fields }.visit_body(frame.body);
    }
    let visited = with_content(cx, |it| is_visited(cx, it));
    for def_id in types(cx).filter(|it| visited.contains(it)) {
        for field in tcx.adt_def(def_id).all_fields() {
            let (env, ty) = type_of(cx, field.did);
            if !fields.contains(&field.did)
                && !ty.is_phantom_data()
                && !cx.is_cell(env, ty)
                && cx.refers(env, ty)
                && !cx.allows.is_on(tcx, field.did)
                && !cx.allows.is_on(tcx, def_id)
            {
                let message =
                    "this refers to cells, and nothing that the collector calls looks at it";
                cx.report("unvisited", tcx.def_span(field.did).source_callsite(), message.into())
                    .with_help("visit it, or clear it when its cells die")
                    .emit();
            }
        }
    }
}

fn check_static(cx: &Types<'_>, def_id: DefId) {
    let (env, ty) = type_of(cx, def_id);
    if cx.refers(env, ty) && !cx.allows.is_on(cx.tcx, def_id) {
        let span = cx.tcx.def_span(def_id).source_callsite();
        cx.report("static", span, "the collector does not scan statics and thread-locals".into())
            .with_help("keep it in the `State` of a `Service`, or in a `Strong`")
            .emit();
    }
}
