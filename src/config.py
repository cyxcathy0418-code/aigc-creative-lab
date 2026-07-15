from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    llm_provider: str
    openai_api_key: str | None
    openai_model: str
    openai_image_model: str
    openai_judge_model: str
    request_timeout: float
    max_retries: int
    langsmith_api_key: str | None
    langsmith_project: str


def get_settings() -> Settings:
    return Settings(
        llm_provider=os.getenv("LLM_PROVIDER", "openai").strip().lower(),
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o").strip() or "gpt-4o",
        openai_image_model=(
            os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2-2026-04-21").strip()
            or "gpt-image-2-2026-04-21"
        ),
        openai_judge_model=(
            os.getenv("OPENAI_JUDGE_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o")).strip()
            or "gpt-4o"
        ),
        request_timeout=float(os.getenv("OPENAI_REQUEST_TIMEOUT", "60")),
        max_retries=int(os.getenv("SPEC_MAX_RETRIES", "3")),
        langsmith_api_key=os.getenv("LANGSMITH_API_KEY"),
        langsmith_project=os.getenv("LANGSMITH_PROJECT", "aigc-creative-lab-spec"),
    )


def configure_langsmith() -> bool:
    settings = get_settings()
    if settings.langsmith_api_key:
        os.environ["LANGSMITH_TRACING"] = "true"
        os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
        os.environ.setdefault("LANGSMITH_PROJECT", settings.langsmith_project)
        os.environ.setdefault("LANGCHAIN_PROJECT", settings.langsmith_project)
        return True

    os.environ["LANGSMITH_TRACING"] = "false"
    os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")
    return False
