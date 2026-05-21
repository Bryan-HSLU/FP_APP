"""CLI for the Future Planning algorithm POC.

    python -m fp m1 --swipes data/swipes.json
    python -m fp m3 --room tests/fixtures/room_fixture.json
    python -m fp m2 --video data/videos/room_demo.mp4
    python -m fp all --swipes data/swipes.json --room tests/fixtures/room_fixture.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # noqa: BLE001
    pass

DEFAULT_TAGS = "data/style_images/tags.json"
DEFAULT_CATALOG = "data/catalog/furniture.json"
DEFAULT_OUT = "out"


def cmd_m1(args: argparse.Namespace) -> int:
    from fp.m1_style.swipe import build_profile, load_swipes, load_tags

    swipes = load_swipes(args.swipes)
    tags = load_tags(args.tags)
    profile = build_profile(swipes, tags, session_id=args.session)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "style_profile.json").write_text(profile.model_dump_json(indent=2))
    print(f"[M1] {profile.swipe_count} swipes -> {out/'style_profile.json'}")
    print(f"[M1] style_axes={[round(v,2) for v in profile.vectors.style_axes]}")
    print(f"[M1] top object_category={profile.top_tags('object_category')}")
    print(f"[M1] top accessory={profile.top_tags('accessory')}")
    return 0


def cmd_m2(args: argparse.Namespace) -> int:
    from fp.m2_capture.run import run_capture

    room = run_capture(
        args.video, args.out,
        scale_ref=args.scale_ref, measured=getattr(args, "measured", None),
        synthetic=getattr(args, "synthetic", False),
    )
    w = room.floor_polygon[1][0]
    l = room.floor_polygon[2][1]
    print(f"[M2] room {w:.2f}x{l:.2f}x{room.ceiling_height:.2f} m -> {args.out}/room.json "
          f"({len(room.walls)} walls, {len(room.openings)} openings: "
          f"{[o.kind for o in room.openings]})")
    return 0


def cmd_m3(args: argparse.Namespace) -> int:
    from fp.m3_planning.assemble import load_catalog, load_profile, load_room, plan

    room = load_room(args.room)
    profile = load_profile(args.profile)
    catalog = load_catalog(args.catalog)
    use_llm = None if args.llm is None else args.llm
    directives, scene, source = plan(room, profile, catalog, args.out, use_llm=use_llm)
    print(f"[M3] directives via {source.upper()}: "
          f"{len(directives.objects)} objects, {len(directives.relations)} relations")
    print(f"[M3] solver: {scene.solver_status}, placed {len(scene.objects)} objects")
    if scene.violations:
        print(f"[M3] violations: {scene.violations}")
    print(f"[M3] -> {args.out}/scene.gltf  +  {args.out}/layout.png")
    return 0


def cmd_all(args: argparse.Namespace) -> int:
    rc = cmd_m1(args)
    if rc:
        return rc
    if args.video or args.synthetic:
        rc = cmd_m2(args)
        if rc:
            return rc
        args.room = str(Path(args.out) / "room.json")
    args.profile = str(Path(args.out) / "style_profile.json")
    return cmd_m3(args)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="fp", description="Future Planning POC (M1-M3)")
    sub = p.add_subparsers(dest="cmd", required=True)

    m1 = sub.add_parser("m1", help="Stilanalyse: swipes -> style_profile.json")
    m1.add_argument("--swipes", required=True)
    m1.add_argument("--tags", default=DEFAULT_TAGS)
    m1.add_argument("--session", default="session")
    m1.add_argument("--out", default=DEFAULT_OUT)
    m1.set_defaults(func=cmd_m1)

    m2 = sub.add_parser("m2", help="Raumerfassung: video -> room.json + room.gltf")
    m2.add_argument("--video", default=None)
    m2.add_argument("--synthetic", action="store_true",
                    help="use a synthetic room cloud (no video / COLMAP needed)")
    m2.add_argument("--scale-ref", type=float, default=None,
                    help="real-world length in meters of a marked reference")
    m2.add_argument("--measured", type=float, default=None,
                    help="measured length of that reference in model units (headless scale)")
    m2.add_argument("--out", default=DEFAULT_OUT)
    m2.set_defaults(func=cmd_m2)

    m3 = sub.add_parser("m3", help="Planung: profile + room -> scene + layout.png")
    m3.add_argument("--room", required=True)
    m3.add_argument("--profile", default=f"{DEFAULT_OUT}/style_profile.json")
    m3.add_argument("--catalog", default=DEFAULT_CATALOG)
    m3.add_argument("--out", default=DEFAULT_OUT)
    grp = m3.add_mutually_exclusive_group()
    grp.add_argument("--llm", dest="llm", action="store_true", default=None,
                     help="force Claude (requires ANTHROPIC_API_KEY)")
    grp.add_argument("--no-llm", dest="llm", action="store_false",
                     help="force the offline heuristic")
    m3.set_defaults(func=cmd_m3)

    al = sub.add_parser("all", help="run M1 -> (M2) -> M3 end to end")
    al.add_argument("--swipes", required=True)
    al.add_argument("--tags", default=DEFAULT_TAGS)
    al.add_argument("--session", default="session")
    al.add_argument("--room", default="tests/fixtures/room_fixture.json")
    al.add_argument("--video", default=None)
    al.add_argument("--synthetic", action="store_true",
                    help="run M2 on a synthetic room cloud instead of a fixture room")
    al.add_argument("--scale-ref", type=float, default=None)
    al.add_argument("--measured", type=float, default=None)
    al.add_argument("--catalog", default=DEFAULT_CATALOG)
    al.add_argument("--out", default=DEFAULT_OUT)
    al.add_argument("--llm", dest="llm", action="store_true", default=None)
    al.add_argument("--no-llm", dest="llm", action="store_false")
    al.set_defaults(func=cmd_all)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
