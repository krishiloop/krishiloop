# Reach: a recall reaches the farmer, and a basic phone can check a receipt

MASTER_PLAN P1 #14. Code: `services/reach/`. Tests: `tests/test_reach.py`, `apps/web/src/features/verify/reachParity.test.ts`, `apps/web/tests/e2e/reach.spec.ts`.

Before Reach, a recall flipped a status-list bit, and a farmer learned of it only by scanning the QR again. Reach adds three things:

1. A **short verify code** per receipt, so a receipt can be checked from an SMS.
2. A **Telegram bot** and a **sandbox SMS** channel.
3. **Recall notices** pushed to everyone who holds an affected receipt.

## What is real and what is sandbox

| Part | Status | Where |
|---|---|---|
| Short code per receipt (Crockford base32, 8 characters, shown `7KQ2-MX4P`), issued with every receipt, collision-checked | implemented | `services/reach/codes.py`, `services/reach/db.py`, hooks in `services/api/main.py` (`_plan`, `_ask`) |
| `GET /api/code/{code}`: any case, no dash, O/0 and I/L/1 typos; 404 `unknown code` for anything else | implemented | `services/reach/service.py` |
| Web: `/v/:code` opens the verifier; a "Code from an SMS" box on `/verify` | implemented | `apps/web/src/features/verify/` |
| Receipt SMS text: the same text as the web preview, now with the short code and `{PUBLIC_BASE}/v/{code}` | implemented, parity proven by shared fixtures | `services/reach/sms.py`, `services/reach/fixtures/sms_parity.json` |
| **Sending SMS** | **sandbox: not sent.** Each SMS is appended to an outbox file. We have no SMS provider account. | `services/reach/senders.py` (`SandboxSender`) |
| Recall notices to holders (both `/api/admin/recall` and `/api/demo/{sid}/recall`), one per holder and receipt, each recorded | implemented | `services/reach/notify.py` |
| Telegram notices and the Telegram bot | implemented; **tested only against a fake Bot API** (no live Telegram test until the owner creates the token) | `services/reach/telegram.py` |
| Officer's recall result: "Notified 3: 2 Telegram, 1 SMS (sandbox: not sent)" | implemented | `apps/web/src/features/officer/RecallPanel.tsx` |
| The farmer app showing the server's code and `/v/` link in its SMS preview and receipt sheet | planned (farmer-app change, not made here) | `apps/web/src/features/farmer/` |
| A "send this receipt to my phone" field in the farmer app (`POST /api/demo/{sid}/reach/sms`) | planned (the endpoint exists; the UI does not) | |
| Notices when an area's photo trust is withdrawn (an `AreaTrustCredential` revoked) | planned: only rule-version recalls notify today | |
| SMS STOP keyword, delivery receipts | planned (needs a provider) | |

## A code is a lookup handle, not a proof

A short code only **finds** a receipt's credential id. It is not a secret and it proves nothing. Authenticity always comes from the signature check:

- In the browser, the `/v/:code` page looks the code up, then runs exactly the same check as `/verify/:id`: the Ed25519 signature over the JCS bytes, then the status lists of the rules the receipt cites.
- In the bot, `/verify CODE` uses the server verifier, the same code as `GET /api/verify/{id}`.

The verify page says so when it was opened from a code ("The code only finds the receipt; the signature check is the proof").

Three more points:

- **Enumeration.** Codes have 40 random bits. Lookups are rate-limited per client (`PLAN_LIMIT_PER_MIN`, 20 a minute). A code reveals only what the receipt link already reveals: receipts are public by design and carry only a hash of a farmer's question.
- **Typos.** A mistyped code that happens to hit another receipt opens that other receipt. Its content, title and rule are shown, so the farmer can see it is not theirs. The chance is about (codes issued) / 2^40.
- **The reply to an unknown code** is a bare `404 {"detail": "unknown code"}`. It is the same for malformed codes, and nothing else is said.

## Endpoints

| Method and path | What it does |
|---|---|
| `GET /api/code/{code}` | `{code, credential_id, verify_path, note}`, or `404 unknown code`; `429` when rate-limited |
| `GET /api/credentials/{id}/code` | the receipt's code (issued now if it predates Reach), `verify_url`, and the SMS text in `en` and `bn` with its segment count |
| `POST /api/demo/{sid}/reach/sms` `{credential_id, phone, lang}` | sandbox SMS of a receipt from that demo session: written to the outbox, **not sent**. The number is kept as the receipt's holder, so a recall in that session notifies it (also sandbox). |
| `GET /api/reach/health` | whether a token is set and the bot is polling; SMS mode |
| `POST /api/admin/recall`, `POST /api/demo/{sid}/recall` | as before, plus `notified: {total, telegram, sms_sandbox, sms_sent, failed, receipts, note}` |

A notice reads: `KrishiLoop: RECALLED. Do not follow advice R-PLB-008 v1 from 2026-11-02. Check https://…/v/7KQ2-MX4P` (Bangla: `কৃষিলুপ: বাতিল। …`). Each notice is recorded with its receipt, rule version, channel, time and status:

- `sent`: Telegram accepted it;
- `sandbox`: an SMS written to the outbox;
- `failed`: with the reason. A later call of the same recall tries a failed notice again; a delivered one is never sent twice.

## The Telegram bot

- **Bot API over HTTPS, long polling** (`getUpdates`). No webhook: nothing on our machines is public.
- The bot runs as a background thread **inside the API process**, so it uses the API's own stores, the same Ask pipeline (`main._ask`, which also serves `POST /api/demo/{sid}/ask`) and the same verifier.
- It starts only when `TELEGRAM_BOT_TOKEN` is set. `KRISHILOOP_TELEGRAM=off` keeps it off even with a token.

