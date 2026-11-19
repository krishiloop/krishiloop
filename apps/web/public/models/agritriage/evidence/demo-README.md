# AgriTriage-Lite: offline demo

A single web page that runs the distilled **TinyViT-11M** student (11.5 MB, INT8 weights) and the act / shortlist / refer gate **inside the browser**. Photos never leave the device, and it works without internet once the page has loaded.

## Run it (laptop, works offline)

Use the bundled server, which enables multi-threading:

```bash
python poster/demo/serve.py
```

Then open `http://localhost:8765`.

- **On a phone:** connect the phone to the same Wi-Fi or hotspot as the laptop and open `http://<laptop-ip>:8765`. `serve.py` prints the address. Allow Python through the Windows firewall when Windows asks.
- **Open a sample straight away:** add `#sample=<0–15>&crop=<crop>` to the address, e.g. `http://localhost:8765/#sample=13&crop=corn` (a Diagnosis) or `#sample=12&crop=tomato` (a Shortlist). Add `&theme=light` to force the light theme. The poster's phone screenshot was taken this way.
- **Plain Python server:** `python -m http.server 8765 --directory poster/demo` also works, but runs single-threaded and about 3× slower.
- **Measured here** (laptop, Chrome, 20 runs on one photo): about **130 ms per photo with 4 threads** and about **400 ms with 1 thread**. Native ONNX Runtime on one CPU core takes about 19 ms. The browser is slower than native code, which is normal.

## What it does

1. **Crop (optional).** Picking the crop restricts the answer to that crop's diseases. This is the *crop-known* mode, and it is much more accurate.
2. **Photo.** Take a photo with the camera, choose a file, or tap one of the 16 sample photos.
3. **Model.** The model returns scores for 89 diseases. The gate scales them by the calibrated temperature, then builds the set of diseases needed to reach the 90% coverage target (deterministic APS, fitted on the cal split). It also checks the energy "unknown photo" score.
4. **Decision:**
   - **Diagnosis / রোগ নির্ণয়**: one disease.
   - **Shortlist / সম্ভাব্য রোগের তালিকা**: 2–3 diseases.
   - **Ask an expert / বিশেষজ্ঞের পরামর্শ নিন**: the photo looks unknown, or more than 3 diseases are possible.
5. **Speed test.** Runs the model 50 times and shows the median time on this device. Use it on your own phones and write down each phone model and its time.

**Test-set behaviour of this exact demo gate** (PlantWild test, 3,663 photos; `config.json` → `test_report`):

| Mode | Answers alone | Accuracy when answering | Shortlists | Refers | Coverage |
|---|---|---|---|---|---|
| Any crop | 64% | 91% | 18% | 19% | 92% |
| Crop known | 88% | 92% | 7% | 5% | 92% |

The INT8 file scores 77.4% top-1 on the test set; the FP32 file scores 77.8%.

This demo uses the deterministic version of the gate. The poster's gate numbers come from the pipeline's randomised version, so they differ slightly. Both target 90% coverage.

## Before the presentation (students)

- [ ] **Check the Bangla action labels** in `index.html` (`ACTIONS`) and correct them if needed. Disease names are in English on purpose; do not add machine-translated names without checking them.
- [ ] **Test on 2–3 of your phones.** Note each phone model and its speed-test median, for the poster or for the talk.
- [ ] **Bring 8–10 printed leaf photos**, test them first (a photo of a print is itself a shift), plus 1–2 real leaves. Also bring one non-leaf object to show REFER.
- [ ] **Record a 60-second screen video** of the demo as a backup.
- [ ] **Hosting (optional):** upload this folder as a free *static* Hugging Face Space or to GitHub Pages, then make a QR code for the poster.
  - **Remove the `samples/` folder before publishing:** those photos come from public datasets whose licences we have not checked for re-hosting.
  - **Speed when hosted:** GitHub Pages can't send the threading headers, so it runs single-threaded. A static HF Space can send them through its config.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app (HTML, CSS, JS) |
| `model.onnx` | TinyViT-11M student, weight-only INT8, exported by `agritriage/agritriage/scripts/export_demo.py` from run `p1f_indomain/proposed_tinyvit_11m/seed0` |
| `config.json` | Classes, crops, temperature, energy threshold, conformal thresholds, test report |
| `ort/` | onnxruntime-web 1.31.1 (MIT licence, Microsoft), WASM build |
| `serve.py` | Offline server with the multi-threading headers |
| `samples/` | 16 test photos, one per crop (local use only) |

**Rebuild after retraining** (on the 5090):

```bash
python scripts/export_demo.py --run outputs/runs/<exp>/<variant>/seed0 --out F:/agritriage/demo
```

Then copy the new `model.onnx`, `config.json` and `samples/` here.
