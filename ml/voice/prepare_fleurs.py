"""Unpack Google FLEURS Bengali (bn_in) test split into wav files + a JSONL manifest.

Source: https://huggingface.co/datasets/google/fleurs (data/bn_in/test.tsv, data/bn_in/audio/test.tar.gz),
licence CC BY 4.0, public and ungated. test.tsv columns: id, file name, raw transcription, normalised
transcription, characters, num_samples, gender. We score against the RAW transcription passed through our
own normaliser (bn_text.normalize_bn), so references and hypotheses get exactly the same treatment.
"""
import argparse
import json
import os
import tarfile

import soundfile as sf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=r"F:\krishiloop-5090\models\voice\fleurs_bn_in\data\bn_in")
    ap.add_argument("--out", default=r"F:\krishiloop-5090\data\voice\fleurs_bn_in")
    a = ap.parse_args()
    wav_dir = os.path.join(a.out, "test")
    os.makedirs(wav_dir, exist_ok=True)
    with tarfile.open(os.path.join(a.src, "audio", "test.tar.gz"), "r:gz") as tf:
        n = 0
        for m in tf:
            if not m.isfile() or not m.name.lower().endswith(".wav"):
                continue
            dest = os.path.join(wav_dir, os.path.basename(m.name))  # basename only: no path traversal
            if os.path.exists(dest) and os.path.getsize(dest) == m.size:
                continue
            with tf.extractfile(m) as src, open(dest, "wb") as out:
                out.write(src.read())
            n += 1
    print("extracted", n, "new wav files")
    rows = []
    with open(os.path.join(a.src, "test.tsv"), encoding="utf-8") as f:
        for line in f:
            c = line.rstrip("\n").split("\t")
            if len(c) < 7:
                continue
            wav = os.path.join(wav_dir, c[1])
            if not os.path.exists(wav):
                print("missing", c[1])
                continue
            info = sf.info(wav)
            rows.append({"id": f"fleurs-bn-{c[0]}-{os.path.splitext(c[1])[0]}", "wav": wav, "ref": c[2],
                         "ref_fleurs_norm": c[3], "dur_s": round(info.frames / info.samplerate, 3),
                         "sr": info.samplerate, "gender": c[6]})
    with open(os.path.join(a.out, "manifest_test.jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tot = sum(r["dur_s"] for r in rows)
    print(f"manifest: {len(rows)} utterances, {tot/3600:.2f} h, sample rates {sorted({r['sr'] for r in rows})}")


if __name__ == "__main__":
    main()
