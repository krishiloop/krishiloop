/**
 * The 64 districts of Bangladesh: the English name exactly as the office data spells it (geoBoundaries), the Bangla
 * name, and other English spellings people type (the newer official spellings such as Chattogram or Bogura).
 * The office data has a Bangla district name for only some offices (and a few of those are scraping slips), so the
 * screen and the search read the Bangla name from here.
 */
export interface District {
  en: string;
  bn: string;
  alt?: string[];
}

export const DISTRICTS: readonly District[] = [
  { en: 'Bagerhat', bn: 'বাগেরহাট' },
  { en: 'Bandarban', bn: 'বান্দরবান' },
  { en: 'Barguna', bn: 'বরগুনা' },
  { en: 'Barisal', bn: 'বরিশাল', alt: ['Barishal'] },
  { en: 'Bhola', bn: 'ভোলা' },
  { en: 'Bogra', bn: 'বগুড়া', alt: ['Bogura'] },
  { en: 'Brahamanbaria', bn: 'ব্রাহ্মণবাড়িয়া', alt: ['Brahmanbaria'] },
  { en: 'Chandpur', bn: 'চাঁদপুর' },
  { en: 'Chittagong', bn: 'চট্টগ্রাম', alt: ['Chattogram'] },
  { en: 'Chuadanga', bn: 'চুয়াডাঙ্গা' },
  { en: 'Comilla', bn: 'কুমিল্লা', alt: ['Cumilla'] },
  { en: "Cox's Bazar", bn: 'কক্সবাজার', alt: ['Coxs Bazar', 'Cox Bazar'] },
  { en: 'Dhaka', bn: 'ঢাকা' },
  { en: 'Dinajpur', bn: 'দিনাজপুর' },
  { en: 'Faridpur', bn: 'ফরিদপুর' },
  { en: 'Feni', bn: 'ফেনী' },
  { en: 'Gaibandha', bn: 'গাইবান্ধা' },
  { en: 'Gazipur', bn: 'গাজীপুর' },
  { en: 'Gopalganj', bn: 'গোপালগঞ্জ' },
  { en: 'Habiganj', bn: 'হবিগঞ্জ' },
  { en: 'Jamalpur', bn: 'জামালপুর' },
  { en: 'Jessore', bn: 'যশোর', alt: ['Jashore'] },
  { en: 'Jhalokati', bn: 'ঝালকাঠি', alt: ['Jhalakathi', 'Jhalokathi'] },
  { en: 'Jhenaidah', bn: 'ঝিনাইদহ' },
  { en: 'Joypurhat', bn: 'জয়পুরহাট' },
  { en: 'Khagrachhari', bn: 'খাগড়াছড়ি', alt: ['Khagrachari'] },
  { en: 'Khulna', bn: 'খুলনা' },
  { en: 'Kishoreganj', bn: 'কিশোরগঞ্জ' },
  { en: 'Kurigram', bn: 'কুড়িগ্রাম' },
  { en: 'Kushtia', bn: 'কুষ্টিয়া' },
  { en: 'Lakshmipur', bn: 'লক্ষ্মীপুর', alt: ['Laxmipur'] },
  { en: 'Lalmonirhat', bn: 'লালমনিরহাট' },
  { en: 'Madaripur', bn: 'মাদারীপুর' },
  { en: 'Magura', bn: 'মাগুরা' },
  { en: 'Manikganj', bn: 'মানিকগঞ্জ' },
  { en: 'Maulvibazar', bn: 'মৌলভীবাজার', alt: ['Moulvibazar'] },
  { en: 'Meherpur', bn: 'মেহেরপুর' },
  { en: 'Munshiganj', bn: 'মুন্সীগঞ্জ' },
  { en: 'Mymensingh', bn: 'ময়মনসিংহ' },
  { en: 'Naogaon', bn: 'নওগাঁ' },
  { en: 'Narail', bn: 'নড়াইল' },
  { en: 'Narayanganj', bn: 'নারায়ণগঞ্জ' },
  { en: 'Narsingdi', bn: 'নরসিংদী' },
  { en: 'Natore', bn: 'নাটোর' },
  { en: 'Nawabganj', bn: 'চাঁপাইনবাবগঞ্জ', alt: ['Chapai Nawabganj', 'Chapainawabganj'] },
  { en: 'Netrakona', bn: 'নেত্রকোনা', alt: ['Netrokona'] },
  { en: 'Nilphamari', bn: 'নীলফামারী' },
  { en: 'Noakhali', bn: 'নোয়াখালী' },
  { en: 'Pabna', bn: 'পাবনা' },
  { en: 'Panchagarh', bn: 'পঞ্চগড়' },
  { en: 'Patuakhali', bn: 'পটুয়াখালী' },
  { en: 'Pirojpur', bn: 'পিরোজপুর' },
  { en: 'Rajbari', bn: 'রাজবাড়ী' },
  { en: 'Rajshahi', bn: 'রাজশাহী' },
  { en: 'Rangamati', bn: 'রাঙ্গামাটি' },
  { en: 'Rangpur', bn: 'রংপুর' },
  { en: 'Satkhira', bn: 'সাতক্ষীরা' },
  { en: 'Shariatpur', bn: 'শরীয়তপুর' },
  { en: 'Sherpur', bn: 'শেরপুর' },
  { en: 'Sirajganj', bn: 'সিরাজগঞ্জ' },
  { en: 'Sunamganj', bn: 'সুনামগঞ্জ' },
  { en: 'Sylhet', bn: 'সিলেট' },
  { en: 'Tangail', bn: 'টাঙ্গাইল' },
  { en: 'Thakurgaon', bn: 'ঠাকুরগাঁও' },
];

const BY_EN = new Map(DISTRICTS.map((d) => [d.en, d]));

/** The district's name in the screen's language (Bangla from the list above, never from a scraped page). */
export function districtName(en: string | null | undefined, lang: string): string | null {
  if (!en) return null;
  return lang === 'bn' ? (BY_EN.get(en)?.bn ?? en) : en;
}

export const districtOf = (en: string | null | undefined) => (en ? BY_EN.get(en) : undefined);

/** The office's name in the screen's language (the Bangla name only where the government page gives one). */
export const officeName = (o: { name_en: string; name_bn: string | null }, lang: string) => (lang === 'bn' && o.name_bn ? o.name_bn : o.name_en);

/** "Upazila, District" in the screen's language. */
export function placeLine(o: { upazila_en: string; upazila_bn: string | null; district_en: string | null }, lang: string): string {
  return [lang === 'bn' ? (o.upazila_bn ?? o.upazila_en) : o.upazila_en, districtName(o.district_en, lang)].filter(Boolean).join(', ');
}
