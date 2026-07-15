from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from src.ab_eval import BaseABJudge, evaluate_ab_experiment
from src.ab_experiment import BaseImageGenerator, run_ab_images
from src.derivation_retry import derive_creatives_with_retries
from src.llm_client import BaseLLMClient
from src.retry import extract_spec_with_retries
from src.schemas import ABGenerationSettings, Brief, DerivationContext, ProductSpec


class SpecGraphState(TypedDict, total=False):
    brief: Brief
    context: DerivationContext
    raw_output: str
    spec: dict[str, Any]
    errors: list[str]


class DerivationGraphState(TypedDict, total=False):
    spec: ProductSpec | dict[str, Any]
    context: DerivationContext
    raw_output: str
    creatives: list[dict[str, Any]]
    errors: list[str]


class CreativeWorkflowState(SpecGraphState, total=False):
    context: DerivationContext
    creatives: list[dict[str, Any]]


class ABExperimentGraphState(TypedDict, total=False):
    spec: ProductSpec | dict[str, Any]
    creatives: list[dict[str, Any]]
    selected_markets: list[str]
    source_images: list[dict[str, Any]]
    primary_reference_index: int
    generation_settings: ABGenerationSettings | dict[str, Any]
    manifest: dict[str, Any]


def build_spec_graph(client: BaseLLMClient | None = None):
    graph = StateGraph(SpecGraphState)
    graph.add_node("extract_spec", _make_extract_spec_node(client))
    graph.add_edge(START, "extract_spec")
    graph.add_edge("extract_spec", END)
    return graph.compile()


def _make_extract_spec_node(client: BaseLLMClient | None = None):
    def extract_spec_node(state: SpecGraphState) -> SpecGraphState:
        if "brief" not in state:
            raise ValueError("Graph state missing brief")

        result = extract_spec_with_retries(state["brief"], client=client)
        return {
            "raw_output": result.raw_output,
            "spec": result.spec.model_dump(),
            "context": DerivationContext(
                target_markets=state["brief"].target_markets,
                platform=state["brief"].platform,
                style_preference=state["brief"].style_preference,
            ),
            "errors": result.attempt_errors,
        }

    return extract_spec_node


def build_derivation_graph(client: BaseLLMClient | None = None):
    graph = StateGraph(DerivationGraphState)
    graph.add_node("derive_creatives", _make_derivation_node(client))
    graph.add_edge(START, "derive_creatives")
    graph.add_edge("derive_creatives", END)
    return graph.compile()


def build_creative_workflow_graph(client: BaseLLMClient | None = None):
    """Full deterministic path retained for future one-click Brief-to-Creative runs."""
    graph = StateGraph(CreativeWorkflowState)
    graph.add_node("extract_spec", _make_extract_spec_node(client))
    graph.add_node("derive_creatives", _make_derivation_node(client))
    graph.add_edge(START, "extract_spec")
    graph.add_edge("extract_spec", "derive_creatives")
    graph.add_edge("derive_creatives", END)
    return graph.compile()


def build_ab_experiment_graph(
    generator: BaseImageGenerator | None = None,
    judge: BaseABJudge | None = None,
):
    """Paid A/B branch. It only runs after an explicit UI action."""
    graph = StateGraph(ABExperimentGraphState)

    def generate_ab_images(state: ABExperimentGraphState) -> dict[str, Any]:
        spec = ProductSpec.model_validate(state["spec"])
        generation_settings = ABGenerationSettings.model_validate(state["generation_settings"])
        manifest = run_ab_images(
            spec=spec,
            creatives_data=state["creatives"],
            selected_markets=state["selected_markets"],
            source_images=state["source_images"],
            primary_reference_index=state["primary_reference_index"],
            generation_settings=generation_settings,
            generator=generator,
        )
        return {"manifest": manifest}

    def evaluate_ab(state: ABExperimentGraphState) -> dict[str, Any]:
        manifest = evaluate_ab_experiment(
            manifest=state["manifest"],
            source_images=state["source_images"],
            judge=judge,
        )
        return {"manifest": manifest}

    def route_after_generation(state: ABExperimentGraphState) -> str:
        return "evaluate_ab" if state["manifest"].get("status") == "generated" else "end"

    graph.add_node("generate_ab_images", generate_ab_images)
    graph.add_node("evaluate_ab", evaluate_ab)
    graph.add_edge(START, "generate_ab_images")
    graph.add_conditional_edges(
        "generate_ab_images",
        route_after_generation,
        {"evaluate_ab": "evaluate_ab", "end": END},
    )
    graph.add_edge("evaluate_ab", END)
    return graph.compile()


def _make_derivation_node(client: BaseLLMClient | None = None):
    def derive_creatives_node(
        state: DerivationGraphState | CreativeWorkflowState,
    ) -> dict[str, Any]:
        if "spec" not in state:
            raise ValueError("Graph state missing spec")
        if "context" not in state:
            raise ValueError("Graph state missing derivation context")

        spec = ProductSpec.model_validate(state["spec"])
        result = derive_creatives_with_retries(
            spec,
            state["context"],
            client=client,
        )
        return {
            "raw_output": result.raw_output,
            "creatives": result.creatives.model_dump()["creatives"],
            "errors": result.attempt_errors,
        }

    return derive_creatives_node
