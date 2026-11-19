/**
 * Bangla (বাংলা) copy for the /receipt walk-through. Machine-written; pending native-speaker review.
 */
import type receipt from './en.receipt';

const d: Record<keyof typeof receipt, string> = {
  'rw.eyebrow': 'ধাপে ধাপে',
  'rw.title': 'একটি রসিদ, ধাপে ধাপে।',
  'rw.lead': 'পাঁচ ধাপ, একটি আসল রসিদ। কোনো ধাপে চাপ দিন।',
  'rw.stepsLabel': 'পাঁচটি ধাপ',
  'rw.stepOf': '{total}-এর {n}',
  'rw.back': 'এক ধাপ পেছনে',
  'rw.next': 'পরের',
  'rw.play': 'চালান',
  'rw.pause': 'থামান',
  'rw.data.name': 'জমির তথ্য',
  'rw.data.title': 'শুরু হয় আপনার জমি থেকে।',
  'rw.data.body': 'আবহাওয়া আর আপনার ফসলের তথ্য। আন্দাজে কিছু নয়।',
  'rw.data.field': 'জমি',
  'rw.data.source': 'Open-Meteo।',
  'rw.rule.name': 'নিয়ম',
  'rw.rule.title': 'একটা লেখা নিয়ম সিদ্ধান্ত নেয়।',
  'rw.rule.body': 'বিশেষজ্ঞের নিয়ম পরামর্শ বাছে। এআই লেখে না।',
  'rw.rule.from': 'বাংলাদেশ ধান গবেষণা ইনস্টিটিউট।',
  'rw.sign.name': 'সই করা রসিদ',
  'rw.sign.title': 'পরামর্শের সঙ্গে রসিদ আসে।',
  'rw.sign.body': 'KrishiLoop সই করে। একটি অক্ষর বদলালেই সই ভেঙে যায়।',
  'rw.sign.paper': 'পরামর্শের রসিদ',
  'rw.sign.rule': 'নিয়ম',
  'rw.sign.week': 'সপ্তাহ',
  'rw.check.name': 'যে কেউ যাচাই করে',
  'rw.check.title': 'যে কেউ এটা যাচাই করতে পারে।',
  'rw.check.body': 'QR স্ক্যান করুন। আপনার ব্রাউজার যাচাই করে। লগইন লাগে না।',
  'rw.check.line': 'আসল, কিছু বদলানো হয়নি।',
  'rw.check.try': 'এই রসিদ এখনই যাচাই করুন',
  'rw.recall.name': 'প্রত্যাহার',
  'rw.recall.title': 'ভুল নিয়ম ফেরত নেওয়া হয়।',
  'rw.recall.body': 'কর্মকর্তা ফেরত নেন। সেই নিয়মের সব রসিদে “ফেরত” লেখা হয়।',
  'rw.recall.line': 'এই নিয়মের সব রসিদ: ফেরত।',
  'rw.recall.try': 'অফিসারের ডেস্কে প্রত্যাহার করে দেখুন',
};

export default d;
