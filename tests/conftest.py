"""Pytest hooks for this test suite.

Kept separate from test_ab_experiment.py on purpose: that file has
unrelated pending local edits, and this hook needs to ship independently
of resolving those.
"""

import platform

import pytest

# tests/test_ab_experiment.py::ABExperimentTests::test_manual_scoring_stays_blind_until_arms_are_explicitly_revealed
# segfaults specifically on Linux (reproduced on GitHub Actions
# ubuntu-latest) inside pyarrow's native DataFrame conversion, triggered by
# Streamlit's threaded AppTest runner rendering a dataframe. It passes
# reliably on Windows (both a normal and a from-scratch venv, multiple
# repeated runs). Root cause is unconfirmed and there is no Linux
# environment available locally to debug further, so it is skipped only on
# the platform where it actually crashes rather than disabled outright.
# Remove this skip once the underlying pyarrow/pandas/Streamlit
# incompatibility is understood and fixed.
_LINUX_SEGFAULT_TEST = (
    "test_manual_scoring_stays_blind_until_arms_are_explicitly_revealed"
)


def pytest_collection_modifyitems(config, items):
    if platform.system() != "Linux":
        return

    skip_marker = pytest.mark.skip(
        reason=(
            "Known Linux-only pyarrow segfault inside Streamlit's threaded "
            "AppTest dataframe rendering; passes on Windows. See "
            "tests/conftest.py for details."
        )
    )
    for item in items:
        if item.name == _LINUX_SEGFAULT_TEST:
            item.add_marker(skip_marker)
