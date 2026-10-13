'use strict';
/* ── The wire ──────────────────────────────────────────────────────────────
   The right of the face carries what the Earth did. This carries what the
   species did — realization: things that became real. A launch either happened
   or it did not; an instrument either saw first light or it did not. That is
   the inclusion rule, and it is as hard as "magnitude 5 and above".

   Two other streams sit behind it on their own pages. World is the human
   mirror of the threshold rule: a government falls, a ceasefire is agreed or
   broken, an emergency is declared. Discovery is science in full, and carries
   the complete realization list the face is drawing its top slice from.

   Nothing here ranks by popularity and nothing is scored for importance. A
   curated source is trusted because a person put the item there; an uncurated
   one is marked as such until a curated source catches up.                   */

const Wire = (() => {

  const MIN = 60000, HOUR = 3600000;

  const state = {
    realization: [],     // launches, first light, arrivals, records
    world: [],           // threshold human events
    discovery: [],       // papers, missions, findings
    incidents: [],       // AI systems that caused harm, as reported
    sources: {}
  };

  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } };
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  const strip = html => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  function merge(list, sourceKey, incoming) {
    const kept = state[list].filter(e => e.source !== sourceKey);
    state[list] = kept.concat(incoming)
      .filter(e => e.time && Math.abs(Date.now() - e.time) < 120 * 24 * HOUR)
      .sort((a, b) => b.time - a.time)
      .slice(0, list === 'discovery' ? 260 : 120);
  }

  /* For news, a read replaces nothing. What a source said an hour ago is still
     true, and a feed that only ever shows its current handful — or that
     refuses a request, or answers with nothing — would otherwise empty the page
     at random. Items accumulate, the newer copy of an item wins, and each
     source's items leave by age alone. */
  function accumulate(list, sourceKey, incoming, maxAge) {
    const byId = new Map();
    for (const e of state[list]) byId.set(e.id, e);
    for (const e of incoming) byId.set(e.id, e);
    const now = Date.now();
    state[list] = [...byId.values()]
      .filter(e => e.time && (e.source !== sourceKey || now - e.time < maxAge))
      .filter(e => Math.abs(now - e.time) < 120 * 24 * HOUR)
      .sort((a, b) => b.time - a.time);
    if (list === 'world') state[list] = oneStoryEach(state[list]);
    state[list] = state[list].slice(0, list === 'incidents' ? Incidents.MAX : 220);
  }

  /* One story, one row. GDELT indexes every syndicated copy of an article —
     the same headline from a dozen local sites — and a newsroom and GDELT can
     carry the same report. Rows whose headlines are the same text are one
     story: the curated copy wins over a newsroom's, a newsroom's over GDELT's,
     and among equals the first report is kept, so "When" is when it was
     first seen reported. */
  const TIER_RANK = { curated: 0, reported: 1, unconfirmed: 2 };
  const headlineKey = text => String(text || '').toLowerCase().replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
  function oneStoryEach(list) {
    const best = new Map();
    for (const e of list) {
      const k = headlineKey(e.headline);
      const b = best.get(k);
      if (!b || (TIER_RANK[e.tier] ?? 2) < (TIER_RANK[b.tier] ?? 2)
          || ((TIER_RANK[e.tier] ?? 2) === (TIER_RANK[b.tier] ?? 2) && e.time < b.time)) best.set(k, e);
    }
    const keep = new Set(best.values());
    return list.filter(e => keep.has(e));
  }

  /* What is war. A curated event is filed by Wikipedia's editors under "Armed
     conflicts and attacks"; anything else is tested against these words, and
     the list is here to be read and argued with. */
  const CONFLICT = /\b(wars?|warfare|air ?strikes?|missiles?|drones? (?:strikes?|attacks?)|shelling|artillery|offensive|counteroffensive|troops|soldiers|militar(?:y|ies)|army|rebels?|militias?|insurgen\w*|jihadis\w*|ceasefire|truce|invasion|invade[sd]?|bombard\w*|bombing|front ?line|hostages?|armed (?:group|forces)|clashes|fighting|siege|annex\w*|mobili[sz]ation|martial law|genocide|war crimes?|killed in (?:an? )?(?:attack|strike|raid)|raids?|gunmen|fighter jets?|navy|naval)\b/i;
  const topicOf = (text, category) => /armed conflict|attacks/i.test(category || '') || CONFLICT.test(text) ? 'CONFLICT' : '';

  /* ── Memory across restarts ───────────────────────────────────────────
     Without it every refresh began from nothing, and every source was asked
     again at once. Launch Library allows fifteen requests an hour, so a few
     refreshes were enough for it to refuse, and the launches vanished from
     Discovery until the hour turned over. The last good reading of every stream is kept in this
     browser, and a stream whose reading is still within its own interval is
     not asked again early. Storage may be unavailable; everything below works
     without it and simply starts cold. */
  const STORE = 'temporal-live:wire:v1';
  const fresh = {};         // stream → the moment of its last good reading
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        lists: { realization: state.realization, world: state.world, discovery: state.discovery, incidents: state.incidents },
        fresh
      }));
    } catch { /* storage full or refused — the next load starts cold */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const d = JSON.parse(raw);
      for (const k of ['realization', 'world', 'discovery', 'incidents'])
        if (d.lists && Array.isArray(d.lists[k])) state[k] = d.lists[k];
      // The "In the news" box is no longer read; its remembered stories carried
      // invented times and go with it.
      state.world = oneStoryEach(state.world.filter(e => e.source !== 'itn')
        .map(e => ({ ...e, tier: e.tier || (e.confirmed ? 'curated' : 'unconfirmed'),
                     topic: e.topic ?? topicOf(e.headline, e.detail) })));
      Object.assign(fresh, d.fresh || {});
    } catch { /* unreadable — start cold */ }
  }
  load();

  /* ── Realization · orbital launches ───────────────────────────────────
     Launch Library carries every orbital attempt with the exact moment of
     lift-off, and says whether it succeeded. Upcoming launches are included
     because a launch an hour away is a realization about to happen and the
     clock is the point of this instrument. */
  async function readLaunches() {
    const [prev, next] = await Promise.all([
      Net.json('https://ll.thespacedevs.com/2.3.0/launches/previous/?limit=12&mode=list&ordering=-net'),
      Net.json('https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=6&mode=list')
    ]);
    /* The two endpoints overlap: a launch that has just happened is in both
       "previous" and "upcoming" for a while, and without this it appeared
       twice in the wire, once marked AHEAD and once not. The first wins, and
       "previous" is read first because it knows the outcome. */
    const items = [], seen = new Set();
    for (const [set, ahead] of [[prev, false], [next, true]])
      for (const r of (set.results || [])) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const t = Date.parse(r.net);
        if (!Number.isFinite(t)) continue;
        const status = (r.status && (r.status.abbrev || r.status.name)) || '';
        items.push({
          id: 'launch:' + r.id, source: 'launches', kind: 'LAUNCH',
          headline: (r.name || '').split('|')[0].trim(),
          detail: (r.name || '').split('|').slice(1).join('|').trim(),
          place: (r.pad && r.pad.location && r.pad.location.name) || '',
          status, ahead: t > Date.now(), time: t,
          level: /fail/i.test(status) ? 'red' : t > Date.now() ? 'amber' : 'green'
        });
      }
    merge('realization', 'launches', items);
  }

  /* ── Realization and discovery · agency newsrooms ─────────────────────
     NASA publishes cross-origin, so the browser reads it directly; ESA does
     not and goes through the proxy. Items that announce a thing existing —
     a launch, a first light, an arrival — are realization; the rest is
     discovery. The test is crude and deliberately visible in the code. */
  const REALIZED = /\b(launch|launches|launched|lift-?off|first light|arriv|dock|land(ed|ing)?|deploy|switch(ed)? on|online|commission|complete[ds]?|achiev|record|milestone|begins? operations?)\b/i;

  async function readAgency(key, url, viaProxy) {
    const items = await Net.feed(url, viaProxy ? { tail: 120000 } : {});
    const mapped = items.filter(i => i.time).map((i, n) => ({
      id: `${key}:${i.link || i.title}:${n}`, source: key,
      kind: REALIZED.test(i.title) ? 'BUILT' : 'FOUND',
      headline: strip(i.title), detail: strip(i.summary).slice(0, 190),
      place: key.toUpperCase(), link: i.link, time: i.time, level: 'green'
    }));
    merge('realization', key, mapped.filter(i => i.kind === 'BUILT'));
    merge('discovery', key, mapped);
  }

  /* ── World · the curated spine ────────────────────────────────────────
     Wikipedia's Current events portal: one page per UTC day, fifteen to
     twenty-five events on each, every one written by an editor and cited to
     an outlet — it is the pool the "In the news" box is drawn from. That
     editorial bar is the threshold rule, already applied by someone
     accountable for it.

     It replaced the "In the news" box, which carries four stories, for today
     only, with no time on any of them. The box was why World so often showed
     four items, and why their time was whenever the page was last opened.
     Every event here is filed under the date it happened, so that date is its
     time — shown as a date, not as an invented hour. */
  const EVENT_DAYS = 3, EVENT_KEEP = 10 * 24 * HOUR;
  const storyKey = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function eventsOfDay(html, dayStart) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.querySelector('.current-events-content');
    if (!root) return [];
    const out = [];
    let category = '';
    for (const node of root.children) {
      if (node.tagName === 'P' && node.querySelector('b')) { category = node.textContent.trim(); continue; }
      if (node.tagName !== 'UL') continue;
      // An event is a list item with nothing nested under it; the items above
      // it are the story it belongs to ("Russo-Ukrainian war" › "Kursk").
      for (const li of node.querySelectorAll('li')) {
        if (li.querySelector('ul')) continue;
        const cites = li.querySelectorAll('a.external');
        const cite = cites[cites.length - 1];
        let text = li.textContent.replace(/\s+/g, ' ').trim();
        let outlet = '';
        if (cite) {
          outlet = cite.textContent.replace(/[()]/g, '').trim();
          text = text.replace(cite.textContent.trim(), '').trim();
        }
        if (text.length < 25) continue;
        const parent = li.parentElement && li.parentElement.closest('li');
        const story = parent ? ((parent.querySelector('a') || parent).textContent || '').trim() : '';
        out.push({
          id: 'cev:' + dayStart + ':' + storyKey(text).slice(0, 60), source: 'events', kind: 'WORLD',
          headline: text, detail: [category, story].filter(Boolean).join(' · '),
          place: outlet || 'Wikipedia', confirmed: true, tier: 'curated', topic: topicOf(text, category),
          link: cite ? cite.getAttribute('href') : '',
          time: dayStart, dayOnly: true, level: 'green'
        });
      }
    }
    return out;
  }

  async function readEvents() {
    const today = Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR;
    const days = Array.from({ length: EVENT_DAYS }, (_, i) => today - i * 24 * HOUR);
    /* One page at a time, a moment apart: Wikimedia refuses bursts, and three
       requests at once was enough to lose one of them (measured). A day that
       fails is simply read again next time; what earlier reads found stays. */
    const items = [];
    for (const [i, t] of days.entries()) {
      if (i) await new Promise(r => setTimeout(r, 1500));
      const d = new Date(t);
      const title = `Portal:Current_events/${d.getUTCFullYear()}_${MONTHS[d.getUTCMonth()]}_${d.getUTCDate()}`;
      try {
        const page = await Net.json(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}`
          + '&prop=text&format=json&formatversion=2&origin=*');
        // Today's page may not exist yet in the first hours of the UTC day.
        if (page && page.parse) items.push(...eventsOfDay(page.parse.text, t));
      } catch { /* refused or missing — the other days still count */ }
    }
    if (!items.length) throw new Error('no curated events');
    accumulate('world', 'events', items, EVENT_KEEP);
  }

  /* ── World · the uncurated supplement ─────────────────────────────────
     GDELT reaches the same events hours earlier and in a hundred languages,
     but it returns articles rather than events, so an item here is one
     outlet's report and nothing more. It is marked unconfirmed and says so on
     the page. One request per five seconds per visitor is GDELT's limit. */
  async function readGdelt() {
    const q = encodeURIComponent('(ceasefire OR "state of emergency" OR resigns OR "sworn in" OR coup OR airstrike OR invasion OR offensive OR "missile strike" OR "drone strike" OR shelling) sourcelang:eng');
    const d = await Net.json(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=40&format=json&timespan=24h&sort=datedesc`);
    const items = (d.articles || []).map((a, i) => {
      const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(a.seendate || '');
      const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
      return {
        id: 'gdelt:' + (a.url || i), source: 'gdelt', kind: 'WORLD',
        headline: strip(a.title), detail: '', place: a.sourcecountry || a.domain || '',
        confirmed: false, tier: 'unconfirmed', topic: topicOf(strip(a.title)), link: a.url, time: t, level: 'amber'
      };
    }).filter(i => i.time && i.headline);
    // GDELT refuses often and sometimes answers with nothing. Neither may
    // empty the page: its articles stay for three days whatever it says next.
    accumulate('world', 'gdelt', items, 3 * 24 * HOUR);
  }

  /* ── World · war, from newsrooms ─────────────────────────────────────
     The curated portal is a day behind and GDELT is anyone. Between them sit
     newsrooms with foreign desks, read for armed conflict only: Al Jazeera
     and BBC World, filtered by the conflict words above, and UN News's
     "Peace and Security" desk, which is conflict by definition. Each item is
     one named newsroom's report — marked REPORTED, a step above GDELT and
     below the curated portal. Items stay four days (UN News posts a few times a week).

     The same feeds are also read for one other thing: reports of an AI system
     escaping the control of the people running it (see AI_ESCAPE). Those go
     to the AI incident list, not to World. */
  const NEWSROOMS = [
    { key: 'aljazeera', outlet: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', all: false },
    { key: 'bbc',       outlet: 'BBC News',   url: 'https://feeds.bbci.co.uk/news/world/rss.xml', all: false },
    { key: 'unnews',    outlet: 'UN News',    url: 'https://news.un.org/feed/subscribe/en/news/topic/peace-and-security/feed/rss.xml', all: true }
  ];
  // What makes a report a containment report: lib/incidents.js, shared with
  // the website's server so both apply the same test.
  const AI_ESCAPE = Incidents.AI_ESCAPE;
  async function readNewsrooms() {
    const reads = await Promise.allSettled(NEWSROOMS.map(n => Net.feed(n.url)));
    if (reads.every(r => r.status === 'rejected')) throw reads[0].reason;
    const war = [], ai = [];
    reads.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const n = NEWSROOMS[i];
      ai.push(...Incidents.fromNewsroom(r.value, n.outlet));
      for (const it of r.value) {
        if (!it.time || !it.link) continue;
        const headline = strip(it.title), summary = strip(it.summary);
        if (!n.all && !CONFLICT.test(headline + ' ' + summary.slice(0, 160))) continue;
        war.push({ id: 'nr:' + it.link, source: 'newsroom', kind: 'WORLD', headline, detail: summary.slice(0, 220),
                   place: n.outlet, confirmed: false, tier: 'reported', topic: 'CONFLICT',
                   link: it.link, time: it.time, level: 'amber' });
      }
    });
    accumulate('world', 'newsroom', war, 4 * 24 * HOUR);
    if (ai.length) accumulate('incidents', 'newsroom', ai, 60 * 24 * HOUR);
  }

  /* ── Discovery · arXiv ────────────────────────────────────────────────
     The newest preprints in the fields this instrument already touches:
     high-energy astrophysics, cosmology, general relativity, instrumentation
     and climate physics. Preprints, not results — labelled as such. */
  const ARXIV_CATS = 'cat:astro-ph.HE+OR+cat:astro-ph.CO+OR+cat:gr-qc+OR+cat:astro-ph.IM+OR+cat:physics.ao-ph';
  async function readArxiv() {
    const items = await Net.feed(
      `https://export.arxiv.org/api/query?search_query=${ARXIV_CATS}&sortBy=submittedDate&sortOrder=descending&max_results=25`);
    merge('discovery', 'arxiv', items.filter(i => i.time).map((i, n) => ({
      id: 'arxiv:' + (i.link || n), source: 'arxiv', kind: 'PREPRINT',
      headline: strip(i.title), detail: strip(i.summary).slice(0, 200),
      place: 'arXiv · preprint', link: i.link, time: i.time, level: 'green'
    })));
  }

  /* ── Discovery · peer-reviewed papers ─────────────────────────────────
     The newest research articles from a short list of flagship journals,
     read through Crossref, which every publisher deposits to. Crossref also
     carries news, editorials and corrections under the same type, so an item
     counts as a paper only when it looks like one: Springer Nature research
     DOIs (10.1038/s4…; its news is d4…), APS letters (10.1103/…), or any item
     with a deposited abstract. Corrections and retractions are dropped. No
     journal may take more than PER_JOURNAL rows, or Physical Review Letters
     — forty a week — would bury the rest.                                    */
  const JOURNALS = [
    '0028-0836', '1476-4687',   // Nature
    '0036-8075', '1095-9203',   // Science
    '0092-8674', '1097-4172',   // Cell
    '0027-8424', '1091-6490',   // PNAS
    '1745-2473', '1745-2481',   // Nature Physics
    '2397-3366',                // Nature Astronomy
    '0031-9007', '1079-7114',   // Physical Review Letters
    '1078-8956', '1546-170X',   // Nature Medicine
    '2662-8465',                // Nature Aging
    '1550-4131', '1932-7420',   // Cell Metabolism
    '1758-678X', '1758-6798'    // Nature Climate Change
  ];
  const PER_JOURNAL = 8;
  const NOT_A_PAPER = /^(author correction|publisher correction|correction|retraction|erratum|editorial expression|daily briefing)/i;
  const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
  const dayOf = parts => parts && parts[0] ? Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1) : null;

  async function readPapers() {
    const since = isoDay(Date.now() - 14 * 24 * HOUR);
    const filter = JOURNALS.map(i => 'issn:' + i).join(',') + `,from-online-pub-date:${since},type:journal-article`;
    const r = await Net.json(`https://api.crossref.org/works?filter=${filter}&sort=published&order=desc&rows=200`
      + '&select=DOI,title,container-title,published,published-online,abstract,author');
    const perJournal = {};
    const items = [];
    for (const w of (r.message && r.message.items) || []) {
      const title = strip((w.title || [])[0]);
      const journal = strip((w['container-title'] || [])[0]);
      const doi = String(w.DOI || '');
      const looksResearch = /^10\.1038\/s4/.test(doi) || /^10\.1103\//.test(doi) || !!w.abstract;
      if (!title || !journal || !looksResearch || NOT_A_PAPER.test(title)) continue;
      if ((perJournal[journal] = (perJournal[journal] || 0) + 1) > PER_JOURNAL) continue;
      const parts = (w['published-online'] || w.published || {})['date-parts'];
      const time = dayOf(parts && parts[0]);
      if (!time || time > Date.now()) continue;
      const authors = w.author || [];
      const lead = authors[0] ? (authors[0].family || authors[0].name || '').replace(/^anonymous$/i, '') : '';
      const abstract = strip(w.abstract).replace(/^abstract\s*/i, '');
      items.push({
        id: 'paper:' + doi.toLowerCase(), source: 'papers', kind: 'PAPER',
        headline: title,
        detail: (abstract || (lead ? `${lead}${authors.length > 1 ? ' et al.' : ''}` : '')).slice(0, 220),
        summary: abstract.slice(0, 900),
        place: `${journal} · peer-reviewed`, link: 'https://doi.org/' + doi,
        time, dayOnly: true, level: 'green', reviewed: true
      });
    }
    merge('discovery', 'papers', items);
  }

  /* ── Discovery · longevity escape velocity ─────────────────────────────
     LEV is the point at which medicine adds more than a year of remaining
     life expectancy per year that passes. Nothing measures it directly; what
     can be followed is the work that would get there — interventions that
     slow, stop or reverse ageing. Two streams:

     1. Peer-reviewed: Europe PMC (PubMed-indexed, so every item has passed
        review), titles about ageing, in the journals where the field's
        results land. Comments, news, errata and corrections are dropped;
        reviews stay but are marked as reviews.
     2. Reported: Lifespan.io's newsroom (Lifespan Research Institute),
        which follows the field full-time. Press releases are dropped.

     A result is called a breakthrough by its own title, not by anyone's
     opinion of it: it says an intervention extended lifespan or healthspan,
     rejuvenated or reversed ageing, cleared senescent cells, or reprogrammed
     cells younger. The test is crude and deliberately visible here. What it
     was shown in — cells, invertebrates, mice, primates, people — is read
     from the title and abstract and stated alongside, because a lifespan
     record in worms and one in people are not the same news.               */
  const LEV_JOURNALS = ['Nature', 'Science', 'Cell', 'Nat Aging', 'Nat Med', 'Cell Metab', 'Aging Cell',
    'Geroscience', 'Nat Commun', 'Sci Transl Med', 'Cell Stem Cell', 'Lancet Healthy Longev',
    'Proc Natl Acad Sci U S A', 'Aging (Albany NY)', 'Ageing Res Rev', 'Nat Biotechnol'];
  const LEV_TERMS = ['aging', 'ageing', 'longevity', 'lifespan', 'healthspan', 'senolytic*', 'senescen*',
    'rejuvenat*', '"epigenetic clock"', '"biological age"', 'reprogramming', 'geroprotect*'];
  const LEV_QUERY = `(${LEV_TERMS.map(t => 'TITLE:' + t).join(' OR ')}) AND SRC:MED AND (${LEV_JOURNALS.map(j => `JOURNAL:"${j}"`).join(' OR ')})`;
  const NOT_RESEARCH = /news|comment|editorial|erratum|correction|retract|letter|interview/i;
  const BREAKTHROUGH = new RegExp([
    '(extend|prolong|increas|lengthen)\\w* (the )?(median |maximal |maximum |mean |overall )?(life|health)[ -]?span',
    '(life|health)[ -]?span extension',
    'rejuvenat\\w*', 'de-?ag(e|ing)\\b', 'revers\\w* (of )?(\\w+ ){0,3}(aging|ageing|age\\b)',
    '(aging|ageing) revers\\w*', 'younger', 'senolytic', 'partial reprogramming',
    '(slow|delay|decelerat)\\w* (\\w+ ){0,2}(aging|ageing)'
  ].join('|'), 'i');
  const MODELS = [
    [4, 'people', /\b(in humans|patients|participants|volunteers|individuals|people|adults|older (adults|women|men)|randomi[sz]ed|clinical trial|phase (i|ii|iii|1|2|3)\b|cohort)/i],
    [3, 'primates', /\b(primates?|monkeys?|macaques?|marmosets?)\b/i],
    [2, 'mice', /\b(mice|mouse|murine|rats?)\b/i],
    [1, 'invertebrates', /\b(worms?|elegans|flies|drosophila|yeast|killifish|nematodes?)\b/i],
    [0, 'cells', /\b(cells?|organoids?|in vitro)\b/i]
  ];
  // The highest model the work reports, from the title first, then the abstract.
  // "Non-human primates" are primates, and "human blood cells" are cells:
  // both are rewritten before the test, so neither reads as work in people.
  const plainModel = text => String(text || '')
    .replace(/non-?human primates?/gi, 'primates')
    .replace(/\bhuman(-derived)? (\w+ ){0,2}(cells?|organoids?|tissues?|fibroblasts?|neurons?|oocytes?|samples?)\b/gi, 'cells');
  // An abstract mentions people for context ("in older adults, …") far more
  // often than it reports work in them, so from the abstract only a study's
  // own words count: patients, participants, volunteers, a trial, a cohort.
  const PEOPLE_STUDIED = /\b(patients|participants|volunteers|randomi[sz]ed|clinical trial|cohort)\b/i;
  function modelOf(title, abstract) {
    const fromTitle = MODELS.find(([, , re]) => re.test(plainModel(title)));
    if (fromTitle) return { rank: fromTitle[0], name: fromTitle[1] };
    const text = plainModel(abstract);
    const hit = MODELS.find(([rank, , re]) => rank === 4 ? PEOPLE_STUDIED.test(text) : re.test(text));
    return hit ? { rank: hit[0], name: hit[1] } : { rank: -1, name: '' };
  }
  const levItem = (fields, title, abstract) => {
    const model = modelOf(title, abstract);
    // A monthly roundup names rejuvenation in its title without being a result.
    const breakthrough = BREAKTHROUGH.test(title) && !/round-?up|digest|newsletter|interview|podcast/i.test(title);
    return { ...fields, kind: 'LEV', breakthrough, model: model.name, modelRank: model.rank,
             level: breakthrough ? 'amber' : 'green' };
  };

  async function readLevPapers() {
    const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=40'
      + '&sort=' + encodeURIComponent('P_PDATE_D desc') + '&query=' + encodeURIComponent(LEV_QUERY);
    const r = await Net.json(url);
    const items = [];
    for (const p of (r.resultList && r.resultList.result) || []) {
      const types = ((p.pubTypeList && p.pubTypeList.pubType) || []).join(' ');
      if (NOT_RESEARCH.test(types)) continue;
      const time = p.firstPublicationDate ? Date.parse(p.firstPublicationDate + 'T00:00:00Z') : null;
      if (!time || time > Date.now()) continue;
      const title = strip(p.title).replace(/\.$/, '');
      const abstract = strip(p.abstractText);
      const j = (p.journalInfo && p.journalInfo.journal) || {};
      // Europe PMC gives the full title in sentence case ("Aging cell"); the
      // abbreviation is used when the full title is a sentence long.
      const full = String(j.title || p.journalTitle || 'Journal').replace(/\.$/, '')
        .replace(/\b([a-z])(\w*)/g, (w, a, b) => /^(of|and|the|in|for|on)$/.test(w) ? w : a.toUpperCase() + b);
      const journal = full.length > 34 && j.isoabbreviation ? j.isoabbreviation : full;
      const review = /review/i.test(types);
      items.push(levItem({
        id: 'lev:' + (p.doi ? p.doi.toLowerCase() : p.id), source: 'lev-papers',
        headline: title, detail: abstract.slice(0, 220), summary: abstract.slice(0, 900),
        place: `${journal} · peer-reviewed${review ? ' review' : ''}`,
        link: p.doi ? 'https://doi.org/' + p.doi : `https://europepmc.org/article/${p.source}/${p.id}`,
        time, dayOnly: true, reviewed: true, review
      }, review ? '' : title, abstract));
    }
    merge('discovery', 'lev-papers', items);
  }

  async function readLevNews() {
    const items = await Net.feed('https://lifespan.io/feed/');
    const mapped = items.filter(i => i.time && !(i.categories || []).some(c => /press release/i.test(c)))
      .map(i => levItem({
        id: 'levnews:' + (i.link || i.title), source: 'lev-news',
        headline: strip(i.title), detail: strip(i.summary).slice(0, 220),
        place: 'Lifespan.io · reported', link: i.link, time: i.time, reviewed: false
      }, strip(i.title), strip(i.summary)));
    accumulate('discovery', 'lev-news', mapped, 60 * 24 * HOUR);
  }

  /* The latest breakthrough, for the line at the top of Discovery: the newest
     peer-reviewed breakthrough shown in a mammal or in people within the last
     month (on the same day, the stronger model wins); failing that, the newest peer-reviewed breakthrough of any kind;
     failing that, the newest reported one. */
  function levLatest() {
    // Newest first; on the same day, the stronger model first.
    const lev = state.discovery.filter(e => e.kind === 'LEV' && e.breakthrough && !e.review)
      .sort((a, b) => b.time - a.time || (b.modelRank ?? -1) - (a.modelRank ?? -1));
    const month = Date.now() - 31 * 24 * HOUR;
    return lev.find(e => e.reviewed && e.modelRank >= 2 && e.time >= month)
      || lev.find(e => e.reviewed) || lev[0] || null;
  }

  /* ── AI incidents ─────────────────────────────────────────────────────
     The AI Incident Database collects reports of AI systems causing or nearly
     causing harm in the world — each entry a news report attached to a
     catalogued incident. It is the closest thing to a live record of AI going
     wrong, and unlike a risk index it is a list of things that happened.
     Its feed carries stub entries with no title or link; those are dropped. */
  async function readIncidents() {
    accumulate('incidents', 'aiid', Incidents.fromAiid(await Net.feed(Incidents.AIID_URL)), Incidents.KEEP_MS);
  }

  /* ── The shared memory ────────────────────────────────────────────────
     A feed holds only its newest items: Al Jazeera's last 25 stories cover
     about four hours. A reader that was not running in those hours never sees
     what passed through, so each copy of the instrument used to know only
     what it had itself been open for. The website keeps one record of AI
     incidents on its server (web/api/memory.js): the server reads the same
     feeds whenever the site is visited, and the desktop app, given the key in
     Settings, adds everything it has read. Every copy reads that record and
     merges it into its own. Without the key the desktop app still reads it. */
  const MEMORY_KEY = 'temporal-live:memory-key';
  const memoryMeta = typeof document !== 'undefined' && document.querySelector('meta[name="sm-memory"]');
  const hasMemory = !!((typeof window !== 'undefined' && window.desktop) || memoryMeta);
  async function readShared() {
    let data;
    if (window.desktop) {
      if (!window.desktop.memory) throw new Error(Net.STALE_RUNTIME);
      let key = '';
      try { key = localStorage.getItem(MEMORY_KEY) || ''; } catch { /* no key */ }
      const own = key ? state.incidents.filter(e => e.source === 'aiid' || e.source === 'newsroom') : null;
      const r = await window.desktop.memory(own, key);
      if (r.error) throw new Error(r.error);
      data = r.data;
    } else {
      if (Net.paused) throw new Error(Net.PAUSED_ERR);
      const res = await fetch(memoryMeta.content);
      if (!res.ok) {
        let why = 'HTTP ' + res.status;
        try { why = (await res.json()).error || why; } catch { /* keep the status */ }
        throw new Error(why);
      }
      data = await res.json();
    }
    const list = (data && Array.isArray(data.incidents) ? data.incidents : []).map(e => Incidents.clean(e)).filter(Boolean);
    accumulate('incidents', 'shared', list, Incidents.KEEP_MS);
  }
  // The key field in Settings (desktop only: the website only reads).
  function wireKeyField() {
    const input = document.getElementById('memory-key'), row = document.getElementById('memory-key-row');
    if (!input || !row) return;
    if (!window.desktop) { row.hidden = true; return; }
    try { input.value = localStorage.getItem(MEMORY_KEY) || ''; } catch { /* none */ }
    input.addEventListener('change', () => {
      const v = input.value.trim();
      try { v ? localStorage.setItem(MEMORY_KEY, v) : localStorage.removeItem(MEMORY_KEY); } catch { /* storage refused */ }
      const st = document.getElementById('memory-key-status');
      if (st) st.textContent = v ? 'Saved. Sending what this app has read…' : 'Removed. The app still reads the shared record.';
      const s = STREAMS.find(x => x.key === 'shared');
      if (s) run(s).then(() => {
        const h = state.sources.shared;
        if (st && v) st.textContent = h.status === 'live' && h.at > Date.now() - 60000
          ? 'Saved. This app’s incidents are in the shared record.' : `Saved, but the record answered: ${h.note || 'no answer'}`;
      });
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireKeyField);
    else wireKeyField();
  }

  /* ── Scheduler ─────────────────────────────────────────────────────── */
  const STREAMS = [
    // Two requests a read, and Launch Library allows fifteen an hour: every
    // twenty minutes is six, which leaves room for the app and the site at once.
    { key: 'launches',  label: 'LAUNCHES',  every: 20 * MIN, read: readLaunches },
    { key: 'nasa',      label: 'NASA',      every: 20 * MIN, read: () => readAgency('nasa', 'https://www.nasa.gov/feed/', false) },
    { key: 'esa',       label: 'ESA',       every: 30 * MIN, read: () => readAgency('esa', 'https://www.esa.int/rssfeed/Our_Activities/Space_Science', true) },
    { key: 'events',    label: 'WORLD',     every: 30 * MIN, read: readEvents },
    { key: 'gdelt',     label: 'GDELT',     every: 15 * MIN, read: readGdelt },
    { key: 'newsroom',  label: 'WAR DESKS', every: 15 * MIN, read: readNewsrooms },
    { key: 'arxiv',     label: 'ARXIV',     every: 60 * MIN, read: readArxiv },
    { key: 'papers',    label: 'PEER-REVIEWED', every: 120 * MIN, read: readPapers },
    { key: 'lev-papers', label: 'LEV · PAPERS', every: 60 * MIN, read: readLevPapers },
    { key: 'lev-news',  label: 'LEV · NEWS', every: 60 * MIN, read: readLevNews },
    { key: 'aiid',      label: 'AI INCIDENTS', every: 60 * MIN, read: readIncidents },
    ...(hasMemory ? [{ key: 'shared', label: 'SHARED RECORD', every: 10 * MIN, read: readShared }] : [])
  ];
  for (const s of STREAMS) state.sources[s.key] = { label: s.label, status: 'waiting', at: null, failures: 0, note: '' };

  async function run(stream) {
    const h = state.sources[stream.key];
    try {
      await stream.read();
      h.status = 'live'; h.at = Date.now(); h.failures = 0; h.note = '';
      fresh[stream.key] = h.at;
      save();
    } catch (error) {
      h.failures += 1;
      h.status = h.at ? 'stale' : 'unreachable';
      h.note = String(error.message || error).slice(0, 60);
    }
    emit();
  }
  function schedule(stream) {
    const h = state.sources[stream.key];
    const wait = h.failures ? Math.min(stream.every * Math.pow(2, h.failures), 2 * HOUR) : stream.every;
    setTimeout(async () => { await run(stream); schedule(stream); }, wait + Math.random() * 4000);
  }
  function start() {
    // A stream read within its own interval is not asked again on a restart:
    // the remembered reading is what a new request would return, and asking
    // anyway is how Launch Library's hourly allowance was being spent. The
    // rest are staggered by six seconds, because GDELT refuses more than one
    // request every five and there is no reason to crowd the others either.
    let slot = 0;
    for (const s of STREAMS) {
      const age = fresh[s.key] ? Date.now() - fresh[s.key] : Infinity;
      if (age < s.every) {
        const h = state.sources[s.key];
        h.status = 'live'; h.at = fresh[s.key];
        setTimeout(async () => { await run(s); schedule(s); }, s.every - age + Math.random() * 4000);
      } else {
        setTimeout(async () => { await run(s); schedule(s); }, 900 + slot++ * 6000);
      }
    }
    emit();
  }

  return { state, start, onUpdate, levLatest, CONFLICT, AI_ESCAPE, BREAKTHROUGH };
})();
