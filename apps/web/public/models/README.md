# Photo model files (not in git)

`*.onnx` files are git-ignored. The app expects `mnv4_union_fp16w.onnx` here (`src/features/farmer/photo/photoModel.ts`).

- Build it with `python ml/vision/pack_onnx.py` from the Kaggle outputs in `ml/vision/artifacts/`, then copy it here.
- The SHA-256 the phone checks is in `src/features/farmer/photo/photoModelCard.ts`.
- This is the v0 model. Its training data blocks commercial use, so it is for the demo only (`ml/vision/MODEL_CARD.md`). Its answers never drive a decision: the photo gate sends every photo to the officer.
