# n8n: a live-site check for KrishiLoop

`krishiloop-site-check.json` is an n8n workflow that checks the public site works. It runs five nodes in order:

1. **Start** (manual trigger).
2. **Photo model config** (HTTP Request): fetches `https://krishiloop.vercel.app/models/agritriage/config.json`, the photo model's config.
3. **Check the model** (Code): confirms there are 89 classes and that the file is `model_xai.onnx`.
4. **Docs visibility** (HTTP Request): fetches `https://krishiloop.vercel.app/docs/docs.config.json`, the /docs publishing switch.
5. **Report** (Code): returns one JSON record with `model_ok`, `classes`, `model_mb`, `docs_visible`, `docs_window` and `all_ok`.

## Last real run (20 Nov 2026, n8n 1.88.0, CLI)
All five nodes ran in about 1.5 s. The Report node returned:

```json
{ "model_ok": true, "classes": 89, "model_mb": 11.5, "docs_visible": true, "all_ok": true }
```

The full record is in `last-run.json`.

## Run it yourself
```bash
npm install n8n@1.88.0                      # in any folder
export N8N_USER_FOLDER=./n8n-home           # keep n8n's own data out of the repo
export N8N_RUNNERS_ENABLED=false            # on Windows the Code-node task runner hung; the in-process runner works
n8n import:workflow --input=docs/n8n/krishiloop-site-check.json
n8n execute --id=KLsiteCheck00001 --rawOutput
```

It needs no credentials and touches no personal data. It only reads two public files from the live site.

## What it is for
- A one-click smoke test after each deploy: the photo model and the docs switch are where the app expects them.
- Next step (planned, not done): run it on n8n's **Schedule** trigger every morning and post to the team chat when `all_ok` is false.
