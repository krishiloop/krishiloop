/**
 * English words for the phone app (/m) and the "Open on your phone" card (builder Mo). Spread into en.ts; bn.mobile.ts
 * carries every key (i18n.test.ts). Copy rules: short sentences, everyday words, no jargon. Sample farms, recorded
 * answers, simulated warnings and the research weights are always named, in plain words.
 */
const mobile = {
  /* ---------------------------------------------------------------- the app */
  'm.title': 'KrishiLoop farm app',
  'm.h1': 'KrishiLoop on your phone',
  'm.tabs': 'App sections',
  'm.tab.home': 'Home',
  'm.tab.leaf': 'Check a leaf',
  'm.tab.ask': 'Ask',
  'm.tab.receipts': 'My receipts',
  'm.tab.help': 'Help',
  'm.tab.recalledN': '{n} withdrawn',
  'm.head.sample': 'Sample farm',
  'm.head.week': 'This week, {from} to {to}',
  'm.head.loading': 'Loading your farm',
  'm.offline': 'No internet. Your saved receipts and the leaf check still work.',

  /* ---------------------------------------------------------------- first run */
  'm.ob.step': 'Step {n} of {of}',
  'm.ob.langTitle': 'Choose your language',
  'm.ob.langSub': 'You can change it later in Help.',
  'm.ob.farmTitle': 'Choose a farm to try',
  'm.ob.farmSub': 'These are sample farms, not real farmers. The advice and receipts are real.',
  'm.ob.farmName': '{crop} farm in {country}',
  'm.ob.loading': 'Loading the sample farms…',
  'm.ob.failed': 'The sample farms did not load. Check the internet and try again.',
  'm.ob.whatTitle': 'What this app does',
  'm.ob.what1': 'Tells you what to do on your field this week.',
  'm.ob.what2': 'Checks a sick leaf with your phone camera.',
  'm.ob.what3': 'Gives a receipt for every answer, so anyone can check it.',
  'm.ob.next': 'Next',
  'm.ob.back': 'Back',
  'm.ob.start': 'Start',

  /* ---------------------------------------------------------------- check a leaf */
  'm.leaf.title': 'Check a leaf',
  'm.leaf.sub': 'Take a photo of one sick leaf. Your phone looks at it, so no internet is needed.',
  'm.leaf.tips': 'For a good photo',
  'm.leaf.tip1': 'One leaf, close up',
  'm.leaf.tip2': 'Daylight, no shadow',
  'm.leaf.tip3': 'Hold the phone still',

  /* ---------------------------------------------------------------- my receipts */
  'm.rc.title': 'My receipts',
  'm.rc.sub': 'Every answer comes with a receipt. Show it to an officer, or share it.',
  'm.rc.empty': 'No receipts yet. Open Home to get this week’s advice and its receipt.',
  'm.rc.goHome': 'Open Home',
  'm.rc.count': '{n} saved on this phone',
  'm.rc.fromPlan': 'Weekly advice',
  'm.rc.fromAsk': 'Your question',
  'm.rc.recorded': 'Recorded sample',
  'm.rc.open': 'Open receipt',
  'm.rc.qr': 'Show QR',
  'm.rc.share': 'Share',
  'm.rc.checkedNow': 'Checked just now',
  'm.rc.checkedAt': 'Last checked {when}',
  'm.rc.notChecked': 'Not checked yet',
  'm.rc.checking': 'Checking…',
  'm.rc.oldNote': 'No internet now. You see the last check. A receipt may have been withdrawn since then.',
  'm.rc.withdrawn': 'Withdrawn. Don’t follow this advice. Open Home for this week’s answer.',
  'm.rc.unknown': 'We don’t know this receipt.',

  /* ---------------------------------------------------------------- the QR to show an officer */
  'm.qr.title': 'Show this to your officer',
  'm.qr.sub': 'They scan it with any phone camera to check the receipt.',
  'm.qr.code': 'Receipt code',
  'm.qr.alt': 'QR code to check this receipt',
  'm.qr.copy': 'Copy link',
  'm.qr.copied': 'Link copied',
  'm.qr.copyFail': 'Could not copy. Show the QR code instead.',
  'm.qr.close': 'Done',

  /* ---------------------------------------------------------------- help */
  'm.help.title': 'Help',
  'm.help.officer': 'Call my officer',
  'm.help.officerSub': 'Ask an officer to visit your field or call you.',
  'm.help.officerGo': 'Book a visit or a call',
  'm.help.noFarm': 'Choose a farm first.',
  'm.help.lang': 'Language',
  'm.help.screen': 'Screen',
  'm.help.light': 'Light',
  'm.help.dark': 'Dark',
  'm.help.farm': 'Sample farm',
  'm.help.farmSub': 'For trying the app. These are not real farmers.',
  'm.help.field': 'Field',
  'm.help.farmer': 'Farmer',
  'm.help.data': 'Where the answers come from',
  'm.help.live': 'Our live server answers you. Your receipts are real, and can be withdrawn.',
  'm.help.recorded': 'Our server is not connected. You see real answers we recorded earlier.',
  'm.help.links': 'More',
  'm.help.website': 'Open the KrishiLoop website',
  'm.help.full': 'See how each answer is made',
  'm.help.restart': 'Show the welcome screens again',
  'm.help.honest': 'What is real here',
  'm.help.honest1': 'The farms and farmers are samples.',
  'm.help.honest2': 'The leaf check uses research weights (trained on PlantWild, non-commercial).',
  'm.help.honest3': 'A weather warning marked “Simulated” is a practice run, not a forecast.',

  /* ---------------------------------------------------------------- "Open on your phone" (home page and /app) */
  'm.open.title': 'Open on your phone',
  'm.open.sub': 'Use KrishiLoop on your phone, in its web browser.',
  'm.open.scan': 'Scan with your phone’s camera, or copy the link.',
  'm.open.copy': 'Copy link',
  'm.open.copied': 'Link copied',
  'm.open.copyFail': 'Could not copy. Select the link and copy it.',
  'm.open.qrAlt': 'QR code that opens the KrishiLoop phone app',
} as const satisfies Record<string, string>;

export default mobile;
