# LICENSES – genutzte Open-Source-Bausteine

> Eigener Code: **proprietär** (© Future Planning). Diese Liste dokumentiert
> die Lizenzen aller genutzten Fremd-Bausteine gemäss Brain →
> `vault/60_Quellen/Modell-und-Tool-Quellen.md`. **Regel:** Jeder neue
> Baustein wird hier **vor** der ersten Nutzung eingetragen. ⚠️-Fälle sind
> fürs spätere Produkt zu ersetzen oder zu lizenzieren – im POC nur
> Eval-Nutzung erlaubt.

## Verbindliche Lizenz-Flags

| Baustein | Zweck | Lizenz | Status |
|---|---|---|---|
| Depth Anything V2 **Small** | metrische Mono-Tiefe (Scan) | Apache-2.0 | ✅ erlaubt |
| Depth Anything V2 Base/Large | Tiefe (besser) | **CC-BY-NC** | ⚠️ **nur Eval**, nie ins Produkt |
| Grounding DINO | Offenes-Vokabular-Detektion | Apache-2.0 | ✅ erlaubt |
| SAM 2 | Segmentierung/Tracking | Apache-2.0 | ✅ erlaubt |
| YOLO11 / Ultralytics | Detektion (Fallback) | **AGPL-3.0** | ⚠️ **meiden**; höchstens Eval-Vergleich, nie einbauen |
| nerfstudio / gsplat | Gaussian Splatting (Kür) | Apache-2.0 | ✅ erlaubt |
| Ollama | lokales LLM-Serving (Kurator) | MIT | ✅ erlaubt |
| Qwen-Instruct-Familie | Kurator-LLM | meist Apache-2.0 | ✅ je Modell prüfen |
| Llama-Familie | Kurator-LLM (Alternative) | Llama Community License | ⚠️ Bedingungen prüfen |
| Gemma-Familie | Kurator-LLM (Alternative) | Gemma Terms | ⚠️ Bedingungen prüfen |

## Laufzeit-Abhängigkeiten (Stand M0/M1)

### Python (PyPI)

| Paket | Lizenz |
|---|---|
| fastapi | MIT |
| pydantic v2 | MIT |
| uvicorn | BSD-3-Clause |
| jsonschema | MIT |
| pytest | MIT |
| ruff | MIT |
| mypy | MIT |
| datamodel-code-generator | MIT |

### JavaScript/TypeScript (npm)

| Paket | Lizenz |
|---|---|
| react / react-dom | MIT |
| vite | MIT |
| three | MIT |
| @react-three/fiber | MIT |
| typescript | Apache-2.0 |
| vitest | MIT |
| eslint / prettier | MIT |
| ajv | MIT |
| json-schema-to-typescript | MIT |

> Später dazukommend (gemäss Konzept): shapely, numpy, networkx,
> trimesh/open3d, ezdxf, WeasyPrint/ReportLab, PyTorch/ONNX Runtime (Scan),
> zustand, three-mesh-bvh, `<model-viewer>` – alle MIT/BSD/Apache; beim
> Einbau hier ergänzen.
