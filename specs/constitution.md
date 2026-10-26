# KrishiLoop Constitution (non-negotiables)
*Spec-first, in the GitHub Spec-Kit style. Every spec, plan and task must comply. Amend only by team decision, recorded at the bottom.*

## Article 1 — Receipt or abstain
Every recommendation shown to a farmer or officer carries a **receipt** made of:
- (a) ≥1 source reference (doc id, page, short verbatim quote);
- (b) the data readings used, each with its source and timestamp;
- (c) the rule id(s);
- (d) a confidence level.

If any element can't be produced, the system **abstains** and routes the case to the officer inbox. There is no third option.

## Article 2 — The LLM never authors agronomy
Agronomic content comes only from `rules/registry/` and from retrieval over licence-cleared or permitted sources. Language models may **phrase, translate and summarise** validated content. They never add actions, thresholds, doses or products.

## Article 3 — No doses, no brands
Generated text contains no pesticide or fertiliser dose unless the dose is a verbatim substring of the cited source passage, and it never contains brand or trade names. Advice is IPM-first.

## Article 4 — Honesty
- No fabricated data, demos, testimonials or metrics.
- Sample data is labelled *sample*.
- Metrics must be reproducible from the repo plus named datasets.
- Every control is presented as `implemented` (with a link) or `planned`.
- Facts in user-facing text come from the verified fact register.

## Article 5 — Farmer data belongs to the farmer
- Diagnosis is on-device by default.
- Photos are uploaded only for "I did it" proofs or with explicit consent.
- GPS EXIF is stripped from stored copies, while the server records capture time plus a signed hash.
- Sharing happens only through **farmer-initiated, scoped, expiring links**.
- No lender back-door.
- No photos, names, phone numbers or exact locations go to free-tier third-party AI APIs.

## Article 6 — Licences
- Only sources marked `cleared` or `permitted` in `corpus/manifest.yaml` may be indexed or committed.
- Sources with `permission_status: requested` may be cited (title, link, page, quote ≤25 words), and nothing more.

## Article 7 — Independence
We sell no inputs and take no commissions. Any sponsor is labelled as a sponsor.

## Article 8 — Inclusion
- Bangla first, with voice support and low-literacy design.
- Works on a shared phone and on slow networks.
- Officers can serve farmers who have no smartphone.

## Article 9 — Secrets and safety
- Keys come only from environment variables; they are never logged or committed.
- Prompt-injection defences apply to all retrieved and model-generated text before it reaches a farmer.

---
*Amendments log:*
- v1, 2026-10-26: initial version adopted from MASTER_PLAN v4 / PRODUCT_CONCEPT v2.
