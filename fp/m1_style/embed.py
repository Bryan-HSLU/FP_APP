"""Optional CLIP enrichment for Modul 1.

The deterministic swipe logic in swipe.py works purely from predefined tags so
the POC runs offline. When open_clip + torch are installed and real catalog
images are present, these helpers derive the visual style axes directly from the
image instead of relying on hand tags. CLIP is therefore an enhancement, not a
hard dependency of the algorithm.
"""

from __future__ import annotations

from functools import lru_cache

from fp.schemas import STYLE_AXES

# Natural-language anchors for each style axis (low pole, high pole).
AXIS_ANCHORS: dict[str, tuple[str, str]] = {
    "color_temperature": ("a cool toned interior", "a warm toned interior"),
    "brightness": ("a dark dim interior", "a bright airy interior"),
    "materiality": ("an interior of smooth synthetic surfaces", "an interior of natural raw materials"),
    "form_language": ("an interior with hard geometric forms", "an interior with soft organic forms"),
    "density": ("a minimal empty interior", "a richly furnished dense interior"),
    "epoch": ("a classic traditional interior", "a modern contemporary interior"),
    "atmosphere": ("a formal interior", "a cozy relaxed interior"),
    "color_intensity": ("a muted monochrome interior", "a vivid colorful interior"),
}


@lru_cache(maxsize=1)
def _load_model():
    import open_clip
    import torch

    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="laion2b_s34b_b79k"
    )
    model.eval()
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    return model, preprocess, tokenizer, torch


def image_axes_from_clip(image_path: str) -> dict[str, float]:
    """Return the 8 style axes in [0,1] inferred from an image via CLIP."""
    from PIL import Image

    model, preprocess, tokenizer, torch = _load_model()
    img = preprocess(Image.open(image_path).convert("RGB")).unsqueeze(0)
    with torch.no_grad():
        img_feat = model.encode_image(img)
        img_feat /= img_feat.norm(dim=-1, keepdim=True)
        out: dict[str, float] = {}
        for axis in STYLE_AXES:
            lo, hi = AXIS_ANCHORS[axis]
            txt = tokenizer([lo, hi])
            tfeat = model.encode_text(txt)
            tfeat /= tfeat.norm(dim=-1, keepdim=True)
            sims = (img_feat @ tfeat.T).softmax(dim=-1).squeeze(0)
            out[axis] = float(sims[1])  # probability mass on the "high" pole
    return out
