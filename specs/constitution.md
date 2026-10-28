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
Generated text contains no pesticide or fertiliser dose unless the dose (amount and unit) matches a dose stated in the cited source passage, checked numerically in English and Bangla, and it never contains brand or trade names (Latin or Bangla script). Advice is IPM-first.

## Article 4 — Honesty
- No fabricated data, demos, testimonials or metrics.
- Sample data is labelled *sample*.
- Metrics must be reproducible from the repo plus named datasets.
- Every control is presented as `implemented` (with a link) or `planned`.
- Facts in user-facing text come from the verified fact registers (VERIFIED rows only).
- Prior-art claims say "we found no example", never "nobody does X". Anything planned is described as planned: the Knowledge Compiler is planned, not built, and "zero engine diff between packs" is not shown until a second pack exists.

## Article 5 — Farmer data belongs to the farmer
- Diagnosis is on-device by default.
- Photos are uploaded only for action attestations or with explicit consent.
- GPS EXIF is stripped from stored copies, while the server records capture time plus a signed hash.
- Sharing happens only through **farmer-initiated, scoped, expiring links**.
- No lender back-door.
- No photos, names, phone numbers or exact locations go to free-tier third-party AI APIs.

## Article 6 — Licences
- Only sources marked `cleared` or `permitted` in `corpus/manifest.yaml` may be indexed or committed.
- Sources with `licence_status: cited_permission_requested` may be cited (title, link, page, quote ≤25 words), and nothing more.
- A quotation permission (for example CIP's statement allowing quotation with acknowledgement) is `permitted` for quotation only. It is not an open licence: never label it CC BY or "openly licensed".

## Article 7 — Independence
We sell no inputs and take no commissions. Any sponsor is labelled as a sponsor.

## Article 8 — Inclusion
- **Local language first:** each pack's own language (Bangla for the Bangladesh pack, English for the Kenya pack, Swahili once reviewed), with voice support and low-literacy design. A language without a native-speaker review is labelled "machine-translated preview".
- Works on a shared phone and on slow networks.
- Officers can serve farmers who have no smartphone.

## Article 9 — Secrets and safety
- Keys come only from environment variables; they are never logged or committed.
- Prompt-injection defences apply to all retrieved and model-generated text before it reaches a farmer.

---
*Amendments log:*
- v1, 2026-10-26: initial version adopted from MASTER_PLAN v4 / PRODUCT_CONCEPT v2.
- v1.1, 2026-10-28: docs sweep after the Oct 27 reviews, aligned with MASTER_PLAN v6 / PRODUCT_CONCEPT v3.1. Editorial: the Art. 6 field name is now `licence_status: cited_permission_requested`; Art. 3 states the numeric dose check that the validator implements; Art. 4 adds the wording rules; Art. 5 uses the attestation naming. Art. 8 becomes "local language first" to match the global product (the owner's standing rule); **a recorded team decision on Art. 8 is still pending.**
