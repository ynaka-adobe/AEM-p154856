import { allowDynamicBackends } from 'fastly:experimental';
allowDynamicBackends(true);

/* Edge function: persona-decision  (AEM Edge Delivery / Fastly Compute JS)
 *
 * Resolves persona/loggedIn/region from the ?p= query param (first hit) or the
 * demoProfile cookie (repeat hits), asks Adobe Target for the decision AT THE
 * EDGE (server-side Delivery API), injects the returned experience into the page
 * HTML, and persists the resolved profile + Target ids as cookies.
 *
 * CONFIG: set TARGET_CLIENT to your Target client code to enable real decisioning.
 * While it is '' the function runs in STUB mode (injects a persona banner) so it
 * stays deployable and testable without Target credentials.
 *
 * BACKENDS (register in your edge-function environment / fastly.toml):
 *   - 'origin'  -> https://main--dupont--ynaka-adobe.aem.live   (content)
 *   - 'target'  -> https://<TARGET_CLIENT>.tt.omtrdc.net         (Adobe Target)
 */
const TARGET_CLIENT = 'acsmarketing'; // Target client code (public; not a secret)
const TARGET_MBOX = 'target-slot-hero'; // regular mbox the XT activity runs on

const PERSONA = {
  1: { name: 'Technical Evaluator', color: '#0072ce', color2: '#004a86' },
  2: { name: 'Business Decision Maker', color: '#e1261c', color2: '#8f1410' },
  3: { name: 'Procurement Manager', color: '#00884a', color2: '#00542e' },
  4: { name: 'Industry Researcher', color: '#6a1b9a', color2: '#3f0f5c' },
};

function getOrigin(req) {
  const host = req.headers.get('host') || '';
  const site = host.split('.')[0];
  return `https://main--${site}--ynaka-adobe.aem.live`;
}

// Wrap a plain-content hero offer (e.g. a DA Experience Fragment, whose inline
// styles are stripped by the authoring pipeline) in a styled, self-contained
// hero shell using the persona's colors — a scoped <style>, no site-CSS needed.
function wrapHero(content, persona) {
  const m = PERSONA[persona] || { color: '#0072ce', color2: '#004a86' };
  // Strip the EDS metadata block (holds adobe.target.offerId) if it rode along.
  content = String(content || '').replace(/<div class="metadata">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, '').trim();
  return `<section data-persona-hero style="background:linear-gradient(120deg,${m.color},${m.color2});`
    + 'color:#fff;padding:48px 24px;text-align:center;font-family:system-ui,Arial,sans-serif">'
    + '<style>[data-persona-hero]>div{max-width:860px;margin:0 auto}'
    + '[data-persona-hero] p{font-size:17px;line-height:1.5;margin:0 auto 16px;max-width:640px;opacity:.95}'
    + '[data-persona-hero] p:first-child{font:600 12px/1.4 system-ui;letter-spacing:1.5px;'
    + 'text-transform:uppercase;opacity:.85;margin:0 0 12px}'
    + '[data-persona-hero] h1{font-size:34px;line-height:1.15;margin:0 0 14px;font-weight:700}'
    + `[data-persona-hero] a{display:inline-block;background:#fff;color:${m.color};font-weight:700;`
    + 'font-size:15px;text-decoration:none;padding:13px 28px;border-radius:4px}'
    + `</style>${content}</section>`;
}

addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));

