/**
 * English copy for the Disease map (builder M): /map and its home preview card (map.*). Spread into en.ts;
 * bn.map.ts carries every key (i18n.test.ts). Copy rules: plain words; recorded sightings always say they are GBIF
 * records and not today's disease; the simulated outbreak always says it is practice data; no doses anywhere.
 */
const map = {
  'map.eyebrow': 'Disease map',
  'map.title': 'Where pests and diseases have been recorded',
  'map.lead':
    'Bangladesh, India and Kenya, area by area. Choose a pest, a range of years and the layers you want. Open an area for its counts, a live 7-day weather forecast and what to watch.',
  'map.loading': 'Loading the map',
  'map.loadError': 'The map could not load. Check your connection and reload the page.',

  /* controls */
  'map.ctl.country': 'Country',
  'map.ctl.bdLevel': 'Bangladesh areas',
  'map.ctl.pest': 'Pest or disease',
  'map.ctl.layers': 'Layers',
  'map.ctl.more': 'Years and layers: {from} to {to}, {n} layers on',
  'map.country.BD': 'Bangladesh',
  'map.country.IN': 'India',
  'map.country.KE': 'Kenya',
  'map.country.all': 'All three',
  'map.level.district': 'district',
  'map.level.division': 'division',
  'map.level.state': 'state',
  'map.level.county': 'county',
  'map.levels.district': 'Districts',
  'map.levels.division': 'Divisions',
  'map.levels.state': 'States',
  'map.levels.county': 'Counties',
  'map.pest.all': 'All pests and diseases',
  'map.pest.faw': 'Fall armyworm',
  'map.pest.blast': 'Rice blast',
  'map.pest.late_blight': 'Late blight',
  'map.pest.bph': 'Brown planthopper',
  'map.pest.locust': 'Desert locust',
  'map.pest.blb': 'Rice bacterial blight',
  'map.pest.brown_spot': 'Rice brown spot',
  'map.problem.unidentified': 'a problem the app could not name',
  'map.years.label': 'Years',
  'map.years.range': '{from} to {to}',
  'map.years.from': 'From year',
  'map.years.to': 'To year',
  'map.years.all': 'All years',
  'map.years.since2000': 'Since 2000',
  'map.years.last10': 'Last 10 years',
  'map.layer.sightings': 'Recorded sightings',
  'map.layer.reports': 'Farmer reports, last {days} days',
  'map.layer.sim': 'Simulated outbreak: practice data',

  /* labels on the map */
  'map.mark.recorded': 'Recorded',
  'map.mark.sim': 'Simulated',
  'map.label.sightings':
    'Recorded sightings in GBIF (research and citizen-science records, years {from} to {to}). The colour shows where people recorded these pests, not how much disease there is now.',
  'map.label.undated': 'With every year chosen, records that have no year are counted too.',
  'map.label.sim': 'Made-up reports from made-up farmers, to show how an outbreak would look. Never added to real counts.',
  'map.reports.live': 'Farmer reports from KrishiLoop in the last {days} days. An area shows only when at least {k} farmers reported the same problem.',
  'map.reports.needsLive': 'Farmer reports need the live service, which is not connected here, so none are shown.',
  'map.reports.india': 'KrishiLoop has no farmer reports from India yet.',
  'map.reports.layerOff': 'The farmer reports layer is off.',
  'map.reports.cell': 'farmers reported {problem} ({area})',
  'map.reports.none': 'No problem was reported here by {k} or more farmers in the last {days} days.',
  'map.sim.noneHere': 'The practice scenario has no reports here.',
  'map.totals': '{placed} of {total} records have a place on the map ({level})',
  'map.svgLabel': 'Map of {country}, {level}. Use the arrow keys to move between areas and Enter to open one.',
  'map.top': '{level} with the most records',
  'map.noneInRange': 'GBIF has no placed records of this pest in {country} for these years.',
  'map.caveat.IN':
    'Borders follow the geoBoundaries file for India, which makes no promise that its lines are exact. Some borders are disputed; this map takes no position.',
  'map.a11y.sightings': '{n} recorded sightings',
  'map.a11y.reports': '{n} farmers reported in the last {days} days',
  'map.a11y.sim': '{n} simulated reports',
  'map.tip': '{area}: {n} recorded',
  'map.tipReports': '{n} farmers reported',

  /* legend */
  'map.legend.title': 'Recorded sightings per area',
  'map.legend.none': 'none',
  'map.legend.range': '{from} to {to}',
  'map.legend.plus': '{n} or more',
  'map.legend.reports': 'Ring: farmers who reported in the last {days} days',
  'map.legend.sim': 'Dashed ring and stripes: simulated practice data',

  /* the area panel */
  'map.panel.title': '{area} ({level}, {country})',
  'map.panel.empty': 'Choose an area on the map to see its counts, its weather and what to watch.',
  'map.panel.recorded': 'Recorded sightings in GBIF',
  'map.panel.recordedSub': '{n} records from {from} to {to}, by pest.',
  'map.panel.recordedNote': 'Where people recorded these pests, not how much there is now.',
  'map.wx.title': 'Weather, next 7 days',
  'map.wx.loading': 'Loading the forecast',
  'map.wx.error': 'The forecast could not load.',
  'map.wx.rainAhead': 'Rain is forecast: about {mm} mm over the week.',
  'map.wx.day': '{day}: rain {mm} mm, high {hi} °C, low {lo} °C, humidity {rh}%',
  'map.wx.key': 'Bars: rain in mm. Below: highest and lowest °C, then humidity.',
  'map.wx.credit': 'Forecast for the centre of this area ({lat}, {lon}), straight from',
  'map.watch.title': 'What to watch',
  'map.watch.pack.BD': 'Our Bangladesh rice rules, each quoted from its source:',
  'map.watch.pack.KE': 'Our Kenya potato late blight rules, each quoted from its source:',
  'map.watch.pack.IN': 'Our rules for India:',
  'map.watch.source': '{publisher}, page {page}',
  'map.watch.noRule': 'We have no sourced rule yet for {pests} in {country}.',
  'map.watch.noCountry': 'We have no sourced rule for {country} yet.',

  /* credits */
  'map.credit.sightings': 'Recorded sightings:',
  'map.credit.gbif': 'GBIF occurrence counts, asked on {date} and stored with this page (the page does not call GBIF).',
  'map.credit.licences': 'Licences of these records: {list}.',
  'map.credit.keys': 'GBIF taxon keys:',
  'map.credit.borders': 'Borders, {country}:',
  'map.credit.weather': 'Weather:',
  'map.credit.openmeteo': 'Open-Meteo.com forecast API (CC BY 4.0), asked by your browser only when you open an area.',

  /* the home preview card */
  'map.teaser.eyebrow': 'Disease map',
  'map.teaser.title': 'See where pests have been recorded',
  'map.teaser.body': 'Bangladesh, India and Kenya, area by area: recorded sightings, farmer reports and a live weather check.',
  'map.teaser.cta': 'Open the disease map',
  'map.teaser.stat': '{n} recorded sightings with a place, from GBIF',
} as const;

export default map;
