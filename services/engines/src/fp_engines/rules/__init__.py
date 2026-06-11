"""Regel-Interpreter (Python) – Spiegel von packages/shared/src/rules (TS).

Semantik & Parameter-Konventionen: packages/shared/src/rules/README.md.
Paritäts-Gesetz: Änderungen immer beidseitig + Fixtures, im selben Commit.
"""

from fp_engines.rules.interpreter import evaluate_rules
from fp_engines.rules.scene import Scene, SceneObject, build_scene

__all__ = ["Scene", "SceneObject", "build_scene", "evaluate_rules"]
