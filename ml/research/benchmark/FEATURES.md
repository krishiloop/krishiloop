# Frozen-backbone features

Generated 2026-10-29 16:42 by `kl_research.report` from each backbone's `_meta.json` on the 5090 (`F:\krishiloop-5090\features\<backbone>\<dataset>.npz`: `uid` aligned with the manifest, `X` float16 L2-normalised, `ok`). Features are outside git. GPU: one RTX 5090 (32 GB), shared with the safety eval (Ollama) which has priority.

What `X` is: open_clip models: `encode_image` (the model's own pooled, projected image embedding, compared with text), with the model's own open_clip preprocessing; timm ViTs (DINOv2, DINOv3): the CLS token after the final norm, preprocessing resize (bicubic) to res x 256/224, centre-crop, model mean/std. EXIF orientation applied; JPEGs decoded with DCT scaling to at least 2x the model resolution before the model's own resize; bf16 autocast.

| Backbone | Model (weights) | Licence (HF API) | Res | Dim | Images embedded | Steady GPU img/s | Steady end-to-end img/s | Peak VRAM GB | Text embeddings |
|---|---|---|---|---|---|---|---|---|---|
| bioclip2 | `hf-hub:imageomics/bioclip-2` | mit | 224 | 768 | 31430 | 667.6 | 569.5 | 2.45 | yes |
| siglip2_b16 | `ViT-B-16-SigLIP2` / webli | apache-2.0; upstream google/siglip2-base-patch16-224: apache-2.0 | 224 | 768 | 31430 | 2845.8 | 1637.5 | 2.74 | yes |
| siglip2_so400m | `ViT-SO400M-16-SigLIP2-384` / webli | apache-2.0; upstream google/siglip2-so400m-patch16-384: apache-2.0 |  |  | pending |  |  |  | planned |
| dinov2_b | `vit_base_patch14_dinov2.lvd142m` | apache-2.0; upstream facebook/dinov2-base: apache-2.0 | 224 | 768 | 31430 | 2137.8 | 190.7 | 2.01 | no (image-only) |
| dinov2_l | `vit_large_patch14_dinov2.lvd142m` | apache-2.0; upstream facebook/dinov2-large: apache-2.0 | 224 | 1024 | 31430 | 717.8 | 672.6 | 2.24 | no (image-only) |
| dinov2_g | `vit_giant_patch14_dinov2.lvd142m` | apache-2.0; upstream facebook/dinov2-giant: apache-2.0 | 224 |  | pending |  |  |  | no (image-only) |
| eva02_l | `EVA02-L-14` / merged2b_s4b_b131k | mit | 224 | 768 | 31430 | 471.3 | 366.3 | 3.15 | yes |
| pe_core_l | `PE-Core-L-14-336` / meta | apache-2.0; upstream facebook/PE-Core-L14-336: apache-2.0 | 336 | 1024 | 31430 | 265.5 | 198.6 | 4.81 | yes |
| dinov3_b **(flagged comparison only)** | `vit_base_patch16_dinov3.lvd1689m` | other; upstream facebook/dinov3-vitb16-pretrain-lvd1689m: other (gated: manual approval) | 224 |  | pending |  |  |  | no (image-only) |
| dinov3_l **(flagged comparison only)** | `vit_large_patch16_dinov3.lvd1689m` | other; upstream facebook/dinov3-vitl16-pretrain-lvd1689m: other (gated: manual approval) | 224 |  | pending |  |  |  | no (image-only) |

Throughput is measured after the first two batches (cuDNN autotuning and DataLoader start-up excluded), on the largest pass of each backbone that used worker processes; GPU img/s times only the forward pass (CUDA events, bf16), end-to-end includes JPEG decoding by the DataLoader workers (6 to 12 processes, shown per pass in `_meta.json`). The PC is shared: the safety eval (Ollama), the voice and sovereign tracks ran on the same GPU and CPU at the same time, so these are lower bounds, measured under contention, not peak numbers. Passes are incremental (each dataset is embedded as it lands), so per-backbone image counts can differ while downloads are running.

## Licence notes

- Licences above are the `license` field of each Hugging Face model card, read through the HF API on 29 Oct 2026 (`benchmark/licence_screen.json`); upstream = the original publisher's repository when timm or open_clip re-host the weights.
- Perception Encoder Core L: Apache-2.0 on both the timm re-host and Meta's repository, so it enters the study (the protocol admitted it only if licensed).
- DINOv3: custom `DINOv3 License` (`other`); Meta's repositories are gated with manual approval, the timm re-host is not gated. It runs last and only as a flagged comparison; its numbers never pick the shipped model. Before any use beyond this comparison, the lead should confirm that the DINOv3 License terms are accepted.
- Text embeddings: the label prompts are fixed in `configs/prompts.yaml` (written before any result); the class vector is the normalised mean of the normalised prompt embeddings (`<backbone>/_text.npz`).
