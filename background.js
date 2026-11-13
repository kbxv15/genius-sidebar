// Fetches from genius.com on behalf of the YouTube Music tab (the extension has host permission for
// genius.com only, so these requests aren't blocked by the browser's cross-site rules).
// Returns compact JSON; the lyrics page HTML is parsed and sanitised in the content script.
'use strict';

const BASE = 'https://genius.com';
const cache = new Map(); // short-lived memory cache while the service worker is alive

// Cookie-less first; if Genius's bot check turns that away, retry with the browser's own genius.com
// cookies (the same as visiting the site), which carry any check it has already passed.
async function get(path, accept) {
  let res = await fetch(BASE + path, { credentials: 'omit', headers: { Accept: accept } });
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    res = await fetch(BASE + path, { credentials: 'include', headers: { Accept: accept } });
  }
  if (!res.ok) throw new Error(res.status === 403 ? 'Genius blocked the request. Open genius.com once in this browser, then try again.' : `Genius returned ${res.status}`);
  return res;
}
async function getJSON(path) {
  return (await get(path, 'application/json')).json();
}

function names(list) {
  return (list || []).map((a) => a && a.name).filter(Boolean);
}

function compactHit(r) {
  return {
    id: r.id,
    title: r.title || '',
    titleWithFeatured: r.title_with_featured || r.title || '',
    artist: (r.primary_artist && r.primary_artist.name) || r.primary_artist_names || '',
    artists: r.artist_names || '',
    path: r.path || '',
    url: r.url || (r.path ? BASE + r.path : ''),
    art: r.song_art_image_thumbnail_url || r.header_image_thumbnail_url || '',
    instrumental: !!r.instrumental,
    lyricsState: r.lyrics_state || '',
    release: r.release_date_for_display || '',
  };
}

const handlers = {
  async search({ q }) {
    const j = await getJSON(`/api/search/song?per_page=10&q=${encodeURIComponent(String(q).slice(0, 200))}`);
    const sec = (j.response && j.response.sections || []).find((s) => s.type === 'song') || (j.response && j.response.sections || [])[0];
    return (sec ? sec.hits : []).map((h) => compactHit(h.result));
  },

  async song({ id }) {
    const j = await getJSON(`/api/songs/${Number(id)}?text_format=html`);
    const s = j.response.song;
    const description = s.description && s.description.html || '';
    return {
      ...compactHit(s),
      art: s.song_art_image_url || s.song_art_image_thumbnail_url || '',
      description: /<\w/.test(description) && !/^\s*<p>\s*\?\s*<\/p>\s*$/.test(description) ? description : '',
      album: s.album ? { name: s.album.name, url: s.album.url } : null,
      writers: names(s.writer_artists),
      producers: names(s.producer_artists),
      featured: names(s.featured_artists),
      credits: (s.custom_performances || []).map((c) => ({ label: c.label, names: names(c.artists) })).filter((c) => c.label && c.names.length),
      pageviews: s.stats && s.stats.pageviews || null,
      annotationCount: s.annotation_count || 0,
      verifiedBy: names(s.verified_contributors && s.verified_contributors.map((v) => v.artist)),
    };
  },

  async referents({ songId }) {
    const out = [];
    let page = 1;
    while (page && page <= 10) {
      const j = await getJSON(`/api/referents?song_id=${Number(songId)}&per_page=50&page=${page}&text_format=html`);
      for (const r of j.response.referents || []) {
        out.push({
          id: r.id,
          fragment: r.fragment || '',
          isDescription: !!r.is_description,
          classification: r.classification || '',
          url: r.url || '',
          annotations: (r.annotations || []).map((a) => ({
            id: a.id,
            html: a.body && a.body.html || '',
            votes: a.votes_total || 0,
            verified: !!a.verified,
            state: a.state || '',
            url: a.url || a.share_url || '',
            authors: (a.authors || []).map((au) => au.user && (au.user.name || au.user.login)).filter(Boolean),
          })),
        });
      }
      page = j.response.next_page;
    }
    return out;
  },

  async page({ path }) {
    // only genius.com song pages
    if (!/^\/[A-Za-z0-9][A-Za-z0-9\-_.%]*-lyrics$/.test(path || '')) throw new Error('Not a Genius lyrics page');
    return (await get(path, 'text/html')).text();
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const h = msg && typeof msg.type === 'string' && msg.type.startsWith('genius:') && handlers[msg.type.slice(7)];
  if (!h) return false;
  const key = JSON.stringify(msg);
  let p = cache.get(key);
  if (!p) {
    p = h(msg);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  p.then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: String(e && e.message || e) }));
  return true;
});
