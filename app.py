"""Future Planning — Algorithmus-POC (Streamlit UI).

Schritt 1: Stil-Profil (M1)   — CLIP-Vektoren aus Swipe-Daten
Schritt 2: Raummodell (M2)    — synthetisch / Upload / MASt3R (GPU)
Schritt 3: Layout generieren  — Groq/Heuristik + OR-Tools Solver → layout.png

Deploy: streamlit run app.py
        GROQ_API_KEY=... streamlit run app.py  (für AI-gestützte Directives)
"""

from __future__ import annotations

import io
import json
import os
import tempfile
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import streamlit as st

ROOT = Path(__file__).parent

st.set_page_config(
    page_title="Future Planning POC",
    page_icon="🏠",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Session-State-Initialisierung ────────────────────────────────────────────
for key in ("profile", "room", "layout_png", "scene_json", "directives_json",
            "llm_source", "solver_status"):
    if key not in st.session_state:
        st.session_state[key] = None

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("🏠 Future Planning")
    st.caption("Algorithmus-POC · Modul 1–3")
    st.divider()

    m1_ok = st.session_state.profile is not None
    m2_ok = st.session_state.room is not None
    m3_ok = st.session_state.layout_png is not None
    st.markdown(f"{'✅' if m1_ok else '⬜'} **M1** Stil-Profil")
    st.markdown(f"{'✅' if m2_ok else '⬜'} **M2** Raummodell")
    st.markdown(f"{'✅' if m3_ok else '⬜'} **M3** Layout")
    st.divider()

    has_groq = bool(os.environ.get("GROQ_API_KEY"))
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))
    if has_groq:
        st.success("🤖 Groq — Llama 3.3 70B")
    elif has_anthropic:
        st.info("🤖 Anthropic — Claude Sonnet")
    else:
        st.warning("⚠️ Kein API-Key → Heuristik\nGroq-Key gratis: console.groq.com")

    try:
        import torch
        _has_gpu = torch.cuda.is_available()
    except ImportError:
        _has_gpu = False
    if _has_gpu:
        st.success("🖥️ GPU verfügbar (MASt3R aktiv)")
    else:
        st.info("💻 CPU-Modus (kein MASt3R)")

# ── Tabs ──────────────────────────────────────────────────────────────────────
tab1, tab2, tab3 = st.tabs([
    "1 · Stil-Profil",
    "2 · Raummodell",
    "3 · Layout generieren",
])

# ─────────────────────────────────── M1 ──────────────────────────────────────
with tab1:
    st.header("Schritt 1 — Stil-Profil (M1)")
    st.write("M1 analysiert Swipe-Daten und erzeugt sechs Präferenz-Vektoren.")

    src = st.radio(
        "Quelle",
        ["Demo-Swipes (data/swipes.json)", "Eigene swipes.json hochladen"],
        horizontal=True,
    )

    if src.startswith("Demo"):
        if st.button("Stil-Profil berechnen", key="m1_default"):
            with st.spinner("Berechne Stil-Profil…"):
                from fp.m1_style.swipe import build_profile, load_swipes, load_tags
                swipes = load_swipes(ROOT / "data/swipes.json")
                tags = load_tags(ROOT / "data/style_images/tags.json")
                st.session_state.profile = build_profile(swipes, tags, session_id="demo")
    else:
        uploaded_sw = st.file_uploader("swipes.json hochladen", type="json", key="sw_up")
        if uploaded_sw and st.button("Stil-Profil berechnen", key="m1_upload"):
            with st.spinner("Berechne Stil-Profil…"):
                from fp.m1_style.swipe import build_profile, load_tags
                from fp.schemas import SwipeEvent
                swipes_raw = json.loads(uploaded_sw.read())
                swipes = [SwipeEvent(**s) for s in swipes_raw]
                tags = load_tags(ROOT / "data/style_images/tags.json")
                st.session_state.profile = build_profile(swipes, tags, session_id="custom")

    p = st.session_state.profile
    if p:
        st.success(f"✅ {p.swipe_count} Swipes verarbeitet")
        col_chart, col_meta = st.columns([3, 2])
        with col_chart:
            from fp.schemas import STYLE_AXES
            axes_data = {name: val for name, val in zip(STYLE_AXES, p.vectors.style_axes)}
            st.bar_chart(axes_data, height=260)
        with col_meta:
            st.metric("Fülle", f"{p.vectors.atmosphere_density[0]:.2f}")
            st.metric("Lebendigkeit", f"{p.vectors.atmosphere_density[1]:.2f}")
            tops_obj = p.top_tags("object_category")
            if tops_obj:
                st.write("**Top Kategorien:**", ", ".join(tops_obj[:3]))
            tops_acc = p.top_tags("accessory")
            if tops_acc:
                st.write("**Top Accessoires:**", ", ".join(tops_acc[:3]))
        with st.expander("📋 style_profile.json"):
            st.json(json.loads(p.model_dump_json()))