Commands:

- **`/start`**: language buttons (বাংলা / English). The welcome message says what is kept and that `/stop` deletes it.
- **`/start <session id>`**: also links the chat to a web demo session. The deep link is `https://t.me/<bot>?start=<session id>`. A recall made in that session's officer console then reaches the chat.
- **`/bn`, `/en`**: switch language.
- **Any text** is a question for the sample field (default: the first field and profile in `rules/demo/demo.yaml`; set `REACH_FIELD_ID` and `REACH_PROFILE_ID` to change them). The reply is one of:
  - the rule's validated text, the rule id, the short code and the `/v/` link;
  - or the abstention message ("Sent to your officer").

  Unlinked chats use the main service (status list `1`), so their questions go to the official inbox and `/api/admin/recall` reaches them. Linked chats use their demo session's sandbox.
- **`/verify CODE`**: Authentic (with "it does not prove the advice fits your field"), Recalled, or Cannot verify.
- **`/stop`**: deletes the chat's id, language and receipt ids.

The token is read from the environment only. It is never printed, logged, or put in an error: errors carry the method and Telegram's own description, never the URL. Only one process may poll a token; Telegram answers a second poller with 409, and the bot then backs off.

## Owner's steps to turn on Telegram

1. In Telegram, open **@BotFather** and send `/newbot`. Give it a name (for example KrishiLoop) and a username ending in `bot`. BotFather replies with a token.
2. Put it in `D:\AI_congress\secrets\.env` as `TELEGRAM_BOT_TOKEN=…`. Never paste it into a chat, a file in the repo or a commit.
3. Optional, in BotFather, `/setcommands`:

   ```
   start - choose your language
   verify - check a receipt code
   stop - delete my data
   help - what I can do
   ```

4. Start the API with that environment loaded, the same way as the other keys. The log says `Telegram bot @<username> polling (long polling, no webhook)`, and `GET /api/reach/health` shows `"polling": true`.
5. Set `PUBLIC_BASE_URL` to the public site (staging from Nov 5). The links in messages are `{PUBLIC_BASE_URL}/v/{code}`; a `localhost` link does not open on a phone.
6. If the API ever runs as more than one process or replica, set `KRISHILOOP_TELEGRAM=off` on all but one.

## What a real SMS provider would need

- **An account** with a provider that delivers in the target country. Its API key goes in the environment only, like the other keys.
- **A sender ID or short code**, registered where the country requires it.
- **A budget per message part.** Bangla is UCS-2: 70 characters for one SMS, 67 per part once split. The Bangla receipt SMS is about 105 units, so 2 parts; the English one fits in 1.
- **Opt-in.** The farmer gives their number and agrees to receive notices. Verify the number (a one-time code) before sending to it, so nobody receives messages meant for someone else.
- **STOP.** Inbound STOP messages call `ReachDB.forget("sms", number)`.
- **Delivery receipts.** Most providers push them to a webhook, which would need a public endpoint. To keep nothing public, poll the provider's status API instead.
- **Code.** One new `Sender` (`channel = "sms"`, `send()` returns `Delivery("sent")` when the provider accepts), used in place of `SandboxSender` in `Reach.on_recall` and the SMS endpoint, plus an official (non-demo) opt-in endpoint. The text and segment rules stay in `sms.py`.

## Personal data

| What | Where | Kept until |
|---|---|---|
| A Telegram chat id, its language, the demo session it is linked to | `chats` table | `/stop` |
| Receipt holders: receipt id, channel, address (chat id or SMS number), language | `holders` table | `/stop` (Telegram). Demo-session holders are purged once the 24 h session has expired (on the next sandbox SMS). |
| Notices: receipt, rule version, channel, time, status | `notifications` table | kept. **No address** is stored here, so deleting a holder leaves no personal data in the log. |
| Sandbox SMS: the text and a **masked** number (`+254•••••••01`) | `sms_outbox.jsonl` | kept. Never sent. |
| Short codes: code and credential id | `codes` table | kept (not personal data) |

- **Location.** Everything lives in `data/trust/<issuer>/reach/` (`reach.sqlite3`, `sms_outbox.jsonl`), or at `KRISHILOOP_REACH_DB`. `data/` is git-ignored.
- **What is not kept.** No names, no Telegram usernames, no message history.
- **Group chats.** The bot ignores them.
- **Third parties.** Nothing goes to a third-party AI API (AGENTS.md rule 8). Telegram, the channel itself, sees the chat.
- **The question.** A question asked in Telegram follows the web Ask path: the receipt carries only its sha256, and the readable question, minus phone numbers and e-mail addresses, goes only to the officer's inbox.

## Tests

| Command | What it covers |
|---|---|
| `.venv/Scripts/python.exe -m pytest tests/test_reach.py` | Codes and typing rules; collisions; SMS text and segments against the shared fixtures; recall notices (demo and admin, once each, failures, only affected receipts); the bot (start, language, a question through the Ask pipeline, a recall push, `/verify`, abstention, `/stop`, deep link, group chats, polling); the token never appears in errors. No network. |
| `cd apps/web && npx vitest run src/features/verify/reachParity.test.ts` | The web's `buildSms`, `smsInfo` and dictionaries, and its code typing rules, against the same fixtures |
| `cd apps/web && npx playwright test tests/e2e/reach.spec.ts` | `/v/:code`, the code box, an unknown code (English and Bangla, phone width, light theme, axe), the unreachable state |

To regenerate the fixtures after a deliberate wording change: change `TEMPLATES`, `DECISION_WORDS` or `KIND_WORDS` in `sms.py` together with the web dictionaries. Then rebuild `fixtures/sms_parity.json` from `sms.py`. Both test suites must pass.
