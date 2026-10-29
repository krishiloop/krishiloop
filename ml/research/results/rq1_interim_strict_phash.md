# RQ1 (shift), frozen backbones: leave-one-domain-out

Generated 2026-10-29T15:39:11 by `kl_research.rq1` (seed 20261029, 1000 cluster-bootstrap resamples). Dataset labels stand in for experts; this is a replay on public data, not a field trial.

**How to read it.** For each held-out domain, the head is trained on the other datasets of the same crop (the crop is known from the field record) and tested on the held-out domain; every domain of the held-out dataset is excluded from training, and near-copy clusters never span train and test. 'Source-val' is the in-distribution score on 20% of the training clusters; 'Drop' = source-val minus target macro-F1. Macro-F1 is over the labels that the held-out domain shares with training; images whose label never occurs in training are counted ('Unseen-label images') and not scored. ZS = zero-shot text classifier (H1 with no training), shown as a reference. H1 needs a text tower, so image-only backbones (DINOv2, DINOv3) report H3 only.

**Caveats.** Label sets differ between domains, so scores are not comparable across crops; several domains are seeded subsets (bandwidth caps, see DEVIATIONS.md); dataset labels are unaudited (some sets carry visible duplicates and label conflicts, removed by the de-duplication rule); the mean over domains weights every domain equally; DINOv3 is a flagged comparison only.

## Summary (mean over held-out domains; 95% interval = bootstrap over domains)

| Backbone / head | Domains | Source-val macro-F1 | Target macro-F1 [95% CI] | Drop | Target ECE [95% CI] | Worst domain (F1) |
|---|---|---|---|---|---|---|
| siglip2_b16/H1 | 8 | 0.835 | 0.427 [0.261, 0.620] | 0.408 | 0.318 [0.216, 0.404] | in_rice_sethy\|field\|unknown (0.226) |
| bioclip2/H1 | 8 | 0.826 | 0.408 [0.225, 0.614] | 0.418 | 0.333 [0.228, 0.425] | in_rice_sethy\|field\|unknown (0.084) |
| bioclip2/H3 | 8 | 0.864 | 0.399 [0.227, 0.620] | 0.465 | 0.395 [0.279, 0.481] | in_rice_sethy\|field\|unknown (0.121) |
| siglip2_b16/ZS | 8 | 0.200 | 0.394 [0.181, 0.619] | -0.194 | 0.186 [0.106, 0.307] | in_rice_sethy\|field\|unknown (0.074) |
| dinov2_b/H3 | 8 | 0.875 | 0.380 [0.239, 0.564] | 0.495 | 0.413 [0.291, 0.514] | in_rice_sethy\|field\|unknown (0.148) |
| siglip2_b16/H3 | 8 | 0.883 | 0.364 [0.259, 0.483] | 0.519 | 0.402 [0.319, 0.501] | in_rice_sethy\|field\|unknown (0.136) |
| dinov2_l/H3 | 8 | 0.883 | 0.344 [0.218, 0.505] | 0.539 | 0.441 [0.319, 0.538] | in_rice_sethy\|field\|unknown (0.137) |
| bioclip2/ZS | 8 | 0.147 | 0.186 [0.064, 0.321] | -0.039 | 0.123 [0.079, 0.162] | bd_rice_netrokona\|field\|unknown (0.003) |

## Every fold

