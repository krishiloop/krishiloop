"""KrishiLoop research package: the multi-domain plant-health benchmark and the earned-trust study.

Pre-registered protocol: ``ml/research/PROTOCOL_v1.md`` (29 Oct 2026); deviations: ``ml/research/DEVIATIONS.md``.

Modules
- ``sources``          public-API helpers (Mendeley Data, Zenodo, Hugging Face, GitHub) and the licence screen
- ``fetch``            resumable downloader: parallel byte ranges with per-host caps, partial zip extraction with CRC
                       checks, byte-verified mirrors (transport only)
- ``prefetch_models``  backbone weights from the Hugging Face CDN into the HF cache layout
- ``manifest``         per-dataset scan (sha256, pHash, EXIF device, original label, capture) and the manifest build
- ``dedup``            exact / perceptual / DINOv2-B near-copy clusters and the duplicate-drop rule
- ``features``         frozen-backbone image embeddings and label text embeddings, cached as npz outside git
- ``pipeline``         keeps the GPU busy: scans and embeds every dataset as soon as its download lands
- ``heads``            H1 text-anchored probe, H3 logistic regression, macro-F1, ECE
- ``rq1``              leave-one-domain-out evaluation of frozen backbones with cluster-bootstrap intervals
- ``build``            dedup -> manifest -> text embeddings -> RQ1 in one re-runnable step
- ``report``           DATASETS.md, FEATURES.md and summary counts from the machine-readable records
- ``eppo_check``       verifies EPPO codes in the label map against gd.eppo.int
- ``overlap``          checks perceptual (pHash) matches against DINOv2-B, within and across datasets

Run order on the 5090 (each is a resumable ``kljob`` job; scripts in ``ml/research/jobs/``, copied to
``F:\\krishiloop-5090\\scripts\\research\\``):
1. licence screen (laptop): ``python -m kl_research.sources screen configs/datasets.yaml configs/backbones.yaml benchmark/licence_screen.json``
2. downloads: ``fetch_run.ps1`` (S3 queue), ``fetch_cdn_run.ps1`` (CDN / mirrors), ``fetch_lk_run.ps1`` (Zenodo)
3. weights: ``prefetch_models_run.ps1``; features: ``pipeline_run.ps1`` (runs until every landed dataset has every backbone)
4. ``build_run.ps1`` (dedup, manifest, text embeddings; ``--no-rq1`` to skip RQ1), then ``rq1_g1/g2/g3.ps1`` in parallel and
   ``python -m kl_research.rq1 merge <out.json> <g1.json> <g2.json> <g3.json>``
5. laptop: ``bash jobs/pull_state.sh`` then ``python -m kl_research.report . <state_dir>``

Seeds: 20261029 everywhere (caps, validation splits, bootstrap). Nothing in this package needs a credential; sources
that need one are rejected by the licence screen.
"""

__version__ = "0.1.0"
