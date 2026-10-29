# RQ1 (shift), frozen backbones: leave-one-domain-out

Generated 2026-10-29T16:05:55 by `kl_research.rq1` (seed 20261029, 1000 cluster-bootstrap resamples). Dataset labels stand in for experts; this is a replay on public data, not a field trial.

**How to read it.** For each held-out domain, the head is trained on the other datasets of the same crop (the crop is known from the field record) and tested on the held-out domain; every domain of the held-out dataset is excluded from training, and near-copy clusters never span train and test. 'Source-val' is the in-distribution score on 20% of the training clusters; 'Drop' = source-val minus target macro-F1. Macro-F1 is over the labels that the held-out domain shares with training; images whose label never occurs in training are counted ('Unseen-label images') and not scored. ZS = zero-shot text classifier (H1 with no training), shown as a reference. H1 needs a text tower, so image-only backbones (DINOv2, DINOv3) report H3 only.

**Caveats.** Label sets differ between domains, so scores are not comparable across crops; several domains are seeded subsets (bandwidth caps, see DEVIATIONS.md); dataset labels are unaudited (some sets carry visible duplicates and label conflicts, removed by the de-duplication rule); the mean over domains weights every domain equally; DINOv3 is a flagged comparison only.

**Run notes.** Rice and bean folds: manifest built 29 Oct 16:04 (12 datasets); potato folds: manifest rebuilt 16:27 after Tanzania potato and the Bangladeshi tomato set landed (14 datasets). Same de-duplication rule in both builds (DEVIATIONS.md, 15:50 row). Dhan-Shomadhan (field and white-background domains) landed after these runs: it is in the 16:38 manifest but not yet in RQ1. EVA-02 L has H3 only on rice and bean: its text embeddings were computed after that run started; potato folds include EVA-02 L H1 and ZS. Interim run under the earlier pHash-only drop rule: results/rq1_interim_strict_phash.{json,md} (kept, reported).

## Summary (mean over held-out domains; 95% interval = bootstrap over domains)

| Backbone / head | Domains | Source-val macro-F1 | Target macro-F1 [95% CI] | Drop | Target ECE [95% CI] | Worst domain (F1) |
|---|---|---|---|---|---|---|
| eva02_l/H1 | 2 | 0.987 | 0.658 [0.403, 0.912] | 0.329 | 0.192 [0.067, 0.318] | bd_potato_ctg\|field\|unknown (0.403) |
| eva02_l/ZS | 2 | 0.364 | 0.612 [0.249, 0.974] | -0.248 | 0.549 [0.436, 0.662] | bd_potato_ctg\|field\|unknown (0.249) |
| pe_core_l/H1 | 13 | 0.880 | 0.453 [0.273, 0.652] | 0.427 | 0.302 [0.184, 0.413] | lk_rice_paddypulse\|lab\|Canon EOS 60D (0.008) |
| pe_core_l/H3 | 13 | 0.917 | 0.407 [0.263, 0.566] | 0.510 | 0.377 [0.275, 0.482] | lk_rice_paddypulse\|lab\|Canon EOS 60D (0.007) |
| bioclip2/H1 | 13 | 0.836 | 0.405 [0.288, 0.545] | 0.431 | 0.337 [0.260, 0.396] | lk_rice_paddypulse\|lab\|Canon EOS 60D (0.211) |
| pe_core_l/ZS | 13 | 0.255 | 0.400 [0.223, 0.603] | -0.145 | 0.212 [0.146, 0.291] | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 (0.000) |
| bioclip2/H3 | 13 | 0.878 | 0.396 [0.271, 0.531] | 0.482 | 0.387 [0.313, 0.466] | bd_rice_daffodil\|field\|unknown (0.183) |
| siglip2_b16/H1 | 13 | 0.848 | 0.389 [0.210, 0.573] | 0.460 | 0.352 [0.244, 0.466] | lk_rice_paddypulse\|lab\|Canon EOS 60D (0.000) |
| eva02_l/H3 | 13 | 0.899 | 0.379 [0.253, 0.515] | 0.520 | 0.415 [0.317, 0.511] | lk_rice_paddypulse\|lab\|Canon EOS 60D (0.006) |
| siglip2_b16/ZS | 13 | 0.224 | 0.350 [0.181, 0.552] | -0.126 | 0.208 [0.137, 0.296] | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 (0.051) |
| dinov2_b/H3 | 13 | 0.889 | 0.342 [0.229, 0.475] | 0.547 | 0.402 [0.315, 0.482] | lk_rice_paddypulse\|lab\|Canon EOS 60D (0.076) |
| dinov2_l/H3 | 13 | 0.899 | 0.320 [0.234, 0.424] | 0.578 | 0.398 [0.319, 0.480] | lk_rice_paddypulse\|lab\|Canon EOS 60D (0.114) |
| siglip2_b16/H3 | 13 | 0.893 | 0.316 [0.221, 0.430] | 0.577 | 0.433 [0.358, 0.500] | lk_rice_paddypulse\|lab\|Canon EOS 60D (0.034) |
| bioclip2/ZS | 13 | 0.150 | 0.233 [0.113, 0.369] | -0.083 | 0.184 [0.110, 0.268] | bd_rice_netrokona\|field\|unknown (0.004) |

