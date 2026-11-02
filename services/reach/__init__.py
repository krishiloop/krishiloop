"""Reach: a recall reaches the farmer, and a basic phone can check a receipt.

- codes.py     short verify codes (Crockford base32, 8 characters): a lookup handle, never a proof
- db.py        the Reach store (SQLite): code -> credential, holders and their channel, notifications, Telegram chats
- sms.py       the receipt SMS (same text as the web preview) and the recall notice, with GSM-7 / UCS-2 counting
- senders.py   SandboxSender (an outbox file, never sends) and TelegramSender (Bot API sendMessage)
- notify.py    recall fan-out: every holder of a receipt that cites the recalled rule version gets a notice
- telegram.py  the Telegram bot: long polling (no webhook), /start, questions, /verify CODE, /stop
- service.py   the glue the API mounts (endpoints, hooks, bot start)
"""
