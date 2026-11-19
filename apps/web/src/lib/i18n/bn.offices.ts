/**
 * Bangla (বাংলা) words for "Nearest agriculture office". Machine-written; pending native-speaker review. Spoken,
 * everyday Bangla, short sentences. Every key of en.offices.ts is here (the type checks it) and every {placeholder}
 * is kept (i18n.test.ts).
 */
import type offices from './en.offices';

const d: Record<keyof typeof offices, string> = {
  'near.card.title': 'নিশ্চিত নন? কাছের কৃষি অফিসে কথা বলুন',
  'near.card.sub': 'সবচেয়ে কাছের অফিস দেখুন। ফোন করুন বা পথ দেখে নিন।',
  'near.card.go': 'আমার কৃষি অফিস খুঁজুন',
  'near.entry.title': 'আমার কৃষি অফিস খুঁজুন',
  'near.entry.sub': 'মানচিত্রে কাছের অফিস দেখুন।',
  'near.sheet.title': 'কাছের কৃষি অফিস',
  'near.sheet.sub': 'কৃষি সম্প্রসারণ অধিদপ্তরের (ডিএই) অফিস',
  'near.loc.why': 'কাছের অফিস খুঁজতে আমাদের জানতে হবে আপনি কোথায়। আপনার অবস্থান এই ফোনেই থাকে। আমরা কোথাও পাঠাই না।',
  'near.loc.allow': 'আমার অবস্থান ব্যবহার করুন',
  'near.loc.sample': 'নমুনা খামার ব্যবহার করুন',
  'near.loc.asking': 'আপনার অবস্থান খোঁজা হচ্ছে',
  'near.loc.denied': 'আপনার অবস্থান পাওয়া যায়নি, তাই নমুনা খামার দেখানো হচ্ছে।',
  'near.from.you': 'আপনার কাছে',
  'near.from.sample': 'নমুনা খামারের কাছে (আসল খামার নয়)',
  'near.change': 'বরং আমার অবস্থান ব্যবহার করুন',
  'near.far': 'আমাদের কাছে এখন শুধু বাংলাদেশের অফিস আছে, আর এই জায়গার কাছে কোনোটি নেই।',
  'near.callcentre': 'কৃষি কল সেন্টার: ১৬১২৩',
  'near.callcentre.sub': 'কৃষি সম্প্রসারণ অধিদপ্তরের ফোনে কৃষি পরামর্শ।',
  'near.callcentre.call': '১৬১২৩ নম্বরে ফোন করুন',
  'near.call': '{phone} নম্বরে ফোন করুন',
  'near.gothere': 'সেখানে যান',
  'near.gothere.aria': '{name} অফিসে যান: আপনার ম্যাপ অ্যাপে পথ খুলবে',
  'near.osm': 'ওপেনস্ট্রিটম্যাপে খুলুন',
  'near.km': '{km} কিমি দূরে',
  'near.approx': 'আনুমানিক জায়গা: উপজেলার মাঝখান, অফিসের দরজা নয়।',
  'near.exact': 'জায়গাটি ওপেনস্ট্রিটম্যাপ থেকে নেওয়া।',
  'near.officer': 'কর্মকর্তা',
  'near.officerCall': 'কর্মকর্তাকে ফোন করুন: {phone}',
  'near.officerNote': 'নাম ও নম্বর সরকারি পাতায় যেমন আছে, তেমনই।',
  'near.officerNone': 'এই অফিসের কর্মকর্তার নাম প্রকাশিত নেই।',
  'near.nophone': 'অফিসের ফোন নম্বর প্রকাশিত নেই। ১৬১২৩ নম্বরে ফোন করুন।',
  'near.source': 'সূত্র: সরকারি পাতা, দেখা হয়েছে {date}',
  'near.sourceNone': 'সূত্র: উপজেলার সীমানা (জিওবাউন্ডারিজ)। অফিসের পাতা পাওয়া যায়নি।',
  'near.map.label': 'কাছের অফিসের মানচিত্র',
  'near.map.loading': 'মানচিত্র আসছে',
  'near.map.error': 'মানচিত্র আসেনি। নিচের তালিকা ঠিকই কাজ করছে।',
  'near.map.you': 'আপনি',
  'near.map.sample': 'নমুনা খামার',
  'near.list': 'সবচেয়ে কাছের অফিস',
  'near.attrib': 'মানচিত্র: © ওপেনস্ট্রিটম্যাপ অবদানকারীরা। সীমানা: জিওবাউন্ডারিজ।',
  'near.mt': 'এখানের বাংলা লেখা মেশিনে লেখা, কোনো বাংলাভাষী এখনো যাচাই করেননি।',
};

export default d;
