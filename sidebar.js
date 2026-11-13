// Genius tab for YouTube Music's player-page sidebar (Up next / Lyrics / Related …).
// Shows the current song's lyrics from Genius with annotated lines highlighted (click one to read its
// note), every note in a list, and the song's "About" text and credits. Content script (isolated world).
(() => {
  'use strict';
  if (window.__geniusSidebar) return;
  window.__geniusSidebar = true;

  const GENIUS = 'https://genius.com';

  // ───────── helpers ─────────
  function ask(type, payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'genius:' + type, ...payload }, (res) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (!res || !res.ok) return reject(new Error((res && res.error) || 'Request failed'));
          resolve(res.data);
        });
      } catch (e) { reject(e); }
    });
  }
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false && kid !== '') el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  const fmt = (n) => Number(n).toLocaleString();
  const storage = {
    get: (k) => new Promise((r) => { try { chrome.storage.local.get(k, (v) => r(v ? v[k] : undefined)); } catch { r(undefined); } }),
    set: (k, v) => { try { chrome.storage.local.set({ [k]: v }); } catch {} },
  };

  // ───────── sanitising Genius HTML ─────────
  // Content from genius.com is rebuilt node by node into a small set of safe elements; scripts,
  // styles, event handlers, iframes and unknown elements never make it into YouTube Music's page.
  function safeUrl(href, base) {
    try {
      const u = new URL(href, base || GENIUS);
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch { return ''; }
  }
  const BLOCK = { P: 'p', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote', H1: 'h4', H2: 'h4', H3: 'h4', H4: 'h4', H5: 'h4', H6: 'h4', HR: 'hr', PRE: 'pre' };
  const INLINE = { I: 'i', EM: 'i', B: 'b', STRONG: 'b', SMALL: 'small', CODE: 'code', SUP: 'sup', SUB: 'sub', U: 'u', S: 's', DEL: 's' };
  function sanitizeRich(node, out) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out.append(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'BR') { out.append(h('br')); continue; }
      if (tag === 'IMG') {
        const src = safeUrl(n.getAttribute('src') || '');
        if (src.startsWith('https:')) out.append(h('img', { src, alt: n.getAttribute('alt') || '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
        continue;
      }
      if (tag === 'A') {
        const href = safeUrl(n.getAttribute('href') || '');
        const a = href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }) : h('span');
        sanitizeRich(n, a);
        out.append(a);
        continue;
      }
      if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT' || tag === 'VIDEO' || tag === 'AUDIO') {
        const src = safeUrl(n.getAttribute('src') || '');
        if (src) out.append(h('p', null, h('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, 'Open embedded media ↗')));
        continue;
      }
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'SVG' || tag === 'svg' || tag === 'BUTTON' || tag === 'FORM' || tag === 'INPUT') continue;
      const mapped = BLOCK[tag] || INLINE[tag];
      if (mapped) {
        const el = h(mapped);
        if (mapped !== 'hr') sanitizeRich(n, el);
        out.append(el);
      } else {
        sanitizeRich(n, out); // div, span, etc.: keep the contents only
      }
    }
    return out;
  }
  // Parsing into a detached document never runs scripts or loads anything; nothing from it is
  // inserted directly. (Content scripts aren't bound by the page's Trusted Types rule, but fall back
  // to a pass-through policy in case a browser applies it.)
  let ttPolicy = null;
  function parseHTML(html) {
    const parser = new DOMParser();
    try { return parser.parseFromString(String(html || ''), 'text/html'); } catch (e) {
      if (!window.trustedTypes) throw e;
      ttPolicy = ttPolicy || window.trustedTypes.createPolicy('genius-sidebar-parse', { createHTML: (s) => s });
      return parser.parseFromString(ttPolicy.createHTML(String(html || '')), 'text/html');
    }
  }
  function richFragment(html) {
    return sanitizeRich(parseHTML(html).body, document.createDocumentFragment());
  }

  // Lyrics: plain text, line breaks, italics/bold, and the annotated fragments as buttons.
  const refIdOf = (href) => { const m = String(href || '').match(/^(?:https?:\/\/genius\.com)?\/(\d+)\//); return m ? m[1] : null; };
  function sanitizeLyrics(node, out) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const text = n.nodeValue;
        if (/^\s*\[[^\]\n]{1,80}\]\s*$/.test(text)) out.append(h('span', { class: 'gl-section', text: text.trim() }));
        else out.append(text);
        continue;
      }
      if (n.nodeType !== 1) continue;
      if (n.hasAttribute('data-exclude-from-selection')) continue;
      const tag = n.tagName;
      if (tag === 'BR') { out.append(h('br')); continue; }
      if (tag === 'A') {
        const id = refIdOf(n.getAttribute('href'));
        if (id) {
          const b = h('button', { type: 'button', class: 'gl-ref', 'data-ref': id, 'aria-expanded': 'false' });
          sanitizeLyrics(n, b);
          out.append(b);
        } else sanitizeLyrics(n, out);
        continue;
      }
      if (INLINE[tag] === 'i' || INLINE[tag] === 'b') { const el = h(INLINE[tag]); sanitizeLyrics(n, el); out.append(el); continue; }
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BUTTON' || tag === 'SVG' || tag === 'svg' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
      sanitizeLyrics(n, out);
    }
    return out;
  }
  function parseLyricsPage(html) {
    const doc = parseHTML(html);
    const boxes = [...doc.querySelectorAll('[data-lyrics-container="true"]')];
    if (!boxes.length) {
      const ph = doc.querySelector('[class*="LyricsPlaceholder"], [class*="lyrics-placeholder"]');
      return { blocks: [], placeholder: ph ? ph.textContent.trim().slice(0, 200) : '' };
    }
    return { blocks: boxes.map((b) => sanitizeLyrics(b, document.createDocumentFragment())), placeholder: '' };
  }

  // ───────── which song is playing ─────────
  function currentSong() {
    const bar = document.querySelector('ytmusic-player-bar');
    const t = bar && bar.querySelector('.content-info-wrapper .title');
    const by = bar && bar.querySelector('.content-info-wrapper .byline');
    const title = t ? (t.getAttribute('title') || t.textContent || '').trim() : '';
    if (!title) return null;
    let artists = by ? [...by.querySelectorAll('a')].filter((a) => /channel\/|browse\/UC/.test(a.getAttribute('href') || '')).map((a) => a.textContent.trim()).filter(Boolean) : [];
    if (!artists.length && by) {
      const first = (by.getAttribute('title') || by.textContent || '').split('•')[0];
      artists = first.split(/,|&| and | x | × /i).map((s) => s.trim()).filter(Boolean);
    }
    const key = title + '|' + artists.join(', ');
    artists = artists.map(cleanArtist).filter(Boolean);
    // K-pop style uploads: "Artist (Name) 'Song' Official MV" on a label's channel
    const q = splitQuoted(title);
    if (q && q.lead && !artists.some((a) => overlap(a, q.lead) > 0)) artists = [q.lead, ...artists];
    // Uploaded videos often look like "Artist - Song (Official Video)" on the uploader's channel.
    const dash = title.match(/^\s*(.+?)\s+[-–—]\s+(.+)$/);
    if (dash && !VERSION.test(dash[2]) && !artists.some((a) => norm(dash[1]).includes(norm(a)) || norm(a).includes(norm(dash[1])))) {
      const lead = dash[1].split(/,|&| x | × | feat\.? | ft\.? /i).map((s) => s.trim()).filter(Boolean);
      artists = [...lead, ...artists];
    }
    return { title, artists, key };
  }
  // "Song - Remastered 2011", "Song - Live at …": a version note after the dash, not "Artist - Song"
  const VERSION = /^(?:\d{4}\s+)?(?:re-?master|live|version|edit|mix|remix|acoustic|demo|mono|stereo|radio|single|extended|from|bonus|instrumental|deluxe|recorded|original|unplugged|sped|slowed|reprise|interlude|intro|outro|pt\.?|part)\b/i;
  const MV_TAIL = /^(?:official\s+)?(?:(?:music|lyric|performance|dance)\s+)?(?:video|mv|m\/v|audio|visuali[sz]er|teaser)?\s*$/i;
  function splitQuoted(title) {
    const m = String(title).match(/^(.+?)\s*['‘"“]([^'’"”]{1,80})['’"”]\s*(.*)$/);
    if (!m || !MV_TAIL.test(m[3])) return null;
    return { lead: m[1].replace(/\s*[([][^)\]]*[)\]]/g, '').trim(), name: m[2].trim() };
  }
  function cleanArtist(a) {
    return String(a).replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*\(?official\)?$/i, '').trim();
  }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  function cleanTitle(title, artists) {
    let t = String(title);
    for (const a of artists) {
      const re = new RegExp('^\\s*' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—:]\\s*', 'i');
      t = t.replace(re, '');
    }
    const q = splitQuoted(t);
    if (q && q.lead) t = q.name;
    // "Someone, Someone Else - Song": drop the lead-in even when the names differ slightly
    const dash = t.match(/^\s*(.+?)\s+[-–—]\s+(.+)$/);
    if (dash && !VERSION.test(dash[2]) && artists.some((a) => overlap(a, dash[1]) > 0)) t = dash[2];
    t = t.replace(/\s*[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|4k|mv|m\/v|explicit|clean|remaster(?:ed)?|from\b[^)\]]*|prod\.?|feat\.?|ft\.?|with)\b[^)\]]*)[)\]]/gi, '');
    t = t.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '');
    t = t.replace(/\s+(?:official\s+)?(?:(?:music|lyric)\s+)?(?:video|mv|m\/v|visuali[sz]er)\s*$/i, '');
    t = t.replace(/\s+-\s+(?:remaster(?:ed)?|\d{4} remaster).*$/i, '');
    return t.trim() || String(title).trim();
  }
  function tokens(s) { return new Set(norm(s).split(' ').filter(Boolean)); }
  function overlap(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let n = 0; for (const x of A) if (B.has(x)) n++;
    return n / Math.max(A.size, B.size);
  }
  // How well a Genius search hit matches what's playing: title 0–3, artist 0–2, minus penalties
  // for translations and other versions (cover, remix, live…) that YouTube Music's title doesn't mention.
  function score(hit, song) {
    const want = norm(cleanTitle(song.title, song.artists));
    const got = norm(cleanTitle(hit.title, []));
    let title;
    if (got === want) title = 3;
    else if (got && want && (` ${got} `.includes(` ${want} `) || ` ${want} `.includes(` ${got} `))) title = 2;
    else title = 2 * overlap(want, got);
    const artistsN = ` ${norm(hit.artists + ' ' + hit.artist)} `;
    let artist = 0;
    if (song.artists.some((a) => norm(a) && artistsN.includes(` ${norm(a)} `))) artist = 2;
    else artist = 1.5 * Math.max(0, ...song.artists.map((a) => overlap(a, hit.artists + ' ' + hit.artist)));
    let penalty = 0;
    if (/^genius\b/i.test(hit.artist)) penalty += 5; // translation / romanisation pages
    for (const w of ['cover', 'remix', 'acoustic', 'live', 'translation', 'instrumental', 'sped up', 'slowed', 'karaoke', 'demo', 'version', 'mix']) {
      if (` ${norm(hit.title)} `.includes(` ${w} `) && !` ${norm(song.title)} `.includes(` ${w} `)) penalty += 1.2;
    }
    return { title, artist, total: title + artist - penalty };
  }
  // Good enough to show without asking: the title and an artist both line up, or the title is exact
  // and it's Genius's own top result for the search.
  const confident = (r, first) => r.s.total >= 3 && ((r.s.title >= 1.5 && r.s.artist >= 1) || (first && r.s.title >= 3));

  // ───────── state ─────────
  const state = {
    active: false,
    view: 'lyrics',      // lyrics | notes | about
    songKey: '',
    loading: false,
    error: '',
    data: null,          // { song, lyrics, referents: Map, candidates, matchedBy }
    picking: false,
    openRef: null,
  };
  const loads = new Map(); // song key → promise of data

  async function loadFor(song, forcedId) {
    const pickKey = 'pick:' + norm(song.key);
    let candidates = [];
    let id = forcedId || (await storage.get(pickKey));
    let matchedBy = id ? 'you' : 'search';
    if (!id) {
      const q = cleanTitle(song.title, song.artists) + ' ' + (song.artists[0] || '');
      candidates = await ask('search', { q });
      if (!candidates.length && song.artists.length) candidates = await ask('search', { q: cleanTitle(song.title, song.artists) });
      const ranked = candidates.map((c, i) => ({ c, i, s: score(c, song) })).sort((a, b) => b.s.total - a.s.total || a.i - b.i);
      if (!ranked.length || !confident(ranked[0], ranked[0].i === 0)) return { song: null, candidates: ranked.map((r) => r.c), notFound: true };
      id = ranked[0].c.id;
      candidates = ranked.map((r) => r.c);
    }
    const info = await ask('song', { id });
    const [html, refs] = await Promise.all([
      info.instrumental ? Promise.resolve('') : ask('page', { path: info.path }),
      ask('referents', { songId: info.id }).catch(() => []),
    ]);
    const lyrics = html ? parseLyricsPage(html) : { blocks: [], placeholder: 'This song is an instrumental.' };
    // notes in the order their lines appear in the song; any others after
    const order = [];
    for (const frag of lyrics.blocks) for (const b of frag.querySelectorAll('.gl-ref')) order.push(b.getAttribute('data-ref'));
    const rank = new Map([...new Set(order)].map((id, i) => [id, i]));
    const sorted = refs.map((r, i) => ({ r, k: rank.has(String(r.id)) ? rank.get(String(r.id)) : 1e6 + i })).sort((a, b) => a.k - b.k).map((x) => x.r);
    const referents = new Map(sorted.map((r) => [String(r.id), r]));
    return { song: info, lyrics, referents, candidates, matchedBy };
  }

  async function refresh(force, forcedId) {
    const song = currentSong();
    if (!song) { state.data = null; state.error = ''; state.songKey = ''; render(); return; }
    if (!force && song.key === state.songKey && (state.data || state.loading)) return;
    state.songKey = song.key;
    state.loading = true;
    state.error = '';
    state.picking = false;
    state.openRef = null;
    render();
    const key = song.key + (forcedId ? '#' + forcedId : '');
    if (force) loads.delete(key);
    if (!loads.has(key)) {
      const p = loadFor(song, forcedId);
      loads.set(key, p);
      p.catch(() => loads.delete(key));
    }
    try {
      const data = await loads.get(key);
      if (state.songKey !== song.key) return;
      state.data = data;
      if (data.notFound) state.picking = true;
    } catch (e) {
      if (state.songKey !== song.key) return;
      state.error = String(e && e.message || e);
      state.data = null;
    }
    state.loading = false;
    render();
  }

  // ───────── UI pieces ─────────
  let tabEl = null, panel = null, scroller = null;

  function noteCard(ref) {
    const a = ref && ref.annotations && ref.annotations[0];
    if (!a) return h('div', { class: 'gl-note' }, h('p', { class: 'gl-muted', text: 'This note has no text yet.' }));
    const label = ref.classification === 'verified' || a.verified ? 'Verified by the artist' : ref.classification === 'accepted' ? 'Genius annotation' : 'Unreviewed annotation';
    const who = a.authors.length ? a.authors[0] + (a.authors.length > 1 ? ` +${a.authors.length - 1}` : '') : '';
    return h('div', { class: 'gl-note' + (ref.classification === 'unreviewed' ? ' gl-unreviewed' : '') },
      h('div', { class: 'gl-note-head' },
        h('span', { class: 'gl-badge', text: label }),
        who ? h('span', { class: 'gl-muted', text: who }) : null,
        h('span', { class: 'gl-votes', title: 'Votes on Genius', text: (a.votes > 0 ? '+' : '') + fmt(a.votes) })),
      h('div', { class: 'gl-rich' }, richFragment(a.html)),
      a.url ? h('a', { class: 'gl-out', href: safeUrl(a.url), target: '_blank', rel: 'noopener noreferrer', text: 'View on Genius ↗' }) : null);
  }

  function lyricsView(d) {
    if (!d.lyrics.blocks.length) return h('p', { class: 'gl-muted gl-pad', text: d.lyrics.placeholder || 'Genius doesn’t have lyrics for this song yet.' });
    const wrap = h('div', { class: 'gl-lyrics' }, d.lyrics.blocks.map((frag) => h('div', { class: 'gl-block' }, frag.cloneNode(true))));
    for (const b of wrap.querySelectorAll('.gl-ref')) {
      const ref = d.referents.get(b.getAttribute('data-ref'));
      if (!ref || !ref.annotations.length) { b.classList.add('gl-ref-empty'); b.disabled = true; continue; }
      b.title = 'Read the note';
      b.addEventListener('click', () => toggleNote(b, ref));
    }
    return wrap;
  }

  // Note opens right under the line it belongs to.
  function toggleNote(btn, ref) {
    const open = btn.getAttribute('aria-expanded') === 'true';
    for (const other of panel.querySelectorAll('.gl-ref[aria-expanded="true"]')) other.setAttribute('aria-expanded', 'false');
    for (const old of panel.querySelectorAll('.gl-lyrics .gl-note')) old.remove();
    if (open) { state.openRef = null; return; }
    btn.setAttribute('aria-expanded', 'true');
    state.openRef = String(ref.id);
    // walk up to the lyric block's own level (the button may sit inside <i>/<b>), then to the line's end
    let after = btn;
    while (after.parentNode && !after.parentNode.classList.contains('gl-block')) after = after.parentNode;
    while (after.nextSibling && after.nextSibling.nodeName !== 'BR') after = after.nextSibling;
    const card = noteCard(ref);
    if (after.nextSibling) after.parentNode.insertBefore(card, after.nextSibling.nextSibling);
    else after.parentNode.appendChild(card);
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function notesView(d) {
    const refs = [...d.referents.values()].filter((r) => !r.isDescription && r.annotations.length);
    if (!refs.length) return h('p', { class: 'gl-muted gl-pad', text: 'No notes on Genius for this song yet.' });
    return h('div', { class: 'gl-notes' }, refs.map((r) => h('div', { class: 'gl-note-item' },
      h('blockquote', { class: 'gl-quote', text: r.fragment }),
      noteCard(r))));
  }

  function aboutView(d) {
    const s = d.song;
    const facts = [];
    const fact = (label, value) => value && (Array.isArray(value) ? value.length : true) && facts.push(h('div', { class: 'gl-fact' }, h('span', { text: label }), h('b', null, Array.isArray(value) ? value.join(', ') : value)));
    fact('Released', s.release);
    if (s.album) facts.push(h('div', { class: 'gl-fact' }, h('span', { text: 'Album' }), h('b', null, h('a', { href: safeUrl(s.album.url), target: '_blank', rel: 'noopener noreferrer', text: s.album.name }))));
    fact('Written by', s.writers);
    fact('Produced by', s.producers);
    fact('Featuring', s.featured);
    for (const c of s.credits.slice(0, 12)) fact(c.label, c.names);
    if (s.pageviews) fact('Views on Genius', fmt(s.pageviews));
    if (s.credits.length > 12) facts.push(h('div', { class: 'gl-fact' }, h('span'), h('a', { class: 'gl-out', href: safeUrl(s.url + '#song-info'), target: '_blank', rel: 'noopener noreferrer', text: `${s.credits.length - 12} more credits on Genius ↗` })));
    const about = s.description ? h('div', { class: 'gl-rich gl-about' }, richFragment(s.description)) : h('p', { class: 'gl-muted', text: 'No “About” text on Genius for this song yet.' });
    return h('div', { class: 'gl-pad' }, about, facts.length ? h('div', { class: 'gl-facts' }, facts) : null);
  }

  function pickerView(d) {
    const list = h('div', { class: 'gl-picks' });
    const showResults = (results) => {
      list.replaceChildren(...(results.length ? results.slice(0, 8).map((c) => h('button', {
        type: 'button', class: 'gl-pick',
        onclick: () => {
          const song = currentSong();
          if (song) { storage.set('pick:' + norm(song.key), c.id); loads.delete(song.key); }
          refresh(true, c.id);
        },
      }, c.art ? h('img', { src: safeUrl(c.art), alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : h('span', { class: 'gl-pick-ph' }),
        h('span', null, h('b', { text: c.title }), h('small', { text: c.artists })))) : [h('p', { class: 'gl-muted', text: 'No matches. Try different words.' })]));
    };
    const input = h('input', { type: 'search', class: 'gl-search', placeholder: 'Search Genius', value: (() => { const s = currentSong(); return s ? cleanTitle(s.title, s.artists) + ' ' + (s.artists[0] || '') : ''; })() });
    for (const t of ['keydown', 'keyup', 'keypress']) input.addEventListener(t, (e) => e.stopPropagation());
    const search = async () => {
      if (!input.value.trim()) return;
      list.replaceChildren(h('div', { class: 'gl-spinner' }));
      try { showResults(await ask('search', { q: input.value })); } catch (err) { list.replaceChildren(h('p', { class: 'gl-muted', text: String(err.message || err) })); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    if (d && d.candidates && d.candidates.length) showResults(d.candidates);
    else search();
    return h('div', { class: 'gl-pad gl-picker' },
      h('p', { class: 'gl-muted', text: d && d.notFound ? 'Couldn’t find this song on Genius for sure. Pick it below or search:' : 'Pick the right song:' }),
      input, list,
      d && d.song ? h('button', { type: 'button', class: 'gl-link', onclick: () => { state.picking = false; render(); }, text: 'Cancel' }) : null);
  }

  function header(d) {
    const s = d && d.song;
    if (!s) return null;
    return h('div', { class: 'gl-head' },
      s.art ? h('img', { class: 'gl-art', src: safeUrl(s.art), alt: '', referrerpolicy: 'no-referrer' }) : null,
      h('div', { class: 'gl-meta' },
        h('a', { class: 'gl-title', href: safeUrl(s.url), target: '_blank', rel: 'noopener noreferrer', title: 'Open on Genius', text: s.titleWithFeatured || s.title }),
        h('div', { class: 'gl-muted', text: s.artists })),
      h('button', { type: 'button', class: 'gl-link', title: 'Choose a different Genius page', onclick: () => { state.picking = !state.picking; render(); }, text: state.picking ? 'Cancel' : 'Wrong song?' }));
  }

  function render() {
    if (!panel) return;
    const d = state.data;
    const body = [];
    if (state.loading) body.push(h('div', { class: 'gl-loading' }, h('div', { class: 'gl-spinner' }), h('span', { class: 'gl-muted', text: 'Finding this song on Genius…' })));
    else if (state.error) body.push(h('div', { class: 'gl-pad' },
      h('p', { text: 'Couldn’t reach Genius.' }), h('p', { class: 'gl-muted', text: state.error }),
      h('button', { type: 'button', class: 'gl-btn', onclick: () => refresh(true), text: 'Try again' })));
    else if (!currentSong()) body.push(h('p', { class: 'gl-muted gl-pad', text: 'Play something to see its Genius lyrics and notes.' }));
    else if (d) {
      body.push(header(d));
      if (state.picking || !d.song) body.push(pickerView(d));
      else {
        const notes = [...d.referents.values()].filter((r) => !r.isDescription && r.annotations.length).length;
        const seg = (id, label) => h('button', { type: 'button', class: 'gl-seg-btn' + (state.view === id ? ' on' : ''), 'aria-pressed': String(state.view === id), onclick: () => { state.view = id; state.openRef = null; render(); scroller.scrollTop = 0; } }, label);
        body.push(h('div', { class: 'gl-seg' }, seg('lyrics', 'Lyrics'), seg('notes', 'Notes' + (notes ? ` ${notes}` : '')), seg('about', 'About')));
        body.push(state.view === 'notes' ? notesView(d) : state.view === 'about' ? aboutView(d) : lyricsView(d));
        body.push(h('p', { class: 'gl-credit' }, 'Lyrics and notes from ', h('a', { href: safeUrl(d.song.url), target: '_blank', rel: 'noopener noreferrer', text: 'Genius ↗' })));
      }
    }
    scroller.replaceChildren(...body.filter(Boolean));
  }

  // ───────── the tab in YouTube Music's sidebar ─────────
  function sidePanel() { return document.querySelector('ytmusic-player-page #side-panel'); }

  function setActive(on) {
    state.active = on;
    const side = sidePanel();
    if (side) side.classList.toggle('gl-active', on);
    if (tabEl) { tabEl.classList.toggle('gl-on', on); tabEl.setAttribute('aria-selected', String(on)); }
    if (on) { place(); refresh(false); }
  }

  function place() {
    const side = sidePanel();
    const tabs = side && side.querySelector('tp-yt-paper-tabs');
    if (!side || !panel || !tabs) return;
    const top = tabs.offsetTop + tabs.offsetHeight;
    panel.style.top = top + 'px';
  }

  function ensure() {
    const side = sidePanel();
    const tabsContent = side && side.querySelector('tp-yt-paper-tabs #tabsContent');
    if (!side || !tabsContent) return;
    if (!tabEl) {
      tabEl = h('div', { class: 'gl-tab', role: 'tab', tabindex: '0', 'aria-selected': 'false', 'aria-label': 'Genius', title: 'Lyrics and notes from Genius' }, h('span', { text: 'Genius' }), noteIcon());
      tabEl.addEventListener('click', (e) => { e.stopPropagation(); setActive(true); });
      tabEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setActive(true); } });
    }
    if (tabEl.parentNode !== tabsContent) { tabsContent.appendChild(tabEl); fit(); }
    if (!tabEl.__styled) {
      // look like YouTube Music's own tabs: same type, same selected / unselected colours
      const sel = tabsContent.querySelector('tp-yt-paper-tab.iron-selected');
      const other = tabsContent.querySelector('tp-yt-paper-tab:not(.iron-selected):not([disabled])');
      const ref = sel || other;
      if (ref && ref.offsetWidth) {
        const cs = getComputedStyle(ref);
        Object.assign(tabEl.style, { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform });
        if (sel) side.style.setProperty('--gl-tab-on', getComputedStyle(sel).color);
        if (other) side.style.setProperty('--gl-tab-off', getComputedStyle(other).color);
        tabEl.__styled = true;
      }
    }
    if (!panel) {
      scroller = h('div', { class: 'gl-scroll' });
      panel = h('div', { id: 'gl-panel', role: 'tabpanel', 'aria-label': 'Genius' }, scroller);
      for (const t of ['keydown', 'keyup', 'keypress']) panel.addEventListener(t, (e) => { if (e.target.closest('input')) e.stopPropagation(); });
      render();
    }
    if (panel.parentNode !== side) side.appendChild(panel);
    // clicking any of YouTube Music's own tabs hands the sidebar back to it
    if (!side.__glHooked) {
      side.__glHooked = true;
      side.querySelector('tp-yt-paper-tabs').addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('tp-yt-paper-tab');
        if (t && !t.hasAttribute('disabled') && t.getAttribute('aria-disabled') !== 'true') setActive(false);
      }, true);
    }
    if (observed !== side) { if (observed) ro.unobserve(observed); ro.observe(side); observed = side; }
    side.classList.toggle('gl-active', state.active);
    if (state.active) place();
  }

  // A fifth tab needs about 410px. In a narrower sidebar the tabs first get tighter, then the
  // Genius tab becomes an icon, so nothing is pushed out of view.
  function fit() {
    const side = sidePanel();
    const tc = side && side.querySelector('tp-yt-paper-tabs #tabsContent');
    const clip = tc && tc.parentNode;
    if (!clip || !clip.clientWidth || !tabEl || tabEl.parentNode !== tc) return;
    const over = () => tc.scrollWidth > clip.clientWidth + 1;
    side.classList.remove('gl-tight', 'gl-tighter');
    if (!over()) return;
    side.classList.add('gl-tight');
    if (over()) side.classList.add('gl-tighter');
  }
  let observed = null;
  const ro = new ResizeObserver(() => fit());

  function noteIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ['M4 6h11', 'M4 11h8', 'M4 16h6']) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '2');
      p.setAttribute('stroke-linecap', 'round');
      svg.appendChild(p);
    }
    const dot = document.createElementNS(NS, 'path');
    dot.setAttribute('d', 'M15.5 12.5h4.5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2.2L16 20.3v-1.8h-.5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z');
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);
    return svg;
  }

  setInterval(() => {
    ensure();
    if (state.active) {
      const s = currentSong();
      if ((s ? s.key : '') !== state.songKey) refresh(false);
    }
  }, 600);
  ensure();

  window.__geniusSidebarApi = { state, refresh, setActive, cleanTitle, score, parseLyricsPage, currentSong };
})();
