// PREPFIX CHURCH MEDIA TOOLKIT (designed by Cyrus Ireri, 0720872582) - lyrics for the church projector, live stream and phone remote.
// Run:  node server.js   (no npm install needed). Songs, playlists and settings are kept in data.json next to this file.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const DIR = __dirname;
const FILE = path.join(DIR, 'data.json'), BACKUP = path.join(DIR, 'data.backup.json');
const WALL = path.join(DIR, 'wallpaper.bin'), PAGE = path.join(DIR, 'index.html');
// ---------- Prepfix kit, licence and support details ----------
const PRODUCT = 'PREPFIX CHURCH TOOLKIT';
const SUPPORT = { phone: '0720872582', email: 'irericyrus004@gmail.com' };
// Prepfix public key: checks that licences and updates really come from Prepfix (the private key never leaves the maker)
const PUBLIC_KEY = crypto.createPublicKey({ key: Buffer.from('MCowBQYDK2VwAyEAoZp4lE4Kse+COLsBbSmoC0h1DQDK34A9JdzdrsFANjc=', 'base64'), format: 'der', type: 'spki' });
const verifySig = (parts, sig) => { try { return crypto.verify(null, Buffer.from(JSON.stringify(parts)), PUBLIC_KEY, Buffer.from(sig || '', 'base64')); } catch (e) { return false; } };
const KIT_FILE = path.join(DIR, 'kit.json'), LICENSE_FILE = path.join(DIR, 'license.json');
let KIT = { version: 'V1', build: '0', updateUrl: '' };
try { KIT = { ...KIT, ...JSON.parse(fs.readFileSync(KIT_FILE, 'utf8')) }; } catch (e) {}
// The church name is set only by Prepfix. A missing, edited or copied-and-renamed licence shows as a pirated copy.
// Every licence is paid until a date ("until"). Prepfix extends it with a signed renewal code (typed in, or collected by the check-in).
// Old licences (made before dates were used) last one year from the day they were made.
// State that changes on this computer (latest date seen, suspension, message from Prepfix) is kept in licence-state.json.
const STATE_FILE = path.join(DIR, 'licence-state.json');
const DAY = 86400000, WARN_DAYS = 7, GRACE_DAYS = 7;
let LSTATE = { seen: 0, suspended: false, message: '', checked: 0 };
try { LSTATE = { ...LSTATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch (e) {}
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(LSTATE, null, 1)); } catch (e) {} };
const ymd = t => new Date(t).toISOString().slice(0, 10);
const addYear = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + 1); return ymd(x); };
// renewal code: PFX1.<licence id>.<YYYYMMDD>.<signature>
function parseRenewal(code, id) {
  const m = /^PFX1\.([0-9a-f]{6,24})\.(\d{8})\.([A-Za-z0-9_-]{40,})$/.exec(String(code || '').replace(/\s+/g, '').trim());
  if (!m || (id && m[1] !== id)) return null;
  const until = m[2].slice(0, 4) + '-' + m[2].slice(4, 6) + '-' + m[2].slice(6, 8);
  const sig = m[3].replace(/-/g, '+').replace(/_/g, '/');
  return verifySig([PRODUCT, 'renew', m[1], until], sig) ? { id: m[1], until } : null;
}
// the date used for the licence: never earlier than the latest date this computer has seen (turning the clock back does not help)
function nowDate() {
  let seen = LSTATE.seen || 0;
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')).licSeen || 0; if (d > seen) seen = d; } catch (e) {}
  return Math.max(Date.now(), seen);
}
function readLicense() {
  if (!fs.existsSync(LICENSE_FILE)) return { status: 'unlicensed', church: '' };
  let L;
  try { L = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8')); } catch (e) { return { status: 'pirated', church: '' }; }
  const ok = L.until ? verifySig([PRODUCT, L.church, L.issued, L.id, L.until], L.sig) : verifySig([PRODUCT, L.church, L.issued, L.id], L.sig);
  if (!ok) return { status: 'pirated', church: '' };
  let until = L.until || addYear(L.issued);
  (L.renew || []).forEach(c => { const r = parseRenewal(c, L.id); if (r && r.until > until) until = r.until; });
  const now = nowDate(), end = Date.parse(until + 'T23:59:59Z'), days = Math.ceil((end - now) / DAY);
  const phase = days > WARN_DAYS ? 'ok' : days >= 0 ? 'warn' : days >= -GRACE_DAYS ? 'grace' : 'expired';
  const status = LSTATE.suspended ? 'suspended' : phase === 'expired' ? 'expired' : 'ok';
  return { status, church: L.church, issued: L.issued, id: L.id, until, days, phase, message: LSTATE.message || '' };
}
let LIC = readLicense();
function rememberToday() { // keeps the latest date seen, in two places
  const t = Date.now();
  if (t > (LSTATE.seen || 0)) { LSTATE.seen = t; saveState(); }
  if (typeof data === 'object' && data && t > (data.licSeen || 0)) { data.licSeen = t; if (typeof save === 'function') save(); }
}
function applyRenewal(code) {
  let L; try { L = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8')); } catch (e) { return { ok: false, error: 'This copy has no licence. Contact Prepfix.' }; }
  const r = parseRenewal(code, L.id);
  if (!r) return { ok: false, error: parseRenewal(code) ? 'That renewal code is for a different church.' : 'That code is not right. Check it and type it again (it starts with PFX1.).' };
  const before = readLicense().until;
  L.renew = [...new Set([...(L.renew || []), String(code).replace(/\s+/g, '').trim()])];
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(L, null, 1));
  LSTATE.suspended = false; saveState();
  LIC = readLicense();
  return { ok: true, until: LIC.until, changed: LIC.until !== before };
}
// check-in with Prepfix's Google Sheet (only when the internet is there): who uses the toolkit, and suspension / renewal / message from Prepfix
async function checkin() {
  const url = KIT.checkin; if (!url || !/^https:\/\//.test(url)) return;
  const L = readLicense();
  const body = { id: L.id || '', church: L.church || '', state: L.status === 'ok' ? L.phase : L.status, until: L.until || '', computer: os.hostname(),
    version: KIT.version + ' (' + KIT.build + ')', songs: (data.songs || []).length, playlists: (data.playlists || []).length, time: new Date().toISOString() };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    if (j.code) applyRenewal(j.code);
    LSTATE.suspended = /suspend/i.test(String(j.status || '')); LSTATE.message = String(j.message || '').slice(0, 500); LSTATE.checked = Date.now(); saveState();
    const before = JSON.stringify(LIC); LIC = readLicense(); if (JSON.stringify(LIC) !== before) pushData();
  } catch (e) {}
}
// ---------- Prepfix Team app: the praise and worship team sees the church's songs on their phones and sends playlists back ----------
// Works through the same Google Sheet web app as the check-in. Turned on (with a team PIN) on ONE computer of the church.
const TEAM_FILE = path.join(DIR, 'team-state.json');
let TEAM = { key: '', hash: '', got: [], last: 0, error: '', sending: false };
try { TEAM = { ...TEAM, ...JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8')), sending: false }; } catch (e) {}
const saveTeam = () => { try { const { sending, ...t } = TEAM; fs.writeFileSync(TEAM_FILE, JSON.stringify(t, null, 1)); } catch (e) {} };
const teamCfg = () => (data.settings && data.settings.team) || {};
const teamLink = () => { const L = readLicense(); if (!L.id || !KIT.checkin) return '';
  const slug = String(L.church || '').toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return KIT.teamUrl ? KIT.teamUrl.replace(/\/?$/, '/') + '?church=' + (slug ? slug + '-' : '') + L.id : KIT.checkin + '?team=1&church=' + L.id; };
const teamStatus = () => ({ on: !!teamCfg().on, pin: teamCfg().pin || '', link: teamLink(), ready: !!(KIT.checkin && readLicense().id),
  last: TEAM.last, error: TEAM.error, moved: TEAM.error === 'moved', songs: (data.songs || []).length });
function teamSongs() {
  const songs = (data.songs || []).map(s => { const o = { i: s.id, t: s.title, x: s.text }; if (s.link) o.l = s.link; if (s.folder) o.f = s.folder; return o; });
  const folders = (data.settings && data.settings.folders) || [];
  return { songs, folders, hash: crypto.createHash('sha1').update(JSON.stringify([songs, folders])).digest('hex') };
}
// a playlist sent by a team leader becomes (or updates) a playlist on this computer
function teamPlaylist(x) {
  const ids = [], secs = {};
  const known = new Set((data.songs || []).map(s => s.id));
  let added = 0, links = 0;
  const byTitle = t => (data.songs || []).find(s => String(s.title).trim().toLowerCase() === String(t).trim().toLowerCase());
  for (const it of x.items || []) {
    if (it.sec) { const k = crypto.randomBytes(4).toString('hex'); secs[k] = { name: String(it.sec), lead: String(it.lead || '') }; ids.push('§' + k); }
    else if (it.n && it.n.t && it.n.x) { // a song the member added: goes into the library, folder "From the team"
      let sg = byTitle(it.n.t);
      if (!sg) {
        sg = { id: crypto.randomBytes(4).toString('hex'), title: String(it.n.t).trim(), text: String(it.n.x).replace(/\r\n?/g, '\n').trim(), folder: 'From the team' };
        data.songs.push(sg); known.add(sg.id); added++;
        const fs_ = (data.settings.folders || []); if (!fs_.includes('From the team')) data.settings = { ...data.settings, folders: [...fs_, 'From the team'] };
      }
      if (it.n.l && !sg.link) { sg.link = it.n.l; links++; }
      ids.push(sg.id);
    } else if (known.has(it.s)) {
      const sg = data.songs.find(s => s.id === it.s);
      if (it.l && sg && !sg.link) { sg.link = it.l; links++; } // a practice link the member added to a song that had none
      ids.push(it.s);
    }
  }
  const name = String(x.name || 'Team playlist') + (x.by ? ' (from ' + x.by + ')' : '');
  const pl = { name, songIds: ids, secs, team: { pid: x.pid, by: x.by || '', time: x.time || '' } };
  const old = data.playlists.find(p => p.team && p.team.pid === x.pid);
  if (old) Object.assign(old, pl); else data.playlists.push({ id: crypto.randomBytes(4).toString('hex'), ...pl });
  return { name, by: x.by || '', again: !!old, added, links };
}
async function teamSync(claim, retry) {
  const cfg = teamCfg(), L = readLicense();
  if (!cfg.on || !KIT.checkin || !L.id || TEAM.sending) return;
  if (TEAM.error === 'moved' && !claim) return;
  TEAM.sending = true;
  try {
    const t = teamSongs();
    const body = { action: 'teamSync', id: L.id, church: L.church || '', key: TEAM.key, claim: !!claim, pin: cfg.pin || '', computer: os.hostname(), ack: TEAM.got };
    if (t.hash !== TEAM.hash || claim) Object.assign(body, { songs: t.songs, folders: t.folders, hash: t.hash });
    const r = await fetch(KIT.checkin, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), redirect: 'follow', signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    if (j.error && /not found/i.test(j.error) && !retry) { TEAM.sending = false; await checkin(); return teamSync(claim, true); } // not yet in Prepfix's sheet: check in first
    if (j.error) { TEAM.error = j.error === 'moved' ? 'moved' : String(j.error); TEAM.movedTo = j.computer || ''; }
    else {
      TEAM.error = ''; TEAM.key = j.key || TEAM.key; TEAM.hash = j.hash || ''; TEAM.last = Date.now();
      const got = new Set(TEAM.got), news = [];
      for (const x of j.inbox || []) if (!got.has(x.pid)) news.push(teamPlaylist(x));
      TEAM.got = (j.inbox || []).map(x => x.pid);
      if (news.length) { save(); pushData(); clients.forEach(c => c.full && send(c, 'team', news)); }
    }
  } catch (e) { TEAM.error = 'offline'; }
  TEAM.sending = false; saveTeam();
}
let teamSoon = null;
const teamLater = () => { clearTimeout(teamSoon); teamSoon = setTimeout(() => teamSync(), 20000); };
const PORT = process.env.PORT || 3000, MAX_BODY = 80 * 1024 * 1024, MAX_WALL = 1024 * 1024 * 1024;

// app icon for phones ("Add to Home screen")
const ICON192 = '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';
const ICON512 = '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';
const MARK = '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'; // Prepfix 'P' mark, transparent, for the church screen corner
const LOGO = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAD9A4QDASIAAhEBAxEB/8QAHgAAAgICAwEBAAAAAAAAAAAAAAEICQIHBAUGAwr/xABuEAABAgQDBAUEBwwREAkEAwABAgMABAURBgchCBIxQQkTUWFxFCKBkRUyQlKhs7QWI2JydZSVsbLR0tMXGBklNjdGVmVzgoSSoqTB4yQmJzNDRUdUVWN0g4WT4fAoNDhEU1d2o8M1ZKXxhsLE/8QAHQEAAQQDAQEAAAAAAAAAAAAAAAQFBgcBAwgCCf/EAEcRAAEDAgIFBgoIBgEEAwEAAAEAAgMEEQUhBhIxQVETYXGBkbEHFCIyM1JyocHRFSM0U2KSovAWQlSCwuHSJCU18UNjsuL/2gAMAwEAAhEDEQA/ALTyIZMAggQjjaDiNIAdbQW1gQi5ELnAdPGHx7IEII0EFrf8IPhhWECEzr2wd9oIcCEeMLl96AjnyjFTiEak27zwgQsgIDHyM40D7dPrgS+2rXeEZsVi4X0EOx48owMw0PdgQvKWj7seuCxRcL6coOPdGHlLY92IXXt39uPXBYouF9PA38YWvjGJmGzwUIPKG/fAwWKLhfThCtyj5l9B90IYfbt7YQWKLhZiC8Y9cg+6EBVfgDbuEFii4Tt3waQJIPA+iGB3xhZS5Q7aawHSAGBCILwW1gvblAhFrC3CDh3QgO+GNIEJaGGNB3QQf86QIQOMHEXhHUQ9IEI468ILWgGo1hWgQmfCA6HTWAc4PCBCIXCGeELjAhAh310EAtaC1xAhLhyhg31hcOHGA8RAhB7eEO2sIiC9jAhMDjBa8BAvCPbAhHCAWh3vCgQiHbTtgv64L8hAhAhHhD4GAeECEeMK9uUP06wX7YEJW5jSGRCA0veHaBCDwgvflCPGGBpAhAFhe8FoPVBw5QISGkHC8HO0PnAhIaiMh42hQX05QIRwhc4d7wHiIEJaiHBC4m1oEI0hnugBg4QIQDrzg05QtIfMwISGkOFwhiBCLDnBYQQCBCOAgvaED3Q7wIRBB3wE98CEj6YYgveCBCDBaCDnAhK2vOGOMIeEO3fAhH24UPQQxAhIGDjaFxNjD0veBCPRAbiDvvBxgQlYnnDtbnpARBfugQjnAOMFuMF9PvwIRygGkB1HZBa0CEQGDmDeA6XMCEHWCC+nDWFaBCYggN7QcYEIgg4QW9cCEoY9EIQ+ECE4IQPZBAhBhDjD48YANIEIgt4wr30gHZwgQn2QHjpCh8LQIRzgPrgg0ECEAQ/+dYV9O6DjAheMzizGZyoyzxJit9rygUqSXMIZvYOuaJbQTyBWpI8Ip3x5m/i/MyvzFXxDX52em3VEhvrlIZZBPtW2wd1CRwAA8bxaLttg/lY8eXH/AHRr5Q1FQyyEuKt2xePg/pYTTS1JaC/WtfmABy7c+pVzpRNJyrIQ7ybXt1n5Ls0VObJuZt8n9tV9+OexWp1AAE2+P9cr78dCh2OS05FwNDeCrx+txXet1idWdZx//eq+/HOYqs0B/wBae/3qvvx0DLkcxp3hrCgNbwTfJrcV37NWmr38qf8A94r78c9mrTRI/qp7/eq+/HnmV98c+XcAMZLG8E2SB3Fejl6pN/4y9/vVffjs5apzQ/7y9/vFffjzbD2gtHZSz14TvjbwTPLrcV6RiqzX+MvH/WK+/HZytWmdP6oe/wB4r78eal3Y7KXdGmsIJIm8Eyza3FelZqc0FAiaeHeHVffj0VJxrXqbbyWtVGXsdOrm3B/PHi5d3Qa3jsmHe+GuaCN+Tmg9SanSzRm7HkHmJW4MPbQmOaKoD2bcn2//AA55CXgfSRvfDG2MJbWbDyks4hpRYB0MzIHeA8UK19R9ERXZe747CXXe14itZgGHVQOtEAeIyPu+Kd6LTDHcLcDDUucBud5Q997dRCsJwzi+j4wkRN0ioMzzI9t1Z85B7FJOqT4iO4tFf2Hq/P4aqDc9S5t2Sm0cHGlWNuw8iO4xKbKXPeUxopul1YNyNZIsgjRuZ+l96r6Hny7Iq7F9GpqAGWA67B2jp49PuV8aLeEakxp7aOvaIpjkPVceAvsPAG99xJyW2zpBa8HEcbwEWPGIWrkSvD4QcCNIOfGBCLwQHhAeECEcoLWg1gGmkCEuV+Ah6EQQcoEIuYL24aQEwraawIReH3wuPd4w/hgQkReHfgIQ4QXgQnzg4wWEF4EIPdALwiYfCBCXK0A74OAgAMCEGGIDraEIEJjS8GsHwQcoEItCv2wXuYNTAhZW5wgILaQiDbWBCZ1HKFAR6IY15QISv3QzwhWh37YEIvrAYPTBbSBCX/N4OcO/hArWBCIOI4QuA74ZNhAhF7wDTuhcYLwITggMI68oEIvfhDhWvANO+BCfAwcdIOEK4MCE4WsPWCBCL6QQuekFzAhPhCuOEPW0HdAhLhDvBxg5QIRa0F+2CERAhO94OA+/APVBx15QIQINPCDuEECEQG0HbBAhKHBwEAgQgWgtB9qC+psIEI4QvggGptaHwgQgeMHqgvrBoD2mBCL90HohkwjAhAEA4wcBBz1gQj0wDx9cHKDWBCALQAmDWHAhIcYIOHbBAhFjeC0IKBKgFC44i/CGYxe+xCIIYNoIyhY2MPl4QEd/CA2gQjjBblBeFcc9YEIt6YZHpgv8MI8YEJi/KDnaACFwgQmRAON7Qi6kAkmwHG/AR09NxpQqzWnqTI1SWnKgy31rjMusL3E3A1I0GpGl7xsbG94JaCQNvMtL54onNbI4AuyFztPAcVqbbXKfysmPSeHkTXyhuKfXVWdX4xbxtyqU3sv48I1vLMj1zDUU/lZC1X7ecXroAbUEntnuaq80mF6lh/D8SuShVjHKaXHCbXfjHIQqLVaoO9q7Ftel7xyG3dRHXtrvHISuwhQCkLmrs2nTfjHYyznfHQIdIOhsY5Lc6432KEbQ4JFJFfYvTsOgc47KXfAjybFZbTbrApPeNY7iSqcu9YIeQT70mxgNimiancBey9Ow9oI7KXdNxHQS73COzl3tRCR7UxTMXfyzul7x2Uu5wjopZ29tY7WXWbCG2RqY5mLumF8I7BhzhrHTy7nDWOwYVwhue1M0rV27DsdlKuqStK0qKFgggpNiDHTMrjsGF8IbpG3TTILG4UuMi81jjCn+xNTd3qxKoulxR1mWx7r6Yc+3j2xtrjziBmHa3NYdq0rU5JzqpqWWHEK5d4PcRoe4xNzCWJJfFmHpGqyx+dTTYXu3vuK4KT6DcRSmkeFCim5eIeQ73H5Hd1rrTwb6WPxukdQVjrzRDadrm7AekbDxyO0ldvByggtpEOVzp2hG2mkHE2h8ORgQkYCeUA1/4wHTvMCEdw0g5QeBt4wu60CEDSCHx0g3YEI4wcIQNoOMCEHSCH46weECEr90O/KAanWHbWBCxJ7oZF4LQXECEA62tBYcoL3gMCEFWloDwh2EYnSBCDpDvzg3uyENTAhPS8G6bQBMIm3bAhFrcYYN+MF94dkBTpeBCOMB8de6FDvAhLnDgtf/AIwanwgQl8MODd//AHADa8CEib8oCfTBeHYgcYEJXtDveGNYR8IEI4/8IO2C1zBw7YEJc4fhD5RjY3gQnwhX5Qx2GHYCBCXAffg4wEW74V4EIJ8YYNzygsTDAtAhLhwgvD4wt31QIReC8EAECEEwuWsMiHbtgQsecZEwrQAaQIReFzh2h2gQlx7oAbQzC4wIQBc3MF9DBumDieUCEAiDnwgtzgtygQgD/kwW4i8Fu+C3bAhB1g48eUMaQjAhHHlCGnjDPf8ABDtygQlfl8MBgOhgtx1gQgawc4Q15aQxa0CEfbg+GDhBb1wIRrBrASEjWNcY2zflKR1kpSNyenRdKnuLTZ8fdHw074asRxSkwqHl6t+qN3E8wG/93S2ko562Tk4G3PuHSV7etV6n4elDMz8yiXb5b2pUexI4k+EalxTnBPVLfYpCTT5Y6dcqxeV4ck+i5jXVWrM7Wp1c1PTLk0+r3SzwHYBwA7hHvcn8GqrM6KxOt3kZZdmUKGjrg5+Cft+EUxPpPiek1W3DsNBiY7ePOtvJI2DmHRc3U8jwelwiA1VX5bh2X3ADf19Ngvf5ZYXmaDS3ZqeUsz88UuOJWokoA9qDf3WpJ8bco9npDHC0KLsw+hiw2lZSw+a0b9p3knnJzKr+pqH1Urpn7Si9oILCCHBJkWtBxgGnbAOECEGDQiAwWgQga6coIALwGBCS1pbQVKISkC5JNgO+I8482uJCmzcxJYakBU1tqKPLplRSwSOaUjzlDvuAY2bnbMTUvlVilySUpL6ZBeqeIToFfxbxAEm2ptrFjaK4HTYi19RUjWDTYD33P74qltP9KK/BnxUdAdQuFy6wJ22sL5bjc7dll7vGWa+KMelSapWHlyx/7oweqZH7lPH03j32yEXG8waqnXd9jVaf6xEaGQ9u8437sdvB3H9W7fY1XxqInmN08VNhE7IWBoA2AW3hVDotU1NZpHSy1Mhe4u2kknYeK99tyPAbLuOSf/Alx/KW4p/eI61WvOLedvTzNlrG9ubct8pbin1TpC1eMJdAiBh8ntnuaugtJBepZ7PxK5KFERyW16xwULv4x9kOd8WiCoY5q7FtYEfUOnxEdeh28chtwa+EbQ4pKWKdWSHR+0vH2VdJxJX8SVGRqlYlUzksxIttlmXbWLt7+8LrNrEgFPG3fGh88tmHGuRcy47U5I1Kg71mq3IpKpc9gcHFpXcrTsJizfZ1c6zIXLtVuNAkviUx72akGJ+XdYmGkPMOpKHG3EhSVpPEEHQjuMUCzTXEqGvlEpEkesRqmwsAdxAy67qzX6OUdTSs1BqusM+reP8A0qJ1LPCMFHtixrP7o+KLicTNYy8Uzh+qG610h0kST54/OzqWVHs1R3Jiv3HOCK/l3Xpii4jpU1SKmx7aXmUbpI5KSeCknkpJIPbFxYRj9DjMd6d/lDa05EdW8c4yUBrsKqcPdaVuW4jYV1TFdnaefnEy4ge9JuPUY7mnZlzMuoCblW5ge+aO4r1aiPKOG8cZ0btzD+c00uo4JxaRgK3PRcwaNPFKFTXkjp9xMjc/jcPhj28o+lxCVpUFIULhSTcHwMRXdc4xyqNimq4deC6fPOy44lsG6FeKToYTvZrbEx1WjTZQTTvseB2do+RUspdy4jsWF2taNIYTz2l3Chiuyplzw8rlQVI/dI4j0X8I3BSKpKVaUbmpKZbmpZftXWVbyT/x7obZY3N84KusRw2poXWnZYcdx6/2V37C7xz2FWtrHUsrjny678YbHtUXlau6l3bi0SH2YsVKJqOH3nNLCblwTw4JWPuT64jjLKtaPeZR1hVEzGoczvFLangwvsKV+Yft/BEUxukFVRSR2ztcdIz/ANJ90RxJ2D47TVANmlwa72XeSey9+kKaJ4aQJ9cJIunthjzYoZd6Bab2nNqPC+y5gySruIJaeqLs/NeRychTkp611YSVKJUshKUpSLkk8wADeIrHpj8E71hl9iY/vqV/Cjg9MepRwHlskaA1icP8nTFWafNGvGJTQUEE8Ae8ZnnTbUVD436rVa6npjMEc8AYnH75lPwof5sbgb9YOJ/riU/CiqIq00hA3hx+iqX1feUl8blVrw6Y3A5P6AcT/XEp+FArpisD8sA4m+uZX8KKoSYV++D6KpR/L7ys+Ny8Va+10x2BQv55gHFCE9qX5RR9W+I9fhrpasmK2ttFSlMUUAqIBXM01L7afEtLUf4sU5A3hlVhHk4TTHYCOtZFZKF+hzLDaPyyzjSkYPxrSa3MKF/JG3w3MjxZXuufxY2T1iTw1j8zrM28w80+04tp9pQU26hRStBHApUNQe8RNLZc6THGuUk1KUbMB+axzhG4R1z69+pSSeF23T/bkj3jhv2KHCGqowdzQXQG/MdqVR1gdk8WVyXEQW0jy+XmZOHs1sJU7E2FaozWKJUG+sYmmDoeRSoHVKknQpIBBFiI9OVWFjpEdILTY7U4A32KPm1Ttn4R2VW6IzWqdUq1VasHXJeRpobBS02QFOLWsgAbygABcnXsiOn5snggG35H2JvrmV/CjWHTEAnM3Lq3D2Fm/lKYr03bxKaPDoJoGvcMymyaofG8tCtcHTH4IV/g/wATj98yn4UZjpiMD8fmAxN9cyv4UVQb1uEG+e2HAYXSDa33lJ/G5Va+emMwOn9QOJvrmV/CjA9Mjggf4P8AE/1zK/hRVEVE98Ma8Yx9FUp2N95R43KrXmemOwM4vz8AYoSntTMSpPq3hHtMMdLHkxW1NoqcvibDylHzlzdND7afSytR/ixTcDbhAFmMHCaUjYe1Hjkq/Q9lltH5ZZw7qcH41pFbmCL+SNvhuZHiyvdc+CNkhQIvH5nWp56WfaeZdU080Qpt1CilaCOBChqD3iJlbMHSX48ymnJSj47fmcd4QBDZXMLCqlKJ4XbeV/bQPeOHwUIaqjB3NzgN+YpXHWB2TxZXMb+sG7zMeXy2zLw3mzg+n4nwrVGatRp5G+1MNGxBHtkLSdULSdCk6gx6dS7DTWI6QWmxGacL3zC8JnZnDQsh8t6zjTEJmFU2mIRvMyiN955xaghttAJAupRAuSAOJ0EQwHTI4H3rHL/E48JiV/Cja3ScvEbIuKLj20/TU/ypEUoOAX0iR4dQRVMRfJtum+pqHROAarXB0xOBlanAOJ/riU/Dg/NisCp/UFif64lPw4qfKj2wgonth2+i6T1feUj8bl4q2D82OwNf9AOJ/riU/ChDpjsD/rAxP9cSn4UVQgmMgIx9FUvq+8rPjcvFWujpjcEE/oAxN4+Uyn4UZDpicD/rBxP9cSv4UVP71oCs9sZ+iqT1feVjxuXirXldMZgdP6gcTH98Sv4UfMdMhgpRA/I9xMf31K/hRVKBfnH1ZsFaxj6KpTu95WfHJAv0T5L5uUXPPLeiY1w71/sVVWlLbbmUbjrSkqKFtrFyN5KkkGxINrjQx5Tad2pcLbLmE6dWMQys/Un6lMmVkpCnISXHVJTvLUVLISlKRa5J4kACPA9GipJ2OsGFNrddPfK3Y0D0yj6kYUytSBxqNQ+Ja+/Eaip43VvIO825HZdOb5HCHXG2y7x3pisDN/qCxOr98Sn4UfMdMdgc8cAYnH74lfwoqhKieJh6iJMcKpdzfeU2eNy8Va4emMwQOGAMTH98yv4UMdMdgfngHE4/fEp+FFUG9rDOvOMfRVL6vvKPG5Va9+bGYHPDAOJvrmU/CjJvpjcCBfzzAWKAntS/KK//ALiKnb98ZA3g+iqU/wAvvKPG5VcnhXpZMla8621UmsS4cKjZTk7TQ82nxLK1H+LElMss/wDLrOJnfwbjCk4gUBdTEtMATCR9Eyqyx6Ux+dq+ukfaUqM1T5xmblJh2Um2VBTUwwstuNkcClQsQfAwnkwaEjyHEHtWxta6/lBfpg3k24wAkmKh9lTpPsVYBm5OgZpuzGLcMEhtNZ3d6pSQ98o/94QOYPn9hVwi2DCOMKLjrDlPr1AqUvVqPUGQ/KzsqvfbdQeBB+Ag6ggggERG6mklpTZ4y4pyjlbKLtXc8I1PnNn/ACOUs1JSCacuqVKZb64sh0NJbbvYEqsdSQbADlG1ireiG22IkfklU4n/ACW38Y5D1o5QwYjXthqBdtibbO5Q7TLFKrCMJfU0btV9wL2Btc8Dl2r1CdtJw6nCSR/tH+jhnbWWn9SQ+yH9HEXy5pxjArBMW/8AwphH3P6nfNc8fx3pF/U/pZ/xUohtrrP6kh9kP6OMhtqr/WkPsh/RxFvfEHWAxj+FMI+5/U75o/jvSL+p/Sz/AIqUh21VfrTH2Q/o4Py6qv1oj7If0cRc3wYA4AYP4Uwj7n9Tvmj+O9Iv6n9LP+KlINtNX60k/ZD+jg/LqKvrhIfZD+jiLm/DDnbGP4Uwj7n9Tvmsfx3pF/U/pZ/xUnl7abl9MIgj6of0cbMyYz8k82pmfkjTXKVUJVsPdWXQ6hbZNrhVhqDa4I5xBcOW8I39sdbvzeVojj7Gn41EMeN6OYbS4fLPDHquaLg3PEcSVKNGNMcbrsXgpqqbWY82I1WjceABUs61V5fD1InKlOLKJSUZW+6oC5CUi5sPREdHdtFsvOBnCqyyFHcU7PBKiOVwEEA+kxunN1QGVuKidLUx/wC4MV5PKF7iGDRTBqPEopJKpmsQQBmRu5iFLdPtJMTwaoghoJNQOBJyBvnbeCpQr2z9P0Kf/kP6OMRtp7vHCdvCof0cRcDph7wMTv8AhTCPuf1O+aqr+PNI/wCp/Sz/AIqWGH9siTqlck5Kew67Iysw6lpUy1NBwt3NgSncFxrrYxI1ToabUtwhISCST2DjFZtKcSipyZ/z7f3QizF1XuQL3uNYrrSvCaTDHw+Kt1Q698ydluN+KuXQHHsQxuKo8efrFmrY2A2619gHBRvqu2dKS88+3I4bcmpVKyG3npsNqWntKQg2v2XjiDbSUT+hL/8AIf0ceB2hcoPyPsSGpyDJFAqSypq3CXd4qaPdxKe645Rp9xYRpE1oMAwSup2TxRXBHrOvz3z28VWGKaWaU4ZWSUlRPquafVZa24i7dhGxSiG2iLfoV/l/9HHxXtrEEgYSuPqh/RxF0ukxkhQ5w4fwphH3P6nfNNX8d6Rf1P6Wf8VO3KDP2lZrPPSQlXKVVmkdZ5K6sLS4gcShQAva4uCAdY2oEi0Vr4bxTOYRrEnVqc6WJ2UcDja+V+YI5gi4I5gxPvLHMSQzNwlKVmRIQVjcmJfeuph0e2Qftg8wRFa6TYAMLeJ6cfVOy42PyO7r5ldOhGlj8cjdS1pHLtzvs1hxsMrjfbdY8V62/dB3wBMIq3f+MQVWqnHDq1Zk6HIOzk8+iWlmx5y1n4AOZ7hHWYwxtTMF0wzc+7Za7pZYRq48rsSPtk6CI14yx3UcaVDyicc3GUE9TKtn520P5z2k/AIg+kWlEGCM5NnlzHY3cOd3y2nm2qT4PgU2Ju13eTGN/HmHz2D3L12PM2pzEynJSR35KlnQi9nHh9ERwH0I9N48GH76co69MxfSPtLNOzkw0ww2p151QQhtOpUomwAjnKurqrFagz1Li5x/dgNw5grcp6GGii5OJuqB+7kr1mCcLvYwrbUk2Shkee+9b+1o5nxPAd8SWp9Ol6XJMykq0GWGUBCEJ4ACPPZdYKbwXQkMKsuees5NOjW6re1HcngPSeceq48Y6J0S0fGDUnKTD65+buYbm9W/n6Aqhx3E/H59SM/Vt2c/P8ubrSAPCGIILXieKNIN+2CCCBCXGH6ILc4LwIR3QceMBGsFoEIKrCDjHDq9Wk6FJLm559MuwjQqPM8gBzPdGtK7nOtxW5SZYNtg6vTAuojuTwHpiO4rj+H4MP8Aq5LO2hozcer4mw505UmHVNafqW5cdy2LiSlIrOH6nT16pm5V1g/ukEfzxWe8pbbim1jdUglJHeNDFnUs4Jphp5Bu24EuJ8CLxW9mpTxhzMXE1OtYMVF8JH0JWVJ+AiL20CnD3TRA5EBw94+IXPHhRoy5lNUW2FzT12I7iulS5YamN97GbpVmPVgD/etXxqIjj15POJC7E7oXmTWBz9ilfGoie6RtthM55viFWGiEdsdpT+L4FbL2+XNzZYxse1MoP5S3FO7iruqsecXBdIGP+ipjS3bJ/Km4p1WuzivGGTQQ2w5/tnuauhdIBeob0fErlocj7Jc9UcFLl4+iV2izQ5RFzFz0Ox9UPWPojrw7pGaXeOvKNmstXJq8HZv/AEgcuf8A0/JfEpjZFt3wjWuzX/2fst7/AK3pH4lMbJvbwjkev+2Te07vKumm9CzoHclz4+iPH5m5QYTzgoCqTimjsVOXFy04obr0uo+6acHnIPgbHmDHseEO2sJYpZIHiSJxa4bCMiFuexkrSx4uDuKq02iNg3FeVqpqs4UD+LcMoutQabvOyqePzxtPt0j36PSkRE929jcRf0QFaH4IjjtBbEOCs50zNUkGkYXxS5dXsjJNDqphX+faFgr6dNld54RcOCaeEWgxUX/GB/8AofEdm9Qav0cGclH+U/A/PtVQ7idY+KkaRtHOnIDGeRla8hxPSlsyziimWqUvdyUmfpHLcfoVWUOyNaKR3RcdPNDVRiWBwc07CM1DnsfC4skFiFx7W5ax3OGMXVTCM95TTJkslX9saV5zbo7FJ4Hx498dZ1fdD6q/KFWprCxWqVrJmGOQAg7ipQZc5n0/G7QZNpOqITdcopV94c1IPMd3EfDGxJcX1iEMk+/ITLcxLurYfaUFodbNlJUOBBiT2UeZacbSRlJwparMum7iRoHk/wDiJH2xy8DDNWUhjGuzZ3KndItH/Egaqlzj3j1f9dy2lL6Wju6ZNmSnJZ9JsptxKwewggx0ksLgR2sui6ka8TEXnFwQVWJJEgI2hT4Zc6xoLHBQuPTH0GsfCRTuSjKTxShIPqEfcHWOb3bV9H2EloJVcvTHaYDy1+q858nTFWBVFpvTH/oEy1+q878nTFWFonGF/ZW9femar9KshrDItCGkBJPAXMO2QSNF4cb+y92D87M0cHUrFGHMIInqJVGfKJSZVVJVouN3IvurcChqDoRHfudGrtENi5wG2od1YkvxsJTVwA2Lx2hbeSk9UqMPOCN8Yu2Fs+MFSLs7Uctaq7KNJ31uU5bU6Ujt3WVqV6hGiloUy6ttxCm3EKKVIULFJHEEHgR2GNrJY5PMddeXMc3zgsAbQE7xgKYLWjavClPsFbWc1s4Zks02rTa1YArr6Gamws3RJuGyUTiByKdAu3tkX5pEXdNPpmkpUhSXEKAIWk3ChyIPZH5nt3f0OqTxHbF4PRwZuv5r7MdDTUJozFXw26qhTK1qutaWgksLPPVpSBfmUmItjFMBado5inWjlv5BKiV0xKrZmZdj9hZv5SmK87kxYT0xV/yT8uvqJN/KUxXqBDthv2Zn73pLU+kKCLwWMOEpYSkk8tYcst6SItaC8SLwv0fmfGMcP0ut0vBKJimVOVanZV41WUR1jLiQtCrKcBF0kGx1jtV9GjtEjUYDbPd7MyX42Epq4B/OO1bRFJ6pUYL+uCN84u2E8+MDU96eqeW9UdlWklTjlNWzOlIHElLK1K9QjRTjKm1qQtKkLQSlSVCxSRxBHIjsjdHKyUXYQV4cxzPOFl8+EAcI4QcLwXAjavKkfsSbWNU2aczWBOzLruBKu6lmtSNypLQOiZpscnG+Jt7ZAIPubXpU6cYn5NmZl3UPy7yA4262oKS4ggEKSRxBBBHjH5oW1bpvb1xdB0YObz2ZGzhL0eovl+qYSmzSN5SrqVLFIclyfBKij/ViIxi9MABO3bvTpSSk+QV2PSgW/KjYm/0+m2+uUxSYom5i67pQUn8qJiS3Ko00/wApTFKJ4wpwf0B6fktdb54WPE8NYY9UOMVaG94ftib1kDC3o2bljsxZp5y0B2t4JwXP4hpLUwqVXNSy2kpS6kAqR560m4Cknhzj2iNgLaCWLnLCqDxmJYf/ACwnNTEDqlwHWtnJPIuAo/EXgA9USD/KBbQKT+ljVD/r5b8bB+UE2guWWFUv+3y342DxmD1x2hHJSeqVH4Cwh7xBAtG/jsC7QY/wX1U/6+W/Gxk1sC7QK1DeywqoH7fLD/5YwaqEiweO0LPJP9VWd9GTY7HGDNbfP5/5W5GiOmUI+ZLKzt9kah8S1ErdizJ+uZI7OGE8JYlbbYrksl+YmmGXA4llTry3Or3hoopCgCRpe9ieMRR6ZMAYTys+qNQ+JaiJ0xDsRu3Zc/FO8gtT2PBVdnQcIwJjJR1haRNUxo4awrm5gUSTYaxIjA+wDnlmDhWk4jomDG5qkVSVbnJSYVVZRsuNLF0q3VOAi45EXjU+aOPz3AdK9NY53mi6jxaEdIk8/wBGxtENGwwEhX0tYkvxsebxbsJZ84IkHJ6p5bVRyVaTvrcpq2p0pHaUsrUr1CNQqoHGweO0L3yUlr6pWhdTGQNuMZOoUw6ttaVIcQSlSVCxSRoQQeBHZGNrwqHMtRTC90aaRMno4NrKayazGYwPiGePzDYkmEtjrleZTp1XmtvJ96hw2QvlqlXI3hqExmka2uQDoSOMaJ4W1DCx62RyGN1wv0xtaovrcaG8Qw2y3NzM6mjl7FN/GORtbYkzifzq2bMIV+emPKKuwwaXUVHUqmJc9WpZ71pCF/uo1BtoulOaNMFv70t/GuQj0RjMeMcm7aA5RjT/AOswJxHrNWjVOxj1nfHG66F1sX5qrlnk1yusgDnpjihyPc4GyZxhmTSnajQKc1NyjTxYUtc020d8AEiyiDwI1hPPPDSs5Sd4a3iTYe9K6ahqKyTkqZhe7gASewLyIXfnD342iNlbM7/ITHoqDH4UZDZXzN/yEx9kGPwobfpnDP6ln5m/NOp0bxj+kk/I75LVwX3wwuNpDZYzN/yEx9kGPwoPyrGZv+QmPsgx+FGPpnDP6ln5m/Nef4bxj+kk/I75LV3WWiQGxosrx/Wuz2MPxqI8h+VXzMv/APQmD/tBj8KN2bMuSGJsu67VqriBlmS66WEq1LoeS6pV1BRUSm4A0txvrEex/FaCXDJo452ucRkAQTtHBSvRXAcUp8ap5pqZ7WtNyS0gDI7yFtbOUEZU4tI/yW/9wYroTMXSLxYxnOm2U+Lrn+9cx9wYrc6wC0NWggvSze18E/8AhObrVlP7J71zOu9MLrbxxA6IfXWi0NVUtqLtKcompSev92R90ItC3Rc6CKs6Y6TU5PX+7t/dCLTDzin9PRZ1N/d/ir+8Fwsyr/s/zXR41wlT8bYbnqNUm9+VmkbpKR5yFcUrT2FJsRFeGPMI1LAeKZ6iVNFpiWV5riR5rqDqlxPcR/OOUWUlNxeNQbRuTozJwv5bT2QcQ01Cly26NX2+KmT48U9/iYYdFsb+jajkJj9U/wBx49G49u5SbTfRoYzS+NU7froxl+Ju8dO8dY3qCm/aH1/ZHHecKFFJBSQbEKFiD2GPkHIv4NuuXOTI2rmb+9oTGzch82HcqsVpdfWpdDnSlueaGu6OToHvk39IuOyNTdba1ozRM20hLVUcVZC6nmF2uFj++5LqGqnw6oZVUzrOabj98DsPMrTZSeanpZp9haXWXUBxt1BulaSLgg9hBvHQY+x7IYEoxm5qzsw7dMvKg2U8v+ZI5nl42iP2yXnSl0IwRV3xvAFVLdcPHmpi/rKfSOyPY7ReApubS3iiSW4+3LthmaYJJDaL6LSOQufO9B7Y5I00gr9HIZhAzWc3MH8PrW32G7p4LuDQmuodJzBLK7Va7Ijg71b7rnYd4I2XWo8TYnqGK6y9Uai91r69AlOiG08kpHID/iY65ExyMdcmZh+UaxyBK9873SyG5JuSdpXVDKdsTBGwWAyAXaB3e4RvXIXAagyMSz7fnLBTIoUOCeBc9OoHdc841hlJgZeP8RBp0KFLlbOTbg5jk2D2q+1cxLdhhuVZbaaQlttCQhKECwSALAAdwi0tCdH/ABiUYnUDyW+aOJ49W7n6FW+lmLCnZ4hCfKd53MOHXv5ulZ8IOMEF9IvZVEjh/wAYR1hju4w4EJcO2CHBAhIC40sIY5wr9sFxxvAhBPrgBPKNK5sbTVJwBUJijU2W9l6yz5rt1brDCuxShqpQ5pHpIjzezrnbWMc41rNNrs717kywJiUQEhDbZQbKQhI4XSoHt82JE3Aa40bq5zbMAvntI4gcLZ52y2KGyaWYW3Eo8LY/WkcbG2xpzyJ4k5WF89tl7fO/ri5SUknyWziu4r0/mP241elQTG7M4KUqoYQXMJHz2TdS/wB+6fNV8Bv6I0bYnjHH+nNO+DG5Hu2PDXDs1e8FdEaPyNkoGtH8pIPbf4qQ+AamajgymOXutDfUq8Und/mEQj2t6Sqk521J6xSiflmJoaaX3Nw/CiJeZKzococ7Jk3Uw/vjwUPvgxH3bypfUVvCdWSnzXpd+TUbc0KSsfdqjrfwT4h4x4q5xzfGWnpaM/e1c7+E+gvRzWHmPDuo5dzlGLygARIfYddLmaFZH7Eq+NbiMpfN4khsJPb+adaH7DqP/vNx0NpMy2D1B/D8QqA0UjtjNMfxLbfSCq3dlPGh/wBD+VNxTi4fnivGLjekGF9lHGnjJ/Km4pycFnFeMRTQX/x7/bPc1Xtj3p29HxKaVcI+oXHySLiMhFlhRYr6BZhhwi+nKMQLx9EJvfTlGwAleMleLszqKtnrLU8zh2R+JTGzNY1ps0W/K+Zbf+npH4lMbLJjkuv+1ze07vKuCn9CzoHclxEPlBftgvCBb090dtoIAIxUbc/TAhddiLDVJxZSJqlVqnytUp0yncelZtoOtODvSdPTxEVg7cey3QMjqjR65hZbsvRKy86wqnPLLnkrqEhVm1HUoKSdFXIKeJB0n1ndtK4JyGp5ViCo9dVnEFUvR5Kzk292HdvZCfolkDsvwisLaO2jq/tF4llpyosNUykSAWmn0thRUloKtvLWo+3cNgCbAAAADttzQWhxXxkVEd20+d77HZZWG833jZx3KF6Q1NHyRidYybrbR0/JaWLNoXV87RzOpBhhmOhGsVb8ouHuRzqJWJ3D1UlqhIOdVNS6wtCuR7Qe0EaEd8LqYx6nUaRtLARYrW4tkaWvFwVMrBWImcW4fkqrLApbmEXU3fVtY0Uk+Bv8Ee8wlS11jE1JkUgqL8023YdhUL/BeI4bNWISh6p0JxRKFJE4yDyIslYHiCk+iJj7OtEVW8wmpopuxTmlPqPLfPmoHrJPoiq8e/7cyYnY0Ejsy9+So+PA3SaRRYYweS57beyTc9gvfoUskJCbjvh314QhcWEO2sc3Lu8bFXJ0x/6A8tfqxOfJ0xVha5MWndMh+gTLX6rzvydMVYxOsL+yt6+9MtX6RO0ZN6LTftEJOsZptvp8RDskKvl2Dik7JOVhA/vKn4xcb9Une4gGI/7BA/6I+Vn1GHxrkSEBAPGK2qPTP6T3qTt80LANoJsUi/bziurpUdmChP4LVm5RJFqSrsjMtM1ssICEzku6rcQ8sDQuIWUDe4lKje+6IsXNjEX+kircrQ9kPHbcy4lK6kiVp8slR1W6uYbIA7wlCj4AxvonujqGFm8ha5mh0ZBVHKk7qiIwsQdYzcG6tXPWMSbiLC2qOICrcIsp6G7ETyqpmfQFKuwW5CooT2LBdaUfVu+qK1CYsZ6GyVUvHOZs7b521TJFgnvU86r7SYacTsaZ1/3mEspfShcLpilf2Tsu/qLN/KUxXnFhnTFEfkmZdDn7CzfylMV6co94d9mZ+96Kn0hT4xi4gLQsfQn7UZRiu4Qsjjun7UORAskg2r9EOzhLhrZ/yyB1/rYph/krcbJ3k9ka52c172QGWdxb+temfJW42KBc+EVpL57ulSVnmhYKZSo3I1HMcYrt6VDZfo81glzNzD9Pbkq5T5hpquFhASmcl3FBCXlgaFxCygb3EpVrfdEWLxGbpF8QSlC2Q8wkzS0oXPsS8hLpV7t1yYb3QO8AKV+5hVRSPjqGFu8gLxM0OYQVRepsgm8IRm77Ym99Y+fGLCUdWQiw7oc8RvsZj5i0HevLTVJlp/c+jafLd/U9FeHZpE/eh4lFOZ2Y4mQDuM4cS2fFcyi33BhtxEA0r7pTTZShS16T47uyLiW/OoU35SmKT1Ebx7Lxdj0npSdkPE9/8epoHj5UiKTCNTCPB/QHp+S31nnhMiMSje0EAEZpNjeH619qb1b70RMqU7NtaUqxBxPMgX/aGInPuJ4boPoitno0NpDLPKrISqUfGGNqNhyqLxBMTKJSoTHVuKaU0yAsC3AkKHoMS5/Lu5EH/Cphj6+H3ogVbDIah5a02vwUgheOTbcrdpQj3ot4Qw2j3o9UaSG2zkSR+mphj6/H3oY22Miv/NTC/wBfj70I+Ql9Q9hW3XbxW7dxHvR6ox3Ek+0T6o0t+XVyLJ/TUwv9kE/ej22XOdeBM20TqsGYrpOJfIikTIps0l1TO97XeA1ANjY2toY8uikaLuaQOhZDmnIFe1sTYcorf6ZNP9aeVh/ZCofEtRZCHBFbvTKEnCmVluHsjUPiWoW4b9rZ+9xWio9E5VckemETDhWifJgWbSglYj9AGx4oK2YcqlAccMyPxYj8/qNFC8foB2NlA7LuVJHD5mpL4sRGsZ8xqc6La5bmDevCEUpUdQARzHERlvC+kBABuYiidVW30q+zNQWcMs5uUSTakaw1ONSdc6lASmbQ7dLT6gNOsSsBJVxUFi/tRFXyk2OkXW9KDXZSk7JmIZR9aUvVSfkZOWSo6qWHg6beCG1H0RSiu6SRE4wl7n03lbimOraBJksTcGHc2hamGOEPKRK1TodcSPT2X+YdAWslin1aWnW0E6DrmSlXrLIj2m2y5u5pUsW/vS38a5Gt+hpk1opGas6oENOTVOl0kjQqS28o/AoRsTbedSjNGlAjX2IR8a5GrRsA6QG3A9wUb01F8APtN71H7rdYA5HGLo7YXWf8mL31VzXqLnB6wibOxOpK8sqlbj7LOfFtxBkLKucTi2H0lOV1Svr+e7nxbcQLTUWwl3tNVjaAtAxpp/C5SLvY2EIG0CiL8dYQMc8rptZXgveEYB4QITNxCvaGVWhEgwIXi86jfKTGH1KmPuDFaRXYRZXnVplFjE/sVMfcGKyluxd+gAvSze0O5c/+Elt6yD2T3rldZ4Q+s1jhB3WH1lucWnqKnTGu2pjo9k5P9vb+6EWrmKm6Y8fZKU1/uzf3Qi2QxTfhBFnU39/+KvXwaN1WVX9n+aQ4w1DSx4QtOEBioVdqhltcZNfM7VFYypEuEU2ec3ag02NGXzwc7kr5/RfTRGxTlotRr1Ck8SUecplRl0zcjNtKZeZXwUkjXwPYeRitvOXLOeymxrNUaZKnpRXz6SmyLB9knQ/TD2qh2jsIi99Dcc8dh8RnP1jBlzt+Y7utc56caN+Iz/SFM36t5zHB3yPffmXjy7cww73xwyvvg63SLN1FVWouzlZ96SmWpmWeWxMMrDjbrZspCgbgg8iDE/cgc45fOLBS258NqrcmkS9RlyBuuAiwdA96sXuORuOyK8A7bnHrsscyJ/LHGElXqfdZaO5MS97JmGT7Zs+I1B5EAxEdI8CZjNIWgfWNzafgeY99ipnotjsmA1ocT9U6wcPiOcfMb1vbNjL1eXuJVtpCjSpsl2SdPJPNsntTf0ixjylIp0xXqlLU6RbMxNzLgaabTzUftDmTyAMS2qkhQc+MtmnZN9L0nPNh+Tmreew6LgXHIpN0qHiI8tkLkxMYJMzWK2ylNYWpTDLW8FBhsGxUCOa7fwbdpj5/YjoTMzGBBE3VhcST+Cxzb0+r/or6J4bpjTyYOaiRwMrQAPx3Hku6PW/2FsLL3A8rgHDUvTJYhxwefMP2sXnT7ZR7uQHIAR6a/ZAdOekHGLjp4I6WJsMIs1osAqhnnkqZXTSm7nG5KNLXgPwd0LTmYY1hQtCBftggsOzWFw4CBCfCCC8ECEcRGCwSBbjeMxf1Q/bAxkLBVbmL6bOUvFNYlqkFCfanHQ9v6kq3yb9973v3xzsucVpwRjajVsEhErMpLu7zbPmrH8EmNr7YmDTS8S07ErCLS9Qb8mmFAf3ZA0J8UW/gRHNTm8CBr3R0ph80eLYcx5GT22I9xHeuLMWopsCxmSME60brtPXdp7r86s5m2WKzS3ZcEOS80yUBQ1BSpOhHrvEZX5dyTmHWHdHGlltQPaDY/ajbWzhiz5rcp6M64vfmpJJkHyTchTeib+KCgx4zNqmGk4xmVJG63NpEynxOivhB9ccKeFHCHQBkxGcTiw9B2HtHvXfmg+JMrog5myRocPl7/cu0yaqYYxQ9KE6TUuqw+iSQofBePPbc9FTNZTSNTAuun1RtRPYhxKkH4d2OFgWoexuMaRMFVkiYShR7leaftxsbahoXzQZEYxlQkrWzImbRYa7zKkufaSYkfgfxHUMLSfRygf2ut83Jr8IdAJaeZoHnxntF/kFWcqZBPGJLbA7m/mvWh+wy/jm4iqmZSo3voeESi6P5W9mzW9f7yr+Objt7ShhGC1JPq/ELk7RqLVxen9pbt6QRO9sp4zF+cn8qbinN0fPFeMXF9IMrd2UsZ/TSfypuKcnF/PFeMQvQT/x7/bPc1XDj32hvR8SmDGaRGKRePs2jnaLNAUWcbLJCbmOQlHGMUJj7Np11Ebw1Jy5Xd7NH/Z9y3/8AT0l8SmNlgRrXZrsNn/Lf/wBPyXxKY2UReOQ8Q+2Te07vKuWm9CzoHcle+kFj2xipe5/wiO20Btr4Nya8ppNPcRibFaAU+x0o4Oql1f590XCfpE3V4cYzQ0FTiMwgpWFzjw7ydgHOVioqYaVhkmdYLeuJMVUnB9HmqrWqjLUumyyd56am3Q22gd5PPsA1PKIJ5/8ASJzM/wCU0bLBpUoxq2vEM4189WOF2Gle1HYtevYkcYitnBnhjHO+t+X4oqq5hltRVLU9gFuUlv2tu9r/AERuo8zHhEIi98B0Dp6S0+I2kfw/lH/Lry5t6rfEtJJZ7x0vkt47z8u9fWrVKdrtTmKhUZt+fn5lZcemZlwuOOK7VKOpPjHHS1HIS0I+ga9MW2yMNAA2KEOlJNyuOGofU90ckN90ZBrSFLWrVrridTeH1FuMcwNW5RmloKNo2Bq88ovYZFudRmVS0g2DiXmz4Fsn+YRazkLgkYUwY3MvM9XPVMiZcuNUot87SfQb/uogjsQZCTWYOYbeJZ1gow1RSetdWCBMPqTZLKe2wN1dgsPdRZwhO4ndsB4cI568I+KMdUtoITcgDW6cyB779il2i2j+viRxyYbGarOm51ndnkjpcgq7NTDBuYN0XgGh7IpVXCq4+mQ/QLlr9V535OmKsALRah0x/wCgTLU/svO/J0xVhE6wv7K3r70yVfpE+EZt+coXNtYxEGo4Q7JCrgdkHbHyXy42bMvsP4izAplJrNNpYl5uSeQ8VtLDizY7qCOBHAxuH80B2fV8M0KR6Wpj8XFD4dVb2xt4xl1y/fH1wxPwiF7y8uOfR8k4iscABZXe4t6SzILDMg69L4zcxBMJF0ylHp77riz2AqSlA9KhFZu2HtnV/aor8o0JRVCwdS3FLp9I6zfWpwixffUNFOEXAA81IJAuSSY4qUVG5ufGETccYVU2HQ0ztdtyedaZal8gtsCal7wjDnANIfGHNJUAb+kW+dEjlivDGQ9YxXNILcxierFbBI1VLS6eqQfArLx9UVcZL5S1rPHM2g4LoLSlT1UfCFPBN0yrI1dfX2JQm6vGw4kR+hHL3A9Ky3wRQ8MUZgS9Lo8m1JSqefVoSACe86kntJiN4vOAwRDaU5UcZvrqsPpiiBmhl2OfsJN/KUxXrFhPTFJvmll2f2EmvlKYr34Q44b9mYtFV6QpCBxW6hVhfQ/agJgv2w5dCSK77IrbHyVoOTGAaXUsy8OSdRkcPyErMyzs3uradRLoStChbQggg+Ee7Vtv5EJGuamGR+/v+EUEh1SeCiPTCU8s+6Prhgdg8TiXFxzTgKxwFrK9TF/SHZCYUp7syMwJSsupSSmTorLk264ewbqQkH6ZQHfFYe2dtq1jaqrMnIy0k7QME0t1TslTHHAt550jd698jTesSEpFwkE6kkmIzh5VrFRI8YRO9Cumw6Gndri5POtUlS+QW2BK8F7QQibw6hJEdYAdYta6H/Ldym5dY0xw4zuGt1BqnSq1DUsyySVkdxcdI8URWTlvltXs2ceUTCOG5VU1WatMJl2E2ulHNTizyQhN1KPIAx+grJbKyl5L5ZYbwVRr+QUaUTLJcIsXl8XHVd61lSj9NEdxao1Y+R3lONJHd2utBdJ+2pWyJiUcxUKaf5SmKUVCyou16Tw22R8UH/76m/KkRSSs6nxjZg/oD0/JYrPPCL3hGCGBpD9tTemi6eBI9MZhxXJR9cfO9oYVBYLF1n1ir+2Prg65QPtjHzuYOEYWVn1y/fm3jE7uiABOfmMPOUb4YWSL8bTLNv54gbzid/Q/LAz+xeCdThhdvrpmEFf9lf0JTTelCt4TYJGnKK3+mUP9amVn1RqHxLUWQJN0p8Irf6ZP9CuVn1QqHxLURHDftbP3uKdqj0TlVyYDDJjHjE+TAsm0hShc2EXKbMO2hklgXZ+y8oNbzDpdOq1NoUrKTco8h7fZdSiykmyCND2RTUNB2RmHlgW3jbsBhBVUbKsAPJFuC3wzGEkgK95fSA7PqD+mhSLftb/4uPN4z6TPILDNOcfk8WvYlmQLpk6NT3nFrPZvLShCfEqikQuqI9sSfGMePHXxhvGDQA7T++pKjWuIyCkBtdbXeINqjF0tMTMv7C4Xpe+KXRku9YUb3tnnVcFuqAA0FkjQcydAKVfvjE3vAFWh7ijbE0MYLAJA5xedY7Vle0ZNkLUBzMYCyo2bs7ZDVjaIzXouDqUlbbUyvrahOpFxJyaSOudPeB5qRzUpIjMjxG0vOwLDWlxDQrWOi7y1dwVswSNVmWuqnMTT71X19sWNGWb+KWyodyo8ttyuhOa1LBH952/jXImvhigSGEsP02jUyWTKU2nSrcnKsp4IabSEoT6ABEINu5wDNilDgfYZv41yNGh0hnxzX4hyY9NWWwUt52qPRdHbCL3feOGXteMLrbm8dFai5x5Nc4PWj0FAzKxPhSTXK0av1GlSy19YpqUmVNpKrW3rA8bAR5IPW4Qi4TGqSnjmbqyNBHOLrbEZIXa8biDxGS98c6seqNzjKu/X7n34zGdePEj9GVc+v3Pvxr3rrc4yDt+cJfo6k+6b+UJX45WffO/MfmtgDOvHgP6Mq59fuffjMZ3Y9H6sa59fuffjXvW2g6254xj6OpPuW/lHyWPHaz7535j81sSXz2x/JzLcy3jGslbSgsBycWtJI5FJJBHcYsswtUXK1hylTzoSHZqUZmF7osN5aAo27rmKkVKuhWvI/ai2HLw7uBcOfUyV+KTFTeECkggip3xMDSS7YAOHBW14P6meaWobK8uFm7STx4rqc8DuZQYyJ5UmZ+4MVfKevzizzPdwfkNY2PD86Jn7gxVqVkWub6Qu8Hjb0k/tfBIfCG3Wq4PZ+K5getD6+OEX4x6254xbeoql5NdxTX/zyk/25v7oRbjzMVAUt388pPn8/b+7EW/8b2ik/CKNV1L/AH/4K7PB03VZVf2f5It3wAQWsNDAddeEU2rkTJtGsc+8opfN7Bb0klKG6zK7z9OmVabjltUE+9Xax9B5Rs3lHX1+uSGG6NO1OpzLcnISbKpiYmHdEtoSLqJ9ELKOompahk1OfLBy6fjfZbfsSKspoaynfBUC7HDP9822+5VP1OTmKXOzEpNsrlpuXcU08y4LKQtJspJHaCCI4nW2Mdlmnm63mvmpXa6zJN06TnXQJVpKQlRQgbqVOdq1ABR79OUdD1tjxvHXtOJXwsfM3VcQCRwNsx1LkmspG01Q+KN2s0E2PEbiuaHteyM0vWjry7rxgD9jG/USHk1I/ZPzw/I+xN8z9XmdzD1VcAS44fNlZg6BfclWiVeg8jE90ecLjSKfQ/fnpE7dj7Pj5s6GMI1qZ365TW/6ldcVdU1LDlfmtHA9qbHkYpnTfR3I4pTD2x/l8D28Vc2g+PllsLqT7B/x+I7OCksdTBqL8IY+CF8EUqrrQQO2C2vZBBAhHEwX11v6IL28YWsCE7A/8YIBBAhEEKHbWBC8LnTgQZiZd1akpSFTfV9fKHmH0XKfXqn91FdClllRSoFKgbFKuIPZFqBAI8NfTFe+1FgY4CzSnVMN9XTqsPL5cAaJKiesR6F3PgoRbOguIWfJQPO3ym9O8dlj1FUf4R8H5VkWJRjMeS7o2tPbcdYWxdjLHIksU1fDLrgDdQZ8qYBP91b0UB4oN/3Ebyz0oxmKPIVNAuqWdLSz9Avh/GA9cQNy5xarBeOqFXUqIEjNocctzbvZY9KSqLJMWU9vE2D6jLMKDiX5YqZUnUE23kEekCId4VsC8Yil1RflWXHtMtbuapd4KcX1IWwuOcTv0u/blGAzJl1pWhVlIIUD3jURKKal2cXYRcacsuXqkiptXeHWyD91ETQ8XbHmeUSYyhqPsngKmhRuqVKmFd26dPgIjlzwb1ZirpoQbazQR0tP/wDS6S0vpQ6ljkI2Eg9Y/wBKpOelV0uaelHRuvS7imVg8lJUUn4REnej1fK83q4n9hF/HtxpbaRoAwpnljanIT1bSak4+2nsQ7Z1PwLjb3R0u7+cddSdfzjWf/faj6VaQStqtHJqhux0Yd22PxXFuD0xp8ajjP8AK+3ZkpA9IQf+ijjP6aS+VNxTqpG8tXjFxnSDJvsp4z+mk/lTcU7KFnVeMQnQMXw5/tnuarGx4/Xt6PiUIRwjkIEYNx9kDWLRaFEXFfVCdY5TaAbiPi2I5LVgoQoa1JHFXX7NjZTkBlzrcfM/JfEpju8y828LZQ4fcrGKquxS5TUNpWd519XvGmx5y1dwHjaKycrduvMDKrADGFZOXpdUlZNssyExUGll2VRrZPmqAWkX0CuHDhpGmMcZh4hzOr79bxNVpmsVN3QvTCrhCfeoSNEJ+hSAIpSLQKpqsQlkq3hsRcTlmSCb9XX2Hapy/SSKGmY2Ft32Az2D5qSOf+3tibM9MzR8IB/CWHV3Qp1C7T00k6eetOjaT71Gvao8Iir1ZKieNzc+MYoRa1o5CEkjWLkw7C6TC4RBSxho955ydp61X9XWz1chkmdc93QvmkX4x9kN90fRLN4+qWyOUPYamxz1gluPqEWj6IT2RmEdojcAEnL18urvGQaIjkpaB4R3+EcC17HdSRIYfo05WZpRt1cmyXN3vURokd5Ij097ImGSQgAbScgvDdZ7g1guSvOJbCo3Ls97Mdez1rKFtJcpuGWHAJyrrR5otxbaB9u58CeJ5AyAyU6PdSnWKpmPNJDaSFewUg5e/c88PuUfwomvRaLI4cpcrTqZJsyEhKoDTEtLoCENpHJIHCKe0k8IEFMx1NhR15PX/lb0esfd07FP8I0XmncJq4arfV3np4D39G1dfgfBVIy8wzIUChyaZKmyTfVtNJ1PepR90om5JPEmO+JGohaeMPQCOdpJHyvMkhu45knaSrYYxsbQxgsAnaCx5/BCJgjWvark6Y/9AWW31YnPk6YqwHwRaf0x/wCgTLX6rzvydMVYROsL+yt6+9MlX6RZd8K8F4WhIHbDrdIk+PjBEgsvdgnO3NHB1IxThvC0tP0OqseUyj66tKtFxu5FyhSwRqDoRHp09GRtDEXODJRP+3JP8ZCQ1cAJBeL9IW3kZPVKitrALRKk9GRtDgi2DZK3aa5J2+MjvcO9FLnnWn0on2cOUBu+rk5Vg76ksoVf1xg1tMP5x2r0IJD/ACqHJF++PV5YZU4szlxbLYbwdRJmuVd8i7TCbIaTe3WOrPmtoHNSiB4nSLIsqeh4odNmWZrMHG01Wwk3VTqGx5IyruU8sqWR9KEnvideWGT+DMmcPpomC8PSWH6cCCtEo3ZTqh7pxZupxX0SiTDZUYvG0WhzPuSqOjcTd+xab2L9jOj7LWEXXJlxirY3qbaRVKuhJ3UpBuJdi+oaSdSTYrOp4ACSdgdIZJhhEROSR0ri95uSnVrQ0WCqh6YmwzOy7+os38pTFeh4RYV0xX6aGXn1EmvlKYr1Aic4d9mYmOp9KUAX8ILQ9IwUvdF+yHI2CSrK8Ia8o3jh3Yhz0xVRKfWKZlvU5qmVCXbm5WZS9LhLrS0hSFgFwGxSQeHONZY8y/xBlhiidw5imlTFErkkUiYkpoALRvJCknQkEFJBBBIN41sljkNmuBPSvbmObmQvOWtrCv2QyRGJF42rwnulXCPVZa5V4tzexTL4dwdQpqvVZ4j5zLI81pPv3VnzW0DmpRAjylyDYHjz7IvQ6P3MDAeYWQNMmsHYdpWFJuUIk63Saa0Ebk4karUfbLSsELSpRJsSL3SYbK6qdTR6zW3PclUEQldYlfDYo2KaRsw4dXUai5L1jHtSZCJ+poTduXb4+Ty9xcIvbeVoVkAmwAAlFui1gLRiUhPCGlXL7cQeWV8zy95uSnxrQwarVEnpQCRsiYm76hTR/KUxSfa8XZ9J+kK2RsUf6fTflSIpMNwfTEuwf0B6fkmms88LEiGFQxYjsjFSdDD6ctib167CWUWOsf05c/hnBtexDItuFlU1TKc7MNpcABKCpKSLgEG3eI75OzHm+oXGV2L/ALCv/gxZr0RQCtmmri5/RNNc/wDMsROgIAHb4xGKjFZIpXM1didWUjXNBuvzyDZhze/8r8X/AGFf/BgVsyZup/wX4v8AsJMfgx+hojtg0HbGn6ak9QL14kzivzvL2aM3Re2V+MPsJMfgxN3op8g8wcC5r4sxLifCdWw3STRfIG3atKrllPPKfbXuoSsAqASgkm1hcdsWigaXgAF7wlnxOSdhYRtW1lM2N2sCkhASAOcVvdMqbYUys+qFQ+JaiyJSrRW70yKd7CuVn1QqHxLUacN+1s/e4rZUeicquSdYIyUBeMInqj6cEASSQOJiR2Cuj8zxzAwpSMR0PCcrN0iqyjc7KPqq8q2VtLF0qKVLBFxyMapJY4s5HAdK9NY53mi6jjaA6eESqPRk7QpH6DJO/wBXJP8AGRh+ZkbRBUP6zZIDtNck/wAZGg1lMP5x2he+RkP8pUWCYW6SdImbhron87q08hNSVhrDzXulzVTL6h4JaQq/riR2U3Q/YWokw1OY/wAXT2JVJsVU6lNeQyyu5ThKnFDw3I0SYlTRjN1+hbW00rt1lW7lFkfjPPXFrOHcF0V6rTyiC84PNYlUE26x5zg2kd+p4AE6Rdlsh7J1C2WMCGny60VXE9Q3HKvWijdMwse1bbB1Syi53U8SSVHU6bXy8yywrlRh5qhYSoMjh+lNaiWkWQgKPvlnitX0SiT3x6ggGxiMVte6p8luTf3tTnDTiLM5lLeBiAW3sbZt0nt9hm/jXIn4QBwEV97fqynN+lfUVr452JdoGL4y32XKIaZi+EuH4go39dYw+uvHC67WDro6aLFz3ya5/Wm0HXW46RwuvNokPs77Lcnnpg+crcxiKZpC2J5cn1DMoh0KAQlW9cqHvuFuUNeI19LhUBqat2q29r2J29AKXUOGVGIzchTNu7pA71oTrt6GHCOcTQ/M7KaOGN5/7Ht/hw/zO+nDjjeeP+zm/wAOIr/GuBff/pd8lIv4Nxj7r9TfmoYdaYA+Imeejupx/VvP/Y9v8OMT0dlOJ/RxPfY5v8OMfxrgX3/6XfJY/g3GPuv1N+ahkt8htW72H7UW1ZbqLmAsNEjU0uU+JREbKd0eNFYm2VzeMalMyoUC6y3JttqWnmAreNr9tjEsKdT2KTIS0lKt9VLy7SGW0XvuoSAEj1ARWmmmPUGMRwR0Ti7VJJyI2242Vh6IYHW4S+Z9U0N1rWzB2X4XXis+kgZMY3P7DzP3Biqtb/Ad0Wp5+E/kK447qNNfFmKn3HhceESnwbtvST+18FH9PWa1VD7J71yut5wdce2OD199Lwdb3xcOoqu5NdzSnb1OT/b2/uxFxXC8U0Ul29Ukh/n2/uxFy/bFGeEptnUn9/8Agri0Abqtqf7f8k728YXGDh3QE698UorbSUoAXvoIgft459Cszxy4okzeTlVpcrLratHXRqiX8EaKV9FYe5MSI2os+WclMCqVKuIViSphTFNZOu6bee+oe9RceKikdsVezz7k9MOvvOreedWXHHHFbylqJuVE8ySSbxc2gOjpqJPpWpb5LfMHE+t1bufoVZ6W41yDfEID5TvO5hw69/N0rqHUqbN0kgg3BHKPQUuqGdl7rPz5Oix/P6Y6V5NuVhHwZmFSkwHE+Ch2iOgCzWCqOSMTNtvXr+uhdd2kx17cwHEBSTdJFxGfXaRo1E1clZc4P2jtcM4oqGFK7I1ilTKpSoSToeZdTyUO3tB4EcwSI8313/IjJL9jHh8LZGljxcHasta5jg9uRCtjyTzbp2cOCJWtSe6zND5zOyYNzLPgecn6U8UnmD23j33Ptiq/Z9zxnMmMdMVC7j1Em91ipyqeLjV9FpHv0E3HbqOcWiUWsSdepUpUZCZbm5KaaS8zMNG6XEKF0qHiI5a0r0fdgdXeMfVPzaeHFp6PeOe66O0bxoYtSgSH61uTufn6+/qXM5Qrjs1h2HohW17IhClyfLsg48YY4RieMCE7gc4IfqggQlz7YOfCAfDBAhFu8RofbBy/+a7K92qS7ZcqFCX5Ymw1LJsl5Pqsr9xG+Dx0j4z0o1Pyj0s+2l1h5BbdbULhaCLKB8QTDjh1Y/D6uOqZtab9I3jrGSbcSomYjRyUkmx4t0Hceo5qpUPJSCDrFiWy9jYY3ydori3Osm6aDTpgk3N27bhPigoiBWbWDHMtswq1h1wK3JN89QtXu2Vec2r+CR6QY3vsHYx8jxRXsMOu2bqDCZ1hKjxcbNlgd5QoH9zF8aXUrMTwXxqHPVs8HmO33G/UqE0PmfhWNeLS5a12Ec42e8W616fMCiDDWNKvJgbrQeLrQ+gX5w+2R6I2hs8VcPU6tU8qv1TqH0juUndPwpEdTtJUUMzdKrLYsHUKlHSO1PnIPqKvVHnNnqpKlseOyij5k5KrQNeKkkKHwBUfPOji+hNLBC0WaXEDoeMuy47F3hUf900dMxzcGg9bTn3FRt6QGhLo2erc6E2bqtKl394c1IKmlfcpjvOjiIVnBXzzFCV8e3HtOkkw2FSOCK+lNuqdmae4q3EKSlxHwpX648R0cKwc48QDn7BL+Paj6Ixz+M6CmTeGFv5XW7gFyA+DkdJAOLge0XUi+kE/7KmMvppL5U3FO6hd1XjFwvSDr3dlPGB/zkkP5U3FPnt3FeMNmgI/7c/2z3NT7pB9ob0DvKzSkR90C0fJCTH3SYtRosog5fZsa68I+oVbhxj4JJOgPpj6tpvpG8FJyF92xcanUxyGkR2GF8IVvGFQTIUOkztZnVcJeQl1PL9ISDb0xJPLro9cz8Vht6styOEpVQv+eD3Wv27mm72/dKEIKvFKHDherlDOk59Q2nqC9RUlRVG0DC5RoaQRaOWlsADesnx0ix3BPRu4FoyEOYirFVxG+PbNtqTJsn0Iur+NG88I7OWWmBd1VGwVSJd1PB96XD7v8NzeV8MQmr8ImFQZU7XSHosO05+5PMOitbNnK4M9592XvVSWHcvsTYrcCaJh2q1ck6GSknHR6wm3wxtPDuxhnBiDdUMIuU5s+7qU01L29BUVfBFrzLLcu2G20BDaRYISLADuEZhITwAHhESqfCXWuuKaBrekl3dqp7i0Ppx6aUnosPmq5qH0cWPZxKVVGv0Cmg8UtqemFD1JSPhjYGH+jSkG1IVW8bzb4v5zdPkUND0KWpX2omzz00g5xG59O8emyEwaOZrfiCU7R6M4ZHtjv0k/6WgcIbD2VGFVIcdor1ffRqHKvMqdTf8Aa07qPWDG76LQKZhuRRJUunytNlECyWJNlLTY/cpAEc+/K8HDjwiJVmJ1uIG9VM5/SSR1DYE+09FTUotBGG9ATt/yIWtoWog+3DYlqZv23EHDlCsLQ9bX5wIQPRBa2pg9EMdkCFXH0x/6BMtT+y878nTFWEWn9Mf+gPLX6sTnydMVYEROsL+yt6+9MlX6REZISCtN+NxGJ0HYIaTZSfEQ6m1kiV82wOCnZGysvqfYYfGuRIO4IiPmwMd7ZFysJ/yMPjXIkFxMVvP6V/Se9SZvmhG7aGdeUAN4L2jQvSLW1vCGsOCBCd/QYQNoCLw0nSBCqf6Yr9NDLv6iTXylMV6iLCumKP8AZPy7H7CzZ/lKYr1Aie4d9mYmKq9IUWhkpKFXHuT9qCMVjzF/Sn7UOaSL9Eezw20Mgcs7ISR8y9M5f/atxFDpR9l9eY+AG8y8PyfWYkwwyU1BtlF1zdOuVKNhxUySVj6ErHIRLDZz1yByz7PmYpnyVuNgPS7cw0tC20uJUCkoWLpUCLEEcxaK7bM6CcvbxUi1A9mqV+ZkJUfD7cMKtxiTm3psyflcM4XxS5cowbXyueo6wDuM6/PZW/a2oi30CkdhiMlr8on0MjZYxIw5FMD2lji0p2iQGxTtNzOzPnHJ1SadcVhOqhMhXGE62YKvNfSPftKO92lJWOcR+4Q06qHdBLG2ZhjdvQxxjcHBfpfpU6xU5Bibln25mWfbS6y80oKQ4hQBSpJHEEEEHvjlKFx3xXd0Wm1UnEmHvyIMQzd6xSWVPUJ95VzMSY1XL35qavdI94be4iw5pRVr2xX1RA6mlMbtykMbxI0OCiX0n6inZExN2+yFNH8qRFKChvGLs+k/AOyPie/+P035SmKSibE+MSrB/QHp+Sa63zwi1oaTc2OsLiIVrGH5N6t+6JqpU6n7NdUQ/Oy0u6cSzSih15KFW6lnWxN4mv8ANTSAqxqkjb/Sm/vx+a3fvxCT4i8ACPeJ/giI9UYSJpXSB9r83+04Mq9Robqr9KfzTUg6+ysj9co+/AcTUf8AypIj98o+/H5rN1HvEfwRBZI9wj+CI0fQg+893+1s8e/Cv0p/NPSP8qyX1yj78YqxXR0jWrSHpmm/vx+a0hPvE/wRC6tC+KEA/SiD6E/+z3f7R49+FfphlZlmfYS6w6280r2rjawpKvAjQxXL0yRCMKZWG/8AfCofEtRh0N1Xn3qLmZSHZx5ymSkxITEvKKWS2ytxLwcUge53txN7cd0QumXSThXKy3D2RqHxLUIaaE09e2Mm9vklEj+UgLlV6o7xhQvGAxNUxrNHtkxf/sbXOy7lTvcfmakvixH5/wBv26Y/QDsb/wDZfyp/9NSXxYiN4z5jelOVFtK3LYDgIYNhDv6IXGImnZPQwrWOkHCDegQi/O0HGD1QcOcCERXp0grm5m/R+32Eb+OdiwqK7OkMXu5y0n6htfHOxZHg/F8bb7LlC9LhfC3DnCjKXLwB20cPrdYA7HUuoqH5Nc9L9osH6PsheUVWI/y278U3FdYdtFhvR3q3so6z2ezjnxLcVr4QG2wN3tNU10PZbFAeYqVYNoCbwED0wr2McuK90WPbDvp2Qd8A1gQjjwhm4hWsCYLaXvaBC19tBkpyQx0eH5zTXxZipNbtiPCLatoXTI3Hf1FmvizFRbjmvojobwZtvRz+0O4KntN23qYfZ+K5HXW53g62OJ1kPrYubUVaai7ekO/npJEcevb+7EXRdsUp0Zy9Wkf9Ia+7EXWdsUL4ThZ1J/f/AIK2dBm2bUf2/wCSLR1OKsTU7B2H5+tVaZTJU2RZU+++vghI+2ToAOZIEdqV7upivvbp2gxiivnL+iTIVSqY7vVN5pXmzE0ODXelvn2r+lis9HcElx6ubSsybtceDd/Wdg5+a6nOL4kzC6V0ztuwDif3tWis6s2qhnNmBUMRT++yys9TJSijcS0ukncQO/mo81Ex4NTh7Y+CnAqMd6OwKekjpIWwQts1oAA5gueJpJKiR00pu4m5X0Wu8cZxIMfTfvHc4PwfUcdYmplCpDJmKlUH0y7LdtLniT2JAuonkAY3Pc2Jhe82AzJ4AIjYXODGjMr1eXGS+Kcd4IxTiakyvXUygpSpxNjvvq4uJaA4lCPPUOy1tTHjVuW5xb3lRlpTcqsAUnDFNSFsSbVnHykBT7p1ccV3qVf0WHKIBbY2QYylxmms0iWLWFq0tS2UIHmykxxWz3A6qT3XHuYrDANMosYxOajeNUE/VniBtB5zbWHWNwvMMY0ZfQ0kdUzMgeXzE7+jd2Heo/F7dg67vjiKd1hb/fFo6ig3JrsGn7HWJgbEm0SmjVFnLyvTNpGbcJpD7qtGXlalgn3qzcp7FXHuhEMOttzj6sTK2nUONrU24ghSVoVYpI1BB5EHnDJjODwYzRvo59+w7wdxH7zFxvTnhtZLhlS2pi3bRxG8fvpV2yTvC+tjD8I0JslbQTecmC/Iqm+DiuktpbngTYzCOCJhI7+CuxXcRG/L38I49xCgnwyqfSVAs5pt8iOYjMLoukq4q2Bs8Ju1379yRHfaFwh2uNOEAMNyWJWBgjL0wQIWMHHW8O/jBx7RAhF9IDwtyMF+UGnpgQoe7euW5elKNjaUZ1YIp08Uj3BJUys+Ct5P7pMRgyrx2vLvMLD+IAopbkptCnrc2Sd1wfwFKiz3MXBspmBgqtYem/7TUZZUuFEX3FnVC/FKgk+iKjK9IzVGqk7TJ1BanJV5cs+2fcrSopUPWDHQug9azE8Lkw6fMsy6Wuv3ZjosqM0uw91DiUdfDlrWPQ5tv9HtVq+cFFTijLeoiVIeWw2mdYKdd7c87TxQVeuI75bVNNGxrQ5xSt1CZpCVH6FXmn4FRujZaxkMwMi8NPvqD8zLMGmze9r5zXma+KN0+mI+Y0k3MJYlqlMQSlySmFobPcDdB9W7HEXhEw1+D4rHV28pji09LDcdufUF1/oJWNxXD5KXc8aw6HCx7Mu1bU296EKns8z8ylAWulz8tOXtqElRaV8DnwRG7o31g514gHP2BXp/r2omZmlTxmVkBiJgJ3zVMPuOt6cV9T1if4yREMujdlFKzmrzxNr0BZ9b7Udd6O1oqNDK6IHJuY6HBtu4rnnFqYwY9A5wzOXWCbqSHSENF3ZTxgANeskj/Km4p/SChar9sXC7fzoa2V8Yb3v5IfypuKgFpC3FW7Ye9ABfDX+2e5q0aQm1Q0c3xKaDfuj6JSXDupEd1gvAGIcxcQytCw1SpmsVaZPzuWlkXNualHglI5qUQB2xYrs7dHRQsFCUrWYzjWJq0LOJpLV/IJdXYvgXyO+yO48Yl+LY/RYMy9S7yjsaNp+XSckx0mHz1zvqhlxOxQgyj2acw86n0/MxQHnpDe3V1WbPUSbfb88V7bwQFHuicmT3RsYUwwhmdx3UXsWT4sTIy29LSST2Gx6xz0lI7omXJScvISzUvLMty7DSQhtppAShCRySBoB3CPuogAlRFuMUpimm2I112QHkmc2383yspxSYDTQWMvlu59nZ87rpcKYOoOCaYinUCjyVFkkCwl5BhLKPEhI1PeY7oBNrAWjxeI806FQStpt41GZTp1UrYgHvXwHwwZdY4msaCpuPSzUq3LuIQ2hCio2IJNyeJ07IqE6QUM9c2iE2vK6+zPYCTc7N3G6mwwypjpzUGPVYLbctuWQXs7W7ofLjBBaHxNyV9YdhygOp19cB4aQIQRCItDPCC3jAhEBGmnqgvzh6dkCEoBpAT6YCBAhLvhgeiFb0w9RAhO58IQ498A7RDECFXJ0x36BctfqvO/J0xVgRFpvTIA/MNlp9V535OmKs909h9UTrCvsrevvTHV+lWPKGkeenxEZdUojQH1QIBQtN0niOUOp50jV8uwQP+iNlX9Rh8a5Egoj9sFDe2R8q7HT2FT8a5EgeHPWK3qPTP6T3qTN80I490FgIIL69saF6QOHbBu+ELTxg4QIWQMHOFfSGDcwIVUHTEj+yhl59RJr5SmK9Cbc4sI6Ysn8lLLywJHsJNfKUxXwG1HWxifYbnTNCYqr0hKQ18IFn52v6U/ahkEaWPqjFwHq13Btunl3Q4khJQv0R7OOuQGWdv1r0z5K3Gx77o4axrbZuB/K+5Ykc8L0w/wAlbjZIN9DFaS+e7pUkZ5oWlNrTZ4kNpfJ+qYVfDbFWb/qyjzyx/wBWnEA7hJ94oEoUPeqPMCKEsQUGfwrW5+j1WUckanIvrlpqVeFlsuoUUrQe8EGP0rrAKSm1weUVedKxsu+Qz7GclBlbMzBbksRNNDRDmiWJo/TaNqPaGzzMPuE1XJv5F2w7On/aRVcWs3XG5Vt7sF+XPtjJXG1iPRCDSjyPqiX5bkz9K7rA2MKxl9jGj4moE2qRrNJmUTcpMJ9wtJvqOaSLpI5gkc4v92cc9aNtCZT0jGNJUlpUwjqp6T3rqk5tIHWsnwOoPNKknnH56tW/cn1RKfo89puayLzolKLUFuuYQxW+zT55oAqEvMKUES8ykdoUrcVbilX0IhlxOlbNFrt84JbSylrtU7CrA+k+cJ2RcRkHjUqbfw8pTFKq0xdf0mrYd2RcUBIvuT9Ov4+VIEUnKJKzofVHnB7eLnp+S9VubxZY31tDjLcPGx9ULdV2GH1IEoYEG6ew+qDdPYfVAhOFBY9h9UMJPYfVGclhEAOt4LHsPqjFQUBoDeMZBCsx6Gx8pczYH1M//wBEdr0yNzhTKzvqFQ+Jajp+hnC+tzYKkm352cR3TEdv0yr25hPKsAa+yFQ+JaiJNI+lAT+/JTxb/prKrtdgYw3oLlZ4H1RkUEcQfVEsyOYTRsQ37cGP0A7GxvsvZUkfrakvixH5/U7xcACT6ov/ANjK52W8qeR+ZqS+4iNYyRqN6U50W0rdXPvgP/NoL3g1I4xFE6ovpwggMB1gQjjyhXuYfGHYGBCQ174rl6RE2zmpP1Ca+OdixsgW0iuDpE1L/JqpI3Tu+wTWtv8APOxZng8/8432XKHaV54a7pCi1v8AfC6zXjGBQSeB9ULdPYfVHVmqqR1V9kqvFivR2fpPVjt9nXfiWorkKikcD6osV6OULVk/Wiq4Hs67b/ctRWXhDAGBO9pveplom22JA8xUtCbwucO0IjX+eOVFdqV9eHpEOC0LiYEJ+MFoYFoRAPOBC11tFfpFY91/vLNfFmKhHV2UPCLedo0EZEY+3RdXsLNaD6QxUA6SpXAjTsjo3wXgeJVHtfAKpNMxeoi9n4rPrBD378I+IQocjGQuOR9UXTYKu9VdjRV/nvIX/wAZa+7EXab4Te8Ui0jfNWkd1JJ8oa5fRiLrKlNJp0nMTbxV1LLa3VhAud1IJNh22EUD4UG3kowPx/4K0dC/JZOT+H/JaY2tc/G8mcvnG6fMJTiirJVL01ANy0OC5gjsQDp2qKewxVi66txxbi1qcWslSlrNyonUknmSY9tnTmrUc6Mwaliee32mnj1UlKE3EtLJPztsd9jcnmpRMeE15g+qLK0S0eZgNAGPH1r7F559w6G99zvUUx3E3YpUkt8xuQ+fX8lkF2MZpcuOMfE37D6oW4rsMTa1lG9VcgJKuHqifGwFkgaPRnsw6xLlM5UUKl6UlY1bl72W73FZFgfepPvoijs45SPZ0ZoU7D6krTTEf1VUn03+dyySN4X5FRsgd6r8otwp1OlqVIS8nKsNy0tLtpZaZbFkoQkWSkDsAAEUr4RcfFNAMKpz5Txd3M3cOs7eYc6sHRPCuVlNbKMm+b08erv6FyQbjSPJZo5cUrNXBNTw3WG96UnW7B1I89lwaodR9Ek2PfqOBMesOkHGOd4ZpKeRs0Rs5pBBG4hWxJG2VhY8XByKpgzHwJV8ssZVPDdaZ6qfkXdxSkg7jqDqhxHalQsR424gx5rf0iyvbZ2f/wAlDBXzR0WV6zE9DaUpLbY8+clRqtrvUnVaf3Q91FaJSewkHgY7E0Wx2PH6Bs+yRuTxwPHoO0dm4qg8Zwp2GVJj/lOYPN8wsusjJKyI+W6ew+qAXB1B9US+yYdVe0yszKq2VON6biWjuWmpNfnsqUQh9o6LaX9Coeo2PERbdltmDSsz8G0zEdGe6ySnm94JUfPaWNFtrHJSTcHw74pfCj2H1RJrYdzrqGA8x5XCcwXJihYjmEsdVe/k80RZDqR323VDmLH3MVVp5o23FKQ10A+tiBPtNGZHSMyOsb1NdGcVNDP4tL6N57Dx69h/0rLoRtxhIWHEXEOOW1dKXHnBBBAhZWvC5wQdv2oEINxBfshWEP0wISOoPbFdW3TlkcJ5ptYklmtyn4ha61akiyUzTYCXB4qG4rvuqLFuI7405tXZaKzLyarErLMdbVKcPZOSsPOLjYJUgfTI30+JETPRHFforFo5HnyH+S7oO/qNj1KM6RYf9IYe9gHlN8odI+YuFoXo9MbhqaxVhBx3V1LdUlkE8xZt23o6s+iPZbTOGvIMdylUSN1mpSw3j/nGzun+KURETZsxkcDZ54SqinC3KuzYkphRNh1Tw6s38CpJ9EWFbSOHE1XL3y0Defpb6Xyr6BXmL+2k+iGrw24Hr8pUNHnASDpbk79OfWnvwS4tyMsULjsJYeh2bf1dy7bJGeRWMqqI0r54GUrk3AddEqKbfwSIibsM0M4X2kMe0ZSChVOkZqV3SLEBE4hI+ACJA7LFX38MVqQ3goys4HUjsC0ffQY8FlJSBh3bxzPYCChqdo4qDZPMOrYUT/C3o1eDyv8AGNGauK/nQA9bHBvxK36aUXi+PMdwlPY8awXpekDQHtlXGIGlnJI/ypuKycichsUZ8Y3TQ8PsBLLZDk9Ungeokmibb6yOJOoSgaqI7ASLY9rLLmsZs5IVjCtBZS7UqlMyTbZWbIbAmWytxZ96lIKjzsNNY9BkhknQMicCymHKGyFbvzybnVpAdnXyAFOr+0BwSAAOES7B9IG4Lg7mxZzOebDgLNzPw4noKjtbhxrqwF+TABfnzOS4uRWQmFMhsLIpWH5QGacSPLao+kGZnFjmtXJPYgean1k7NIBHZHHeeQyhS1qS2hIKlLUbAAcSTGlcf52reU5IYccKWhdLlQHFXc32D6Lj2dsVDj+kUGHNdV4hIXPdsG1zjzfsAdim2F4TLWOEFK2zRv3D99pWwcZ5kUvByS04szc+RdMoyRcfTngkeOvdGlMT5l1rFK1ImH/J5MnSVlyUo/dHir0+qPIrnFOqKlqKlKNyVG5J7SYxLoMc443pXiGMOLA7Ui9Ub/aO093Mrbw7AKagAcRrP4n4Dd3865hmL6DTwjc+QS9+mVn/AEhv7iNFFwcjG7tndZVSq0T/AIy39xG7QgH6chvwd/8AkrXpGzVw2Q9HeFt88YCfAQ+d4ROusdPqmEuEM6HugB01gJgQlpxhk6dkBVp2QW07IEI7rwW1+9C4QxoIEJ8OEIwHXsgJvpAhPjGNtYYNoPRAhFoVz6IfA3gB1gQvEZrZK4Kzww+3RMcYelcQ0xp4TDTUwVJU06AQFoWghSTYkGx1Bsbxqb8zp2dkj9LSU+yE5+OiSB8YBp3xubNKwWY4gcxXgsa7MhRwPR2bPHLLST9M/N/joR6OnZ2WPOy1kz/tCc/HRJA68IAOdo9+Mzn/AOQ9pWOSZ6o7F1mG8NUvB9CkKNRZFimUqnsIlpWTlkBDbLaRZKUgcABHZnx+CDW+nCDUmE5JOZWxBHKACFzh8YwhBvflAdeMGpMF4EIHhD0t2QuPO8HhAha4zg2dcus+5ens47wvK4g9j1KVKuOrcacZ3rbwSttSVWNhdN7GwNriNaNdHRs8Ni35G0oofVCc/HRJKFxMbmzysFmuIHSvBY05kKNjnRy7O7moy2lR/tCc/HR9Gejq2d0FJ/I1k1FJBsuem1A+ILuo7okf8EPX0x78Zn9c9pWOTZ6oXwp8hLUmRl5OSl25WUlm0sssMpCENoSAEpSkaAAAAAdkfcwc4BCZbEA2EddiDD9MxZRZ2kVmQl6nS51pTEzKTbQcaebULFKknQgx2QHfBbWMg2zCFG1zo5tnd1wr/I1kwSb2TPzYHoHXaQ/zOzZ3Cbfkayv2QnPx0SQJgtcawoFTONjz2la+TZ6oUaz0cuzu4fOy2lfshOfjo7fCewZkPgjEVOrtIy7kZeqU55MxKvPTMw+G3Em6V7jjhSSDqLg2Njxjftrd0FyRGDUTHIvPaUcmwbgujxfgqh5g4aqOHsR0uWrFFqDfVTUlNI3m3U3vr3ggEEaggEEGNFL6ObZ2WbnLWVB7RUJz8dEkQNId7d8eGSyRizHEdBXosa7aFGwdHPs8J0/I3lfshOfjoD0c+zsf8G0sf9ozn46JI2uYfwRs8Zn9c9pXnkmeqOxRtHRz7O3/AJbSv2QnPx0H5nLs7kfpbSo/2hOfjokjx5Qxw/ng8Zn9c9pRybPVCjaOjl2dj/g3lvsjOfjoPzOfZ3/8t5X7ITn46JI2trD7IPGZ/XPaUcmz1R2KNp6OjZ3/APLaV+yE5+OhDo5tnYG5y3lT/tCc/HRJMaGDTlpB4zP657Sjk2eqOxeHynyRwNkfRH6RgfDkph6RmHuveRL7yluuWsFLWslSrDQXOnK0fPNrJDBOedBZouOcOyuIqcy8JhlEwVJUy5a28haClSTYkGx1GhvHvD8EEadd2tr3z4r1qi1rZKNrXRy7OzQ/S1lCe01Cc/HQnujo2eHBYZbSg8J+c/HRJPlCAjd4zP657SvPJs9UKNzPR0bO7Vj+RrKE/RT84R6uuiQ9Io8jh+lSdNpsozIyEmyiXl5aXQENstIASlCUjQAAAARyz8ELgdI1vlkk89xPSV6DWt2BOFe8A7+MA1741L0j0+iGILwH1wIT9MK8IQ+cCEfDHisxcl8FZsiUGK8Py1XXKXDDiytDjYPEBaCDY9l7R7blrCtzjfBPNTSCWB5a4bCCQe0LVJFHM0skaHA7iLhaTGxdk0P1EsemcmfxkB2L8miP0Ey/13M/jI3Zy7oOIh2+nsW/q5Pzu+aQ/RlD9wz8o+S0kNizJkG/zEsH9+TP4yNo4MwPQcvMPsUTDlLYpNLYJUiXYBtvE3KiSSVE8ySTHeAQW9MJKnE66sZydTO97dtnOJF+glb4aOmp3a0MbWnmAHcjhBeFDhtSxELjDAvAocLQIR3C0ELQ8oY8YEL5TMqzOy7rEwyh9hxJbW24kKStJFiCDxBGlo02/sZZNzL63V4IlUqUSohuamEJHgkOWA7hG6TAO+F9NX1dFfxWZzL7dVxF+mxCTTUsFRblmB1uIB71pUbGWTQFvmIlvTNzP4yMVbF2TRN/mJlx4Tkz+MjdluQgt2XtC36dxb+rk/O75pN9GUP3DPyj5LUmHdk7KfC9alKrTcGyjU9KOB1lx1554IWNQrdWspJB1FxpG2lISRulIIPbD3uV4L6Q31NbVVrg6plc8jZrEnvulUNPDTgiFgaDwAHctNz+x5k/Up1+bfwRJh55ZcWGX32kXJubISsJT4AARx/yl2TJ/URL/Xkz+MjdgMF76Q4DHcVAsKuT87vmkxw2iJuYG/lHyWk/yluTP6yJcfvyZ/GQ07GGTKeGCZc+M5M/jI3Xwg5XjP09i39XJ+d3zWPo2h+4Z+UfJeTwBlPhHK2RelMK0KUozL6gp4sJJW6Rw31qJUq3K50vpHrLcIL6X4QcecNE00tQ8yzOLnHaSbk9ZS6ONkTQyMAAbhkEa8oIB8EAHHlGlbEHUWjUuINlDKfFFWmKnUcFSK5yYUVurYW6wFqOpUUtrSm5OpNtY2yRr2w+BtwhZTVtTROLqaVzCduqSO6yTzU8NQAJmBwHEA960qNjHJr9ZEuf35M/jIR2L8mT+oiXH78mfxkbr4QQ4/T2Lf1cn53fNJfoyh+4Z+UfJaUGxhkyNfmJl/ryZ/GR3mDNmXLLL/EEtXKDhKVkqrL36mZU666WyRYlIWsgGxIva+sbP4ju7YXhGuTGsUlYY5KqQtORBe4gjgRdem4fRscHNhaCPwj5J2A0GkFoOcFrQzJwRvW5wQjflBAhAhjhe0B+GDhxgQga8TANDxg17PTBxtzMCEzrzj5up3k6621t2xmRARbjAhVQbTGXK8os4q1TZZBZp76xUaYoC1mXCVAD6RYUn9yIsTy+rzOdWRtKqDqgV1ykht++u69uFC/UtJjTXSCZZfNFl9IYvlWt+coDu5MFI1Mo6QCT9KvcPcFKj4dHfjYVLLiu4aeVeYo0917KSdepfF9B2BaF+sRcePvbpJonDWPzfEdR/QfJPb5B61XuEtdg2PSQMya/ym9WY7Mwu82YGn6VjCu0yY8x1yV85J5LbcsR/GMe4awm1J7WAraE28vwcthZ7VtTaB9y4n1R0rcocJbTLKQncl6qlbqO/rGzf+OgxvP2LlXp5ioFlHljTS2kPW85KFEFSb9hKUn0RzvoVM7DKOei9UyRnoNiD2m6uvTBor6uGsH87WP+BHusuSBuJtxEYuTTbLa3HFpbQgFSlLNgkDUknsjJZIER7z7zNVNzLuF6Y8Qw0bT7qD7dX/heA4q7TpyMKMaxeHBqR1TLmdgHE8PmdwTdhWGS4rUiCPIbSeA4/LnXDzWzXVi51ym0x0t0ZCvOWNDNEcz9B2DnxPKNah0jhHXJfI5xn5ReOXcRrqjFKh1TUm7j2AcBwA/eavyjw6GghEEAsB7+c865/XXEPrtOMcEO9sMu2ENuqlnJrml4jnG+NnLeXRKy5ukIM0hIV2kI1+2I0VQKJUMUVNqn02XVMzLh4AaJHvlHkB2mJb4EwgxgnDUtTGVdYtF1vO2t1jh9srw5DuAiztBMNmlxDx21mMBz4ki1h23PDrUD0tq4oaPxW/lvIy4AG9/h/wCl6Aj/APcBF4OEIamOg1TaNb9kOx58YOAvzh8YEI5QhZXOEs7oHebRCXG3St5cYIxlXsOzGFsUzMxSJ9+nuvMtywQ4tpwoUU7zoNrpNrjhCiGCWckRNvZeHPazzjZTc9MK3bEB/wA2HyzSbDBuLf4Mr+Nj3uWnSg5LZh1Nmnzs7U8GzLyghDmIJUNy5UTYAvNqWlPivdHfG51DUtFywrwJozkHKXZsO+AC/OPlKTLU3LtvsuJdacSFoWhQUlSSLggjQgg8RH1OkIVuTtY3hEawc+N4Z174EJA9vCA2PGH8MKxgQi1ucAFoBppBaBCO7iYLafzQ7QHThAhY8YfHlD7YRECEcOEAguYB2QISvGQNhCHDsh8tIEJcTBYnn6IPTBaBCL37oD2Q+MIgwIRC15wwLCDnxgQgQW00gBsYCYEItr2mDXsgsfRAdBfsgQgC4hxpzMrafw7lliuYoE/TanMzTDbbi3JZLe556d4AXUDwMeQe24sJIN00OtH0NfhxIIdH8UqI2yxQEtcLg5Zg9ajM+kuEU8roZahoc02IzyI6lJLjCtY/zxoPDm2bgWtTKWZxqqUYKNuumpcLbHiUKJHqjeNJrMjXaexP06bZnZN9O+0+wsLQsdoIhDWYbWUFvGoi2/EZduxONFitDiV/FJmvttsc+zauZ9qFy7YVjGUNqdUibiD4ICLQXFoEI4+EF7QW7tIBYc4EI4cIdoSzupvEcs/9qJ/LytOYcw3KsTdXZSDNTUyCpqXJFwgJBG8qxBNzYXHE8HPD8OqMTnFPTNudvMBxKacTxSlwinNTVus3Zzk8ApGn4IOHK8QVou2Jj9NSYbdcptRLjiUCWdlAjeJNgAUEEcYnNLrWplBcCQ7YbwSbgK5gemFuLYJVYMWCpIOte1jfZbmHFN+C6QUePB5pQ4alr6wttvbeeBWdud4ZtxggiPqTI74CdIOPh2wcIEI0t2wXvoYLWhcYEJ317oAe6HHDFWkvKvJPLJfyknd6nrU79+zdveMgE7AvJcG7SuWdO+DSDhaDlGF6QB3QfBBANeUCEXh2gsB3xpnad2oMPbLeFqTXMRU2p1RipT3kLLNMS2VpUG1OFSt9SRayT6THtjHSODGC5KwSGi5W5ePODjyv3xAlXTB5ZoBtg7Fpt9DK/jY+tP6YLK2YmkNzWFMXSjSjYvBiWd3e/dDtz6IWnD6obWFaRPEf5gp48OMHGNb5LbQuAc/6K5UsFYhl6slm3lMqQWpmWJ4B1lVlJ7jax5Exsi4BNoQua5h1XCxW4EEXCIQhg3MOxMeVlLWC2kFu2AwIS4Q+UAHPjAdYEIsSINLawQEQIRfugJg4DhBygQjT0QE25XgOloBY98CEhe8Mm8B8dYLQIQB6YOEAF+6C0CEXPCDieEFwBrHBqldp1Dlw/UZ6Wp7JNg5NPJaST2XUQIyBfYhc4i3hAfhj4yk5Lz8q1Myzzcww6kLbdZWFpWk8CCNCO+PrGEI48odtLwGAaQISA/8A3GV++Fr6YOd7wIQRzgvBBaBCLc7wrW7odoAIEI8BeCFaCBCenpg4GFyveAC/KBCfKCC2ugtADfjAhA9UHGHGMCF1uJsPyWKqDUaPUGQ/Iz8uuVfQeba0lJ9OsQA2UzN5LbVFRwZUlkeVJmKQsq0DjiD1jK/3QTp9PFiRG8CO2IT7beDXMAZhYMzcpaC0ZeeYYnyngXGjvtLP0yAtB+lTFiaI1ImNRg0h8moaQOZ4F29vfZRLHoCzkcQZticCfZO399K31nRTVS2JsA4nbFvI6s1KPqH/AIbqhu39II/dRt0CwIHKPJ4wpCccYJmm5Ih0vNtzcooc1pKXWiPSB649SzvFO+oFJIvY8u6KmgpjT1k7rWD9U9diD7gFYc9SKiip2k5s1h1XDh7y5eTzTxuMD4Qmp5JHljnziVSebqr2PgkXV6Ih088XXFLUpS1qJUpSjcknUk95MbV2lcUCpYwl6QhfzqmshS03/urmp9SQn1mNPhy3OKI0xxI1+IuhB8iLyR0/zHty6ldGieGCjw9szh5UmZ6Nw7M+tcjrCRDDlhHH62PY4AyvrWYcyPIm/J6elVnZ94Hq09oT79XcPSREOpqOarkEMDS5x3D9+9SyomhpIzNO4NaN5Xm2A5NPoZYbW884d1DbaSpSj2ADUxuPAezzUqsW5rES1UyUOolGyC+sfRHgges+EbewFlXRMv5cGTY6+fIs5PPgF1XaB70dw9N49jcDgLRcmDaCxQ2mxI6zvVGwdJ3+4dKqLF9MZJSYsPGq31jtPQN3f0LqsPYWpeFJESlKk2pRnmEDzlntUo6qPjHag6wHUwWi1Ioo4WCOJoa0bAMgFW0kj5XF8hJJ3nMogOkBvw5Qo2rWne+sFucHDS/rgtbxgQsHTcI+mEfnWz+meszyzKtxGJKmf5U5H6KXeKPphH52M+JdKM88yjf9UdT+VOxI8G1taTV4JtrbWbdWK0noe8EVGny0ycwMTJLrSHCnyaV0Kkg29r3xFrbK2GavsqSlPr0lWTiXCU+/5GJt1gMzEq+UlSW3UglJCglW6pPNJBA0vcjh3E1LFCkPzykgDLM/95b0+dp74gj0p20LguqZXS2W1IrEnWsRzVTYnJxqSeS8mSZZ3lfPFJJCVqUQAm97bxIAtfFFV1b6gMvcFep4YRHciy4/RKbQlWxNS8Q5XVicXNt0WXRUqOt5V1NSxXuOsC/uEqKFJHILUOAETZxBtE5X4RrM3R65mDhul1WUX1cxJzlUabdZVYGykk3BsQbHtitnoh8FzU1nFjLE6W1pptOofkK3beaXn3kqSi/busqPqiPG3HNKG1tmsi2nsypPj86bj3JRsnrHscbZXy4rDJiyEOAurpc1NpnLHJUSoxjjSlUV6abDrEs46XX3EHgsNthSt0++tbvjtsqc68F530N6sYIxFJ4ipzD3k7zsoVAtOWCtxaVAKSbEHUcDFP2T+xjnFtiy03j9+fk5KTn3ClNbxC+tKp1SLIs0hCFEoTuhIOiRu2F7GJzbOeXU70fey9mFVMePyU9MydRfqoFLeK0TKeqaal20qUlJClrATYjS8I6ijhibqsk1n7LLbHM95u5tmqWGO8yML5YUVVWxXiCnYepwNvKalMpZSo9ibm6j3JuY1NTdvXIKqz6ZNjM6jJeUrdBmA6y2T9OtAT6bxUay3mvt6Z9hlUx7K16c33h17hbkaRKJIvujXq2kXA0BUske2UqJIYo6IrGVOws7N0THlKrdbQ2VCmuyTkq2+q3tEOlarE8BvJAva5EKRQUsNm1MtnHgvHLyvzjbcK1SmVaSrdOYn6fNsT0lMIDjMzKupcacT2pUkkKHeI6rGGPsO5eUVdXxPW5CgUpLiWlTlRmEstBajZKd5RtcngIpq2HNprEuzfnLKYQr0zMs4MqdQ9jKrSZokJp0wpfViYQk/wBrUhywWBopN76gGJxdK0yVbKKwk6jEFPv63IRS0BhqGxOOTthW5k4ewuG5Sbwpnll9jmXqT+Hsa0GsM0xsPTrknUGnEyyDey3CDZCfNOp00Ma1n9vnIKmVZcg/mdRy+hW4VspedZB/bEoKPSDaKVcpcJ43zJr/AMwODUzc9M4iW2l+msPdW0+lq60qfPDq27qUSrQceNolpXuiNzSksMGekcU4bqdXS3v+xTZeaCzb2iHlJ3SeQKgkd4he7DqWA2nlsTsHzSdtTJJmxqtcwhjfD+YFEZrGGq1I12lv/wBrnKfMJeaUezeSSAe46x3ftTr64/P/AJF53452Ps3XJptucklSc0ZSv4cmSUImkoVZxpxHAOJsd1fEG2pBIN4lWzlw3Ssn38yHJsKws3R/ZsPj2y5ctdYmw98bhIHabQ21dE6mcLZg7EpimEgO4hd5jTMLDWXNFcq+KK5T6BTG9FTVRmUMt37AVHU9wuY1HTNvLIKsVNEhL5n0UTC1biTMdaw2T+2LQEem9op7zOzUx7tj5zMPvNTNXrFTmfJaNQpZRU3JoUfNZaSdE2Gqlm17KUo24SHX0ROaa8L+XjFGGfZgt75pJcete19zr93d3uV93dvz5w4HDqeBg8Yks47knFRI8nk25BWc4wz7y8wAunjEmNqDRPZBnymU8tqDbflDV7b6Dfzk35jSPT4RxpQsd0KVrWHatJ1qkTVyxPSLyXWXbKKTuqGhsQR4iPzs4/w/ivBddVhDFaJ2Rn8POOSYps2sqEnvK31JRqQEKJCxu+ad644xcn0aumx3gLt62d+WOQlq6EUsYeHXutsU/KuItZbklNpTKqerjVHl8xcMPVV2ZEm3JoqrJdW8VbgbCd65VvaW7dI6nNHa1ykybrXsPi3HdLpNVABXIhS33m78N9DaVFHb51tIocxFiCcoGZlVqcg+uUnpGtTE1LzCLXacRMqUhYvzBAPoiTeVfRx5zZ5YcTjSdm6ZQEVe8+ycRTT3lc6HPO65SUIUU797grNze9rQufhlNENaSWw+K0CpkcbNYrgcA5jYczPwtJ4jwtWJWu0Oc3uonpRe82spUUqGoBBBBBBAIIjqszM9cAZOSrT+M8W0rDoeF2m52YAdcHahsXWod4ERcqWLah0fOwtQJGotyUxjVpLkjJS6XOtYXPvuuulZOm822i6zwvugaXivHJLITMzbezQrM77LdfMJUmYrOJ60tS0tFZO4kAaqUbHdbTYAJ9yBCGGhY/Wkc60YO3it75i2zQPKKt4wptv5F4zqjNOpmZVFXOvK3G25ta5XfPIBTqUpJPjG8WnkPICkKCkkXBBuCORinvPbotMZZW4Cn8TULFMnjNimsqmZ6QTJqlpgMpF1rbBUoOboBJTobA2udI9l0Xu1hV6ZjGUyhxLUXahRKi2s0F2YcK1yj6ElZl0qJ/tS0hRSn3Kk2Gio2S0ETojNSv1gNt9q8sncHBkosSrVCINYErCkg9sFzDGlqL6QlnzDr6ICLGMVi6TGQsFV/wC1u8s541lI1/qeV+JTHvsptkmh4/wDRMQTlcqctMT7HXLZZQ3uJO8RYEgnlHi9qwIGeVava/USvxKYlPs81CUYyZwmhUyylSZLVKnUgjz1crxdGKV1VQYBRyUjy0kMGVtmoVQmD4fRYlpJXx1rA5oLznx1wFHfOrZQmMv8NTNeoFTdqkjKALmpeZbSl1tHArSU6KA5iwIGuscXY8zFnMNY8TheZmFKpdYCurZUfNbmUpKkqT2bwBSe3zeyN97RubVDwvlvXKaZ6WmqvUpVcpLyTLqVueeN0rUATupSCTc8dAIirs0UqYr2dGHA2hW5IuKnXlge1Q2k8fElI9MbaCoqcVwGodimYAOqSLXsLg9R2HfsWnEaalwfSSlbg+RJbrNBuBc2I5rjaN21WI9ajcupQFhc35Rr6t7QWX2HptcrN4qkevQd1SGCp7dPYSgED1xHjaxzpmqhX5nBNInFytOkwE1FbSt1Uw6RfqiR7hIIuOZvfhHX4F2O65ibD0vUalWGKD5S2HGZUsF50JIuCvUBNxrbU9vZETo9HaOGkZW4vOY2v80Db3Huy3lTSt0prp659BglOJXM85x2X7RvyvfPOw3qW+E8xcNY6ZW5Qa3J1Tc1WmXdBWjxSbKHpEeiGvdFdGO8rcW5A4rkZtFQ3FKJckatIKKQsptvJIOoIuLpNwQeYiauR+Z35KWAZGrPIQ1UG1mVnW0e1DybXI7AoEKA5XtyhvxnAGUMDK6jk5SF2V946ezmsciE5YFpK/EKl+H10XJTsztuI5u0HabjMFdw1m1gx6pIp6MUUlc6p3qEsCbRvly+7ugX430tHBxZnXgvBNQMlWMRyUpOJNlS4UXHEfTJSDu+m0V51udclMZT07KvGXmZeoOvNOp4oWl1RSR4EAxsvCeyzjzHFHRWgZORbmx17fso+sPPhWu+QEqIvxuqxN7xKZtEMNomtmrKotYRzAk83/oqIQab4rXufBQ0gfIDuuQBz7O8damenNHCnsFJVl3EFOapE8ool5x18IbdUL3AKraixuO6K+czqi3X8wsSzsvMImWZmpvrQ+hQUlSCs2UDzFrRKPFWzhXMS5IYLwnLTEhKVOkrU9MmYcUWypQXvBKkpN9VdkQ9r9JmcLV2fpTykOPyUyuWcU2SUFSVFJIvra4h10OpaGGSaSml1nXItwaHZHrFky6c1mI1EdPFVQ6rcjfi4tGsOo3Cnphan5R+SUmi09eF5p5tTaZdpKmXHluixCgfbFdxe973jbd0t8TrEQsutlfGOGsa4er01UaOqTk5pqacQ064XCka2AKAL+mPptd51VKVqSsEUWZXKNpaS5U32VFK1lQulkEcE7tirtuBwveGz4MzEq9lLQVJlBBLnH+XPP4dJsp3S47JheGSVmI0ohIIa1oy1ssvj0C637iDPXAmGp5cpP4okG5lBspplReUg9h3AbemO4wlmThfHAUKFXJOpLTqptpyziR2lBsr4IiBlTsn1vG+G5asT1TZoMtNoDksypkuurQeCyLgJB4jW5GukeTzUyexRkfXKfPJnw404sqkqrIqU2oLTqUkcUKtra5BHpEOQ0cweeQ0VPVkzjmyJG3cPc4ppdpXjtPEK+qogKc2zBzAOwnM+9oCsQKr84+UxOMScu4++62wy2CpbjiglKR2knQCNY5AZmvZoZfsT0+pCKvKOGVnQnQKWACHLcgpJB8bxFDaLzqqOZOJ5ilyEw43hiUeLMvLNE2mlJNutWB7Yk+1HIW5kxHcO0bqa6ukonnV5Pzjtt0cb7ubNSrE9KqOgw6OvZ5fK+YNl+N9trb9ueSl7PbQ2XcjNmXcxXIlwGxLO+4kfukpI+GPW4cxfRMXyflVGqsrU2BxVLOhe79MBqPTEN8H7IWNK3Q256dm5CiOuIC25ObK1OgHhv7osg92pHO0cHCeTeZ+Ec05aRpDLlMqbNnTUUqJkyzfVSljRaDwKCLnhYQ+zaPYM9j20taNdgudYi2XUPcSo1BpPj8ckbqzD/q3kAaoN8+s9hDepS4zIzCoWFaRPylQrklS6i7IvLl2n5lLbijuKCSkE39toD2xA3I6sS9JzewrVKpONSkq1Nb781MrCUp8xQJUo954mJGbT2QGIMyq3K4hkJ6msMyFLLcwiYLiVKUgrcJSAlWljpcxErA2Fp3H2KKXQJJxpmZn3eqbcfJCEmxOtgTyiR6LUtE3DJyJbl7fL/Dk74XKjml9ZXuxanBhsGO8j8ebfjYKy3DuY+F8UzZk6PiCm1ObCC4WZWZQ4vdHE2B4aiPSXiN+QOzPXcqcbLrdSqNMmWDJuy+5KFwr3lFOvnJAtoYkgDoB8MVTilPSU1RydFLyjLbedXFg9VW1dNyldDyb7nLm4o8OEAOnGCCGdPiANOMV/dMS2VZQYC8639cCz/JXIsBBivzpi95WUGAgDb+uBfyVyHDD/tLP3uSef0TlEvYY2M6FtXoxmutYkqdCNBXKJaFOaaX1oeDpO9vg2t1YtbtMSUxr0O9Jaw/MrwnmBUTWkoJYarUo0Zd1XJKlNhKkX98Aq3YY6nodJuTp0tmuqbm2Jbfdpm71zqUb3mzHC5F4n/jvNvBWXmHpqs4lxTSqRS5dJU4+/NoubckpBKlqPJKQSTyhyq6upiqS2Mndlt3JPDFE+IFwVDGXmZGLtmHOVmsyaXqdXsPTy5WfkVKsHkoWUvyzltFJUAoeNlDUAxfe9mrhWkYJpuLKzXZGiUGfZl3mZypzKGG7PIC207yiBvEHh3GKCM6sdNZv5y4yxPTJJxCcQ1l+alJXd+eWcXZpJA90Ru3HabRZR0gVAfwRsIYSoc1rNUyZocg7z+eNsLSr4QYUV8QmfFrmxdt9y107iwODdgUyqHndl9iekVeq0jGlBqNNpCQuoTktUWlsyaSCQXVhVkA2Op7I8HhvbhyOxZiyUw1SsxqTOVicfTKyzKA6EPOqNkoQ4UBBJOg11ik7KegY5zWqSstsGNzVQVX5lqYfpjSwhl5TAXuOvKOgQ2HFm6tBe+ptE0cm+jDzQy2ziy9xVVqphyepNMrEvPVBqRnHS6yhs75sFtpC9QBoecJ5sPpoAdeXPcFsjqJJLWYrUFupQnevpzjSWMdtrI/AVVdptZzJojU+0rccYlXFzRbUOIUWkqAI7CYhL0nW1lW04lmcnsK1JynSEo0heIZuUdKFzLq0haZXfGobSgpKwPbFQB0BB1ns89GDjbN3BMliiu4glMD06oNJmJCTdlFzE060oXS6pAUkNpUNQCSogg2F4TxUMbYhLUu1Qdi2OnJcWRi5CtTyy2gsus5Q58xWMaTiJxobzjEpMDr0DtU0qywO+1o2GnzheKI9oLZnzB2LscUOp+zG8284XaPieirWyoOosVIIPnNuAEHdJIUDxIuBajsS7ST20jkpK1mqltvE9MeVTqwlhO6lbyEhSXkp9yHEEKtwCt4DQR4q6EQsE0LtZhXqKfXcWPFitw5h5rYPynpAqmL8SU3DsiSQh2oTCW+sI4hAOqz3JBjVNL2+sgKvOplWczqQ26pW6kzSHpdBP07iAn1mKgszMbYq2sNogv1CptpqFcrCaZTEzrpRLSDC3urZbHvEJBBNtSbk3JiWGIOh6xAzh1TtGzIkZ6tpRcyk9TVyzC1dgcStakjsJSYVOw+mgaBUyEOPYtIqJHk8m24Cs+pFfp+IKexP0uel6jITCd9malHUutOJ7UrSSCPAxzioIF1GwiF3Ry7K2NdnnC2Jp3Gs3MyE3VZkMsYeROB2Vlm2iQZjdSSjrHDwI9wBfU2GjelD2tq3KYkdyfwnUnafJSzCHMQzcq4UOTC1p3kSoUNUoCClS7HzioA6AgtzaTlZzFE64G9KXS6jNdwspr4121skMA1d2l1nMiisz7Kt1xiWcXNKbVzCupSoJI7Cbx67LHPzLzOVtxWC8YUrES2hvOMSkwOuQO1TSrLA7yIqy2dujBxjm9gWQxRX8RSuCZGospmJGSVKKmJpxlQuhxad5CWwoWIFyoggkCNZbRGzLmHsW40odVTWutZedK6RiairWwtLqLEoIJ3m3ALHduUqF9TYgOYw+kkPJRy+X7v31pNy8rfKczJXrLdSggXGsa5qG0tlTSq1MUedzFwzK1SXmDKPSb1VZS628FbpbUknRQVpbtjWuw/tIv7SmSstV6uWhiulTHsbWEtJCUuOgBSHwke1DiCFWGgUFAaCKeNo9x+nbRuZDjay24ziqoOIUPcqTNLIPZoQIR01Dysj45DYtW2WfUaHDO6vPzU2kMtclXm2cZ4zpVBmnBvJlH3SuYUnkeqQFLt3kWjj5X7UOVWcs8ZDB+OKTW6iAVeQodLUwQOJDTgSpQHcDFXeV3R55x7R2H1ZhVut0+jPV+8+0/iB552dngvUPLCEkpSriN43tayQLRHnNrKHG+zVmj7BYhC6VXqeW52TqFPfJStJJLcww6LG10nXQgpIIFoWsw2mk+rZLd4Wk1MjfKcyzV+gXE2LqNguhzVZr1UlKPSJYAvT088lplsEhI3lq0FyQPExTN0kWYVGzG2jXp2gV+UxHQ26TJtsuyc0JmWQsBZWE2JSDci9vTE7aQuubdWwCzKsz0jKYrrcs1KTUxOhSWPKpWZSHVq3ASN/qt6wGhX2RVRtD5IV3Z2zKfwXX52Qn6i3KszZfpqlqaKHQSkXWlJvob6R7wuGOKR5kd5YuLfFeap7nNGqMjvVr+yTtMZU4T2bMt6TWcxcMUqpSVDl2JmTm6m004ytIN0qSTdJHYYlxLvtTTKHWVpdacSFpWg3CkkXBB5i0UvZVdGBmNm/lvQcX07E2F5OQrkiicYYm3JgOoQsGwXutEX8CYuUw5Sl0Wh0+RWtK1y0q0wVI4EoQEkju0hrro4WPvG+5JN+ZK4XPcPKFl2NtYOI4CDW/bBax0ENiUI58YBxguecF9P54EJ69sY6kwwdIR7oEJga98HDiYOcK/dAhZWvwghXggQjh3wcYOKuyAaHWBCACOcGvOC1vCC8CEcBARBf1wXgQgDWPB545asZtZXYgwu6UpcnpYiWWrg3MJ85pXoUBfuJj3cPiPhEKKeeSlmZPEbOaQQecG4WqWNs0bo3jIix61qDZQxJN4jyJwqKhvJqdOYXSpxC/bIdl1lohXfZKY22651aSpWiBqT2DnHg8CYZmcHY1xqw0wUUarTTVZl1Aeal9xG5Mov27zSV2/zhj02NqgKbg+uTe9ulmRecB7CEG0KMamiFRNVR5Ndd9uFxrW6r26l4wyJ72RwO84eT02Nr9e1QixLX14mxLVao4bqm5px0fSlR3R/BAEdapWhN9Iw6rcaRuDQJESDyMyLVusYhxNLa6OSdOeTw5hxwdvYk+J7I5Mw7DarGqvk4xcnNztwvtJ/ea6rxHEKTBKTlJDYDJo3m2wD95Lqso8gnsRpl6xiRDktS1WWzI6pcmByKuaUH1nuHGS8lIy9MlWpaVZbl5ZpO4200kJSgdgA4R99ALD1wcY6FwjBaXB4eTgF3Ha47T/rgPjmuesWxmqxiblJzZo2NGwf74n/0jjyhcNYelrwHhD8mFEId8B/5MMA2gQjhxGkOFfThANBAhF7CGNYRsAYONtYELB73H0wj86OfSlt56Zjk3sMSVM/ypyP0XvH2n0wj87OfTiHM8cygdL4jqfyp2JHg3nSEHcE3Vmxq9/K7CmfU2w26nK2qrbcSFpVvy1iCLg/22Pf5Z9F3nRjapsIrVLk8C0oqu7N1SZbccSOe4wyVFSu4lI74uRwzLoNBp5CU/wDVmeX+bTHbtp3dAABGt+MTuGqGgfvpWW0cYN7lay2fsgMM7OGW8rhLDja1toJfnJ6YAL87MEAKdcI0voAEjRKQAOGtLG3U8lO1hmyUjzk1dZv39S3F+jpSUkHsihLbll0HavzaPM1Zwn/cNxnCi+Wd7icyPiFmq1WsA3K67IKmSVByTwBISEsmWlJegSKW20CwAMugn1kk+mI3dLNOzktsrtIliQ1MYhkW5gg8UAOqAPdvpR8ESgyZSE5RYIB5UKQH8mbjy21LkujaByRxPgxLrcvOzjCXZCYdHmszbSg4yo9iSpO6T2KMNcLwypD3bAfilLgXR2HBUt7MmLc7MK1yuzOTUnVpmouS7TdRXSaWidWhnfJQFbyFboKr8ONu6JBuZx7dyRf2Pxqf/wCLs/iY0HkXnZjXYuzynJp+jLbn5Qrpldw9PEt9c3vAlBVY7qgQFIcAI56pUYsIX0u+VAw4JgYYxYat1esj5PLhO/2dd1u7bvt6Ik1RyhddkIeDv3ptj1QLOeQVXrizInaCx3i2rYjrGWmL5uu1OYVNzMyKGtrrHlG5VZKQkEnXS0WM9J03ODY0p4m95M77L0rrwrj1m4rev37148nsqdJFX86toFWE69hdqWoldVuUdulNqfepykJJJmF/3RtQHnOWSEG2m6dPedLFMbuyjcJ44gp4+MhDJJKaqJkzbWI2JQ1rOTcWG91HDod6VKO5pZhzzqG11BijSzUupQupLa31dZbxKG7+Ai1xejKgrgRaPzy7PO0NiXZwzLlMX4dDb7iEKlpuRmCQzOy6iCppZGo1SFBQ1BSDrqDYNUemPwsvC6lU7L6tHEBbITLTc2wJRK7c3U3WpN+xAJ7oxX0Uss+vELgogmY1lnZWUaelEk6dT9ripmTQhLs3SpCZnAgcXyhSbnvKENxvfE1QqP5kFRipS7uS0rKrNzfyX2UUlPo3QkeEQmErjja/z3VuIVVsY4pnd9SmkENS6dAVW13GWkAceCUjUk63TYm2aaNWtmF/JxhfUU0UFFGlpsp1Q4hALb5Hb1qQs+JhRVuFM2COQ3LSPctcI5Qve3eq3uiUolLntpisTU5uLnZLDsy7JBfFK1PMocUnv3FEeCjFw+6Q1bim3CPz2YYr2YGyBnsmbMuaRi/DU0tmZlJpJU08kiy0KGm+04g3ChxBSoG4EWAS/TGYXVhUKcy8rXzQdXYyiJ5nyQrtye9vu3+gvGmvo5aiQSwi4IXuCVsbdV5sQtK9LhTKfJ7R+H5iVQ23NzmG2XJzd4qUl95CCe/cAHgkRNro3N38p/gK3DrZ4fyxyKes7s38SZ85l1PGuJFI8uqCwltplJDMuyjzUMtX9ygadpJJOpi4Do1G1I2O8BhR4vzx/lbkZrmOio443bR/tYgcHSucN6p7elpap53rknmw7LzOJyy42eCkKnt1QPiCRH6JpRBYQWmkhDSDuJSBYJA0AHcAI/PLTmEI2gGB7YfNYn5eI/Q/LndDp+jP2484ze8d+HyWaS3lW4qsrpkJuf38q5W6vY8+yTx7C8OpSPTuk+uIzbM+ONo3CODai3k7T64/QX58qm3qVRW5xBmQ2gEKWpCiCEbnm30v3xZN0imztUc/8jr4clFTeKcOTBqchLI9vNI3Cl9hP0Sk2Ukc1ISOcVs7Gm2JWNk/ElWlZ2ku1vCtTdSahSt/qn2H27pDrW9oFgXSpCrXsASCIU0UmvScnG0OcNx2bVrmbabWcbDitqT+be3VNsOMuUrGTrTiShaFYWYspJFiP7V2GNZ7NuzTnJh3aDy3q01lximmS8liGSffm5imuNNMtB5JcUpR0CQnev3RNPF3S95ZSNBW5h7CuJKrWFI+dys6yzKMhVtN9wLWbX96kmO+2BduGv7SVaxLhvFlEbarEkFVGWqNMlVJlEy6l2DDnHcWm4CFE/PADzSb6nSVEcT38iGjfuXsNjc4DXuVNdCAgG+gvpGSSIgv0iG2vi7Z2quHMKYIalJas1OUXUZmqT0uHwyyHC2hDbZ80qUUqJUq9gAALm49L0eO15ibaXw3ianYvlZQ1/Dy5dSqhJNdS3Nsvb+6VN3IStKm1A7uhBBsNYZDSSiHlz5qWcq3X1N6mITppGK1eadIySL6wnCAgwjC2lV97Wy/7OtaA4+TyvxKY6HDORuOsT0aVqtMw3MzlPmkb7L6VtgLTe1xdQPEGPS7WSG1Z51q+h6iV+JTEsdnJoJyVwjwP9RcbfRqi9anGJsFwOjmgaCXBozv6t9xHBc6UmBU+P6Q10FQ5zQ1zzlb17bweKiVSNlfMeqzaG10JqltKPnPzsy2lKR22SVE+gRLPJHI2mZP0hwIdFQrM5u+Vz5Ru3A4NoT7lAPpJ1PIDZosOVoakbw0NjFb4ppPX4tHyMpDWbw24v03JPwVq4PohhuCy8vEC5+4uINuiwA69qq9x43NTOYuIH1FSptVVmDY6nf65VhY8eUbkex1tFtDSSrmmlk0hv8AAjq9qnKWfwdj6br8q0o0SsvF9DqBoy+dVtnsJN1DtBPZGwsstsmTptClpHGVPnHp2XQGxPyKUrD4AsCtBIIV2kEg8dItGrnfW4fBVUVKycWzBAJGQ2dYsRt2KoKKBlDidTR19W+ndfItJAdmdtuINwdm1asxq9nZmDIS8piCgV2oS8u51raTSwgpVYi90pB4ExvbY4w1iDDlAxCzXKRPUgOTzLjLc6yWiv52QogHiNEiPKY823HHHpdOEaLuy7boW8/VQN51A4oSlJO7f3xJPYIknl9i1rHmEaTXmZWYkW55oOiXmUFK0G9iO8XGiuBFjziI45VYhDhYgnpWxRvOWruIN9g2Xt3qb6PUWGTYsammrHzSsGZdvBFtpzNr91lXG7JNTmYa5dZC2nauW1JPNJmLEeoxZ8wjq0biAEoT5qUgaADgIrFZl7ZlN7qvOFZHyiLPG7+d9MY3adk/9KOY/wCK1+DwC9Yd+sP8kySOGsVi5oTls0MUpIv+fEx8aYs8PGKxM0erVmdioked7MTPxxjxoD9on9kd69+Ea3i1Nf1j3KzCUAVT2Tb+5J+0IrlzzfcmM3MZFwkueyj6NfehW6n4AIsZkgVyTAFwOqT9yIhbteZTTlBxi7i6UaUqk1Up8ocSNGJgAJIV2BYAIPbcdl0WhNVHBiL43mxeLDpuDZK/CBSTVGFRyxi4Y4E9FiL9XxXwl8XbQ7Um0iWla4hhCEpbSikt2CQABbzOFrR0OMHs9ceU1unYgotdqMk28H0tqpiUWWAQDdKQeCj642Hk/tgM4foMpRsX0+amlybYZaqMmErU4gCyQ4hRGoGm8DrbUR2WPNtJlSUNYRpK0ObySuaqqQBug6pS2lR48Lk6chEoDcTirNWHDowQcngADpv+zzKIF+EzUOvPikpBGbCST0W393Osdm/DmKMHYMzEXV6PP0hSpDrZUTbRb33EtO6pvxI0jSWQtLk6nnFg9ueCVy/liV7q+BWlBUj+MExO3LvGctmdgSRrfkLsm1ONqS5LPptr7VW6fdJOtlcxEA808EVrJfMVcqhTrCGX/K6VPI0DjYVdCkn3ydARyI7CI8YJXOxGpr6ecCOaQWtwIaWnsyK3Y9hzMMpMNqqYmSCIk3O8OcHjtzCspQNwXGsMK3uHGIr4R23ZI0VtOIqBOeyiEWW5T1ILTqvfWUQUX7NY85K7ZmJJ3MWVXLUgPUN9SZZFEZAW+u50UldrlzXh7Xl3xBm6JYs5zw6O2rvJFj0dPUONlYZ01wUNjLZdYuIyANx09HWeF1LPGCAcMVYHnJPg/wC7VFf+zswlGcuDd3/Gx8WqLBa3Ku1jD83LtpU25MyrjaUrsCkqQQAe+5iszBGKZ7K7H9Kqr8oXpikTfz6UWdwkpuhaL8jqR4xI9D2GairoGec5th1hwHvUW03eIcQw+ofkxrrk9BaT7laIFG2ojMaiNKZX7UNFzUxYxQZCkT8m47LuPddNLbtdAB3QEk3uL66cI81tRbQteyuqdMoWHG2GJyYl/LHp2YaDu6gqKUoQk6XO6SSb8ohcWAV8ta2gLNWRwvmd3E2vwU/k0iw6OhdiDZNaNptkN+WWduKkjpAdO+NG7LueNTzhoVUZrTDKarSnG0uTEujcQ+hYO6d3gFApINtOB0jeNobK6imw6ofSzjym/wDsdoTtQV0OI0zKqA+S7Z3d6DxivnpjUrGUOASOHzQufJXIsGFrxX90xTqW8n8BX/XAv5K7GaD7Sz97kon9G5Vr5UZG5hZ2Gp/MRhOcxMKaWxOeSlsdT1m9uX31J47iuHZGzpHo9c/qvMttIyzm5VajYOzM1KtJT4qLukSo6GgocTm2Ny/nUvUjumIsvCEpOiQPRD3VYpLBK6IAEDj0JBFSse0POSr/ANjXoyE5UYmp+Ocy52Tq1fkFB6n0WRJclZN4e1ddWQOtcT7kAbqTrdRAt67pX1ob2Xk6XHzR08endeiawVfQxCzpYEIVswJCtB80VPI/gvQ0QzPqKpjnnO6WvY2OIgKOPQ5U6VmcysyZ9xlKpqXpEoy04RqhDj6ysDxLaPVFrrikqbCVcDYGKtOhwShON80LcfY2R+Oei0t1CVI3SNDxtGcTBFU4Hm7limziC/PVtNVGoVHaLzMenUqM2vEs+lSVDXR9SUi30oTEoqbnDtzsybLLNHxe0y2hKEJGFWAAkCwA+dcLRwOk92c6hl7m5OZjyMi47hPFS0uTD6EkplJ/dCXELPues3QtJPElY4iNj7NfStUvDOCqdhzNCh1Sdn6awiVartJQh5Uy2gBKOuaUpJCwAAVJJCuNgbw/OeX08ckTA/mO5IA3Vkc15LVo7OZO11nhQJaiY2wji+t0yXmUzjTJw2hrcdCVJCgptsHgpQte2sSk6KTK7H+WbWZTeLsL1fDUrOLp65VNVlVMdctIfCygK42BSD4iPG52dLqpZYlcrMLLZCHUuP1PEyE2WhJBLaGG1G28BYrUq4B0F9YnXkznvIZs5H0rMj2JqFDlJuRcnHpKYllqdb6sK6zcAF3UHdJQpI88WsLm0NtXJO2DUdGGh24duxKomsL9YOuQqzdq7o38wsHY4rGIcuKS7izCU9MOTjUnIqHl0gVqKi0WiQXEpJO6pFzawIBGussMbZm0TkJMtUmbxJWW0y4CBSMXSZfske5HXJDgA7laRJXBXS+ut5h1w4twgp/BUzNFVMNL3RPSTI0AcStW68SBvHVJSokC4AjPa86Q7J3OLJKv4Xo+HKrXa3UpfqpN2rU5DLdPcuCHw4VqUFItcBHE6E2vCxjqjyYqmLWHHgtThHm6N1it/bE+3TK7UDNQw/XaWzh/GVPlxNOMyqyqVnWN4JU61vecgpKkhSCTbeBBIvaqXalnqjPbR+Zz1QSozasSzyVJWNQA8pKRbs3QkeESB6KPB1YxFtITFflpdwUahUmZTOv2IRvvpDbTV+G8fOVbsRfsjm9KNs61TAWbc1mPISC3cJ4pUlUy+2klEpP7oStDh9yHAkLSTxO+OI1IBDT1jmMNgRl08PisSa8kIcRsXLkM4tudMgw1LUrGDUuhtKW0t4WYACABu2+dcLWjwubitr7OzDzNCxvhPGNdpTMymcbYXhtDe46kKSFBSGwrgtQtexvG9tmjpVabhPA1Ow7mjRKnPTtNl0SrNdpCEPLmW0AJR1zS1JIWAACpJO9a5AN4yzq6XxL4YlMqsLOsrDyFv1PE6E2KEqBLaGG1G28BYrUrQE2F7EYtO2SzYGg8Vm8bm5vPQvV9FNlZmFlo7mYjF2F6xhqSnE09UsmqyipcPOJLwUUBXGySL27REANpCWXMbR2ZCHLKSrFdQSQeYM2sGLyMgs4pfPjKHD+N5ekTlDTVGt4yU62UqQtKt1W4ogdY2SCUrGihYxRrtCzhc2kcxidP67J/5WuPNBI6WokdILFYnbqsYGr9AtElW5GlSbLSUoabYbQlCRYJAQAAPVFWfTCFprMfLle4A4ujTSVKtqQJhNh6Ln1xajIG9PY/aUfciKqumIP9knLcHh7DTfylENeGEiqaRzpVUi8RUmeiuV12yZTRfT2aqI/90RCDpTZe+1xPkH+8tPH8VyJwdFc0BsmU0DnWqif/AHREN+liwvUKLtJyNddaV7H1ihSxlnSPNUplS0OIv2i6Ce5YhdTW+kJA7ffvWmW/i4tzKx7YlC07KeVQPH5n5a/qMbw3tYqp2delMw7lBkVQcIVvBdYqVaoEn5Ew9T32Uy8y2i5QVFZ3kGxANkq4XHG0Wc4UxMzizC9IrsqCJapSbE60km5CHW0rT8ChDTVwSRyOc8WBJSuJ7XNABXe2vx0gPdFWG1N0mGZWCs9sQ4awWmlUuh4en109SZ2R8pdnnGzZxSyVDdSVXACLGwve50sD2bc31Z9ZJ4Tx2uQFMdrEqVvSiVFSWnkLU24Ek6lO8gkE8iIxNSSwRtkfsKyyVryWjctmDSDhDVCtCJbUeOsHKC1x2wcD2wIRfvgt3QcoXPtgQmNIILmCBCDz1ggPGCBCAbQaXMHGAmBCPhg8ILG0HwwIR48ICBAYBAhCbDUx5/H9CmcR4MrdMklJTNTcm4y1vGw3iNATyvw9Md/u8xDAIjTNE2eN0T9jgQevJboZXQSNlZtaQR1ZqPGSWRE7Jz/sxiuSDBl1/wBS090pVvKH90Xa4sOQ5nU8BEhxoLCDhwgF9RDbheFU+EQCCnHSTtJ505YritRi9QaioPQBsA5ktLQ9e2DlaAw8JnRxFrwcYOGsHOBCLawQawcT2wISMP4YOEHDWBCVu6He57oVyDD5wISICrX5G8RNxX0ZGSuMsUVivT8pXfLarOPT0x1NYWhBcdWVr3U7uguo6RLQk2jGwBEbY5XxX1Da68lodtC+UjJt0+Val2gQ22hKEgm5sAAPgEfZXCC9oOHGNS9LAoChY84jFmX0c+UOa2O65i6uy1bXVqy+Zia8mqy2mispCSUpCdNEiJQAW5wrE/ejbHK+I3YbLy5odtC4NCocrhuh06lSSVIk5GXblWUrVvEIQgISCTxNgNY5hRv6GMofLSNRN8yvS07nlskZY7Q6WncY4cbmaoyjq2atJuGWnG08k9anVSRySoKA7Ijyjohso258urxFi92WvcSxm5cDw3wxvROgk+iFa8Ko6qeIarHkBanRMdm4LV+SGzNl1s+SDrGCcOS9MfmEBMzUHFKenJgDkt5ZKiL67osnujQfSxKSjZTuoXHzQSH/AMkTNvaNC7amz7WdpXJZWD6FUZCmVAVKWng9Ut/qilveum6ATfztNOUeqeX/AKhskh37SsPb5Ba0Kvjou8tMKZw1nNTDOLqJK1yjzNJkVLlplPtVB9yy0KFlIWOSkkERJmodEJlDM1czMvXcWyMmVbxkW51laQOwLWyVgeJJ747jYP2IsV7K+KsW1bEVcotVRV5KXlWW6V1xKChxSyVFxKdNQBaJoBUK6urfyzjE/L/S1RRDUAeFqjIzZey62dqa7LYJoDUhNTCQiaqT6y/OTIBuAt5Wu7fXdFk90bXBsLHhCOkHDnDU57nnWcblKgAMgtRZ87KWW20dKMpxjQUzE/LoLctVZNwy86wm991LqdSnj5qgpOvCI90ToicnqXVxNTlYxXVpRKt7yCYnmmkKHvVLbaSsjwIMTivaETr2xvZUzRt1WuIC8GNjjchR0zK2BMnMzmMOsTuH36XKUGSNPkJaizi5NttkrKyClN947xJKjqSTcmNp5R5Q0HJLANLwfhhuZao1OLimEzb5fcutwuKJWePnKMe4AsYZIAjw6aR7dVziQvQa0G4CihK9GbkvK4qbxCmSrip9E8KgN6sOFHWh3rfa24b3KJWpCW963M3MZXgEYklkltruvZDWtbsCxLYXx4RHvPDYQykz5q71ZrdCdpdffN3qvRH/ACV989rgsUOH6JSSe+JDcIQ10MYjkfEdZhsUOaHCzgoO0joicoJGeD89W8WVZlJv5M7OsspI7CptoK9RES0yvyiwfkzhpugYMoEnQKWlW+pqVR5zi/fuLN1OK+iUSY9dwg1jZJUSzC0jiV5bGxnmhaQ2ldkHAm1HI05GKETslUqbviTq1LeS3MNIXYqbO8lSVoJANlDQ6i2sdts6bMeDNmXCkzQ8JszLipx4TE7UZ90OzM0sCyd5QAASkXASkAC55kmNtW7TD4cDHnlpNTk9byeCzqNvrWzSNu2MTqLEaQ7emHbjGle1qvHmzbg3MbEr9dq7M8Z99CELMvNqbSQhO6nzbdgEe7whhSRwThyQolMS4iRkm+qZDq99QTcnUnjqTHc6W01gvpaF0tdUzxNgkkJY3YCchbIJvhw+kp5nVEUQa920gZm+Zv1oOvCFw8YNeEPvhCnBcKsUeQxBTZiQqMozPSb6dx1h9AWhY7wY0bXtirAtXm1PyszVqQlRv1MtMJW2PDfSoj1xv+Fy1hypMSrKC/i0pbfgcuzYmqtwqhxKxq4Q8jYSM+3atOYK2UMA4MmmplUi/W5lshSF1V0OpSrt6sAJPpBjcJbASkIFgOAEZnWC9jwjVVVtTWv16mQuPOe7gttHh9Jh7OTpYwwHgLX6ePWtMtbJmAmq2KqGaiZoTPlWs8rd39/f4W4X5RuUWSCBzN4ZN4UFTW1NZbxiQutsub2WaWgpaHW8WjDNbbYWukUq5GNM1jZLwFXa7O1aaZqJm5yYXMu7k8pKd9St42FtBc8I3RBeClramiJNNIWk7bGyKugpa8BtVGHgbLi6TTYbbSgCwSAB4R8KlTpWqyT0nOS7U3KvJKHWXkBaFpPIpOhEcgk211ha8oSBxB1gc0tLQRqkZLRVf2OMCVaaW/JKqNFKjfqpN8KbHglaVW8AY5eFtkbAOHZtuZmZearrqDdIqTwU2D+1pCQfTeN12tBD4cexQx8kah1unPt2+9R1ujeDtl5YUzNboy7NnuXxalUS7aG20JQ2gBKUJFgkDgABwEdTi3AtCx3SVU6u01ipShO8EPJ1Qr3yVDVJ7wRHeeMEMrJXxvEjHEOG8bU/yRRysMcjQWnaCLjsUfZ7YqwU/NdZL1GsyTRN+pQ+2tI7gVIJ9ZMe/wAvMhMHZaP+VUqnFypW3fL5xfXPAcwkkWR+5AjYfCELCHefGsRqY+RmncW8L7enj1pkpsAwqkl5eCna13G2zo4dSxtujdHCNU5kbMWC8y6q5VJyXmadU3dXpqnOhsvG1rrSQUk99r9sbZte8AOukN9LV1FFJytO8tdxCcquipq+PkqqMPbwIWpMt9mbCWWFcYrEi5UJ2pMBQaem5gWRvJKTZKUpB0J43jtc2MisNZxsynswiYlpyUCkszsm4EuJSTcpNwQpN9bEaco2NqeMANjxhU7Fa51QKsynlBsN8+joz2bElZg+Hx0xo2wtEZzLbZE8enIZ7V4zK7KTD+UVCXTKEy4A6vrZiZmF77r67WBUbAaDQAAAR7Mm0BPphWvxhDPPLUyGWZxc47SU4wQRU0bYYWhrRsAQACNTGqdoHZrwdtK4fplGxk3POydOmzOsGQmzLrDhQUakA3FlHSNrnhByvGpriw6zTYrcQCLFae2edlXAuzK1XEYLYn2vZlTKptU/OqmSrqgsICbgW9urxvG4TxtC5waeMZe90h1nG5QAGiwS3b90a6zyyFwvtCYL+ZbFrc27SvK2p0CSmTLuB1sKCTvAHTzjpGxyYQjDXFp1mnNBAORWktnzY/y/2aKhWp7BjNSbmKu00zMmfn1TI3W1KUkJBAtqoxu227D5QcRaMve6Q6zjcoAAFgusxFhqlYwos5SK3T5Wq0ucbLUzJTjKXWXkHilSVCxERBxp0T+TGJai7N0l2v4SDit7yWmTqXGB3JS8hZSO4KiaNoB3xsjnkh9G6y8uY1/nC6iXlj0Y+SuXNVl6jN02oYxm2CFt/NFMpeYSoHQ9QhKUK8FBQ7olgzLNSzCGWkJbaQkJSlA3QkDgABwA7I+nKERcdsYkmkmN5HXQ1jWCzRZRyzp2AcnM7au/WKnh5yjVyYUVP1KgP+RuPKPunEAFtavoim55mNU0voiMn5OeS9OVvFtUYBv5K7OstJUOwqbZCvURE49NNIfLSNraudjdUPNl5MUZNyF5LLHKjCeTWFmMPYNoUpQaQySsMSqNVrPFa1G6lrPNSiTHc4jw5TMXUabpFZp0rVKXONlqZk5xpLrLyDxSpKhYiOzN4dtOFoTFxJ1ic1ssNihfjToocmMTVBybpbtfwmlxW95LTJ1LjCe5KXkLKR3BUdxln0X2SOXtUYqM3TahjGbZIWgYhmg6wFDmWG0oQrwUCO6Jc2hQqNZUFuqXmy1CGMG4C+DckzLSzbDLaWWW0hCEISEpSkaAADQADlEVMWdGdkxjPGFXxLUZSvGpVSedqMz1NYWhsuuOFa91O7oN4nTlEsr2gOg740MlfHmw2WwtDtoXzl2Ey7SG0iyUpCQCeQFo0ptAbHeXm0pVKPUcYy9SdmaUw5LS6pCfVLjcWoKUFAA31Ebv1gItHlj3MdrNNiskBwsVr/JLJHDWz/gaXwlhRqaao7L7sykTkyX3N9xW8olRtz5RhnVkPgraCwt8z+NqMiqySF9bLuBZaflXLW32nE+cg20NtCNCDGw/HhBoPvxnlH62vfPiiwtZQdk+iHydlqn5Q7WcWzUqDfyJc+ylJHYVpZC7em/fEy8L4WpuDcM0ugUmXMvS6bKNSUqypal7jTaQlCd5RJNgBqTeO3uRyg5R7knklsHuuvLWNZ5oUWM6ejkyqzvzFexnU1Vij1ScWlyoN0iaQ2zOqAA31JUhRQsgAFSCL2vx1iRuC8G0bL3CtLw5h6RbptFpkuiVlJRq+622kWAudSeZJ1JJJjuSNYdrC/GPL5ZHtDXG4CyGtBuAg3vwg4DSAG4gtGpekcIRPZD4wGBCOMF4OcHwQIQIIIIEIB1gvbvgvaFxMCE+UBF4O6DhAhGkHGDjxhGBCLXh21ggHG0CEcIIXOGIEItrDOmkKCBCCPVBwhnSFzgQgDWC0BEB1OsCEaX42gOggggQi/LlAbQQHWBCB3m0A+CDlBAhHDugvD74xMCE/ReD7UEBMCEuHfDgA5QjpAhMW5QXNhAIQ4mBCNeyHe3dCvflDteBCL3gBgGgg42gQgm4hWhmCBCNfTBw1hcoBAhOCEOEMmwgQiDiLWggtAhEF+6CAGBCLQoL2EAVrAhMwcIOEIm3CBCCbwxCBhnhAhHfADrpBC4C8CE7EHTWC8HCDiQIEIA1g4WhHzTDPC8CEEkCAAEfzwE274IEJEWh2hX0hgXTAhK3dpD0MI8IDxtAhM8YXog4CHwgQlGULiLwiYEJk98LUQyNBABYEwIRbXjeC/GDtjHetAhZawcIE6wr62gQmdDeAcNYBpcwcTaBCO2FfSGBAYEI+3Bex0gPGCBCDeDh3QCCBCXOC8MwQIR8MA1EB1gtoYEItpe8B48YDAeECEremC0HGDiYEJi9uyAXgvaAiBCNILd0LgIfdAhHwwXvpAdYLWgQiAacDBC5CBCy56mEfGAmwgvax7YEIJt9+C9x3wK7YLmBCNSIOV+yA+brzggQg90B+GDjAeQgQi+nCDh3QxrzjEc4EJ31hcIZ0PdBAhA9UHDvgPDtggQjlBxg5mC+loEICR2XggEECF//2Q==';
const MANIFEST = JSON.stringify({ name: 'Prepfix Church Media Toolkit', short_name: 'Church Media', start_url: '/', scope: '/', display: 'standalone',
  background_color: '#16181d', theme_color: '#16181d', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] });

const SAMPLE = `Reign, Jesus reign
Reign, Jesus reign...
King of Zion
Judah's lion
Reign, Jesus reign

He sits high on His throne
He is a God
And He will never leave you alone
He is sovereign
He is Holy
Just come before His presence boldly (boldly...

Reign, Jesus reign
Reign, Jesus reign
King of Zion
Judah's lion
Reign, Jesus reign.`;

const DEFAULTS = {
  church: { font: 'Georgia', size: 110, color: '#ffffff', bg: '#000000', shadow: false, wpBehind: false, autoProjector: true, brand: true },
  stream: { font: 'Arial', size: 64, color: '#ffffff', style: 'outline' }
};

// ---------- load saved data (never thrown away) ----------
let data = { songs: [{ id: 's1', title: 'Reign, Jesus Reign', text: SAMPLE }], playlists: [], settings: JSON.parse(JSON.stringify(DEFAULTS)) };
if (fs.existsSync(FILE)) {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = { ...d }; // keep any extra keys from older/newer versions
    data.songs = Array.isArray(d.songs) ? d.songs : [];
    data.playlists = Array.isArray(d.playlists) ? d.playlists : [];
    const s = d.settings || {};
    data.settings = { ...s, church: { ...DEFAULTS.church, ...(s.church || {}) }, stream: { ...DEFAULTS.stream, ...(s.stream || {}) } };
    fs.copyFileSync(FILE, BACKUP); // a fresh backup every time the server starts
  } catch (e) {
    const keep = path.join(DIR, 'data.broken-' + Date.now() + '.json');
    fs.copyFileSync(FILE, keep);
    console.error('\n!! data.json could not be read (' + e.message + ').\n!! It was kept as ' + path.basename(keep) +
      '. If data.backup.json exists, rename it to data.json and restart.\n');
  }
}

let live = { key: '', church: [], stream: '', churchBlank: false, streamBlank: false };

// ---------- saving: only when songs/playlists/settings change, written safely ----------
let saveTimer = null;
function writeNow() {
  clearTimeout(saveTimer); saveTimer = null;
  const json = JSON.stringify(data, null, 1), tmp = FILE + '.tmp';
  try { fs.writeFileSync(tmp, json); fs.renameSync(tmp, FILE); }
  catch (e) { try { fs.writeFileSync(FILE, json); } catch (e2) { console.error('Could not save data.json: ' + e2.message); } }
}
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(writeNow, 250); };
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => process.on(sig, () => { if (saveTimer) writeNow(); stopWinHelper(); closeProjector(true); setTimeout(() => process.exit(0), 300); }));
process.on('exit', () => { if (saveTimer) writeNow(); });