async function handleRequest(event) {
  const req = event.request;
  const url = new URL(req.url);
  const cookies = parseCookies(req.headers.get('cookie') || '');
  const profile = resolveProfile(cookies, url);
  const ids = resolveIds(cookies);

  // 1) base page from the content origin (host → main--<site>--ynaka-adobe.aem.live)
  const originResp = await fetch(getOrigin(req) + url.pathname + (url.search || ''));
  let html = await originResp.text();

  // 2) decision at the edge
  if (profile.persona) {
    let decision;
    try {
      decision = TARGET_CLIENT
        ? await targetDeliver(url, profile, ids)   // real Adobe Target call
        : stubDecision(profile);                   // no-creds fallback
    } catch (e) {
      decision = stubDecision(profile);            // fail open to content/stub
    }
    html = injectExperience(html, decision, profile);
  }

  // 3) persist profile + Target ids
  const headers = new Headers(originResp.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('x-persona', String(profile.persona || ''));
  headers.append('set-cookie', cookie('demoProfile', JSON.stringify(profile)));
  if (ids.tntId) headers.append('set-cookie', cookie('mboxTnt', ids.tntId));
  return new Response(html, { status: originResp.status, headers });
}

/* ---- profile + ids ---- */
function resolveProfile(cookies, url) {
  let profile = {};
  try { profile = JSON.parse(cookies.demoProfile || '{}'); } catch (e) { profile = {}; }
  const p = url.searchParams.get('p'); if (p) profile.persona = parseInt(p, 10);
  const li = url.searchParams.get('li'); if (li !== null) profile.loggedIn = (li === '1' || li === 'true');
  const region = url.searchParams.get('region'); if (region) profile.region = region.toUpperCase();
  return profile;
}
function resolveIds(cookies) {
  return {
    tntId: cookies.mboxTnt || '',
    sessionId: cookies.mboxSession || cryptoRandom(),
  };
}

/* ---- Adobe Target server-side Delivery API ---- */
function profileParams(profile) {
  return {
    persona: String(profile.persona),
    loggedIn: String(!!profile.loggedIn),
    region: profile.region || '',
  };
}

async function targetDeliver(url, profile, ids) {
  const body = {
    context: { channel: 'web', address: { url: `https://www.dupont.com${url.pathname}` } },
    // Only send `id` when we actually have a tntId — an empty id:{} makes Target 400.
    ...(ids.tntId ? { id: { tntId: ids.tntId } } : {}),
    experienceCloud: { analytics: { logging: 'server_side' } },
    // The activity runs on the regular mbox `target-slot-hero` (NOT the global
    // mbox), so request it by name in execute.mboxes and read the offer from
    // execute.mboxes[].options. pageLoad is kept too so a global-mbox activity
    // would still work (its offer comes back in pageLoad.options).
    execute: {
      pageLoad: { profileParameters: profileParams(profile) },
      mboxes: [{ index: 0, name: TARGET_MBOX, profileParameters: profileParams(profile) }],
    },
  };
  const endpoint = `https://${TARGET_CLIENT}.tt.omtrdc.net/rest/v1/delivery`
    + `?client=${TARGET_CLIENT}&sessionId=${encodeURIComponent(ids.sessionId)}`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`target ${resp.status}`);
  const data = await resp.json();
  if (data && data.id && data.id.tntId) ids.tntId = data.id.tntId;
  // collect option contents from pageLoad + mboxes
  const opts = [];
  const pageLoad = data?.execute?.pageLoad?.options || [];
  const mboxes = (data?.execute?.mboxes || []).flatMap((m) => m.options || []);
  [...pageLoad, ...mboxes].forEach((o) => { if (o && o.content != null) opts.push(o.content); });
  return { options: opts, persona: profile.persona };
}

function stubDecision(profile) {
  const meta = PERSONA[profile.persona] || { name: 'Default', color: '#333333' };
  return { options: [], persona: profile.persona, stub: meta };
}

/* ---- inject the experience server-side (token-based, no DOM at the edge) ----
 * Target returns JSON offers shaped as { "token": "hero", "html": "<...>" }
 * (or an array of them). The author marks a spot in the page one of two ways:
 *   1) an EMPTY SLOT BLOCK (recommended; invisible until filled, survives EDS):
 *        <div class="target-slot-hero"></div>
 *      -> offer HTML is injected inside the matching target-slot-<token> block.
 *   2) a text token typed in the content:   [[target:hero]]
 *      -> replaced in place (its <p> wrapper too); visible until the edge runs.
 * Falls back to the persona banner when no offer matched (e.g. no activity yet).
 */
