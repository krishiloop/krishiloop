"""What the Telegram bot says, in English and Bangla (Bangla is machine-written, pending native-speaker review).

Wording rules (AGENTS.md, apps/web/DESIGN.md): a receipt is Authentic, Recalled or Cannot verify, never "correct";
"রসিদ" is a receipt, "বাতিল" Recalled, "খাঁটি" Authentic; no em dashes.
"""
from __future__ import annotations

TEXT = {
    "en": {
        "pick": "KrishiLoop. Choose your language.",
        "lang_set": "Language: English.",
        "welcome": "Ask a farming question in your own words. You get one sourced rule with a receipt, or your question "
                   "goes to an officer.\nAnswers are for the sample field {field} (a sample location, no farmer).\n"
                   "Check a receipt: /verify CODE\nWe keep only this chat's id, your language and the receipts we sent "
                   "you, so we can warn you if advice is recalled. /stop deletes them.",
        "linked": "This chat is linked to your demo session. A recall made there reaches you here.",
        "link_unknown": "That demo session was not found or has expired, so this chat uses the main service.",
        "need_start": "Press /start first to choose your language.",
        "answer": "{text}\nRule {rule}. Receipt {code}\nCheck: {url}",
        "sandbox": "(demo sandbox)",
        "abstained": "We don't have a sourced answer for this yet. Sent to your officer.",
        "busy": "Too many questions at once. Try again in a minute.",
        "unavailable": "The answering service is not available right now. Try again later.",
        "verify_usage": "Send /verify and the code on your receipt, for example /verify 7KQ2-MX4P",
        "verify_unknown": "Cannot verify: no receipt has the code {code}.",
        "authentic": "Authentic: issued by KrishiLoop and not changed since. It does not prove the advice fits your field."
                     "\nRule {rule}\n{url}",
        "expired": "This advice was for an earlier week.",
        "recalled": "Recalled: a rule behind this advice was withdrawn. Do not follow it.\nRule {rule}\n{url}",
        "invalid": "Cannot verify: {reason}",
        "stopped": "Deleted. We no longer keep this chat's id, language or receipts. Send /start to begin again.",
        "help": "/start choose your language\n/verify CODE check a receipt\n/stop delete your data\n"
                "Or just type a farming question.",
        "text_only": "Please send your question as text.",
    },
    "bn": {
        "pick": "কৃষিলুপ। আপনার ভাষা বেছে নিন।",
        "lang_set": "ভাষা: বাংলা।",
        "welcome": "নিজের ভাষায় চাষের প্রশ্ন লিখুন। উত্তরে পাবেন উৎসসহ একটি নিয়ম ও তার রসিদ, নইলে প্রশ্নটি কর্মকর্তার "
                   "কাছে যাবে।\nউত্তরগুলো নমুনা জমি {field}-এর জন্য (নমুনা জায়গা, কোনো কৃষক নেই)।\n"
                   "রসিদ যাচাই: /verify কোড\nআমরা শুধু এই চ্যাটের আইডি, আপনার ভাষা আর আপনাকে পাঠানো রসিদগুলো রাখি, "
                   "যাতে কোনো পরামর্শ বাতিল হলে জানাতে পারি। /stop দিলে সব মুছে যাবে।",
        "linked": "এই চ্যাট আপনার ডেমো সেশনের সঙ্গে যুক্ত। সেখানে কোনো পরামর্শ বাতিল হলে এখানে খবর পাবেন।",
        "link_unknown": "ডেমো সেশনটি পাওয়া যায়নি বা তার মেয়াদ শেষ, তাই এই চ্যাট মূল সেবা ব্যবহার করছে।",
        "need_start": "আগে /start চাপুন এবং ভাষা বেছে নিন।",
        "answer": "{text}\nনিয়ম {rule}। রসিদ {code}\nযাচাই: {url}",
        "sandbox": "(ডেমো স্যান্ডবক্স)",
        "abstained": "এই প্রশ্নের উৎসসহ উত্তর আমাদের কাছে এখনো নেই। আপনার কর্মকর্তার কাছে পাঠানো হয়েছে।",
        "busy": "একসঙ্গে অনেক প্রশ্ন এসেছে। এক মিনিট পরে আবার চেষ্টা করুন।",
        "unavailable": "উত্তর দেওয়ার সেবাটি এখন চালু নেই। পরে আবার চেষ্টা করুন।",
        "verify_usage": "/verify লিখে রসিদের কোডটি দিন, যেমন /verify 7KQ2-MX4P",
        "verify_unknown": "যাচাই করা যায়নি: {code} কোডের কোনো রসিদ নেই।",
        "authentic": "খাঁটি: কৃষিলুপের দেওয়া, এরপর বদলানো হয়নি। এতে প্রমাণ হয় না যে পরামর্শটি আপনার জমির জন্য "
                     "মানানসই।\nনিয়ম {rule}\n{url}",
        "expired": "এই পরামর্শ আগের এক সপ্তাহের জন্য ছিল।",
        "recalled": "বাতিল: এই পরামর্শের পেছনের একটি নিয়ম প্রত্যাহার করা হয়েছে। এটি মানবেন না।\nনিয়ম {rule}\n{url}",
        "invalid": "যাচাই করা যায়নি: {reason}",
        "stopped": "মুছে ফেলা হয়েছে। এই চ্যাটের আইডি, ভাষা বা রসিদ আর আমরা রাখছি না। আবার শুরু করতে /start পাঠান।",
        "help": "/start ভাষা বেছে নিন\n/verify কোড রসিদ যাচাই\n/stop আপনার তথ্য মুছুন\nঅথবা সরাসরি চাষের প্রশ্ন লিখুন।",
        "text_only": "প্রশ্নটি লিখে পাঠান।",
    },
}


def say(lang: str, key: str, **kw) -> str:
    table = TEXT.get(lang) or TEXT["en"]
    return (table.get(key) or TEXT["en"][key]).format(**kw)