// ---------- real-time (Server-Sent Events) ----------
// The control page gets everything; church/stream screens only get settings + the live lyric.
const clients = new Set();
const send = (c, ev, obj) => { try { c.res.write('event: ' + ev + '\ndata: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} };
const kitInfo = () => ({ product: PRODUCT, version: KIT.version, build: KIT.build, updates: !!KIT.updateUrl });
const dataFor = c => c.full
  ? { songs: data.songs, playlists: data.playlists, media: data.media, settings: data.settings, lic: LIC, kit: kitInfo(), support: SUPPORT }
  : { settings: data.settings, lic: { status: LIC.status, church: ['ok', 'expired', 'suspended'].includes(LIC.status) ? LIC.church : '' } };
const pushData = () => clients.forEach(c => send(c, 'data', dataFor(c)));
const pushLive = () => clients.forEach(c => send(c, 'live', { ...live, serverNow: Date.now() }));
// tell the control pages whether a church (projector) screen and a stream page are open
const screenCount = () => { const n = { church: 0, stream: 0 }; clients.forEach(c => { if (c.view in n) n[c.view]++; }); return n; };
const pushScreens = () => { const n = screenCount(); clients.forEach(c => c.full && send(c, 'screens', n)); };
setInterval(() => clients.forEach(c => { try { c.res.write(': ping\n\n'); } catch (e) {} }), 20000);

function applyUpdate(p) {
  let changed = false;
  if (Array.isArray(p.songs)) { data.songs = p.songs; changed = true; }
  if (Array.isArray(p.playlists)) { data.playlists = p.playlists; changed = true; }
  if (p.settings && typeof p.settings === 'object') {
    const s = p.settings;
    data.settings = { ...data.settings, ...s,
      church: { ...data.settings.church, ...(s.church || {}) }, stream: { ...data.settings.stream, ...(s.stream || {}) } };
    changed = true;
  }
  if (Array.isArray(p.media)) { const before = data.media || []; data.media = p.media; removeOrphans(before, data.media); changed = true; }
  if (changed) { save(); pushData(); if (p.songs || p.settings) teamLater(); }
  if (p.live && typeof p.live === 'object') {
    const wasHidden = !!live.churchHide, nowHidden = !!p.live.churchHide;
    // Hide lyrics: make the projector window invisible so Windows shows its real desktop on that screen.
    // Hide the window before the page changes; show it only after the lyrics are back (no flash).
    if (!wasHidden && nowHidden) winCtl('hide');
    live = p.live; pushLive();
    if (wasHidden && !nowHidden) setTimeout(() => winCtl('show'), 150);
  }
}

// ---------- projector window (Windows): opens the church screen full screen on the extended display ----------
const { spawn, execFile, spawnSync } = require('child_process');
let proj = null; // the browser window showing the church screen
const pushProj = () => clients.forEach(c => c.full && send(c, 'proj', { on: !!proj }));

function getScreens(cb) {
  if (process.platform !== 'win32') return cb([]);
  const ps = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { '{0},{1},{2},{3},{4}' -f $_.Primary,$_.Bounds.X,$_.Bounds.Y,$_.Bounds.Width,$_.Bounds.Height }";
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 10000 }, (err, out) => {
    if (err) return cb([]);
    cb(String(out).trim().split(/\r?\n/).filter(Boolean).map((l, i) => {
      const [p, x, y, w, h] = l.trim().split(',');
      return { i, primary: p === 'True', x: +x, y: +y, w: +w, h: +h };
    }));
  });
}
function findBrowser() {
  const E = process.env, PF = E.ProgramFiles || 'C:\\Program Files', PF86 = E['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    path.join(PF, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(PF86, 'Google\\Chrome\\Application\\chrome.exe'),
    E.LOCALAPPDATA && path.join(E.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(PF86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(PF, 'Microsoft\\Edge\\Application\\msedge.exe')
  ].find(f => f && fs.existsSync(f));
}
function closeProjector(sync) {
  const ch = proj; proj = null;
  if (!ch) return false;
  if (process.platform === 'win32') {
    const a = ['/PID', String(ch.pid), '/T', '/F'];
    sync ? spawnSync('taskkill', a, { windowsHide: true }) : execFile('taskkill', a, { windowsHide: true }, () => {});
  } else { try { ch.kill(); } catch (e) {} }
  if (!sync) pushProj();
  return true;
}
function openProjector(screen, cb) {
  if (process.platform !== 'win32') return cb('The projector button works on Windows. Open http://localhost:' + PORT + '/?view=church and press F11.');
  const exe = findBrowser();
  if (!exe) return cb('Google Chrome or Microsoft Edge was not found on this computer.');
  getScreens(list => {
    const s = list.find(x => x.i === screen) || list.find(x => !x.primary) || list[0] || { x: 0, y: 0, w: 1280, h: 720 };
    const hadOld = closeProjector();
    setTimeout(() => {
      // a separate browser profile so the window always opens fresh, in app mode, full screen on the chosen display
      const args = ['--app=http://localhost:' + PORT + '/?view=church',
        '--user-data-dir=' + path.join(os.tmpdir(), 'church-lyrics-projector'),
        '--window-position=' + Math.round(s.x + s.w / 2 - 200) + ',' + Math.round(s.y + s.h / 2 - 150),
        '--window-size=400,300', '--start-fullscreen',
        '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
        '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate'];
      let ch;
      try { ch = spawn(exe, args, { stdio: 'ignore' }); } catch (e) { return cb('Could not open the browser: ' + e.message); }
      proj = ch;
      winCtl('ready'); // start the hide/show helper now so the first "Hide lyrics" is instant
      if (live.churchHide) { live = { ...live, churchHide: false }; pushLive(); } // a newly opened projector starts with lyrics showing
      const gone = () => { if (proj === ch) { proj = null; pushProj(); } };
      ch.on('exit', gone); ch.on('error', gone);
      pushProj(); cb(null);
    }, hadOld ? 900 : 0);
  });
}

// ---------- hide / show the projector window itself (Windows) ----------
// A small helper runs in the background and hides or shows every window whose title starts with
// "Church Lyrics Projector". Hidden = Windows' own desktop shows on the projector exactly as usual.
const WIN_HELPER = `$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class CLWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  static List<IntPtr> hidden = new List<IntPtr>();
  static List<IntPtr> Find(bool visible) {
    var found = new List<IntPtr>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (IsWindowVisible(h) == visible) {
        var sb = new StringBuilder(300); GetWindowText(h, sb, 300);
        if (sb.ToString().StartsWith("Church Lyrics Projector")) found.Add(h);
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static void Hide() { foreach (var h in Find(true)) { ShowWindow(h, 0); if (!hidden.Contains(h)) hidden.Add(h); } }
  public static void Show() {
    var list = hidden.Count > 0 ? hidden : Find(false);
    foreach (var h in list) ShowWindow(h, 8);  // show again without taking the keyboard from the control page
    hidden = new List<IntPtr>();
  }
}
'@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq 'hide') { [CLWin]::Hide() } elseif ($line -eq 'show') { [CLWin]::Show() }
}
`;
let winHelper = null;
function winCtl(cmd) {
  if (process.platform !== 'win32') return;
  if (!winHelper) {
    try {
      const f = path.join(os.tmpdir(), 'church-lyrics-window-helper.ps1');
      fs.writeFileSync(f, WIN_HELPER);
      winHelper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
      const h = winHelper;
      h.on('exit', () => { if (winHelper === h) winHelper = null; });
      h.on('error', () => { if (winHelper === h) winHelper = null; });
      h.stdin.on('error', () => {});
    } catch (e) { winHelper = null; return; }
  }
  try { winHelper.stdin.write(cmd + '\n'); } catch (e) {}
}
const stopWinHelper = () => { if (winHelper) { try { winHelper.stdin.write('show\n'); winHelper.stdin.end(); } catch (e) {} } };

// ---------- auto launch ----------
// Opens the church screen on the projector when the app starts, and again whenever a projector is newly connected.
// It does not re-open a projector window that you closed yourself (until the projector is unplugged and connected again).
let lastExt = -1, checking = false;
function autoProjectorCheck(first) {
  if (process.platform !== 'win32' || data.settings.church.autoProjector === false || checking) return;
  checking = true;
  getScreens(list => {
    checking = false;
    if (!list.length) return; // could not read the screens this time
    const ext = list.filter(s => !s.primary).length;
    if (ext > 0 && !proj && (first || lastExt === 0)) {
      console.log('  Projector / second screen found - opening the church screen on it.');
      openProjector(-1, err => { if (err) console.log('  ' + err); });
    } else if (first && !ext) console.log('  No second screen yet. Connect the projector (Windows key + P > Extend) and it will open by itself.\n');
    lastExt = ext;
  });
}
function openControlPage() {
  if (process.platform !== 'win32' || process.env.NO_BROWSER) return;
  execFile('cmd', ['/c', 'start', '', 'http://localhost:' + PORT], { windowsHide: true }, () => {});
}


// ---------- phone setup: this laptop's Wi-Fi address + a QR code to scan ----------
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const i of list || []) {
    if (!(i.family === 'IPv4' || i.family === 4) || i.internal || /^169\.254\./.test(i.address)) continue;
    let score = 0;
    if (/wi-?fi|wlan|wireless/i.test(name)) score += 3;
    if (/ethernet|^eth|^en/i.test(name)) score += 2;
    if (/vethernet|virtual|vmware|vbox|hyper-v|bluetooth|loopback|docker|wsl/i.test(name)) score -= 5;
    if (/^192\.168\./.test(i.address)) score += 1;
    out.push({ name, address: i.address, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
// QR code generator: "QR Code Generator for JavaScript", Copyright (c) 2009 Kazuhiko Arase, MIT license
// (https://github.com/kazuhikoarase/qrcode-generator). "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
const QRLIB = (function () {
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();
  return qrcode;
})();
function qrSvg(text) {
  const q = QRLIB(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 8, margin: 3 });
}

// ---------- the computer's own desktop wallpaper (shown on the projector when lyrics are hidden) ----------
function desktopInfo(cb) {
  if (process.platform !== 'win32') return cb({ ok: false });
  const q = (key, val, done) => execFile('reg', ['query', key, '/v', val], { windowsHide: true, timeout: 5000 }, (e, out) => {
    const m = !e && new RegExp(val + '\\s+REG_\\w+\\s+(.*)', 'i').exec(String(out)); done(m ? m[1].trim() : '');
  });
  q('HKCU\\Control Panel\\Desktop', 'WallPaper', wp => q('HKCU\\Control Panel\\Desktop', 'WallpaperStyle', style =>
    q('HKCU\\Control Panel\\Desktop', 'TileWallpaper', tile => q('HKCU\\Control Panel\\Colors', 'Background', col => {
      const cached = process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft\\Windows\\Themes\\TranscodedWallpaper') : '';
      const file = [wp, cached].find(f => { try { return f && fs.statSync(f).isFile(); } catch (e) { return false; } }) || '';
      const rgb = (col || '0 0 0').split(/\s+/).map(Number);
      let mtime = 0; try { mtime = fs.statSync(file).mtimeMs; } catch (e) {}
      cb({ ok: !!file, file, v: Math.round(mtime), style: +style || 0, tile: tile === '1',
        color: 'rgb(' + [rgb[0] || 0, rgb[1] || 0, rgb[2] || 0].join(',') + ')' });
    }))));
}
function sniffType(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

// ---------- Check for updates (only when the operator presses the button) ----------
// version.json on the Prepfix update page lists the files with their fingerprints and is signed by Prepfix.
// Songs, playlists, settings, licence and wallpaper are never touched. If anything fails, nothing changes.
const UPDATABLE = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]*\.(js|html|txt|bat)$/i;
const KEEP = ['data.json', 'data.backup.json', 'license.json', 'kit.json', 'wallpaper.bin', 'node.exe'];
function httpsGet(u, hops = 5) {
  return new Promise((resolve, reject) => {
    const r = https.get(u, { headers: { 'User-Agent': 'PrepfixChurchToolkit', 'Cache-Control': 'no-cache' }, timeout: 20000 }, x => {
      if ([301, 302, 303, 307, 308].includes(x.statusCode) && x.headers.location && hops > 0) { x.resume(); return resolve(httpsGet(new URL(x.headers.location, u).href, hops - 1)); }
      if (x.statusCode !== 200) { x.resume(); return reject(new Error('HTTP ' + x.statusCode)); }
      const b = []; x.on('data', c => b.push(c)); x.on('end', () => resolve(Buffer.concat(b))); x.on('error', reject);
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', reject);
  });
}
const friendlyNetError = e => /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|timeout|ECONNRESET/i.test(String(e && (e.code || e.message)))
  ? 'Could not reach the Prepfix update page. Check that this laptop is connected to the internet and try again.'
  : 'Update failed: ' + (e && e.message || e) + '. Nothing was changed.';
const baseUrl = () => KIT.updateUrl.endsWith('/') ? KIT.updateUrl : KIT.updateUrl + '/';
async function fetchManifest() {
  const m = JSON.parse((await httpsGet(baseUrl() + 'version.json?t=' + Date.now())).toString('utf8'));
  const files = Object.keys(m.files || {}).sort().map(k => [k, m.files[k]]);
  if (!verifySig([PRODUCT, m.version, String(m.build), m.notes || '', files], m.sig)) throw new Error('the update is not signed by Prepfix');
  return m;
}
async function checkUpdate() {
  if (!KIT.updateUrl) return { error: 'Updates are not set up for this copy yet. Contact Prepfix: ' + SUPPORT.phone };
  const m = await fetchManifest();
  return { current: KIT.build, latest: String(m.build), version: m.version, notes: m.notes || '', available: Number(m.build) > Number(KIT.build) };
}
async function installUpdateFiles() {
  if (!KIT.updateUrl) return { error: 'Updates are not set up for this copy yet.' };
  const m = await fetchManifest();
  if (!(Number(m.build) > Number(KIT.build))) return { error: 'You already have the latest version.' };
  // 1. download everything and check each file's fingerprint first
  const got = [];
  for (const [name, sha] of Object.entries(m.files)) {
    if (!UPDATABLE.test(name) || KEEP.includes(name.toLowerCase())) throw new Error('unexpected file ' + name);
    const buf = await httpsGet(baseUrl() + encodeURIComponent(name) + '?b=' + m.build);
    if (crypto.createHash('sha256').update(buf).digest('hex') !== sha) throw new Error(name + ' did not download correctly');
    got.push([name, buf]);
  }
  // 2. keep the current version in "previous version", then replace; put everything back if any write fails
  const prev = path.join(DIR, 'previous version'); fs.mkdirSync(prev, { recursive: true });
  const done = [];
  try {
    for (const [name, buf] of got) {
      const f = path.join(DIR, name);
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(prev, name));
      fs.writeFileSync(f + '.new', buf); fs.renameSync(f + '.new', f); done.push(name);
    }
    KIT = { ...KIT, version: m.version || KIT.version, build: String(m.build) };
    fs.writeFileSync(KIT_FILE, JSON.stringify(KIT, null, 1));
  } catch (e) {
    for (const name of done) { try { fs.copyFileSync(path.join(prev, name), path.join(DIR, name)); } catch (e2) {} }
    throw e;
  }
  return { ok: true, version: KIT.version, build: KIT.build, notes: m.notes || '' };
}
// restart with the new files: the Start file runs the server again when it exits with code 3
function restartSoon() {
  setTimeout(() => { if (saveTimer) writeNow(); try { stopWinHelper(); closeProjector(true); } catch (e) {} process.exit(3); }, 800);
}

// ---------- Media: pictures, videos and slide sets, kept in the "media" folder ----------
// data.media = [{ id, type: 'image'|'video'|'slides', name, file?, loop?, slides?: [{ img } | { title, text }], src? }]
const MEDIA_DIR = path.join(DIR, 'media');
try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch (e) {}
if (!Array.isArray(data.media)) data.media = [];
const MEDIA_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const mediaFiles = list => new Set(list.flatMap(m => [m.file, ...(m.slides || []).map(s => s.img)]).filter(Boolean));
function removeOrphans(before, after) { // delete files that no longer belong to any media item
  const keep = mediaFiles(after);
  for (const f of mediaFiles(before)) if (!keep.has(f) && /^[\w.-]+$/.test(f)) { try { fs.unlinkSync(path.join(MEDIA_DIR, f)); } catch (e) {} }
}
// stream an upload straight to the media folder
function saveUpload(req, res, ext, cb) {
  const name = newId() + ext, f = path.join(MEDIA_DIR, name), tmp = f + '.part', out = fs.createWriteStream(tmp);
  let size = 0, dead = false;
  const fail = (code, msg) => { if (dead) return; dead = true; out.destroy(); try { fs.unlinkSync(tmp); } catch (e) {} if (!res.headersSent) { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); } };
  req.on('data', c => { size += c.length; if (size > MAX_WALL) { fail(413, 'That file is bigger than 1 GB.'); req.destroy(); } });
  req.on('aborted', () => fail(400, 'Upload stopped.'));
  req.pipe(out); out.on('error', () => fail(500, 'The file could not be saved.'));
  out.on('finish', () => { if (dead) return; try { fs.renameSync(tmp, f); cb(name, f); } catch (e) { fail(500, 'The file could not be saved.'); } });
}
// send a file with byte-range support (videos seek and loop smoothly)
function sendFile(req, res, f, type, cache) {
  let total; try { total = fs.statSync(f).size; } catch (e) { res.writeHead(404); res.end(); return; }
  const head = { 'Content-Type': type, 'Cache-Control': cache || 'max-age=31536000', 'Accept-Ranges': 'bytes' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m && total) {
    const start = m[1] === '' ? Math.max(0, total - (+m[2] || 0)) : +m[1], end = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], total - 1) : total - 1;
    if (start > end || start >= total) { res.writeHead(416, { 'Content-Range': 'bytes */' + total }); res.end(); return; }
    res.writeHead(206, { ...head, 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Content-Length': end - start + 1 });
    fs.createReadStream(f, { start, end }).pipe(res);
  } else { res.writeHead(200, { ...head, 'Content-Length': total }); fs.createReadStream(f).pipe(res); }
}
// PowerPoint -> one picture per slide, using Microsoft PowerPoint on this computer (hidden slides are skipped)
const PPT_SCRIPT = `$ErrorActionPreference = 'Stop'
try { $app = New-Object -ComObject PowerPoint.Application } catch { Write-Output 'NOPPT'; exit 0 }
try {
  $p = $app.Presentations.Open($env:PPT_IN, -1, 0, 0)
  $w = 1920; $h = [int](1920 * $p.PageSetup.SlideHeight / $p.PageSetup.SlideWidth)
  $i = 0
  foreach ($s in $p.Slides) {
    if ($s.SlideShowTransition.Hidden -eq -1) { continue }
    $i++
    $s.Export((Join-Path $env:PPT_OUT ('slide' + $i.ToString('000') + '.png')), 'PNG', $w, $h)
  }
  $p.Close()
  Write-Output ('OK ' + $i)
} catch { Write-Output ('ERR ' + $_.Exception.Message) }
finally { try { if ($app.Presentations.Count -eq 0) { $app.Quit() } } catch {} }
`;
function convertPpt(src, cb) {
  if (process.platform !== 'win32') return cb('PowerPoint files can only be turned into slides on Windows with Microsoft PowerPoint installed.');
  const work = path.join(os.tmpdir(), 'prepfix-ppt-' + newId()); fs.mkdirSync(work, { recursive: true });
  const script = path.join(work, 'convert.ps1'); fs.writeFileSync(script, PPT_SCRIPT);
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { windowsHide: true, timeout: 300000, env: { ...process.env, PPT_IN: src, PPT_OUT: work } }, (err, out) => {
      const o = String(out || '').trim();
      const done = (e, files) => { try { fs.rmSync(work, { recursive: true, force: true }); } catch (x) {} cb(e, files); };
      if (/NOPPT/.test(o)) return done('Microsoft PowerPoint is not installed on this computer. Open the presentation in PowerPoint or Google Slides on another computer, save it as pictures (PNG or JPEG), then add the pictures here together as one slide set.');
      if (!/^OK\s+\d+/m.test(o)) return done('PowerPoint could not open this presentation' + (/ERR (.*)/.exec(o) ? ': ' + /ERR (.*)/.exec(o)[1] : (err ? ' (' + (err.killed ? 'it took too long' : err.message) + ')' : '')) + '.');
      const pics = fs.readdirSync(work).filter(f => /^slide\d+\.png$/i.test(f)).sort();
      if (!pics.length) return done('This presentation has no visible slides.');
      const base = newId(), files = [];
      pics.forEach((f, i) => { const name = base + '-' + String(i + 1).padStart(3, '0') + '.png'; fs.copyFileSync(path.join(work, f), path.join(MEDIA_DIR, name)); files.push(name); });
      done(null, files);
    });
}

// ---------- more kinds of media: music, any video (changed to MP4 with FFmpeg), PDF and Office documents ----------
Object.assign(MEDIA_TYPES, { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.flac': 'audio/flac', '.ogv': 'video/ogg', '.pdf': 'application/pdf' });
// these play only after being changed into MP4 (video) or MP3 (music)
const CONVERT_VIDEO = ['.avi', '.wmv', '.mkv', '.flv', '.3gp', '.3g2', '.mpg', '.mpeg', '.ts', '.mts', '.m2ts', '.vob', '.asf', '.f4v', '.divx', '.dv', '.mxf', '.rm', '.rmvb'];
const CONVERT_AUDIO = ['.wma', '.amr', '.ac3', '.aiff', '.aif', '.mka', '.ape'];
const OFFICE_EXT = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv', '.pub', '.docx', '.doc', '.rtf', '.odt', '.ods'];
let ffmpegPath = null;
function findFfmpeg(cb) {
  if (ffmpegPath) return cb(ffmpegPath);
  const E = process.env, list = [path.join(DIR, 'ffmpeg.exe'), path.join(DIR, 'ffmpeg'), 'ffmpeg', 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(E.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe'), E.LOCALAPPDATA && path.join(E.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe', E.USERPROFILE && path.join(E.USERPROFILE, 'ffmpeg', 'bin', 'ffmpeg.exe')].filter(Boolean);
  let i = 0;
  const next = () => { if (i >= list.length) return cb(null); const p = list[i++];
    execFile(p, ['-version'], { windowsHide: true, timeout: 10000 }, e => { if (!e) { ffmpegPath = p; cb(p); } else next(); }); };
  next();
}
const jobs = {};
function startConvert(file, kind, removeOriginal) {
  const id = newId(), src = path.join(MEDIA_DIR, file), outName = newId() + (kind === 'audio' ? '.mp3' : '.mp4'), out = path.join(MEDIA_DIR, outName);
  const job = jobs[id] = { state: 'running', pct: 0, file: null, error: '' };
  findFfmpeg(ff => {
    if (!ff) { job.state = 'error'; job.error = 'This kind of file has to be changed into ' + (kind === 'audio' ? 'MP3' : 'MP4') + ' first, which needs FFmpeg, and FFmpeg was not found on this computer. Copy ffmpeg.exe into the toolkit folder (next to server.js) and try again.'; if (removeOriginal) { try { fs.unlinkSync(src); } catch (e) {} } return; }
    const args = kind === 'audio' ? ['-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', out]
      : ['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out];
    let dur = 0, err = '';
    const p = spawn(ff, args, { windowsHide: true });
    p.stderr.on('data', d => { const s = d.toString(); err = (err + s).slice(-3000);
      const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(s); if (m) dur = +m[1] * 3600 + +m[2] * 60 + +m[3];
      const t = /time=(\d+):(\d+):([\d.]+)/.exec(s); if (t && dur) job.pct = Math.min(99, Math.round((+t[1] * 3600 + +t[2] * 60 + +t[3]) / dur * 100)); });
    p.on('error', e => { job.state = 'error'; job.error = 'FFmpeg could not start: ' + e.message; });
    p.on('close', code => {
      if (code === 0 && fs.existsSync(out)) { job.state = 'done'; job.pct = 100; job.file = outName; if (removeOriginal) { try { fs.unlinkSync(src); } catch (e) {} } }
      else { job.state = 'error'; job.error = 'This file could not be converted' + (/Invalid data|could not find codec|does not contain any stream/i.test(err) ? ' – it may be damaged or not a real video / music file.' : '.'); try { fs.unlinkSync(out); } catch (e) {} if (removeOriginal) { try { fs.unlinkSync(src); } catch (e) {} } }
    });
  });
  return id;
}
// Excel, Publisher and Word -> PDF with Microsoft Office on this computer (the PDF pages then become slides)
const OFFICE_SCRIPT = `$ErrorActionPreference = 'Stop'
$in = $env:DOC_IN; $out = $env:DOC_OUT; $ext = [IO.Path]::GetExtension($in).ToLower()
try {
  if ($ext -in '.xlsx','.xls','.xlsm','.xlsb','.csv','.ods') {
    try { $a = New-Object -ComObject Excel.Application } catch { Write-Output 'NOAPP Microsoft Excel'; exit 0 }
    $a.DisplayAlerts = $false; $w = $a.Workbooks.Open($in, 0, $true); $w.ExportAsFixedFormat(0, $out); $w.Close($false); $a.Quit()
  } elseif ($ext -eq '.pub') {
    try { $a = New-Object -ComObject Publisher.Application } catch { Write-Output 'NOAPP Microsoft Publisher'; exit 0 }
    $d = $a.Open($in, $true, $false); $d.ExportAsFixedFormat(2, $out); $d.Close(); $a.Quit()
  } else {
    try { $a = New-Object -ComObject Word.Application } catch { Write-Output 'NOAPP Microsoft Word'; exit 0 }
    $a.Visible = $false; $a.DisplayAlerts = 0; $d = $a.Documents.Open($in, $false, $true); $d.ExportAsFixedFormat($out, 17); $d.Close(0); $a.Quit()
  }
  if (Test-Path $out) { Write-Output 'OK' } else { Write-Output 'ERR no PDF was made' }
} catch { Write-Output ('ERR ' + $_.Exception.Message) }
`;
function officeToPdf(src, cb) {
  if (process.platform !== 'win32') return cb('Excel, Publisher and Word files can only be turned into slides on Windows with Microsoft Office. Save the file as PDF and add the PDF instead.');
  const work = path.join(os.tmpdir(), 'prepfix-doc-' + newId()); fs.mkdirSync(work, { recursive: true });
  const script = path.join(work, 'convert.ps1'), pdfName = newId() + '.pdf', pdf = path.join(MEDIA_DIR, pdfName); fs.writeFileSync(script, OFFICE_SCRIPT);
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { windowsHide: true, timeout: 300000, env: { ...process.env, DOC_IN: src, DOC_OUT: pdf } }, (err, out) => {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
      const o = String(out || '').trim(), app = /NOAPP (.*)/.exec(o);
      if (app) return cb(app[1].trim() + ' is not installed on this computer. Open the file on a computer that has it, choose File > Save As > PDF, then add the PDF here.');
      if (!/^OK/m.test(o) || !fs.existsSync(pdf)) return cb('The document could not be opened' + (/ERR (.*)/.exec(o) ? ': ' + /ERR (.*)/.exec(o)[1] : (err ? ' (' + (err.killed ? 'it took too long' : err.message) + ')' : '')) + '. Save it as PDF and add the PDF instead.');
      cb(null, pdfName);
    });
}

/* ---------- importing songs from other song programs ----------
   EasyWorship 6/7 (Songs.db + SongWords.db, .ewsx), OpenLP (songs.sqlite, .osz), ProPresenter 7 (.pro) and 6 (.pro6),
   RTF, PowerPoint (.pptx), Word (.docx), zip files of songs. Text formats (OpenLyrics, OpenSong, ChordPro, SongSelect,
   SongBeamer, VideoPsalm, FreeShow, EasySlides...) are read in the browser; text files found in zips are handed back to it. */
const zlib = require('zlib');
let W1252 = null; try { W1252 = new TextDecoder('windows-1252'); } catch (e) {}
const cp1252 = b => W1252 ? W1252.decode(Buffer.from([b])) : String.fromCharCode(b);
function decodeText(b) {
  if (b[0] === 0xFF && b[1] === 0xFE) return b.slice(2).toString('utf16le');
  if (b[0] === 0xFE && b[1] === 0xFF) { let c = Buffer.from(b.slice(2)); if (c.length % 2) c = c.slice(0, -1); c.swap16(); return c.toString('utf16le'); }
  const s = b.toString('utf8');
  if (!s.includes('\uFFFD')) return s.replace(/^\uFEFF/, '');
  return W1252 ? W1252.decode(b) : b.toString('latin1');
}
const isTextBuf = b => { const n = Math.min(b.length, 4096); if (b[0] === 0xFF && b[1] === 0xFE || b[0] === 0xFE && b[1] === 0xFF) return true; for (let i = 0; i < n; i++) if (b[i] === 0) return false; return true; };
const xmlDecode = s => String(s).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function unzip(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) return [];
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = [];
  for (let k = 0; k < n && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1'); p += 46 + nl + xl + cl;
    if (name.endsWith('/') || lo + 30 > buf.length) continue;
    const st = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.slice(st, st + csize);
    try { const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null; if (data) out.push({ name, data }); } catch (er) {}
  }
  return out;
}

const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'fldinst', 'object', 'nonshppict', 'filetbl', 'revtbl', 'expandedcolortbl']);
const RTF_CH = { emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', tab: ' ', emspace: ' ', enspace: ' ' };
function rtfToText(rtf) {
  let out = '', i = 0, skip = false, uc = 1, pend = 0; const stack = [];
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') { stack.push({ skip, uc }); i++; continue; }
    if (ch === '}') { const s = stack.pop(); if (s) { skip = s.skip; uc = s.uc; } pend = 0; i++; continue; }
    if (ch === '\\') {
      const nx = rtf[i + 1];
      if (nx === '\\' || nx === '{' || nx === '}') { if (!skip) { if (pend > 0) pend--; else out += nx; } i += 2; continue; }
      if (nx === "'") { if (!skip) { if (pend > 0) pend--; else out += cp1252(parseInt(rtf.substr(i + 2, 2), 16)); } i += 4; continue; }
      if (nx === '*') { skip = true; i += 2; continue; }
      if (nx === '~') { if (!skip) out += ' '; i += 2; continue; }
      if (nx === '\n' || nx === '\r') { if (!skip) out += '\n'; i += 2; continue; }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 48));
      if (!m) { i += 2; continue; }
      i += 1 + m[0].length; const w = m[1], a = m[2] !== undefined ? +m[2] : null;
      if (RTF_SKIP.has(w)) { skip = true; continue; }
      if (skip) continue;
      if (w === 'par' || w === 'line' || w === 'sect' || w === 'row' || w === 'page') out += '\n';
      else if (w === 'u' && a !== null) { out += String.fromCharCode(a < 0 ? a + 65536 : a); pend = uc; }
      else if (w === 'uc' && a !== null) uc = a;
      else if (RTF_CH[w]) out += RTF_CH[w];
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (!skip) { if (pend > 0) pend--; else out += ch; }
    i++;
  }
  return out.replace(/\u2028|\u2029/g, '\n');
}
// every {\rtf ...} block inside a binary file, in order (ProPresenter 7 keeps one per slide)
function rtfBlocks(s) {
  const out = []; let from = 0;
  for (;;) {
    const st = s.indexOf('{\\rtf', from); if (st < 0) break;
    let d = 0, i = st;
    for (; i < s.length; i++) { const c = s[i]; if (c === '\\') { i++; continue; } if (c === '{') d++; else if (c === '}' && --d === 0) break; }
    out.push(s.slice(st, i + 1)); from = i + 1;
  }
  return out;
}
const baseName = n => path.basename(String(n)).replace(/\.[^.]+$/, '');
const joinSlides = list => { const out = []; list.map(x => String(x || '').replace(/\r\n?/g, '\n').trim()).filter(Boolean).forEach(x => { if (out[out.length - 1] !== x) out.push(x); }); return out.join('\n\n'); };

function pptxSong(name, entries) {
  const slides = entries.filter(e => /^ppt\/slides\/slide\d+\.xml$/i.test(e.name)).sort((a, b) => +/(\d+)\.xml$/i.exec(a.name)[1] - +/(\d+)\.xml$/i.exec(b.name)[1]);
  const st = slides.map(e => {
    const x = e.data.toString('utf8');
    return (x.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) || []).map(p => xmlDecode(p.replace(/<a:br\b[^>]*\/>/g, '\n').replace(/<a:t>([^<]*)<\/a:t>|<a:t [^>]*>([^<]*)<\/a:t>|<[^>]+>/g, (m, a, b) => a !== undefined ? a : b !== undefined ? b : ''))).map(l => l.trim()).filter(Boolean).join('\n');
  });
  return { title: baseName(name), text: joinSlides(st) };
}
function docxSong(name, entries) {
  const doc = entries.find(e => e.name === 'word/document.xml'); if (!doc) return null;
  const x = doc.data.toString('utf8'), body = (/<w:body>([\s\S]*)<\/w:body>/.exec(x) || [, x])[1];
  const isHead = p => /<w:pStyle w:val="(Heading|Title|Subtitle)[^"]*"/i.test(p) || (() => { const runs = p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || []; const tr = runs.filter(r => /<w:t[ >]/.test(r)); return tr.length && tr.every(r => /<w:b\/>|<w:b w:val="(1|true|on)"\/>/.test(r)); })();
  const paras = (body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || []).map(p => (isHead(p) ? '\u0001' : '') + xmlDecode(p.replace(/<w:(br|cr)\b[^>]*\/>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<w:t>([^<]*)<\/w:t>|<w:t [^>]*>([^<]*)<\/w:t>|<[^>]+>/g, (m, a, b) => a !== undefined ? a : b !== undefined ? b : '')).trim());
  const lines = []; paras.forEach(p => { if (p[0] === '\u0001') { p = p.slice(1); if (p.trim() && p.trim().length < 80) { lines.push('', p, ''); return; } } lines.push(p); });
  return { title: baseName(name), text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}
function pro6Song(name, s) {
  const t = /CCLISongTitle="([^"]+)"/.exec(s), slides = [];
  let re = /rvXMLIvarName="PlainText">([^<]+)</g, m, any = false;
  while ((m = re.exec(s))) { any = true; slides.push(Buffer.from(m[1], 'base64').toString('utf8')); }
  if (!any) {
    re = /rvXMLIvarName="RTFData">([^<]+)<|RTFData="([^"]+)"/g;
    while ((m = re.exec(s))) slides.push(rtfToText(Buffer.from(m[1] || m[2], 'base64').toString('latin1')));
  }
  return { title: t && t[1].trim() ? xmlDecode(t[1]) : baseName(name), text: joinSlides(slides) };
}
// OpenLP keeps lyrics as small XML: <verse ...><![CDATA[...]]></verse>
function openlpLyrics(x) {
  x = String(x || ''); if (!/<verse/i.test(x)) return x;
  const out = []; let m; const re = /<verse\b[^>]*>([\s\S]*?)<\/verse>/gi;
  while ((m = re.exec(x))) {
    let v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (a, b) => b);
    v = /<lines|<br/i.test(v) ? xmlDecode(v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/lines>\s*<lines[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')) : xmlDecode(v);
    out.push(v.replace(/\{\/?[a-z]+\}/gi, '').replace(/\[---\]/g, '\n'));
  }
  return joinSlides(out);
}
const asLyrics = v => { v = String(v == null ? '' : v); return /^\s*\{\\rtf/.test(v) ? rtfToText(v) : /^\s*<\?xml|<verse\b/i.test(v) ? openlpLyrics(v) : v; };
function readDatabases(dbs, acc) {
  let Sql; try { Sql = require('node:sqlite'); } catch (e) { acc.notes.push('This computer\'s toolkit cannot open song databases (needs a newer node.exe).'); return; }
  const words = {}, titles = {}, done = new Set();
  for (const d of dbs) {
    const f = path.join(os.tmpdir(), 'prepfix-import-' + newId() + '.db'); let db;
    try {
      if (d.file) db = new Sql.DatabaseSync(d.file, { readOnly: true }); else { fs.writeFileSync(f, d.data); db = new Sql.DatabaseSync(f, { readOnly: true }); }
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
      const cols = t => db.prepare('PRAGMA table_info("' + t.replace(/"/g, '') + '")').all().map(r => String(r.name));
      const has = (t, c) => cols(t).map(x => x.toLowerCase()).includes(c);
      let used = false;
      for (const t of tables) {
        const tl = t.toLowerCase(), cl = cols(t).map(x => x.toLowerCase());
        if (tl === 'word' && cl.includes('song_id') && cl.includes('words')) { // EasyWorship SongWords.db
          for (const r of db.prepare('SELECT song_id, words FROM "' + t + '"').all()) words[r.song_id] = asLyrics(r.words);
          used = true;
        } else if (tl === 'song' && cl.includes('title')) { // EasyWorship Songs.db
          for (const r of db.prepare('SELECT rowid AS id, title FROM "' + t + '"').all()) titles[r.id] = String(r.title || '');
          used = true;
        } else if (tl === 'songs' && cl.includes('title') && cl.includes('lyrics')) { // OpenLP
          for (const r of db.prepare('SELECT title, lyrics FROM "' + t + '"').all()) acc.songs.push({ title: String(r.title || ''), text: openlpLyrics(r.lyrics) });
          used = true;
        }
      }
      if (!used) for (const t of tables) { // any other song database: a title column and a words column
        const c = cols(t), lc = c.map(x => x.toLowerCase());
        const ti = lc.findIndex(x => ['title', 'name', 'song_title', 'songtitle', 'songname', 'titre', 'title1'].includes(x));
        const wi = lc.findIndex(x => ['lyrics', 'words', 'text', 'content', 'contents', 'lyric', 'song_text', 'songtext', 'paroles'].includes(x));
        if (ti < 0 || wi < 0) continue;
        for (const r of db.prepare('SELECT "' + c[ti] + '" AS t, "' + c[wi] + '" AS w FROM "' + t + '"').all()) acc.songs.push({ title: String(r.t || ''), text: asLyrics(r.w) });
        used = true;
      }
      if (!used) acc.notes.push((d.name || 'A database') + ': no songs found in it.');
    } catch (e) { acc.notes.push((d.name || 'A database') + ' could not be opened (' + e.message + ').'); }
    finally { try { db && db.close(); } catch (e) {} try { fs.unlinkSync(f); } catch (e) {} }
  }
  for (const id of Object.keys(words)) if (!done.has(id)) acc.songs.push({ title: titles[id] || '', text: words[id] });
  if (Object.keys(titles).length && !Object.keys(words).length) acc.notes.push('EasyWorship: please choose SongWords.db together with Songs.db (both are in the same folder).');
}
function importOne(name, buf, acc, depth) {
  const ext = path.extname(name).toLowerCase();
  if (buf.length >= 16 && buf.slice(0, 15).toString('latin1') === 'SQLite format 3') { acc.dbs.push({ name, data: buf }); return; }
  if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 3 && buf[3] === 4) {
    const ents = unzip(buf);
    if (ext === '.pptx' || ents.some(e => /^ppt\/slides\//.test(e.name))) { const s = pptxSong(name, ents); if (s.text) acc.files.push({ name: path.basename(name), text: s.text, plain: true }); else acc.notes.push(name + ': no text on the slides.'); return; }
    if (ext === '.docx' || ents.some(e => e.name === 'word/document.xml')) { const s = docxSong(name, ents); if (s && s.text) acc.files.push({ name: path.basename(name), text: s.text, plain: true }); else acc.notes.push(name + ': no text found.'); return; }
    if (depth > 3) return;
    for (const e of ents) if (!/(^|\/)(__MACOSX|\.)/.test(e.name)) importOne(e.name, e.data, acc, depth + 1);
    return;
  }
  if (/^\s*\{\\rtf/.test(buf.slice(0, 20).toString('latin1'))) { acc.files.push({ name: path.basename(name), text: rtfToText(buf.toString('latin1')), plain: true }); return; }
  if (isTextBuf(buf)) {
    const s = decodeText(buf);
    if (ext === '.pro6' || ext === '.pro5' || /<RVPresentationDocument/.test(s.slice(0, 3000))) { acc.songs.push(pro6Song(name, s)); return; }
    acc.files.push({ name: path.basename(name), text: s }); return;
  }
  if (ext === '.pro' || ext === '.probundle') { // ProPresenter 7: one RTF block per slide
    const st = rtfBlocks(buf.toString('latin1')).map(rtfToText);
    if (st.length) acc.songs.push({ title: baseName(name), text: joinSlides(st) }); else acc.notes.push(name + ': no slide text found.');
    return;
  }
  const blocks = rtfBlocks(buf.toString('latin1'));
  if (blocks.length) { acc.songs.push({ title: baseName(name), text: joinSlides(blocks.map(rtfToText)) }); return; }
  acc.notes.push(path.basename(name) + ': this kind of file could not be read.');
}
function importAll(files) { // files: [{name,data}] or [{name,file}] (database on this computer)
  const acc = { songs: [], files: [], dbs: [], notes: [] };
  for (const f of files) { try { if (f.file && /\.(db|sqlite3?)$/i.test(f.file)) acc.dbs.push({ name: f.name, file: f.file }); else importOne(f.name, f.data || fs.readFileSync(f.file), acc, 0); } catch (e) { acc.notes.push(f.name + ' could not be read.'); } }
  if (acc.dbs.length) readDatabases(acc.dbs, acc);
  delete acc.dbs;
  acc.songs = acc.songs.map(s => ({ title: String(s.title || '').trim(), text: String(s.text || '').replace(/\r\n?/g, '\n') })).filter(s => s.text.trim());
  return acc;
}
// the browser sends several files in one body: [name length][name][data length][data] ...
function unpackFiles(b) {
  const out = []; let p = 0;
  while (p + 8 <= b.length) {
    const nl = b.readUInt32LE(p); p += 4; const name = b.slice(p, p + nl).toString('utf8'); p += nl;
    const dl = b.readUInt32LE(p); p += 4; out.push({ name, data: b.slice(p, p + dl) }); p += dl;
  }
  return out;
}
// song libraries of other programs on this computer
let foundLibs = [];
function walkFiles(dir, test, max, depth, out) {
  out = out || []; if (depth < 0 || out.length >= max) return out;
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(f, test, max, depth - 1, out); else if (test(e.name, f)) out.push(f);
    if (out.length >= max) break;
  }
  return out;
}
function scanLibraries() {
  const env = process.env, home = env.USERPROFILE || os.homedir(), pub = env.PUBLIC || 'C:\\Users\\Public';
  const docs = [path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Documents'), path.join(pub, 'Documents')];
  const libs = [];
  // EasyWorship 6 / 7
  const ew = new Set();
  for (const d of docs) walkFiles(path.join(d, 'Softouch'), n => n.toLowerCase() === 'songwords.db', 20, 6).forEach(f => ew.add(path.dirname(f)));
  for (const d of ew) { const songs = fs.readdirSync(d).find(n => n.toLowerCase() === 'songs.db'); libs.push({ label: 'EasyWorship', where: d, files: [path.join(d, fs.readdirSync(d).find(n => n.toLowerCase() === 'songwords.db'))].concat(songs ? [path.join(d, songs)] : []) }); }
  // OpenLP
  for (const base of [env.APPDATA, env.LOCALAPPDATA].filter(Boolean)) { const f = path.join(base, 'openlp', 'data', 'songs', 'songs.sqlite'); if (fs.existsSync(f)) libs.push({ label: 'OpenLP', where: path.dirname(f), files: [f] }); }
  const add = (label, dirs, re, depth) => { for (const d of dirs) { const fl = walkFiles(d, n => re.test(n), 20000, depth); if (fl.length) libs.push({ label, where: d, files: fl }); } };
  add('ProPresenter 7', docs.map(d => path.join(d, 'ProPresenter', 'Libraries')), /\.pro$/i, 4);
  add('ProPresenter 6', docs.map(d => path.join(d, 'ProPresenter6')), /\.pro6$/i, 3);
  add('FreeShow', docs.map(d => path.join(d, 'FreeShow', 'Shows')), /\.show$/i, 2);
  add('OpenSong', docs.map(d => path.join(d, 'OpenSong', 'Songs')), n => !/\.(jpe?g|png|gif|bmp|mp3|pdf|db)$/i.test(n) && !n.startsWith('.'), 3);
  add('VideoPsalm', docs.map(d => path.join(d, 'VideoPsalm')).concat([env.APPDATA, env.LOCALAPPDATA].filter(Boolean).map(d => path.join(d, 'VideoPsalm'))), /\.json$/i, 4);
  add('Quelea', [path.join(home, '.quelea')], /\.(qsp|xml)$/i, 3);
  foundLibs = libs;
  return libs.map((l, i) => ({ id: i, label: l.label, where: l.where, count: /EasyWorship|OpenLP/.test(l.label) ? null : l.files.length }));
}

// opens a web page for "Get lyrics from a web link" (the lyrics are picked out in the browser)
async function fetchPage(u) {
  let x; try { x = new URL(String(u).trim()); } catch (e) { throw new Error('That does not look like a web link. Copy the link from the browser address bar and try again.'); }
  if (!/^https?:$/.test(x.protocol)) throw new Error('Only web links (http or https) can be opened.');
  let r;
  try {
    r = await fetch(x, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en,sw;q=0.8' } });
  } catch (e) { throw new Error(e && e.name === 'TimeoutError' ? 'The page took too long to open. Try again, or copy the lyrics and use Paste copied lyrics.' : 'The page could not be opened. Is this computer connected to the internet?'); }
  if (!r.ok) throw new Error('The website did not allow the page to be read (' + r.status + '). Some lyrics sites block programs: copy the lyrics on the page and use "Paste copied lyrics" instead.');
  let buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 8 * 1024 * 1024) buf = buf.slice(0, 8 * 1024 * 1024);
  const cs = (/charset=["']?([\w-]+)/i.exec(r.headers.get('content-type') || '') || /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.slice(0, 5000).toString('latin1')) || [])[1] || 'utf-8';
  let html; try { html = new TextDecoder(cs).decode(buf); } catch (e) { html = buf.toString('utf8'); }
  return { html, url: r.url };
}


function readBody(req, res, cb) {
  const parts = []; let size = 0, dead = false;
  req.on('data', c => { size += c.length; if (size > MAX_BODY && !dead) { dead = true; res.writeHead(413); res.end('too big'); req.destroy(); } else parts.push(c); });
  req.on('end', () => { if (!dead) cb(Buffer.concat(parts)); });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;

  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 1500\n\n');
    const c = { res, view: url.searchParams.get('view') || 'control' }; c.full = c.view === 'control';
    LIC = readLicense(); // re-checked whenever a screen connects
    clients.add(c); send(c, 'data', dataFor(c)); send(c, 'live', { ...live, serverNow: Date.now() });
    if (c.full) send(c, 'proj', { on: !!proj });
    pushScreens();
    req.on('close', () => { clients.delete(c); pushScreens(); });

  } else if ((p === '/api/state' || p === '/api/live') && req.method === 'POST') {
    readBody(req, res, b => {
      try { applyUpdate(JSON.parse(b.toString('utf8'))); res.end('ok'); }
      catch (e) { res.writeHead(400); res.end('bad'); }
    });

  } else if (p === '/api/import/files' && req.method === 'POST') {
    readBody(req, res, b => {
      let r; try { r = importAll(unpackFiles(b)); } catch (e) { r = { songs: [], files: [], notes: ['The files could not be read (' + e.message + ').'] }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r));
    });

  } else if (p === '/api/fetchpage') {
    fetchPage(url.searchParams.get('url') || '').then(r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); },
      e => { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(e.message); });

  } else if (p === '/api/license/renew' && req.method === 'POST') {
    readBody(req, res, b => {
      let q = {}; try { q = JSON.parse(b.toString('utf8')); } catch (e) {}
      const r = applyRenewal(q.code); if (r.ok) pushData();
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r));
    });

  } else if (p === '/api/import/scan') {
    let r = []; try { r = scanLibraries(); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r));

  } else if (p === '/api/import/local' && req.method === 'POST') {
    readBody(req, res, b => {
      let q = {}; try { q = JSON.parse(b.toString('utf8')); } catch (e) {}
      const lib = foundLibs[q.id];
      const r = lib ? importAll(lib.files.map(f => ({ name: path.basename(f), file: f }))) : { songs: [], files: [], notes: ['Please search again.'] };
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r));
    });

  } else if (p === '/api/media/upload' && req.method === 'POST') {
    const ext = String(url.searchParams.get('ext') || '').toLowerCase();
    const conv = CONVERT_VIDEO.includes(ext) ? 'video' : CONVERT_AUDIO.includes(ext) ? 'audio' : '';
    if (!MEDIA_TYPES[ext] && !conv) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('This kind of file cannot be added here (' + ext + ').'); req.resume(); return; }
    saveUpload(req, res, ext, name => { res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ file: name, type: conv || MEDIA_TYPES[ext].split('/')[0], convert: !!conv })); });

  } else if (p === '/api/media/convert' && req.method === 'POST') {
    readBody(req, res, b => {
      let q = {}; try { q = JSON.parse(b.toString('utf8')); } catch (e) {}
      if (!/^[\w.-]+$/.test(q.file || '') || !fs.existsSync(path.join(MEDIA_DIR, q.file))) { res.writeHead(400); res.end('bad'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ job: startConvert(q.file, q.kind === 'audio' ? 'audio' : 'video', !!q.removeOriginal) }));
    });

  } else if (p === '/api/media/job') {
    const j = jobs[url.searchParams.get('id')];
    res.writeHead(j ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j || { state: 'error', error: 'unknown job' }));

  } else if (p === '/api/media/office' && req.method === 'POST') {
    const ext = String(url.searchParams.get('ext') || '').toLowerCase();
    if (!OFFICE_EXT.includes(ext)) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Please choose an Excel, Publisher or Word file.'); req.resume(); return; }
    saveUpload(req, res, ext, (name, f) => officeToPdf(f, (err, pdf) => {
      try { fs.unlinkSync(f); } catch (e) {}
      if (err) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(err); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ pdf }));
    }));

  } else if (p.startsWith('/lib/')) { // pdf.js (reads PDF pages in the browser, offline)
    const rel = decodeURIComponent(p.slice(5));
    if (!/^[\w.-]+(\/[\w.-]+)?$/.test(rel)) { res.writeHead(404); res.end(); return; }
    const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.txt': 'text/plain' };
    sendFile(req, res, path.join(DIR, 'lib', rel), types[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'max-age=86400');

  } else if (p === '/api/media/ppt' && req.method === 'POST') {
    const ext = String(url.searchParams.get('ext') || '.pptx').toLowerCase();
    if (!/^\.(pptx?|ppsx?|pptm|odp)$/.test(ext)) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Please choose a PowerPoint file (.pptx or .ppt).'); req.resume(); return; }
    saveUpload(req, res, ext, (name, f) => convertPpt(f, (err, files) => {
      try { fs.unlinkSync(f); } catch (e) {}
      if (err) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(err); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ files }));
    }));

  } else if (p.startsWith('/media/')) {
    const name = decodeURIComponent(p.slice(7));
    if (!/^[\w.-]+$/.test(name)) { res.writeHead(404); res.end(); return; }
    sendFile(req, res, path.join(MEDIA_DIR, name), MEDIA_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream');

  } else if (p === '/api/desktop') {
    desktopInfo(i => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); delete i.file; res.end(JSON.stringify(i)); });

  } else if (p === '/desktop-wallpaper') {
    desktopInfo(i => {
      if (!i.ok) { res.writeHead(404); res.end(); return; }
      let b; try { b = fs.readFileSync(i.file); } catch (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': sniffType(b), 'Cache-Control': 'max-age=31536000' }); res.end(b);
    });

  } else if (p === '/api/screens' && req.method === 'GET') {
    getScreens(list => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ platform: process.platform, screens: list })); });

  } else if (p === '/api/projector' && req.method === 'POST') {
    readBody(req, res, b => {
      let q = {}; try { q = JSON.parse(b.toString('utf8') || '{}'); } catch (e) {}
      if (q.action === 'close') { closeProjector(); res.end('ok'); return; }
      openProjector(typeof q.screen === 'number' ? q.screen : -1, err => {
        if (err) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(err); } else res.end('ok');
      });
    });

  } else if (p === '/api/data' && req.method === 'GET') { // full backup download
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="church-lyrics-backup-' + new Date().toISOString().slice(0, 10) + '.json"' });
    res.end(JSON.stringify({ ...data, telegram: undefined, inbox: undefined }, null, 1));

  } else if (p === '/api/wallpaper' && req.method === 'POST') {
    // picture or video; streamed straight to disk so big videos don't fill memory
    const tmp = WALL + '.upload', out = fs.createWriteStream(tmp); let size = 0, dead = false;
    const fail = (code, msg) => { if (dead) return; dead = true; out.destroy(); try { fs.unlinkSync(tmp); } catch (e) {} if (!res.headersSent) { res.writeHead(code); res.end(msg); } };
    req.on('data', c => { size += c.length; if (size > MAX_WALL) { fail(413, 'too big'); req.destroy(); } });
    req.on('aborted', () => fail(400, 'aborted'));
    req.pipe(out);
    out.on('error', () => fail(500, 'write failed'));
    out.on('finish', () => {
      if (dead) return;
      try { fs.renameSync(tmp, WALL); } catch (e) { fs.copyFileSync(tmp, WALL); fs.unlinkSync(tmp); }
      data.settings.church = { ...data.settings.church, wp: Date.now(), wpType: req.headers['content-type'] || 'image/jpeg' };
      save(); pushData(); res.end('ok');
    });

  } else if (p === '/api/wallpaper' && req.method === 'DELETE') {
    try { fs.unlinkSync(WALL); } catch (e) {}
    data.settings.church = { ...data.settings.church, wp: 0 };
    save(); pushData(); res.end('ok');

  } else if (p === '/wallpaper') {
    // supports byte ranges so videos loop and seek smoothly
    let total; try { total = fs.statSync(WALL).size; } catch (e) { res.writeHead(404); res.end(); return; }
    const head = { 'Content-Type': data.settings.church.wpType || 'image/jpeg', 'Cache-Control': 'max-age=31536000', 'Accept-Ranges': 'bytes' };
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m && total) {
      let start = m[1] === '' ? Math.max(0, total - (+m[2] || 0)) : +m[1], end = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], total - 1) : total - 1;
      if (start > end || start >= total) { res.writeHead(416, { 'Content-Range': 'bytes */' + total }); res.end(); return; }
      res.writeHead(206, { ...head, 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Content-Length': end - start + 1 });
      fs.createReadStream(WALL, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...head, 'Content-Length': total });
      fs.createReadStream(WALL).pipe(res);
    }

  } else if (p === '/api/update/check') {
    checkUpdate().then(r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); })
      .catch(e => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: friendlyNetError(e) })); });

  } else if (p === '/api/update/apply' && req.method === 'POST') {
    installUpdateFiles().then(r => {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r));
      if (r.ok) restartSoon();
    }).catch(e => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: friendlyNetError(e) })); });

  } else if (p === '/api/team') { // team app settings (GET = status, POST = {on, pin, claim})
    const done = () => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(teamStatus())); };
    if (req.method !== 'POST') return done();
    readBody(req, res, async b => {
      let q = {}; try { q = JSON.parse(b.toString('utf8')); } catch (e) {}
      const t = { ...teamCfg() };
      if ('on' in q) t.on = !!q.on;
      if ('pin' in q) t.pin = String(q.pin || '').replace(/\D/g, '').slice(0, 8);
      data.settings = { ...data.settings, team: t }; save(); pushData();
      if (q.claim) TEAM.error = '';
      if (t.on) await teamSync(!!q.claim);
      done();
    });

  } else if (p === '/api/addresses') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ port: PORT, addrs: lanAddresses() }));

  } else if (p === '/qr.svg') {
    try {
      const svg = qrSvg(String(url.searchParams.get('t') || '').slice(0, 300));
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' }); res.end(svg);
    } catch (e) { res.writeHead(400); res.end(); }

  } else if (p === '/mark.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=604800' }); res.end(Buffer.from(MARK, 'base64'));

  } else if (p === '/logo.jpg') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=604800' }); res.end(Buffer.from(LOGO, 'base64'));

  } else if (p === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' }); res.end(MANIFEST);

  } else if (p === '/icon-192.png' || p === '/icon-512.png' || p === '/favicon.ico' || p === '/apple-touch-icon.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=604800' });
    res.end(Buffer.from(p === '/icon-512.png' ? ICON512 : ICON192, 'base64'));

  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(PAGE));
  }
}).on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error('\nPrepfix Church Media Toolkit is already running in another window. Opening the control page...\n');
    openControlPage();
    setTimeout(() => process.exit(1), 1500);
    return;
  }
  console.error(e);
  process.exit(1);
}).listen(PORT, '0.0.0.0', () => {
  // auto launch: church screen full screen on the projector first, then the control page on the main screen (so it has the keyboard)
  autoProjectorCheck(true);
  setTimeout(openControlPage, 2500);
  setInterval(() => autoProjectorCheck(false), 10000);
  console.log('\n  ==============================================');
  console.log('     P R E P F I X   CHURCH MEDIA TOOLKIT   ' + KIT.version);
  console.log('        Designed by Cyrus Ireri  -  0720872582');
  console.log('  ==============================================');
  rememberToday(); setInterval(() => { rememberToday(); const b = LIC.status + LIC.phase; LIC = readLicense(); if (LIC.status + LIC.phase !== b) pushData(); }, 3600000);
  setTimeout(checkin, 60000); setInterval(checkin, 6 * 3600000);
  setTimeout(() => teamSync(), 30000); setInterval(() => teamSync(), 120000); // team app: new songs out, leaders' playlists in
  if (LIC.status === 'ok') console.log('  Licensed to: ' + LIC.church + '   (paid until ' + LIC.until + ')' + (LIC.phase !== 'ok' ? '\n  !! The licence ' + (LIC.phase === 'warn' ? 'ends soon' : 'has ended - grace days left: ' + (LIC.days + GRACE_DAYS)) + '. Renew with Prepfix: ' + SUPPORT.phone : ''));
  else if (LIC.status === 'expired') console.log('  !! LICENCE EXPIRED on ' + LIC.until + ' (' + LIC.church + '). Renew with Prepfix: ' + SUPPORT.phone);
  else if (LIC.status === 'suspended') console.log('  !! LICENCE SUSPENDED by Prepfix (' + LIC.church + '). Contact Prepfix: ' + SUPPORT.phone);
  else console.log('  !! PIRATED / UNLICENSED COPY - get a genuine copy from Prepfix: ' + SUPPORT.phone);
  console.log('\n  Running. Keep this window open during the service.');
  console.log('  ' + data.songs.length + ' songs, ' + data.playlists.length + ' playlists loaded\n');
  console.log('  Control (this PC):  http://localhost:' + PORT);
  lanAddresses().forEach((a, k) => console.log('  ' + (k ? 'Other address:      ' : 'Control (phone):    ') + 'http://' + a.address + ':' + PORT));
  console.log('  Phone app:          press "Phone app" on the control page and scan the QR code');
  console.log('  Church screen:      http://localhost:' + PORT + '/?view=church');
  console.log('  Stream (OBS):       http://localhost:' + PORT + '/?view=stream\n');
});