# ─────────────────────────────────── M2 ──────────────────────────────────────
with tab2:
    st.header("Schritt 2 — Raummodell (M2)")

    m2_options = ["Synthetischer Raum (4 × 5 m)", "room.json hochladen"]
    if _has_gpu:
        m2_options.append("Video → MASt3R (GPU)")
    m2_src = st.radio("Quelle", m2_options, horizontal=False)

    if m2_src.startswith("Synthetisch"):
        if st.button("Synthetischen Raum erstellen", key="m2_synth"):
            with st.spinner("Erstelle synthetischen Raum…"):
                from fp.m2_capture.run import run_capture
                with tempfile.TemporaryDirectory() as td:
                    st.session_state.room = run_capture(None, td, synthetic=True)
            st.success("✅ Synthetischer Raum 4 × 5 m erstellt")

    elif m2_src.startswith("room.json"):
        uploaded_room = st.file_uploader("room.json hochladen", type="json", key="room_up")
        if uploaded_room and st.button("Raummodell laden", key="m2_upload"):
            from fp.schemas import RoomModel
            st.session_state.room = RoomModel.model_validate_json(
                uploaded_room.read().decode()
            )
            st.success("✅ Raummodell geladen")

    else:  # MASt3R
        st.info("MASt3R rekonstruiert einen Raum aus einem Handy-Video (2–5 Min).")
        video_file = st.file_uploader("Raum-Video hochladen", type=["mp4", "mov", "avi"])
        if video_file and st.button("Rekonstruieren (MASt3R)", key="m2_mast3r"):
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tf:
                tf.write(video_file.read())
                tmp_video = tf.name
            try:
                with st.spinner("MASt3R rekonstruiert Raum… (kann einige Minuten dauern)"):
                    from fp.m2_capture.run import run_capture
                    with tempfile.TemporaryDirectory() as td:
                        st.session_state.room = run_capture(
                            tmp_video, td, engine="mast3r"
                        )
                st.success("✅ Raummodell via MASt3R erstellt")
            finally:
                Path(tmp_video).unlink(missing_ok=True)

    r = st.session_state.room
    if r:
        fp_poly = r.floor_polygon
        col_a, col_b, col_c = st.columns(3)
        try:
            w = fp_poly[1][0]
            l = fp_poly[2][1]
            col_a.metric("Breite", f"{w:.2f} m")
            col_b.metric("Länge", f"{l:.2f} m")
        except (IndexError, TypeError):
            col_a.metric("Punkte im Polygon", str(len(fp_poly)))
        col_c.metric("Deckenhöhe", f"{r.ceiling_height:.2f} m")
        st.write(
            f"**Wände:** {len(r.walls)}  ·  "
            f"**Öffnungen:** {len(r.openings)}"
            + (f" ({', '.join(o.kind for o in r.openings)})" if r.openings else "")
        )
        with st.expander("Grundriss-Vorschau"):
            fig, ax = plt.subplots(figsize=(4, 4))
            pts = fp_poly + [fp_poly[0]]
            ax.plot([p[0] for p in pts], [p[1] for p in pts], "k-", lw=2)
            for op in r.openings:
                if op.polygon:
                    ox = [p[0] for p in op.polygon]
                    oy = [p[1] for p in op.polygon]
                    color = "brown" if op.kind == "door" else "steelblue"
                    ax.fill(ox, oy, color=color, alpha=0.4)
            ax.set_aspect("equal")
            ax.set_xlabel("m"); ax.set_ylabel("m")
            ax.set_title("Grundriss")
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
            plt.close(fig)
            st.image(buf.getvalue(), width=320)

# ─────────────────────────────────── M3 ──────────────────────────────────────
with tab3:
    st.header("Schritt 3 — Layout generieren (M3)")

    if not m1_ok:
        st.warning("Bitte zuerst **Schritt 1** (Stil-Profil) abschliessen.")
    elif not m2_ok:
        st.warning("Bitte zuerst **Schritt 2** (Raummodell) abschliessen.")
    else:
        if has_groq:
            llm_label = "Groq · Llama 3.3 70B"
        elif has_anthropic:
            llm_label = "Anthropic · Claude Sonnet"
        else:
            llm_label = "Heuristik (kein API-Key)"
        st.info(f"🤖 KI-Quelle: **{llm_label}**")

        if st.button("▶ Layout generieren", type="primary", use_container_width=True):
            with st.spinner("KI generiert Directives · Solver platziert Möbel…"):
                try:
                    from fp.m3_planning.assemble import load_catalog, plan
                    catalog = load_catalog(ROOT / "data/catalog/furniture.json")
                    with tempfile.TemporaryDirectory(prefix="fp_m3_") as td:
                        directives, scene, source = plan(
                            st.session_state.room,
                            st.session_state.profile,
                            catalog,
                            td,
                        )
                        layout_path = Path(td) / "layout.png"
                        scene_path = Path(td) / "scene.json"
                        dir_path = Path(td) / "directives.json"
                        st.session_state.layout_png = layout_path.read_bytes() if layout_path.exists() else None
                        st.session_state.scene_json = scene_path.read_text() if scene_path.exists() else None
                        st.session_state.directives_json = dir_path.read_text() if dir_path.exists() else None
                    st.session_state.llm_source = source
                    st.session_state.solver_status = scene.solver_status
                    st.rerun()
                except Exception as exc:
                    st.error(f"Fehler beim Generieren: {exc}")

        if st.session_state.layout_png:
            col_img, col_meta = st.columns([3, 2])
            with col_img:
                st.image(st.session_state.layout_png, caption="Layout — Draufsicht",
                         use_container_width=True)
                st.download_button(
                    "⬇️ layout.png herunterladen",
                    data=st.session_state.layout_png,
                    file_name="layout.png",
                    mime="image/png",
                )
            with col_meta:
                st.metric("Solver-Status", st.session_state.solver_status or "—")
                st.metric("KI-Quelle", (st.session_state.llm_source or "—").upper())
                if st.session_state.scene_json:
                    st.download_button(
                        "⬇️ scene.json herunterladen",
                        data=st.session_state.scene_json,
                        file_name="scene.json",
                        mime="application/json",
                    )

            if st.session_state.directives_json:
                with st.expander("📋 Directives JSON (KI-Output)"):
                    st.json(json.loads(st.session_state.directives_json))
            if st.session_state.scene_json:
                with st.expander("📋 Scene JSON (Solver-Output)"):
                    st.json(json.loads(st.session_state.scene_json))