function normalizeOffers(options) {
  const res = [];
  (options || []).forEach((c) => {
    let val = c;
    // A JSON offer ({token,html} or an array) is parsed; anything else (e.g. a
    // plain HTML Experience Fragment offer pushed from DA) is treated as a hero.
    if (typeof val === 'string') {
      const s = val.trim();
      if (s[0] === '{' || s[0] === '[') { try { val = JSON.parse(s); } catch (e) { /* keep as html */ } }
      // `raw` = a plain HTML offer (no styling of its own) → edge wraps it.
      if (typeof val === 'string') { if (s) res.push({ token: 'hero', html: s, raw: true }); return; }
    }
    (Array.isArray(val) ? val : [val]).forEach((o) => {
      if (o && o.token) res.push({ token: String(o.token), html: o.html || o.content || '' });
      else if (typeof o === 'string' && o.trim()) res.push({ token: 'hero', html: o, raw: true });
    });
  });
  return res;
}

function injectExperience(html, decision, profile) {
  let out = html;
  let applied = false;
  const unplacedHero = [];
  normalizeOffers(decision.options).forEach(({ token, html: rawHtml, raw }) => {
    const t = escapeRe(token);
    // Plain offers (DA Experience Fragments) get the styled hero shell; offers
    // that already carry their own styling (JSON offers) are injected as-is.
    const content = raw && token === 'hero' ? wrapHero(rawHtml, profile.persona) : rawHtml;
    const before = out;
    out = out
      // 1) empty slot block: inject offer HTML just inside <div class="target-slot-<token>...">
      .replace(new RegExp('(<div class="target-slot-' + t + '[^"]*"[^>]*>)', 'g'), (_m, open) => open + content)
      // 2) text token, optionally alone in a paragraph
      .replace(new RegExp('<p>\\s*\\[\\[target:' + t + '\\]\\]\\s*</p>', 'g'), () => content)
      .replace(new RegExp('\\[\\[target:' + t + '\\]\\]', 'g'), () => content);
    if (out !== before) applied = true;
    else if (token === 'hero' && content) unplacedHero.push(content); // no slot on this page
  });
  // Pages without an explicit target-slot-hero block (i.e. every routed nav page
  // that wasn't hand-authored with a slot): drop the hero at the top of <main>
  // so the offer still personalizes the page. The offer HTML is self-contained.
  if (unplacedHero.length) {
    const content = unplacedHero.join('');
    if (/<main[^>]*>/i.test(out)) out = out.replace(/(<main[^>]*>)/i, (m) => m + content);
    else out = out.replace(/<body[^>]*>/i, (m) => m + content);
    applied = true;
  }
  // strip any leftover unfilled tokens so they never render as raw text
  out = out.replace(/<p>\s*\[\[target:[^\]]+\]\]\s*<\/p>/g, '').replace(/\[\[target:[^\]]+\]\]/g, '');
  if (!applied && decision.persona) {
    out = out.replace(/<body[^>]*>/i, (m) => m + personaBanner(decision, profile));
  }
  return out;
}

function personaBanner(decision, profile) {
  const meta = decision.stub || PERSONA[profile.persona] || { name: 'Default', color: '#333333' };
  return `<div data-edge-persona style="position:sticky;top:0;z-index:10000;background:${meta.color};`
    + `color:#fff;font:600 14px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center">`
    + `Edge decision &#8594; Persona ${profile.persona}: ${escapeHtml(meta.name)}`
    + `${profile.loggedIn ? ' &#183; logged in' : ' &#183; guest'}`
    + `${profile.region ? ' &#183; ' + escapeHtml(profile.region) : ''}</div>`;
}

/* ---- helpers ---- */
function cookie(name, value) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=2592000; SameSite=Lax`;
}
function parseCookies(str) {
  const out = {};
  str.split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function cryptoRandom() {
  return 'sid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