| Backbone | Head | Held-out domain | n test | Source-val F1 | Target F1 [95% CI] | Target ECE [95% CI] | Unseen-label images |
|---|---|---|---|---|---|---|---|
| bioclip2 | H1 | bd_bean_bldbd\|field\|unknown | 430 | 0.951 | 1.000 [1.000, 1.000] | 0.019 [0.013, 0.058] | 217 |
| bioclip2 | H3 | bd_bean_bldbd\|field\|unknown | 430 | 0.963 | 0.998 [0.963, 1.000] | 0.024 [0.018, 0.055] | 217 |
| bioclip2 | ZS | bd_bean_bldbd\|field\|unknown | 430 | 0.364 | 0.581 [0.552, 0.817] | 0.124 [0.097, 0.287] | 217 |
| dinov2_b | H3 | bd_bean_bldbd\|field\|unknown | 430 | 0.956 | 0.816 [0.761, 0.879] | 0.050 [0.040, 0.185] | 217 |
| dinov2_l | H3 | bd_bean_bldbd\|field\|unknown | 430 | 0.959 | 0.874 [0.701, 0.896] | 0.049 [0.045, 0.147] | 217 |
| siglip2_b16 | H1 | bd_bean_bldbd\|field\|unknown | 430 | 0.962 | 0.986 [0.939, 0.997] | 0.016 [0.013, 0.061] | 217 |
| siglip2_b16 | H3 | bd_bean_bldbd\|field\|unknown | 430 | 0.963 | 0.594 [0.565, 0.797] | 0.198 [0.054, 0.226] | 217 |
| siglip2_b16 | ZS | bd_bean_bldbd\|field\|unknown | 430 | 0.625 | 0.983 [0.922, 0.993] | 0.212 [0.195, 0.278] | 217 |
| bioclip2 | H1 | bd_rice_bd5\|field\|unknown | 2278 | 0.768 | 0.308 [0.291, 0.324] | 0.352 [0.329, 0.377] | 0 |
| bioclip2 | H3 | bd_rice_bd5\|field\|unknown | 2278 | 0.811 | 0.343 [0.326, 0.359] | 0.349 [0.325, 0.376] | 0 |
| bioclip2 | ZS | bd_rice_bd5\|field\|unknown | 2278 | 0.020 | 0.250 [0.230, 0.269] | 0.171 [0.149, 0.195] | 0 |
| dinov2_b | H3 | bd_rice_bd5\|field\|unknown | 2278 | 0.814 | 0.258 [0.241, 0.272] | 0.542 [0.518, 0.567] | 0 |
| dinov2_l | H3 | bd_rice_bd5\|field\|unknown | 2278 | 0.824 | 0.204 [0.190, 0.218] | 0.560 [0.536, 0.585] | 0 |
| siglip2_b16 | H1 | bd_rice_bd5\|field\|unknown | 2278 | 0.797 | 0.249 [0.238, 0.260] | 0.372 [0.347, 0.400] | 0 |
| siglip2_b16 | H3 | bd_rice_bd5\|field\|unknown | 2278 | 0.835 | 0.297 [0.279, 0.314] | 0.409 [0.381, 0.441] | 0 |
| siglip2_b16 | ZS | bd_rice_bd5\|field\|unknown | 2278 | 0.121 | 0.186 [0.175, 0.195] | 0.190 [0.176, 0.204] | 0 |
| bioclip2 | H1 | bd_rice_daffodil\|field\|unknown | 389 | 0.771 | 0.278 [0.236, 0.318] | 0.333 [0.288, 0.378] | 0 |
| bioclip2 | H3 | bd_rice_daffodil\|field\|unknown | 389 | 0.816 | 0.204 [0.165, 0.241] | 0.475 [0.435, 0.518] | 0 |
| bioclip2 | ZS | bd_rice_daffodil\|field\|unknown | 389 | 0.060 | 0.019 [0.004, 0.039] | 0.135 [0.124, 0.143] | 0 |
| dinov2_b | H3 | bd_rice_daffodil\|field\|unknown | 389 | 0.825 | 0.203 [0.164, 0.239] | 0.586 [0.545, 0.629] | 0 |
| dinov2_l | H3 | bd_rice_daffodil\|field\|unknown | 389 | 0.867 | 0.215 [0.182, 0.248] | 0.503 [0.462, 0.546] | 0 |
| siglip2_b16 | H1 | bd_rice_daffodil\|field\|unknown | 389 | 0.781 | 0.235 [0.195, 0.273] | 0.420 [0.384, 0.463] | 0 |
| siglip2_b16 | H3 | bd_rice_daffodil\|field\|unknown | 389 | 0.850 | 0.211 [0.176, 0.244] | 0.440 [0.404, 0.480] | 0 |
| siglip2_b16 | ZS | bd_rice_daffodil\|field\|unknown | 389 | 0.107 | 0.173 [0.147, 0.197] | 0.068 [0.052, 0.115] | 0 |
| bioclip2 | H1 | bd_rice_netrokona\|field\|unknown | 1404 | 0.747 | 0.266 [0.252, 0.281] | 0.330 [0.309, 0.353] | 476 |
| bioclip2 | H3 | bd_rice_netrokona\|field\|unknown | 1404 | 0.819 | 0.251 [0.238, 0.262] | 0.444 [0.420, 0.469] | 476 |
| bioclip2 | ZS | bd_rice_netrokona\|field\|unknown | 1404 | 0.072 | 0.003 [0.000, 0.008] | 0.202 [0.199, 0.204] | 476 |
| dinov2_b | H3 | bd_rice_netrokona\|field\|unknown | 1404 | 0.834 | 0.287 [0.271, 0.306] | 0.308 [0.284, 0.335] | 476 |
| dinov2_l | H3 | bd_rice_netrokona\|field\|unknown | 1404 | 0.849 | 0.260 [0.246, 0.273] | 0.374 [0.350, 0.398] | 476 |
| siglip2_b16 | H1 | bd_rice_netrokona\|field\|unknown | 1404 | 0.740 | 0.283 [0.274, 0.292] | 0.307 [0.290, 0.324] | 476 |
| siglip2_b16 | H3 | bd_rice_netrokona\|field\|unknown | 1404 | 0.847 | 0.322 [0.314, 0.330] | 0.368 [0.348, 0.389] | 476 |
| siglip2_b16 | ZS | bd_rice_netrokona\|field\|unknown | 1404 | 0.132 | 0.384 [0.365, 0.403] | 0.158 [0.142, 0.183] | 476 |
| bioclip2 | H1 | bd_rice_riceleafdiseasebd\|field\|unknown | 731 | 0.846 | 0.265 [0.233, 0.296] | 0.432 [0.397, 0.467] | 135 |
| bioclip2 | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 731 | 0.890 | 0.269 [0.235, 0.301] | 0.490 [0.457, 0.524] | 135 |
| bioclip2 | ZS | bd_rice_riceleafdiseasebd\|field\|unknown | 731 | 0.078 | 0.113 [0.094, 0.132] | 0.017 [0.008, 0.044] | 135 |
| dinov2_b | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 731 | 0.897 | 0.295 [0.259, 0.328] | 0.399 [0.368, 0.435] | 135 |
| dinov2_l | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 731 | 0.912 | 0.375 [0.336, 0.413] | 0.359 [0.324, 0.396] | 135 |
| siglip2_b16 | H1 | bd_rice_riceleafdiseasebd\|field\|unknown | 731 | 0.860 | 0.287 [0.254, 0.316] | 0.382 [0.349, 0.414] | 135 |
| siglip2_b16 | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 731 | 0.910 | 0.411 [0.377, 0.440] | 0.347 [0.315, 0.386] | 135 |
| siglip2_b16 | ZS | bd_rice_riceleafdiseasebd\|field\|unknown | 731 | 0.113 | 0.153 [0.127, 0.178] | 0.065 [0.042, 0.090] | 135 |
| bioclip2 | H1 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 353 | 0.775 | 0.257 [0.221, 0.291] | 0.455 [0.409, 0.506] | 43 |
| bioclip2 | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 353 | 0.822 | 0.268 [0.237, 0.295] | 0.452 [0.403, 0.506] | 43 |
| bioclip2 | ZS | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 353 | 0.073 | 0.117 [0.090, 0.143] | 0.024 [0.005, 0.067] | 43 |
| dinov2_b | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 353 | 0.844 | 0.319 [0.273, 0.365] | 0.439 [0.386, 0.495] | 43 |
| dinov2_l | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 353 | 0.846 | 0.234 [0.197, 0.270] | 0.542 [0.489, 0.596] | 43 |
| siglip2_b16 | H1 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 353 | 0.780 | 0.328 [0.289, 0.360] | 0.375 [0.327, 0.426] | 43 |
| siglip2_b16 | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 353 | 0.827 | 0.326 [0.282, 0.367] | 0.401 [0.352, 0.455] | 43 |
| siglip2_b16 | ZS | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 353 | 0.118 | 0.258 [0.228, 0.285] | 0.107 [0.064, 0.162] | 43 |
| bioclip2 | H1 | in_rice_sethy\|field\|unknown | 2058 | 0.751 | 0.084 [0.068, 0.100] | 0.518 [0.501, 0.534] | 0 |
| bioclip2 | H3 | in_rice_sethy\|field\|unknown | 2058 | 0.789 | 0.121 [0.102, 0.140] | 0.547 [0.528, 0.565] | 0 |
| bioclip2 | ZS | in_rice_sethy\|field\|unknown | 2058 | 0.076 | 0.019 [0.012, 0.027] | 0.158 [0.151, 0.163] | 0 |
| dinov2_b | H3 | in_rice_sethy\|field\|unknown | 2058 | 0.830 | 0.148 [0.128, 0.168] | 0.571 [0.548, 0.593] | 0 |
| dinov2_l | H3 | in_rice_sethy\|field\|unknown | 2058 | 0.810 | 0.137 [0.119, 0.158] | 0.551 [0.527, 0.574] | 0 |
| siglip2_b16 | H1 | in_rice_sethy\|field\|unknown | 2058 | 0.757 | 0.226 [0.206, 0.248] | 0.483 [0.454, 0.510] | 0 |
| siglip2_b16 | H3 | in_rice_sethy\|field\|unknown | 2058 | 0.836 | 0.136 [0.112, 0.163] | 0.696 [0.671, 0.720] | 0 |
| siglip2_b16 | ZS | in_rice_sethy\|field\|unknown | 2058 | 0.111 | 0.074 [0.061, 0.088] | 0.118 [0.106, 0.129] | 0 |
| bioclip2 | H1 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.809 [0.782, 0.834] | 0.223 [0.196, 0.252] | 436 |
| bioclip2 | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.739 [0.710, 0.767] | 0.377 [0.345, 0.414] | 436 |
| bioclip2 | ZS | ug_bean_ibean\|field\|unknown | 859 | 0.431 | 0.386 [0.351, 0.417] | 0.155 [0.105, 0.200] | 436 |
| dinov2_b | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.717 [0.681, 0.752] | 0.407 [0.365, 0.446] | 436 |
| dinov2_l | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.452 [0.420, 0.480] | 0.587 [0.555, 0.620] | 436 |
| siglip2_b16 | H1 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.825 [0.797, 0.849] | 0.188 [0.164, 0.217] | 436 |
| siglip2_b16 | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.617 [0.580, 0.653] | 0.354 [0.315, 0.397] | 436 |
| siglip2_b16 | ZS | ug_bean_ibean\|field\|unknown | 859 | 0.273 | 0.941 [0.924, 0.955] | 0.570 [0.552, 0.586] | 436 |

## Not scored

- bd_rice_riceleafbd_rimi\|field\|realme C21: labels train 12, test scored 1, n 100
- bd_rice_riceleafbd_rimi\|field\|samsung SM-A125F: labels train 12, test scored 1, n 100
