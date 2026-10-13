/* ── AI incidents: one definition, three readers ─────────────────────────────
   The AI page lists reports of AI systems causing harm, and raises the
   containment alert when one describes a system acting outside its operators'
   control. This file holds what makes an item an incident, and is read by:
     · the page (wire.js), in the desktop app and on the website;
     · the website's shared memory (web/api/memory.js), which reads the same
       feeds on the server and keeps what any reader has seen, so a story that
       was in a feed for four hours is not lost to whoever was not watching.
   It is a plain script in the page (a global, Incidents) and a CommonJS module
   on the server. web/api/_lib/incidents.cjs is a copy of it; the website's
   build refuses to run if the two differ.                                   */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Incidents = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000;
  // How long an incident is kept, and the most kept at once.
  const KEEP_MS = 60 * DAY, MAX = 400;

  const AIID_URL = 'https://incidentdatabase.ai/rss.xml';
  // The newsrooms read for the containment test (wire.js reads them for war too).
  const NEWSROOMS = [
    { key: 'aljazeera', outlet: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { key: 'bbc',       outlet: 'BBC News',   url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { key: 'unnews',    outlet: 'UN News',    url: 'https://news.un.org/feed/subscribe/en/news/topic/peace-and-security/feed/rss.xml' }
  ];

  /* A system acting outside its operators' control. The words are here to be
     read and argued with. */
  const AI_ESCAPE = /(self[- ]?exfiltrat\w*|exfiltrat\w* (?:its|their) (?:own )?weights|escap\w* (?:its |the |their )?(?:sandbox|containment|confinement|lab)|self[- ]?replicat\w*|autonomous(?:ly)? replicat\w*|copied (?:itself|its (?:own )?weights)|loss of control (?:of|over) (?:an? )?ai|(?:evad|resist|sabotag)\w* (?:its )?shut ?down|disabl\w* (?:its )?oversight)/i;

  const strip = html => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  /* Feed items ({title, summary, link, time}) to incidents. The AI Incident
     Database's feed carries stub entries with no title or link; those are
     dropped. */
  function fromAiid(items) {
    return items.filter(i => i.time && i.link && !/^no title$/i.test(i.title)).map(i => {
      let outlet = 'AIID';
      try { outlet = new URL(i.link).hostname.replace(/^www\./, ''); } catch { /* keep AIID */ }
      return {
        id: 'aiid:' + i.link, source: 'aiid', kind: 'INCIDENT',
        headline: strip(i.title), detail: strip(i.summary).slice(0, 190),
        place: outlet, link: i.link, time: i.time, level: 'amber',
        escape: AI_ESCAPE.test(i.title + ' ' + i.summary)
      };
    });
  }
  // From a newsroom, only the containment reports are incidents.
  function fromNewsroom(items, outlet) {
    const out = [];
    for (const it of items) {
      if (!it.time || !it.link) continue;
      const headline = strip(it.title), summary = strip(it.summary);
      if (!AI_ESCAPE.test(headline + ' ' + summary)) continue;
      out.push({ id: 'nr:' + it.link, source: 'newsroom', kind: 'INCIDENT', headline, detail: summary.slice(0, 190),
                 place: outlet, link: it.link, time: it.time, level: 'amber', escape: true });
    }
    return out;
  }

  /* An incident as the shared memory accepts it: the known fields only, each
     of the right kind and length, and its id derived from its link — so a
     story is one row however many readers send it. Anything else is null. */
  function clean(e, now = Date.now()) {
    if (!e || typeof e !== 'object') return null;
    const source = e.source === 'aiid' ? 'aiid' : e.source === 'newsroom' ? 'newsroom' : null;
    const link = typeof e.link === 'string' ? e.link.trim() : '';
    const time = Number(e.time);
    if (!source || !/^https?:\/\/[^\s]{4,600}$/.test(link) || !Number.isFinite(time)) return null;
    if (now - time > KEEP_MS || time - now > DAY) return null;
    const text = (v, n) => strip(typeof v === 'string' ? v : '').slice(0, n);
    const headline = text(e.headline, 300);
    if (!headline) return null;
    return {
      id: (source === 'aiid' ? 'aiid:' : 'nr:') + link, source, kind: 'INCIDENT',
      headline, detail: text(e.detail, 300), place: text(e.place, 80) || 'AIID',
      link, time, level: 'amber', escape: e.escape === true
    };
  }

  // One list from several: one row per id, the newest first, none older than
  // the keep. Where two readers carry the same story, the later copy wins.
  function merge(...lists) {
    const now = Date.now(), byId = new Map();
    for (const list of lists) for (const e of list || []) if (e && e.id) byId.set(e.id, e);
    return [...byId.values()].filter(e => now - e.time < KEEP_MS && e.time - now < DAY)
      .sort((a, b) => b.time - a.time).slice(0, MAX);
  }

  return { AI_ESCAPE, AIID_URL, NEWSROOMS, KEEP_MS, MAX, strip, fromAiid, fromNewsroom, clean, merge };
});