## Every fold

| Backbone | Head | Held-out domain | n test | Source-val F1 | Target F1 [95% CI] | Target ECE [95% CI] | Unseen-label images |
|---|---|---|---|---|---|---|---|
| bioclip2 | H1 | bd_bean_bldbd\|field\|unknown | 446 | 0.951 | 1.000 [1.000, 1.000] | 0.018 [0.013, 0.069] | 222 |
| bioclip2 | H3 | bd_bean_bldbd\|field\|unknown | 446 | 0.963 | 0.998 [0.953, 1.000] | 0.024 [0.019, 0.069] | 222 |
| bioclip2 | ZS | bd_bean_bldbd\|field\|unknown | 446 | 0.364 | 0.581 [0.554, 0.846] | 0.125 [0.102, 0.340] | 222 |
| dinov2_b | H3 | bd_bean_bldbd\|field\|unknown | 446 | 0.956 | 0.822 [0.769, 0.888] | 0.047 [0.042, 0.217] | 222 |
| dinov2_l | H3 | bd_bean_bldbd\|field\|unknown | 446 | 0.959 | 0.872 [0.691, 0.893] | 0.045 [0.043, 0.168] | 222 |
| eva02_l | H3 | bd_bean_bldbd\|field\|unknown | 446 | 0.952 | 0.970 [0.921, 0.989] | 0.088 [0.064, 0.112] | 222 |
| pe_core_l | H1 | bd_bean_bldbd\|field\|unknown | 446 | 0.978 | 0.993 [0.909, 1.000] | 0.012 [0.009, 0.065] | 222 |
| pe_core_l | H3 | bd_bean_bldbd\|field\|unknown | 446 | 0.981 | 0.992 [0.988, 1.000] | 0.041 [0.020, 0.055] | 222 |
| pe_core_l | ZS | bd_bean_bldbd\|field\|unknown | 446 | 0.670 | 0.984 [0.835, 0.996] | 0.117 [0.107, 0.214] | 222 |
| siglip2_b16 | H1 | bd_bean_bldbd\|field\|unknown | 446 | 0.962 | 0.986 [0.930, 0.996] | 0.016 [0.013, 0.078] | 222 |
| siglip2_b16 | H3 | bd_bean_bldbd\|field\|unknown | 446 | 0.963 | 0.596 [0.576, 0.800] | 0.196 [0.060, 0.215] | 222 |
| siglip2_b16 | ZS | bd_bean_bldbd\|field\|unknown | 446 | 0.625 | 0.984 [0.916, 0.991] | 0.211 [0.180, 0.273] | 222 |
| bioclip2 | H1 | bd_potato_ctg\|field\|unknown | 772 | 0.980 | 0.402 [0.370, 0.435] | 0.406 [0.371, 0.446] | 1567 |
| bioclip2 | H3 | bd_potato_ctg\|field\|unknown | 772 | 0.980 | 0.465 [0.440, 0.491] | 0.319 [0.285, 0.362] | 1567 |
| bioclip2 | ZS | bd_potato_ctg\|field\|unknown | 772 | 0.460 | 0.324 [0.300, 0.349] | 0.270 [0.242, 0.300] | 1567 |
| dinov2_b | H3 | bd_potato_ctg\|field\|unknown | 772 | 0.986 | 0.604 [0.571, 0.638] | 0.281 [0.246, 0.314] | 1567 |
| dinov2_l | H3 | bd_potato_ctg\|field\|unknown | 772 | 0.990 | 0.304 [0.271, 0.335] | 0.399 [0.368, 0.434] | 1567 |
| eva02_l | H1 | bd_potato_ctg\|field\|unknown | 772 | 0.985 | 0.403 [0.375, 0.431] | 0.318 [0.287, 0.351] | 1567 |
| eva02_l | H3 | bd_potato_ctg\|field\|unknown | 772 | 0.986 | 0.710 [0.681, 0.742] | 0.229 [0.199, 0.262] | 1567 |
| eva02_l | ZS | bd_potato_ctg\|field\|unknown | 772 | 0.659 | 0.249 [0.218, 0.280] | 0.436 [0.408, 0.465] | 1567 |
| pe_core_l | H1 | bd_potato_ctg\|field\|unknown | 772 | 0.990 | 0.883 [0.861, 0.905] | 0.075 [0.058, 0.102] | 1567 |
| pe_core_l | H3 | bd_potato_ctg\|field\|unknown | 772 | 0.994 | 0.434 [0.404, 0.465] | 0.392 [0.359, 0.424] | 1567 |
| pe_core_l | ZS | bd_potato_ctg\|field\|unknown | 772 | 0.575 | 0.702 [0.673, 0.734] | 0.123 [0.100, 0.150] | 1567 |
| siglip2_b16 | H1 | bd_potato_ctg\|field\|unknown | 772 | 0.986 | 0.728 [0.699, 0.759] | 0.107 [0.079, 0.140] | 1567 |
| siglip2_b16 | H3 | bd_potato_ctg\|field\|unknown | 772 | 0.993 | 0.757 [0.730, 0.784] | 0.208 [0.178, 0.245] | 1567 |
| siglip2_b16 | ZS | bd_potato_ctg\|field\|unknown | 772 | 0.709 | 0.451 [0.436, 0.469] | 0.296 [0.271, 0.326] | 1567 |
| bioclip2 | H1 | bd_rice_bd5\|field\|unknown | 2371 | 0.772 | 0.428 [0.410, 0.443] | 0.215 [0.193, 0.239] | 0 |
| bioclip2 | H3 | bd_rice_bd5\|field\|unknown | 2371 | 0.808 | 0.433 [0.417, 0.448] | 0.258 [0.233, 0.284] | 0 |
| bioclip2 | ZS | bd_rice_bd5\|field\|unknown | 2371 | 0.023 | 0.249 [0.230, 0.267] | 0.161 [0.139, 0.183] | 0 |
| dinov2_b | H3 | bd_rice_bd5\|field\|unknown | 2371 | 0.835 | 0.278 [0.261, 0.295] | 0.454 [0.428, 0.478] | 0 |
| dinov2_l | H3 | bd_rice_bd5\|field\|unknown | 2371 | 0.843 | 0.290 [0.274, 0.306] | 0.380 [0.353, 0.406] | 0 |
| eva02_l | H3 | bd_rice_bd5\|field\|unknown | 2371 | 0.844 | 0.394 [0.376, 0.411] | 0.348 [0.324, 0.373] | 0 |
| pe_core_l | H1 | bd_rice_bd5\|field\|unknown | 2371 | 0.817 | 0.387 [0.375, 0.399] | 0.269 [0.248, 0.290] | 0 |
| pe_core_l | H3 | bd_rice_bd5\|field\|unknown | 2371 | 0.862 | 0.472 [0.454, 0.488] | 0.145 [0.125, 0.169] | 0 |
| pe_core_l | ZS | bd_rice_bd5\|field\|unknown | 2371 | 0.154 | 0.250 [0.237, 0.263] | 0.111 [0.096, 0.132] | 0 |
| siglip2_b16 | H1 | bd_rice_bd5\|field\|unknown | 2371 | 0.763 | 0.223 [0.211, 0.236] | 0.362 [0.340, 0.387] | 0 |
| siglip2_b16 | H3 | bd_rice_bd5\|field\|unknown | 2371 | 0.836 | 0.190 [0.174, 0.207] | 0.486 [0.461, 0.509] | 0 |
| siglip2_b16 | ZS | bd_rice_bd5\|field\|unknown | 2371 | 0.099 | 0.187 [0.178, 0.198] | 0.204 [0.188, 0.220] | 0 |
| bioclip2 | H1 | bd_rice_daffodil\|field\|unknown | 471 | 0.777 | 0.266 [0.229, 0.303] | 0.301 [0.263, 0.338] | 0 |
| bioclip2 | H3 | bd_rice_daffodil\|field\|unknown | 471 | 0.830 | 0.183 [0.153, 0.213] | 0.486 [0.447, 0.527] | 0 |
| bioclip2 | ZS | bd_rice_daffodil\|field\|unknown | 471 | 0.053 | 0.016 [0.004, 0.033] | 0.129 [0.120, 0.136] | 0 |
| dinov2_b | H3 | bd_rice_daffodil\|field\|unknown | 471 | 0.845 | 0.235 [0.196, 0.270] | 0.483 [0.446, 0.522] | 0 |
| dinov2_l | H3 | bd_rice_daffodil\|field\|unknown | 471 | 0.875 | 0.242 [0.205, 0.278] | 0.455 [0.415, 0.494] | 0 |
| eva02_l | H3 | bd_rice_daffodil\|field\|unknown | 471 | 0.871 | 0.287 [0.242, 0.328] | 0.425 [0.384, 0.466] | 0 |
| pe_core_l | H1 | bd_rice_daffodil\|field\|unknown | 471 | 0.833 | 0.306 [0.267, 0.346] | 0.352 [0.314, 0.395] | 0 |
| pe_core_l | H3 | bd_rice_daffodil\|field\|unknown | 471 | 0.902 | 0.255 [0.222, 0.287] | 0.433 [0.395, 0.474] | 0 |
| pe_core_l | ZS | bd_rice_daffodil\|field\|unknown | 471 | 0.163 | 0.169 [0.147, 0.192] | 0.179 [0.156, 0.202] | 0 |
| siglip2_b16 | H1 | bd_rice_daffodil\|field\|unknown | 471 | 0.801 | 0.192 [0.163, 0.221] | 0.526 [0.489, 0.564] | 0 |
| siglip2_b16 | H3 | bd_rice_daffodil\|field\|unknown | 471 | 0.878 | 0.260 [0.227, 0.291] | 0.485 [0.445, 0.525] | 0 |
| siglip2_b16 | ZS | bd_rice_daffodil\|field\|unknown | 471 | 0.099 | 0.150 [0.125, 0.175] | 0.109 [0.085, 0.141] | 0 |
| bioclip2 | H1 | bd_rice_netrokona\|field\|unknown | 1462 | 0.724 | 0.240 [0.225, 0.254] | 0.359 [0.334, 0.382] | 499 |
| bioclip2 | H3 | bd_rice_netrokona\|field\|unknown | 1462 | 0.783 | 0.235 [0.222, 0.247] | 0.451 [0.423, 0.476] | 499 |
| bioclip2 | ZS | bd_rice_netrokona\|field\|unknown | 1462 | 0.073 | 0.004 [0.000, 0.009] | 0.187 [0.184, 0.190] | 499 |
| dinov2_b | H3 | bd_rice_netrokona\|field\|unknown | 1462 | 0.839 | 0.214 [0.200, 0.228] | 0.482 [0.450, 0.510] | 499 |
| dinov2_l | H3 | bd_rice_netrokona\|field\|unknown | 1462 | 0.845 | 0.245 [0.233, 0.256] | 0.353 [0.328, 0.379] | 499 |
| eva02_l | H3 | bd_rice_netrokona\|field\|unknown | 1462 | 0.860 | 0.287 [0.276, 0.298] | 0.419 [0.392, 0.445] | 499 |
| pe_core_l | H1 | bd_rice_netrokona\|field\|unknown | 1462 | 0.816 | 0.314 [0.295, 0.332] | 0.345 [0.323, 0.367] | 499 |
| pe_core_l | H3 | bd_rice_netrokona\|field\|unknown | 1462 | 0.868 | 0.318 [0.298, 0.336] | 0.453 [0.422, 0.483] | 499 |
| pe_core_l | ZS | bd_rice_netrokona\|field\|unknown | 1462 | 0.125 | 0.338 [0.322, 0.356] | 0.200 [0.180, 0.221] | 499 |
| siglip2_b16 | H1 | bd_rice_netrokona\|field\|unknown | 1462 | 0.770 | 0.302 [0.295, 0.308] | 0.367 [0.335, 0.396] | 499 |
| siglip2_b16 | H3 | bd_rice_netrokona\|field\|unknown | 1462 | 0.846 | 0.320 [0.315, 0.324] | 0.524 [0.491, 0.555] | 499 |
| siglip2_b16 | ZS | bd_rice_netrokona\|field\|unknown | 1462 | 0.132 | 0.298 [0.275, 0.318] | 0.101 [0.088, 0.123] | 499 |
| bioclip2 | H1 | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.819 | 0.267 [0.236, 0.297] | 0.421 [0.387, 0.458] | 138 |
| bioclip2 | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.888 | 0.248 [0.219, 0.277] | 0.476 [0.444, 0.509] | 138 |
| bioclip2 | ZS | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.062 | 0.113 [0.094, 0.132] | 0.016 [0.011, 0.045] | 138 |
| dinov2_b | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.900 | 0.323 [0.286, 0.356] | 0.404 [0.372, 0.442] | 138 |
| dinov2_l | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.914 | 0.368 [0.332, 0.404] | 0.360 [0.323, 0.393] | 138 |
| eva02_l | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.903 | 0.364 [0.324, 0.399] | 0.400 [0.363, 0.438] | 138 |
| pe_core_l | H1 | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.869 | 0.307 [0.275, 0.337] | 0.421 [0.387, 0.458] | 138 |
| pe_core_l | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.932 | 0.346 [0.312, 0.378] | 0.469 [0.434, 0.502] | 138 |
| pe_core_l | ZS | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.174 | 0.187 [0.170, 0.204] | 0.145 [0.123, 0.167] | 138 |
| siglip2_b16 | H1 | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.836 | 0.255 [0.226, 0.282] | 0.409 [0.380, 0.446] | 138 |
| siglip2_b16 | H3 | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.895 | 0.377 [0.344, 0.409] | 0.398 [0.367, 0.436] | 138 |
| siglip2_b16 | ZS | bd_rice_riceleafdiseasebd\|field\|unknown | 733 | 0.110 | 0.137 [0.112, 0.162] | 0.061 [0.039, 0.083] | 138 |
| bioclip2 | H1 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.772 | 0.255 [0.217, 0.290] | 0.426 [0.376, 0.472] | 43 |
| bioclip2 | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.844 | 0.273 [0.242, 0.303] | 0.432 [0.382, 0.481] | 43 |
| bioclip2 | ZS | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.057 | 0.116 [0.089, 0.143] | 0.033 [0.007, 0.076] | 43 |
| dinov2_b | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.842 | 0.285 [0.246, 0.323] | 0.473 [0.426, 0.519] | 43 |
| dinov2_l | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.860 | 0.253 [0.221, 0.284] | 0.538 [0.489, 0.590] | 43 |
| eva02_l | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.858 | 0.319 [0.281, 0.356] | 0.468 [0.415, 0.520] | 43 |
| pe_core_l | H1 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.852 | 0.290 [0.255, 0.322] | 0.463 [0.411, 0.516] | 43 |
| pe_core_l | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.891 | 0.307 [0.270, 0.345] | 0.428 [0.374, 0.482] | 43 |
| pe_core_l | ZS | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.165 | 0.292 [0.253, 0.328] | 0.108 [0.070, 0.160] | 43 |
| siglip2_b16 | H1 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.799 | 0.320 [0.285, 0.350] | 0.357 [0.307, 0.405] | 43 |
| siglip2_b16 | H3 | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.845 | 0.352 [0.312, 0.390] | 0.368 [0.315, 0.419] | 43 |
| siglip2_b16 | ZS | bd_rice_riceyleafdisease\|mixed\|Xiaomi M2101K7AG | 356 | 0.110 | 0.254 [0.224, 0.282] | 0.118 [0.069, 0.171] | 43 |
| bioclip2 | H1 | in_rice_sethy\|field\|unknown | 2121 | 0.770 | 0.236 [0.213, 0.257] | 0.369 [0.344, 0.393] | 0 |
| bioclip2 | H3 | in_rice_sethy\|field\|unknown | 2121 | 0.822 | 0.248 [0.227, 0.267] | 0.415 [0.389, 0.439] | 0 |
| bioclip2 | ZS | in_rice_sethy\|field\|unknown | 2121 | 0.062 | 0.019 [0.011, 0.026] | 0.152 [0.145, 0.159] | 0 |
| dinov2_b | H3 | in_rice_sethy\|field\|unknown | 2121 | 0.828 | 0.167 [0.147, 0.187] | 0.537 [0.514, 0.559] | 0 |
| dinov2_l | H3 | in_rice_sethy\|field\|unknown | 2121 | 0.842 | 0.173 [0.150, 0.194] | 0.534 [0.512, 0.558] | 0 |
| eva02_l | H3 | in_rice_sethy\|field\|unknown | 2121 | 0.841 | 0.232 [0.210, 0.252] | 0.498 [0.470, 0.526] | 0 |
| pe_core_l | H1 | in_rice_sethy\|field\|unknown | 2121 | 0.829 | 0.164 [0.141, 0.187] | 0.544 [0.516, 0.570] | 0 |
| pe_core_l | H3 | in_rice_sethy\|field\|unknown | 2121 | 0.875 | 0.174 [0.148, 0.199] | 0.516 [0.488, 0.545] | 0 |
| pe_core_l | ZS | in_rice_sethy\|field\|unknown | 2121 | 0.173 | 0.061 [0.048, 0.075] | 0.151 [0.140, 0.162] | 0 |
| siglip2_b16 | H1 | in_rice_sethy\|field\|unknown | 2121 | 0.769 | 0.215 [0.197, 0.233] | 0.424 [0.397, 0.453] | 0 |
| siglip2_b16 | H3 | in_rice_sethy\|field\|unknown | 2121 | 0.824 | 0.154 [0.132, 0.176] | 0.523 [0.499, 0.546] | 0 |
| siglip2_b16 | ZS | in_rice_sethy\|field\|unknown | 2121 | 0.112 | 0.053 [0.040, 0.065] | 0.128 [0.118, 0.138] | 0 |
| bioclip2 | H1 | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.762 | 0.211 [0.157, 0.325] | 0.403 [0.363, 0.485] | 17 |
| bioclip2 | H3 | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.835 | 0.191 [0.142, 0.316] | 0.498 [0.458, 0.568] | 17 |
| bioclip2 | ZS | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.062 | 0.119 [0.096, 0.207] | 0.010 [0.003, 0.071] | 17 |
| dinov2_b | H3 | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.852 | 0.076 [0.038, 0.144] | 0.585 [0.531, 0.616] | 17 |
| dinov2_l | H3 | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.858 | 0.114 [0.070, 0.204] | 0.564 [0.513, 0.597] | 17 |
| eva02_l | H3 | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.856 | 0.006 [0.000, 0.024] | 0.715 [0.691, 0.754] | 17 |
| pe_core_l | H1 | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.827 | 0.008 [0.000, 0.032] | 0.551 [0.531, 0.580] | 17 |
| pe_core_l | H3 | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.883 | 0.007 [0.000, 0.015] | 0.707 [0.683, 0.742] | 17 |
| pe_core_l | ZS | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.190 | 0.129 [0.089, 0.223] | 0.178 [0.133, 0.210] | 17 |
| siglip2_b16 | H1 | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.784 | 0.000 [0.000, 0.000] | 0.755 [0.735, 0.789] | 17 |
| siglip2_b16 | H3 | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.849 | 0.034 [0.009, 0.074] | 0.636 [0.603, 0.673] | 17 |
| siglip2_b16 | ZS | lk_rice_paddypulse\|lab\|Canon EOS 60D | 291 | 0.126 | 0.056 [0.024, 0.107] | 0.148 [0.132, 0.179] | 17 |
| bioclip2 | H1 | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.765 | 0.277 [0.153, 0.428] | 0.249 [0.204, 0.319] | 9 |
| bioclip2 | H3 | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.830 | 0.223 [0.138, 0.344] | 0.389 [0.330, 0.454] | 9 |
| bioclip2 | ZS | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.066 | 0.023 [0.005, 0.047] | 0.144 [0.124, 0.158] | 9 |
| dinov2_b | H3 | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.830 | 0.182 [0.153, 0.212] | 0.218 [0.174, 0.314] | 9 |
| dinov2_l | H3 | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.840 | 0.265 [0.246, 0.282] | 0.075 [0.071, 0.160] | 9 |
| eva02_l | H3 | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.862 | 0.263 [0.247, 0.277] | 0.151 [0.110, 0.223] | 9 |
| pe_core_l | H1 | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.813 | 0.173 [0.150, 0.198] | 0.198 [0.149, 0.261] | 9 |
| pe_core_l | H3 | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.859 | 0.249 [0.233, 0.267] | 0.201 [0.163, 0.274] | 9 |
| pe_core_l | ZS | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.184 | 0.000 [0.000, 0.000] | 0.246 [0.241, 0.251] | 9 |
| siglip2_b16 | H1 | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.776 | 0.058 [0.032, 0.081] | 0.430 [0.390, 0.491] | 9 |
| siglip2_b16 | H3 | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.847 | 0.137 [0.113, 0.160] | 0.288 [0.246, 0.357] | 9 |
| siglip2_b16 | ZS | lk_rice_paddypulse\|lab\|NIKON CORPORATION NIKON D750 | 232 | 0.122 | 0.051 [0.000, 0.148] | 0.183 [0.172, 0.189] | 9 |
| bioclip2 | H1 | lk_rice_paddypulse\|lab\|unknown | 188 | 0.778 | 0.251 [0.158, 0.330] | 0.500 [0.459, 0.544] | 213 |
| bioclip2 | H3 | lk_rice_paddypulse\|lab\|unknown | 188 | 0.828 | 0.255 [0.166, 0.335] | 0.517 [0.472, 0.566] | 213 |
| bioclip2 | ZS | lk_rice_paddypulse\|lab\|unknown | 188 | 0.067 | 0.251 [0.231, 0.268] | 0.406 [0.334, 0.480] | 213 |
| dinov2_b | H3 | lk_rice_paddypulse\|lab\|unknown | 188 | 0.849 | 0.128 [0.066, 0.187] | 0.563 [0.517, 0.609] | 213 |
| dinov2_l | H3 | lk_rice_paddypulse\|lab\|unknown | 188 | 0.855 | 0.191 [0.132, 0.248] | 0.450 [0.393, 0.503] | 213 |
| eva02_l | H3 | lk_rice_paddypulse\|lab\|unknown | 188 | 0.862 | 0.121 [0.059, 0.178] | 0.584 [0.536, 0.623] | 213 |
| pe_core_l | H1 | lk_rice_paddypulse\|lab\|unknown | 188 | 0.812 | 0.133 [0.039, 0.212] | 0.613 [0.579, 0.648] | 213 |
| pe_core_l | H3 | lk_rice_paddypulse\|lab\|unknown | 188 | 0.876 | 0.147 [0.085, 0.199] | 0.623 [0.578, 0.664] | 213 |
| pe_core_l | ZS | lk_rice_paddypulse\|lab\|unknown | 188 | 0.200 | 0.108 [0.079, 0.137] | 0.126 [0.081, 0.176] | 213 |
| siglip2_b16 | H1 | lk_rice_paddypulse\|lab\|unknown | 188 | 0.793 | 0.004 [0.000, 0.013] | 0.601 [0.571, 0.628] | 213 |
| siglip2_b16 | H3 | lk_rice_paddypulse\|lab\|unknown | 188 | 0.838 | 0.108 [0.016, 0.187] | 0.583 [0.544, 0.620] | 213 |
| siglip2_b16 | ZS | lk_rice_paddypulse\|lab\|unknown | 188 | 0.121 | 0.066 [0.040, 0.091] | 0.095 [0.056, 0.133] | 213 |
| bioclip2 | H1 | tz_potato\|field\|samsung SM-A032F | 4656 | 1.000 | 0.637 [0.623, 0.652] | 0.482 [0.465, 0.497] | 1435 |
| bioclip2 | H3 | tz_potato\|field\|samsung SM-A032F | 4656 | 1.000 | 0.530 [0.514, 0.546] | 0.604 [0.589, 0.619] | 1435 |
| bioclip2 | ZS | tz_potato\|field\|samsung SM-A032F | 4656 | 0.131 | 0.824 [0.814, 0.834] | 0.517 [0.505, 0.529] | 1435 |
| dinov2_b | H3 | tz_potato\|field\|samsung SM-A032F | 4656 | 0.998 | 0.326 [0.317, 0.335] | 0.484 [0.467, 0.501] | 1435 |
| dinov2_l | H3 | tz_potato\|field\|samsung SM-A032F | 4656 | 1.000 | 0.324 [0.316, 0.332] | 0.526 [0.508, 0.543] | 1435 |
| eva02_l | H1 | tz_potato\|field\|samsung SM-A032F | 4656 | 0.989 | 0.912 [0.904, 0.919] | 0.067 [0.058, 0.077] | 1435 |
| eva02_l | H3 | tz_potato\|field\|samsung SM-A032F | 4656 | 0.995 | 0.499 [0.487, 0.510] | 0.525 [0.510, 0.542] | 1435 |
| eva02_l | ZS | tz_potato\|field\|samsung SM-A032F | 4656 | 0.069 | 0.974 [0.969, 0.978] | 0.662 [0.655, 0.668] | 1435 |
| pe_core_l | H1 | tz_potato\|field\|samsung SM-A032F | 4656 | 0.998 | 0.974 [0.969, 0.978] | 0.025 [0.021, 0.030] | 1435 |
| pe_core_l | H3 | tz_potato\|field\|samsung SM-A032F | 4656 | 1.000 | 0.827 [0.815, 0.837] | 0.196 [0.184, 0.209] | 1435 |
| pe_core_l | ZS | tz_potato\|field\|samsung SM-A032F | 4656 | 0.153 | 0.989 [0.986, 0.992] | 0.448 [0.442, 0.455] | 1435 |
| siglip2_b16 | H1 | tz_potato\|field\|samsung SM-A032F | 4656 | 0.991 | 0.971 [0.965, 0.975] | 0.012 [0.009, 0.017] | 1435 |
| siglip2_b16 | H3 | tz_potato\|field\|samsung SM-A032F | 4656 | 0.998 | 0.317 [0.309, 0.326] | 0.518 [0.499, 0.535] | 1435 |
| siglip2_b16 | ZS | tz_potato\|field\|samsung SM-A032F | 4656 | 0.154 | 0.929 [0.921, 0.937] | 0.486 [0.477, 0.495] | 1435 |
| bioclip2 | H1 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.795 [0.769, 0.821] | 0.232 [0.203, 0.261] | 436 |
| bioclip2 | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.865 [0.840, 0.887] | 0.158 [0.132, 0.184] | 436 |
| bioclip2 | ZS | ug_bean_ibean\|field\|unknown | 859 | 0.467 | 0.386 [0.351, 0.417] | 0.237 [0.208, 0.265] | 436 |
| dinov2_b | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.803 [0.774, 0.829] | 0.218 [0.192, 0.247] | 436 |
| dinov2_l | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.521 [0.486, 0.551] | 0.502 [0.471, 0.535] | 436 |
| eva02_l | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.477 [0.458, 0.500] | 0.548 [0.508, 0.594] | 436 |
| pe_core_l | H1 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.956 [0.943, 0.968] | 0.059 [0.044, 0.074] | 436 |
| pe_core_l | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.770 [0.739, 0.797] | 0.298 [0.268, 0.332] | 436 |
| pe_core_l | ZS | ug_bean_ibean\|field\|unknown | 859 | 0.388 | 0.991 [0.984, 0.996] | 0.628 [0.621, 0.635] | 436 |
| siglip2_b16 | H1 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.797 [0.768, 0.822] | 0.217 [0.192, 0.245] | 436 |
| siglip2_b16 | H3 | ug_bean_ibean\|field\|unknown | 859 | 1.000 | 0.504 [0.460, 0.542] | 0.413 [0.370, 0.465] | 436 |
| siglip2_b16 | ZS | ug_bean_ibean\|field\|unknown | 859 | 0.394 | 0.941 [0.924, 0.955] | 0.570 [0.552, 0.586] | 436 |

## Not scored

- bd_rice_riceleafbd_rimi\|field\|realme C21: labels train 13, test scored 1, n 100
- bd_rice_riceleafbd_rimi\|field\|samsung SM-A125F: labels train 13, test scored 1, n 100
