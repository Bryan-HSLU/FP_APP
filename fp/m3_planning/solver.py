"""Modul 3, Layer 2 - hard-rule placement with OR-Tools CP-SAT.

Consumes the AI directives + room geometry and emits metric coordinates.
The AI never produces coordinates; it only says *what* and *how things relate*.
This solver decides *where* under hard constraints (collisions, openings free,
clearances, against-wall, containment).

Two staged solves keep the problem small and feasible:
    Stage 1: place main objects (layout-defining).
    Stage 2: freeze mains, place accessories relative to them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from fp.schemas import (
    Directives,
    FurnitureCatalog,
    PlacedObject,
    Relation,
    RelationType,
    RoomModel,
    Scene,
)

CELL = 0.05  # grid resolution in meters (5 cm)
DOOR_SWING = 0.90  # meters of clearance kept in front of a door
WINDOW_SETBACK = 0.10  # meters kept against a window


def m2c(x: float) -> int:
    return int(round(x / CELL))


@dataclass
class Instance:
    """One concrete object to place (directive expanded by quantity)."""

    iid: str
    catalog_id: str
    klass: str
    priority: int
    orientation_pref: str
    w: float
    d: float
    h: float
    clearance: float
    color: str
    is_rug: bool = False


@dataclass
class Placed:
    iid: str
    catalog_id: str
    klass: str
    cx: float  # center x, meters
    cy: float  # center y, meters
    rot: int  # 0..3 (90 deg steps)
    w: float
    d: float
    h: float
    color: str

    def footprint_cells(self, ox: float, oy: float) -> tuple[int, int, int, int]:
        sw, sd = (self.w, self.d) if self.rot % 2 == 0 else (self.d, self.w)
        x0 = m2c(self.cx - ox - sw / 2)
        x1 = m2c(self.cx - ox + sw / 2)
        y0 = m2c(self.cy - oy - sd / 2)
        y1 = m2c(self.cy - oy + sd / 2)
        return x0, y0, x1, y1


@dataclass
class _Rect:
    x0: int
    y0: int
    x1: int
    y1: int


@dataclass
class _Stage:
    """Bookkeeping for one CP-SAT solve."""

    model: cp_model.CpModel = field(default_factory=cp_model.CpModel)
    cx: dict[str, cp_model.IntVar] = field(default_factory=dict)
    cy: dict[str, cp_model.IntVar] = field(default_factory=dict)
    rot: dict[str, cp_model.IntVar] = field(default_factory=dict)
    x0: dict[str, cp_model.IntVar] = field(default_factory=dict)
    y0: dict[str, cp_model.IntVar] = field(default_factory=dict)
    x1: dict[str, cp_model.IntVar] = field(default_factory=dict)
    y1: dict[str, cp_model.IntVar] = field(default_factory=dict)
    x_iv: dict[str, cp_model.IntervalVar] = field(default_factory=dict)
    y_iv: dict[str, cp_model.IntervalVar] = field(default_factory=dict)


def _opening_rects(room: RoomModel, ox: float, oy: float, wc: int, lc: int) -> list[_Rect]:
    """Floor clearance rectangles that must stay free of furniture."""
    rects: list[_Rect] = []
    for op in room.openings:
        xs = [p[0] for p in op.polygon]
        ys = [p[1] for p in op.polygon]
        x_lo, x_hi = min(xs) - ox, max(xs) - ox
        y_lo, y_hi = min(ys) - oy, max(ys) - oy
        depth = DOOR_SWING if op.kind == "door" else WINDOW_SETBACK
        # The opening sits on a wall, so one extent is ~0; push inward by `depth`.
        if (x_hi - x_lo) < (y_hi - y_lo):  # vertical wall (east/west)
            if x_lo <= 0.01:  # west wall -> push +x
                x_hi = x_lo + depth
            else:  # east wall -> push -x
                x_lo = x_hi - depth
        else:  # horizontal wall (north/south)
            if y_lo <= 0.01:  # south wall -> push +y
                y_hi = y_lo + depth
            else:  # north wall -> push -y
                y_lo = y_hi - depth
        rects.append(
            _Rect(
                max(0, m2c(x_lo)),
                max(0, m2c(y_lo)),
                min(wc, m2c(x_hi)),
                min(lc, m2c(y_hi)),
            )
        )
    return rects


def _add_object_vars(
    st: _Stage, inst: Instance, wc: int, lc: int, *, inflate: bool
) -> None:
    m = st.model
    pad = inst.clearance if inflate else 0.0
    hw = m2c(inst.w / 2 + pad)
    hd = m2c(inst.d / 2 + pad)
    # Object must fit; if not, the bounds below become infeasible (caught by caller).
    cx = m.new_int_var(0, wc, f"cx_{inst.iid}")
    cy = m.new_int_var(0, lc, f"cy_{inst.iid}")
    rot = m.new_int_var(0, 3, f"rot_{inst.iid}")
    parity = m.new_int_var(0, 1, f"par_{inst.iid}")
    m.add_modulo_equality(parity, rot, 2)
    # effective half extents depend on rotation parity (linear in parity bool)
    ehx = m.new_int_var(min(hw, hd), max(hw, hd), f"ehx_{inst.iid}")
    ehy = m.new_int_var(min(hw, hd), max(hw, hd), f"ehy_{inst.iid}")
    m.add(ehx == hw + (hd - hw) * parity)
    m.add(ehy == hd + (hw - hd) * parity)
    x0 = m.new_int_var(0, wc, f"x0_{inst.iid}")
    x1 = m.new_int_var(0, wc, f"x1_{inst.iid}")
    y0 = m.new_int_var(0, lc, f"y0_{inst.iid}")
    y1 = m.new_int_var(0, lc, f"y1_{inst.iid}")
    m.add(x0 == cx - ehx)
    m.add(x1 == cx + ehx)
    m.add(y0 == cy - ehy)
    m.add(y1 == cy + ehy)
    sx = m.new_int_var(0, wc, f"sx_{inst.iid}")
    sy = m.new_int_var(0, lc, f"sy_{inst.iid}")
    m.add(sx == 2 * ehx)
    m.add(sy == 2 * ehy)
    st.cx[inst.iid], st.cy[inst.iid], st.rot[inst.iid] = cx, cy, rot
    st.x0[inst.iid], st.x1[inst.iid] = x0, x1
    st.y0[inst.iid], st.y1[inst.iid] = y0, y1
    st.x_iv[inst.iid] = m.new_interval_var(x0, sx, x1, f"ivx_{inst.iid}")
    st.y_iv[inst.iid] = m.new_interval_var(y0, sy, y1, f"ivy_{inst.iid}")


def _abs_diff(model: cp_model.CpModel, a, b, ub: int, name: str) -> cp_model.IntVar:
    diff = model.new_int_var(-ub, ub, f"d_{name}")
    model.add(diff == a - b)
    out = model.new_int_var(0, ub, f"ad_{name}")
    model.add_abs_equality(out, diff)
    return out


def _solve_stage(
    room: RoomModel,
    instances: list[Instance],
    relations: list[Relation],
    fixed: dict[str, Placed],
    *,
    symmetry: float,
    time_limit: float = 15.0,
) -> tuple[dict[str, Placed], str, list[str]]:
    ox, oy, mx, my = room.floor_bounds()
    wc, lc = m2c(mx - ox), m2c(my - oy)
    st = _Stage()
    m = st.model
    violations: list[str] = []

    by_id = {i.iid: i for i in instances}
    rugs = {i.iid for i in instances if i.is_rug}

    for inst in instances:
        _add_object_vars(st, inst, wc, lc, inflate=not inst.is_rug)

    # --- hard: no-overlap among solid footprints + opening clearances + fixed mains
    solid_x = [st.x_iv[i.iid] for i in instances if not i.is_rug]
    solid_y = [st.y_iv[i.iid] for i in instances if not i.is_rug]
    for r in _opening_rects(room, ox, oy, wc, lc):
        ivx = m.new_interval_var(r.x0, max(0, r.x1 - r.x0), r.x1, f"opx_{len(solid_x)}")
        ivy = m.new_interval_var(r.y0, max(0, r.y1 - r.y0), r.y1, f"opy_{len(solid_y)}")
        solid_x.append(ivx)
        solid_y.append(ivy)
    for fid, p in fixed.items():
        fx0, fy0, fx1, fy1 = p.footprint_cells(ox, oy)
        ivx = m.new_interval_var(fx0, max(0, fx1 - fx0), fx1, f"fx_{fid}")
        ivy = m.new_interval_var(fy0, max(0, fy1 - fy0), fy1, f"fy_{fid}")
        solid_x.append(ivx)
        solid_y.append(ivy)
    if solid_x:
        m.add_no_overlap_2d(solid_x, solid_y)

    objective_terms: list = []
    diag = wc + lc

    def center_of(name: str):
        """Return (cx_expr, cy_expr) for an instance in this stage or a fixed obj."""
        if name in st.cx:
            return st.cx[name], st.cy[name]
        if name in fixed:
            p = fixed[name]
            return m2c(p.cx - ox), m2c(p.cy - oy)
        return None

    for rel in relations:
        if rel.type in (RelationType.facing, RelationType.near):
            ca, cb = center_of(rel.a or ""), center_of(rel.b or "")
            if ca is None or cb is None:
                continue
            dx = _abs_diff(m, ca[0], cb[0], diag, f"{rel.a}_{rel.b}_x")
            dy = _abs_diff(m, ca[1], cb[1], diag, f"{rel.a}_{rel.b}_y")
            # Soft pull only: a hard center-to-center cap conflicts with
            # no-overlap (the cap distance often lies inside the larger
            # object's footprint). The objective draws them as close as the
            # collision constraints allow.
            weight = 6 if rel.max_dist else 3
            objective_terms.append(-weight * (dx + dy))
        elif rel.type == RelationType.against_wall:
            if rel.a not in st.x0:
                continue
            # at least one footprint edge coincides with a room wall
            b_w = m.new_bool_var(f"aw_w_{rel.a}")
            b_e = m.new_bool_var(f"aw_e_{rel.a}")
            b_s = m.new_bool_var(f"aw_s_{rel.a}")
            b_n = m.new_bool_var(f"aw_n_{rel.a}")
            m.add(st.x0[rel.a] == 0).only_enforce_if(b_w)
            m.add(st.x1[rel.a] == wc).only_enforce_if(b_e)
            m.add(st.y0[rel.a] == 0).only_enforce_if(b_s)
            m.add(st.y1[rel.a] == lc).only_enforce_if(b_n)
            m.add_bool_or([b_w, b_e, b_s, b_n])
        elif rel.type == RelationType.on_top_footprint:
            # a sits on top of b's footprint -> b (rug) contains a
            rug, on = (rel.b, rel.a) if rel.b in rugs else (rel.a, rel.b)
            if rug not in st.x0:
                continue
            ca = center_of(on or "")
            if ca is None:
                continue
            inst_on = by_id.get(on or "")
            if on in fixed:
                p = fixed[on]
                hx = m2c((p.w if p.rot % 2 == 0 else p.d) / 2)
                hy = m2c((p.d if p.rot % 2 == 0 else p.w) / 2)
                ax0, ax1 = ca[0] - hx, ca[0] + hx
                ay0, ay1 = ca[1] - hy, ca[1] + hy
            elif inst_on is not None:
                ax0, ax1 = st.x0[on], st.x1[on]
                ay0, ay1 = st.y0[on], st.y1[on]
            else:
                continue
            m.add(st.x0[rug] <= ax0)
            m.add(st.x1[rug] >= ax1)
            m.add(st.y0[rug] <= ay0)
            m.add(st.y1[rug] >= ay1)
        # clear_in_front / not_blocking handled via opening rects + clearance pads

    # --- soft: symmetry pulls main centers toward the room's central x axis
    if symmetry > 0:
        cxc = wc // 2
        wsym = max(1, int(round(symmetry * 2)))
        for inst in instances:
            if inst.klass == "main":
                dxc = _abs_diff(m, st.cx[inst.iid], cxc, wc, f"sym_{inst.iid}")
                objective_terms.append(-wsym * dxc)

    if objective_terms:
        m.maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 8
    status = solver.solve(m)
    status_name = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
    }.get(status, "UNKNOWN")

    placed: dict[str, Placed] = {}
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for inst in instances:
            placed[inst.iid] = Placed(
                iid=inst.iid,
                catalog_id=inst.catalog_id,
                klass=inst.klass,
                cx=ox + solver.value(st.cx[inst.iid]) * CELL,
                cy=oy + solver.value(st.cy[inst.iid]) * CELL,
                rot=solver.value(st.rot[inst.iid]),
                w=inst.w,
                d=inst.d,
                h=inst.h,
                color=inst.color,
            )
    else:
        violations.append(f"stage {status_name}: no placement found for {len(instances)} objects")
    return placed, status_name, violations


def _expand(directives: Directives, catalog: FurnitureCatalog) -> list[Instance]:
    cat = catalog.by_id()
    # In an on_top_footprint relation, "a" sits on top of "b", so "b" is the
    # base layer (the rug) that must contain "a" and stay out of no-overlap.
    rug_ids = {
        r.b
        for r in directives.relations
        if r.type == RelationType.on_top_footprint and r.b
    }
    out: list[Instance] = []
    for obj in directives.objects:
        item = cat.get(obj.catalog_id)
        if item is None:
            continue  # unknown catalog_id already rejected upstream; skip defensively
        for k in range(max(1, obj.quantity)):
            iid = obj.id if obj.quantity == 1 else f"{obj.id}_{k+1}"
            out.append(
                Instance(
                    iid=iid,
                    catalog_id=item.id,
                    klass=obj.klass,
                    priority=obj.priority,
                    orientation_pref=obj.orientation_pref.value,
                    w=item.dims[0],
                    d=item.dims[1],
                    h=item.dims[2],
                    clearance=item.clearance,
                    color=item.color,
                    is_rug=("rug" in item.id) or (obj.id in rug_ids),
                )
            )
    return out


def solve_layout(
    room: RoomModel, directives: Directives, catalog: FurnitureCatalog
) -> Scene:
    instances = _expand(directives, catalog)
    mains = [i for i in instances if i.klass == "main"]
    accs = [i for i in instances if i.klass == "accessory"]
    sym = directives.global_params.symmetry
    violations: list[str] = []

    placed_main, st1, v1 = _solve_stage(room, mains, directives.relations, {}, symmetry=sym)
    violations += v1
    placed_acc, st2, v2 = _solve_stage(
        room, accs, directives.relations, placed_main, symmetry=0.0
    )
    violations += v2

    all_placed = {**placed_main, **placed_acc}
    if st1 == "OPTIMAL" and st2 in ("OPTIMAL", "FEASIBLE"):
        status = "OPTIMAL" if st2 == "OPTIMAL" else "FEASIBLE"
    elif placed_main:
        status = "FEASIBLE"
    else:
        status = "INFEASIBLE"

    objects = [
        PlacedObject(
            instance_id=p.iid,
            catalog_id=p.catalog_id,
            klass=p.klass,
            position=[round(p.cx, 3), round(p.cy, 3), 0.0],
            rotation_z=round(p.rot * math.pi / 2, 4),
            dimensions=[p.w, p.d, p.h],
            color=p.color,
        )
        for p in all_placed.values()
    ]
    return Scene(
        room_type=room.room_type,
        objects=objects,
        solver_status=status,  # type: ignore[arg-type]
        violations=violations,
    )
