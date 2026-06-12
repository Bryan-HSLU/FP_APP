"""Überholt durch fp_engines.kurator.BaselineKurator (M4) – dünne Delegation.

Bleibt als Kompatibilitäts-Schicht für bestehende Aufrufer; neue Aufrufer
nutzen direkt den KuratorPort (waehle_port / BaselineKurator).
"""

from typing import Any

from fp_engines.kurator import BaselineKurator

_NEUTRAL: dict[str, Any] = {"styleVector": {}, "derivedRequirements": [], "palette": []}


def baseline_auswahl(room: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, Any]:
    """Neutrale Kurator-Baseline (ein Item je Slot, Flächen-Daumenregel)."""
    return BaselineKurator().kuratiere(_NEUTRAL, room, catalog, None, seed=1)
