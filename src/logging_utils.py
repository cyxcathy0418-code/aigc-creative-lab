from __future__ import annotations

import logging
import os
from typing import Any


def setup_logging() -> logging.Logger:
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    return logging.getLogger("creative_lab")


def safe_brief_summary(brief: Any) -> dict[str, Any]:
    return {
        "name": brief.name,
        "selling_points": brief.selling_points,
        "brand_tone": brief.brand_tone,
        "target_markets": brief.target_markets,
        "platform": brief.platform,
        "style_preference": brief.style_preference,
        "images": [
            {
                "file_name": image.file_name,
                "mime_type": image.mime_type,
                "size_bytes": len(image.data),
            }
            for image in brief.images
        ],
    }
