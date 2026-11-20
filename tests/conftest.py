import pytest


@pytest.fixture(autouse=True, scope="session")
def _vector_store_in_tmp(tmp_path_factory):
    """Tests never write the Ask vector store into the real data/ folder."""
    mp = pytest.MonkeyPatch()
    mp.setenv("KRISHILOOP_VECTOR_DIR", str(tmp_path_factory.mktemp("ask_vectors")))
    yield
    mp.undo()
