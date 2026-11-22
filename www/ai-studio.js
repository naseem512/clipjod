/* ===================== ClipJod AI Studio =====================
   1) Faceless video maker: topic / title / reference link -> script -> Gemini voice -> visuals -> editable project
   2) Auto Shorts: a long video of your own -> best moments -> 9:16 shorts with captions, ready to edit
   Calls Google's Gemini API straight from the device with the user's own key. Nothing goes to a ClipJod server. */
'use strict';

const AI = { busy: false, script: null, kit: null, src: null, moments: null, transcript: null };
const store = {
  get(k, d = '') { try { return localStorage.getItem('cj_' + k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cj_' + k, v); } catch (e) {} },
};
const uniq = a => [...new Set(a.filter(Boolean))];
const GBASE = 'https://generativelanguage.googleapis.com/v1beta';
// Model names change often; these are tried in order and the user can put their own first under "Advanced".
const TEXT_MODELS = () => uniq([store.get('mText'), 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']);
const TTS_MODELS = () => uniq([store.get('mTts'), 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts']);
const IMG_MODELS = () => uniq([store.get('mImg'), 'gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']);
const VOICES = [
  ['Kore', 'Kore · female, firm'], ['Puck', 'Puck · male, upbeat'], ['Charon', 'Charon · male, informative'],
  ['Aoede', 'Aoede · female, breezy'], ['Fenrir', 'Fenrir · male, excited'], ['Leda', 'Leda · female, youthful'],
  ['Orus', 'Orus · male, firm'], ['Sulafat', 'Sulafat · female, warm'], ['Algenib', 'Algenib · male, gravelly'],
];
const STYLES = {
  facts: 'Amazing facts', story: 'Story', motivation: 'Motivation', tips: 'Tips / how-to',
  explainer: 'News explainer', listicle: 'Top 5 list', history: 'History', business: 'Business & money',
};
const LANGS = { english: 'English', urdu: 'Urdu', roman: 'Roman Urdu', hindi: 'Hindi', arabic: 'Arabic' };

/* ---------- Gemini calls ---------- */
function gKey() { return store.get('gemini').trim(); }
async function gPost(path, body) {
  const key = gKey(); if (!key) { const e = new Error('Add your free Gemini API key first (AI tab → Setup).'); e.noKey = true; throw e; }
  let r;
  try { r = await fetch(`${GBASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) }); }
  catch (e) { const er = new Error('Could not reach Google. Check your internet connection.'); er.net = true; throw er; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || `Google said HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
const fatal = e => e.noKey || e.net || e.status === 401 || e.status === 403 || (e.status === 400 && /api key/i.test(e.message));
function parseJSON(t) {
  t = String(t).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}'), c = t.indexOf('['), d = t.lastIndexOf(']');
  if (c >= 0 && (a < 0 || c < a) && d > c) return JSON.parse(t.slice(c, d + 1));
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('The AI answer was not in the expected format. Try again.');
}
async function gText(parts, json = true, temperature = .9) {
  let last;
  for (const m of TEXT_MODELS()) {
    try {
      const j = await gPost(`models/${m}:generateContent`, { contents: [{ role: 'user', parts }], generationConfig: json ? { responseMimeType: 'application/json', temperature } : { temperature } });
      const t = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || '').join('');
      if (!t) throw new Error('Empty answer from ' + m);
      store.set('okText', m);
      return json ? parseJSON(t) : t;
    } catch (e) { last = e; if (fatal(e)) throw e; }
  }
  throw last;
}
function findAudio(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 8) return null;
  if (o.inlineData && o.inlineData.data) return { data: o.inlineData.data, mime: o.inlineData.mimeType || '' };
  if (o.inline_data && o.inline_data.data) return { data: o.inline_data.data, mime: o.inline_data.mime_type || '' };
  if (typeof o.data === 'string' && o.data.length > 800) return { data: o.data, mime: o.mime_type || o.mimeType || '' };
  for (const v of Array.isArray(o) ? o : Object.values(o)) { const r = findAudio(v, depth + 1); if (r) return r; }
  return null;
}
function b64bytes(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function pcmToWav(pcm, rate) {
  const h = new ArrayBuffer(44), v = new DataView(h), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length, true);
  return new Blob([h, pcm], { type: 'audio/wav' });
}
function audioBlob(a) {
  const u = b64bytes(a.data);
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46) return new Blob([u], { type: 'audio/wav' });
  if (/mp3|mpeg/i.test(a.mime)) return new Blob([u], { type: 'audio/mpeg' });
  const m = /rate=(\d+)/i.exec(a.mime); return pcmToWav(u, m ? +m[1] : 24000);
}
async function gSpeech(text, voice, style) {
  let last;
  for (const m of TTS_MODELS()) {
    // generateContent shape first (Gemini 2.5 / 3.x), then the newer Interactions API shape
    try {
      const j = await gPost(`models/${m}:generateContent`, {
        contents: [{ parts: [{ text: style ? `${style}:\n${text}` : text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      });
      const a = findAudio(j.candidates || j); if (a) { store.set('okTts', m); return audioBlob(a); }
      throw new Error('No audio in the answer');
    } catch (e) { last = e; if (fatal(e)) throw e; }
    try {
      const j = await gPost('interactions', {
        model: m, input: [{ type: 'user_input', content: [{ type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }] }],
        response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice }] },
      });
      const a = findAudio(j); if (a) { store.set('okTts', m); return audioBlob(a); }
      throw new Error('No audio in the answer');
    } catch (e) { last = e; if (fatal(e)) throw e; }
  }
  throw last;
}
async function gImage(prompt, ratio) {
  let last;
  for (const m of IMG_MODELS()) {
    try {
      const j = await gPost(`models/${m}:generateContent`, {
        contents: [{ parts: [{ text: `${prompt}. Vertical ${ratio} composition, cinematic, no text, no letters, no watermark.` }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio } },
      });
      const a = findAudio(j.candidates || j);
      if (a) return new Blob([b64bytes(a.data)], { type: a.mime || 'image/png' });
      throw new Error('No image in the answer');
    } catch (e) { last = e; if (fatal(e)) throw e; }
  }
  throw last;
}

/* ---------- media downloads (Pexels stock footage) ---------- */
async function getBlob(url, headers = {}) {
  const CH = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  if (NATIVE && CH) {
    // the app's native HTTP skips browser CORS limits on stock-video hosts
    const r = await CH.get({ url, headers, responseType: 'blob' });
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    return new Blob([b64bytes(String(r.data).replace(/^data:[^,]+,/, ''))]);
  }
  const r = await fetch(url, { headers }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob();
}
async function pexelsJSON(path) {
  const key = store.get('pexels').trim(); if (!key) return null;
  const r = await fetch('https://api.pexels.com/' + path, { headers: { Authorization: key } });
  if (!r.ok) throw new Error('Pexels HTTP ' + r.status);
  return r.json();
}
async function stockVideo(query, need, portrait, used) {
  const j = await pexelsJSON(`videos/search?query=${encodeURIComponent(query)}&orientation=${portrait ? 'portrait' : 'landscape'}&size=medium&per_page=12`);
  if (!j || !j.videos || !j.videos.length) return null;
  const vids = j.videos.filter(v => !used.has('v' + v.id));
  const pick = vids.find(v => v.duration >= need) || vids.sort((a, b) => b.duration - a.duration)[0];
  if (!pick) return null; used.add('v' + pick.id);
  const files = (pick.video_files || []).filter(f => /mp4/.test(f.file_type || 'mp4') && f.link);
  const target = portrait ? 720 : 1280;
  files.sort((a, b) => Math.abs((portrait ? a.width : a.width) - target) - Math.abs((portrait ? b.width : b.width) - target));
  if (!files.length) return null;
  return { blob: await getBlob(files[0].link), name: `Pexels ${pick.id}.mp4`, credit: pick.user && pick.user.name };
}
async function stockPhoto(query, portrait, used) {
  const j = await pexelsJSON(`v1/search?query=${encodeURIComponent(query)}&orientation=${portrait ? 'portrait' : 'landscape'}&per_page=10`);
  if (!j || !j.photos || !j.photos.length) return null;
  const p = j.photos.find(x => !used.has('p' + x.id)) || j.photos[0]; used.add('p' + p.id);
  const src = p.src && (portrait ? p.src.portrait : p.src.landscape || p.src.large2x);
  return src ? { blob: await getBlob(src), name: `Pexels photo ${p.id}.jpg` } : null;
}
// built-in backdrop when no stock or AI images are available: soft gradient with depth, rendered as a photo clip
const BG_PALETTES = [['#1d2b64', '#f8cdda'], ['#0f2027', '#2c5364'], ['#42275a', '#734b6d'], ['#141e30', '#243b55'], ['#3a1c71', '#ffaf7b'], ['#0b486b', '#f56217'], ['#232526', '#414345'], ['#16222a', '#3a6073'], ['#4b134f', '#c94b4b'], ['#003973', '#e5e5be']];
function backdrop(i, w, h) {
  return new Promise(res => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    const [a, b] = BG_PALETTES[i % BG_PALETTES.length];
    const gr = g.createLinearGradient(0, 0, w * .4, h); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 7; k++) { const x = ((i * 97 + k * 211) % 100) / 100 * w, y = ((i * 53 + k * 137) % 100) / 100 * h, r = (0.15 + ((k * 31) % 25) / 100) * Math.max(w, h); const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, 'rgba(255,255,255,.16)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, h); }
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .3, w / 2, h / 2, Math.hypot(w, h) / 2); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = vg; g.fillRect(0, 0, w, h);
    c.toBlob(res, 'image/jpeg', .9);
  });
}

/* ---------- 1) script ---------- */
const YT_RE = /(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w\-?=&%.]+)/i;
async function makeScript(o) {
  const words = Math.round(o.seconds * (o.lang === 'english' ? 2.5 : 2.2));
  const link = (o.topic.match(/https?:\/\/\S+/) || [])[0] || '';
  const langRule = o.lang === 'roman'
    ? 'Write "text" in Roman Urdu (Urdu written with English letters, as people type on WhatsApp) and also give "speech" with the same words in Urdu script, for the voice.'
    : `Write all narration in ${LANGS[o.lang]}${o.lang === 'urdu' ? ' (Urdu script)' : ''}.`;
  const prompt = `You are a top YouTube Shorts / TikTok / Reels scriptwriter. Write an ORIGINAL faceless short video script.
Topic or reference: ${o.topic}
${link ? `The user pasted a link to a video they like${YT_RE.test(link) ? ' (attached)' : ''}. Learn from what makes it work (hook, pacing, structure, topic), then write a NEW script in your own words. Never copy its sentences.` : ''}
Style: ${STYLES[o.style]}. Length: about ${o.seconds} seconds, about ${words} words in total.
${langRule}
Rules: the first line is a scroll-stopping hook (max 10 words). Short spoken sentences. One idea per scene. 5 to ${Math.max(6, Math.round(o.seconds / 5))} scenes. Facts must be true and not misleading. End with a short call to follow or comment.
For each scene give "visual": 2-4 simple English keywords for stock footage, and "imagePrompt": one vivid English sentence describing a matching image.
Also give a YouTube title (max 70 chars, curiosity driven, no clickbait lies), a description (2-3 lines) and 8-12 hashtags, in the same language as the narration (hashtags may mix English).
Return JSON only: {"title":"","hook":"","scenes":[{"text":"",${o.lang === 'roman' ? '"speech":"",' : ''}"visual":"","imagePrompt":""}],"youtubeTitle":"","description":"","hashtags":[""]}`;
  const parts = [{ text: prompt }];
  if (link && YT_RE.test(link)) parts.unshift({ fileData: { fileUri: link.match(YT_RE)[1] } });
  try { return normScript(await gText(parts)); }
  catch (e) {
    if (parts.length > 1 && !fatal(e)) { parts.shift(); return normScript(await gText(parts)); } // video link not readable: write from the text alone
    throw e;
  }
}
function normScript(s) {
  if (!s || !Array.isArray(s.scenes) || !s.scenes.length) throw new Error('The AI did not return any scenes. Try again.');
  s.scenes = s.scenes.map(x => ({ text: String(x.text || '').trim(), speech: x.speech ? String(x.speech).trim() : '', visual: String(x.visual || '').trim(), imagePrompt: String(x.imagePrompt || x.visual || '').trim() })).filter(x => x.text);
  s.hashtags = (s.hashtags || []).map(h => String(h).trim()).filter(Boolean).map(h => h.startsWith('#') ? h : '#' + h.replace(/\s+/g, ''));
  return s;
}

/* ---------- 1) build the video ---------- */
async function resetProject() {
  pause();
  S.clips.forEach(c => { if (c.type === 'video') { c.el.pause(); c.el.remove(); } });
  if (S.music) S.music.el.pause();
  S.voices.forEach(v => v.el.pause());
  S.layers.forEach(l => { if (l.type === 'video') { l.el.pause(); l.el.remove(); } });
  Object.assign(S, { clips: [], texts: [], music: null, voices: [], layers: [], sel: null, selText: null, selVoice: null, selLayer: null, cut: null });
  T = 0;
}
function captionsFor(text, start, end, per) {
  const chunks = splitChunks(text, per), wts = chunks.map(c => c.length + 4), sum = wts.reduce((a, b) => a + b, 0) || 1;
  let t = start; return chunks.map((c, i) => { const d = (end - start) * wts[i] / sum, cap = makeCaption(c, t, t + d); t += d; return cap; });
}
async function buildVideo(o) {
  const s = AI.script; if (!s) return;
  AI.busy = true; renderAI();
  const step = (m) => { busy(m); const el = $('#aiProgress'); if (el) el.textContent = m; };
  try {
    ensureAudio();
    const portrait = o.ratio === '9:16' || o.ratio === '4:5';
    // voice: one request for the whole script keeps within free-tier limits; scenes are then timed by their length
    let voiceBlob = null;
    if (o.voice !== 'none') {
      step('Recording the voice-over with Gemini…');
      const full = s.scenes.map(x => x.speech || x.text).join('\n');
      voiceBlob = await gSpeech(full, o.voice, o.tone);
    }
    await resetProject();
    S.ratio = o.ratio; S.fit = 'fill'; S.bg = 'blur'; sizeCanvas();
    let total0 = s.scenes.reduce((a, x) => a + (x.speech || x.text).length, 0) / 15; // rough seconds when there is no voice
    let voice = null;
    if (voiceBlob) { voice = await addVoiceBlob(voiceBlob, 'AI voice-over', 0); if (voice) { voice.off = 0; voice.len = voice.dur; total0 = voice.dur; } }
    const wts = s.scenes.map(x => (x.speech || x.text).length + 8), sum = wts.reduce((a, b) => a + b, 0);
    const durs = wts.map(w => Math.max(1.2, total0 * w / sum));
    const used = new Set(); const credits = [];
    const W = portrait ? 720 : 1280, H = portrait ? 1280 : 720, ar = o.ratio === '1:1' ? '1:1' : portrait ? '9:16' : '16:9';
    const mine = o.visuals === 'mine' ? (AI.mine || []) : [];
    for (let i = 0; i < s.scenes.length; i++) {
      const sc = s.scenes[i], need = durs[i];
      step(`Finding visuals for scene ${i + 1} of ${s.scenes.length}…`);
      let clip = null;
      try {
        if (o.visuals === 'mine' && mine.length) {
          const f = mine[i % mine.length];
          clip = f.type.startsWith('image') ? await addImageBlob(f, f.name) : await addVideoBlob(f, f.name);
        } else if (o.visuals === 'stock' && store.get('pexels')) {
          const got = await stockVideo(sc.visual || s.title, need, portrait, used).catch(() => null) || await stockPhoto(sc.visual || s.title, portrait, used).catch(() => null);
          if (got) { clip = got.name.includes('photo') ? await addImageBlob(got.blob, got.name) : await addVideoBlob(got.blob, got.name); if (got.credit) credits.push(got.credit); }
        } else if (o.visuals === 'ai') {
          const img = await gImage(sc.imagePrompt || sc.visual, ar).catch(e => { if (fatal(e)) throw e; return null; });
          if (img) clip = await addImageBlob(img, `AI image ${i + 1}.png`);
        }
      } catch (e) { if (fatal(e)) throw e; }
      if (!clip) clip = await addImageBlob(await backdrop(i, W, H), `Background ${i + 1}.jpg`);
      if (!clip) continue;
      if (clip.type === 'image') { clip.start = 0; clip.end = need; clip.kb = true; }
      else {
        const avail = clip.srcDur;
        if (avail >= need) { clip.start = Math.min(Math.max(0, (avail - need) / 3), avail - need); clip.end = clip.start + need; }
        else { clip.start = 0; clip.end = avail; clip.speed = Math.max(.5, avail / need); }
        clip.muted = true; // stock clips play under the voice
      }
      if (i > 0) clip.trans = o.ratio === '9:16' ? 'fade' : 'fade';
      S.clips.push(clip);
    }
    relayout();
    // captions follow each scene's share of the voice
    let t = 0; const tl = S.clips;
    s.scenes.forEach((sc, i) => { const d = tl[i] ? tl[i].len : durs[i]; S.texts.push(...captionsFor(sc.text, t, t + d, 3)); t += d; });
    if (s.hook) S.texts.push(newText({ text: s.hook, start: 0, end: Math.min(2.6, total), y: .16, size: 6.4, font: 'anton', style: 'outline', color: '#F2B33D', bgc: '#000000', anim: 'pop' }));
    if (voice) { voice.len = Math.min(voice.dur, total); }
    S.sel = S.clips[0] ? S.clips[0].id : null;
    AI.kit = { title: s.youtubeTitle || s.title, description: [s.description, credits.length ? `Stock video: Pexels (${uniq(credits).slice(0, 6).join(', ')})` : ''].filter(Boolean).join('\n\n'), hashtags: s.hashtags || [] };
    busy(null); afterStructureChange(); seek(0); checkpoint(true);
    toast('Video ready. Press play, edit anything, then Export.', 4500);
  } catch (e) {
    busy(null); console.warn(e); toast(e.message || String(e), 6000);
  } finally { AI.busy = false; if (S.tab === 'ai') renderAI(); }
}

/* ---------- 2) Auto Shorts from your own long video ---------- */
async function loadSource(file) {
  busy('Opening video…');
  const url = URL.createObjectURL(file); const v = await makeVideoEl(url);
  busy(null);
  if (!v) return toast("Couldn't open this video. Try an MP4.");
  if (AI.src && AI.src.el) AI.src.el.remove();
  AI.src = { file, url, el: v, dur: v.duration, name: file.name }; AI.moments = null; AI.transcript = null;
  renderAI();
}
async function transcribeSource(lang) {
  const src = AI.src;
  // 1st choice: Whisper on this device (free, private). 2nd: Gemini listens to the audio. 3rd: none (pick by loudness).
  try {
    const asr = await loadAsr(S.capModel || 'base');
    busy('Listening to the whole video… this can take a few minutes');
    const a = await getAudio(src.file, 16000);
    const opts = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' }; if (lang !== 'auto') opts.language = lang;
    const out = await asr(a.data, opts);
    return (out.chunks || []).map(c => ({ start: c.timestamp[0] || 0, end: c.timestamp[1] ?? (c.timestamp[0] + 3), text: (c.text || '').trim() })).filter(c => c.text);
  } catch (e) { console.warn('whisper', e); }
  if (gKey()) {
    busy('Gemini is listening to the video…');
    const a = await getAudio(src.file, 16000);
    const maxS = Math.min(a.data.length, 16000 * 60 * 9); // inline audio limit (~9 minutes)
    const pcm = new Int16Array(maxS); for (let i = 0; i < maxS; i++) pcm[i] = Math.max(-1, Math.min(1, a.data[i])) * 32767;
    const wav = pcmToWav(new Uint8Array(pcm.buffer), 16000);
    const b64 = await new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(wav); });
    const res = await gText([{ inlineData: { mimeType: 'audio/wav', data: b64 } }, { text: `Transcribe this audio${lang !== 'auto' ? ' (' + lang + ')' : ''}. Split into sentences with start and end times in seconds. Return JSON only: [{"start":0,"end":0,"text":""}]` }], true, .2);
    return (Array.isArray(res) ? res : res.segments || []).map(x => ({ start: +x.start || 0, end: +x.end || 0, text: String(x.text || '').trim() })).filter(x => x.text && x.end > x.start);
  }
  return null;
}
function loudMoments(a, n, minL, maxL) {
  // fallback without words: windows with the most speech energy, spread through the video
  const sr = a.sr, win = Math.round((minL + maxL) / 2), step = Math.max(1, Math.round(win / 3)), dur = a.data.length / sr, res = [];
  for (let s = 0; s + win <= dur; s += step) { let e = 0; const i0 = Math.floor(s * sr), i1 = Math.floor((s + win) * sr); for (let i = i0; i < i1; i += 8) e += a.data[i] * a.data[i]; res.push({ start: s, end: s + win, e }); }
  res.sort((x, y) => y.e - x.e); const pick = [];
  for (const r of res) { if (pick.length >= n) break; if (pick.every(p => r.end <= p.start || r.start >= p.end)) pick.push(r); }
  const mx = pick[0] ? pick[0].e : 1;
  return pick.sort((x, y) => x.start - y.start).map((p, i) => ({ start: p.start, end: p.end, title: `Moment ${i + 1}`, hook: '', score: Math.round(60 + 39 * p.e / mx), why: 'One of the liveliest parts of the video (no AI key, picked by sound).' }));
}
async function findMoments(o) {
  const src = AI.src; if (!src) return toast('Choose your long video first');
  AI.busy = true; renderAI();
  try {
    pause();
    const [minL, maxL] = o.len.split('-').map(Number);
    const tr = AI.transcript || await transcribeSource(o.lang); AI.transcript = tr;
    let moments = null;
    if (tr && tr.length && gKey()) {
      busy('Gemini is picking the best moments…');
      const lines = tr.map(c => `[${c.start.toFixed(1)}-${c.end.toFixed(1)}] ${c.text}`).join('\n').slice(0, 60000);
      const res = await gText([{ text: `You are a viral short-form video editor (like Opus Clip). From this timestamped transcript of a ${Math.round(src.dur)} second video, pick the ${o.count} best self-contained moments for YouTube Shorts / Reels / TikTok.
Each moment: ${minL}-${maxL} seconds, starts at the beginning of a sentence with a strong hook, ends at the end of a sentence, makes sense without context. No overlaps. Rank by viral potential.
For each give: start, end (seconds, from the transcript times), title (catchy, max 60 chars, in the video's language), hook (max 8 words, on-screen text for the first seconds), score (1-100), why (one short sentence).
Return JSON only: [{"start":0,"end":0,"title":"","hook":"","score":0,"why":""}]
Transcript:
${lines}` }], true, .4);
      moments = (Array.isArray(res) ? res : res.moments || []).map(m => ({ start: clamp(+m.start || 0, 0, src.dur), end: clamp(+m.end || 0, 0, src.dur), title: String(m.title || ''), hook: String(m.hook || ''), score: Math.round(+m.score || 0), why: String(m.why || '') })).filter(m => m.end - m.start >= 5);
    }
    if (!moments || !moments.length) { busy('Finding the liveliest parts…'); moments = loudMoments(await getAudio(src.file, 8000), o.count, minL, maxL); }
    moments.sort((a, b) => b.score - a.score);
    for (const m of moments) { m.thumb = await grabThumb(src.el, src.el.videoWidth || 16, src.el.videoHeight || 9, m.start + .2, true); }
    AI.moments = moments; busy(null);
    toast(`${moments.length} shorts found`);
  } catch (e) { busy(null); console.warn(e); toast(e.message || String(e), 6000); }
  finally { AI.busy = false; if (S.tab === 'ai') renderAI(); }
}
async function openMoment(i) {
  const m = AI.moments[i], src = AI.src; if (!m || !src) return;
  busy('Making your short…');
  await resetProject();
  const c = await addVideoBlob(src.file, src.name);
  if (!c) return busy(null);
  c.start = m.start; c.end = m.end; c.zoom = 1;
  S.clips.push(c); S.ratio = '9:16'; S.fit = 'fill'; sizeCanvas(); relayout();
  const tr = (AI.transcript || []).filter(x => x.end > m.start && x.start < m.end);
  tr.forEach(x => S.texts.push(...captionsFor(x.text, Math.max(0, x.start - m.start), Math.min(m.end, x.end) - m.start, 3)));
  if (m.hook) S.texts.push(newText({ text: m.hook, start: 0, end: Math.min(3, total), y: .15, size: 6.2, font: 'anton', style: 'outline', color: '#F2B33D', bgc: '#000000', anim: 'pop' }));
  S.sel = c.id; AI.kit = { title: m.title, description: '', hashtags: [] };
  busy(null); afterStructureChange(); seek(0); checkpoint(true); setTab('clip');
  toast('Short ready. Drag the picture to frame the speaker (Clip → Position), then Export.', 5000);
}

/* ---------- panel ---------- */
function copyText(t) { navigator.clipboard && navigator.clipboard.writeText(t).then(() => toast('Copied'), () => toast('Select and copy the text')); }
function renderAI() {
  const p = $('#pane-ai'); if (!p) return;
  const key = gKey(), s = AI.script, b = AI.busy;
  const o = { topic: store.get('topic'), style: store.get('style', 'facts'), lang: store.get('lang', 'urdu'), seconds: +store.get('secs', 45), voice: store.get('voice', 'Kore'), tone: store.get('tone', 'Say in an energetic, engaging short-video narrator voice'), visuals: store.get('vis', store.get('pexels') ? 'stock' : 'bg'), ratio: store.get('ratio', '9:16') };
  p.innerHTML = `
  <section class="grp" style="border:0;padding-top:0"><h4>AI Studio <span class="pill">Gemini</span></h4>
    <p class="note">Make faceless videos from a topic, and turn your long videos into shorts. Uses your own Google Gemini key, so it is free on Google's free plan.</p>
  </section>
  <section class="grp"><h4>Setup ${key ? '<span class="pill">ready</span>' : ''}</h4>
    <div class="field"><label for="aiKey">Gemini API key</label><input id="aiKey" class="ai-in" type="password" autocomplete="off" placeholder="Paste your key (starts with AIza…)" value="${esc(key)}"></div>
    <p class="note">Get a free key at <b>aistudio.google.com/apikey</b> → Create API key. It stays on this device.</p>
    <div class="field"><label for="pxKey">Pexels API key (optional, free)</label><input id="pxKey" class="ai-in" type="password" autocomplete="off" placeholder="For real stock videos" value="${esc(store.get('pexels'))}"></div>
    <p class="note">Free at <b>pexels.com/api</b>. Without it, ClipJod uses AI images (paid on Gemini) or its own backgrounds.</p>
    <details class="ai-adv"><summary>Advanced: model names</summary>
      <div class="field"><label for="mText">Text model</label><input id="mText" class="ai-in" placeholder="${TEXT_MODELS().filter(x => x !== store.get('mText'))[0]}" value="${esc(store.get('mText'))}"></div>
      <div class="field"><label for="mTts">Voice model</label><input id="mTts" class="ai-in" placeholder="${TTS_MODELS().filter(x => x !== store.get('mTts'))[0]}" value="${esc(store.get('mTts'))}"></div>
      <div class="field"><label for="mImg">Image model</label><input id="mImg" class="ai-in" placeholder="${IMG_MODELS().filter(x => x !== store.get('mImg'))[0]}" value="${esc(store.get('mImg'))}"></div>
      <p class="note">Leave empty to use the defaults. Working now: ${esc(store.get('okText', '—'))} / ${esc(store.get('okTts', '—'))}.</p>
    </details>
  </section>
  <section class="grp"><h4>1 · Video from a topic or link</h4>
    <textarea id="aiTopic" rows="3" dir="auto" placeholder="A topic, a title, or a link to a short you like. Example: 5 habits of rich people · https://youtube.com/shorts/…">${esc(o.topic)}</textarea>
    <p class="note">With a link, the AI studies why that video works and writes a new, original script. It does not copy or download the video.</p>
    <div class="field"><span class="lbl">Style</span>${segHtml('aiStyle', o.style, Object.entries(STYLES))}</div>
    <div class="field"><span class="lbl">Language</span>${segHtml('aiLang', o.lang, Object.entries(LANGS))}</div>
    <div class="field"><span class="lbl">Length</span>${segHtml('aiSecs', o.seconds, [[20, '20s'], [30, '30s'], [45, '45s'], [60, '60s'], [90, '90s']])}</div>
    <div class="btnrow"><button id="aiScript" class="btn primary" ${b ? 'disabled' : ''}>✦ Write script</button></div>
  </section>
  ${s ? `<section class="grp"><h4>Script</h4>
    <div class="field"><label for="aiTitle">Title</label><input id="aiTitle" class="ai-in" dir="auto" value="${esc(s.title || '')}"></div>
    <div class="field"><label for="aiHook">On-screen hook</label><input id="aiHook" class="ai-in" dir="auto" value="${esc(s.hook || '')}"></div>
    <div class="ai-scenes">${s.scenes.map((x, i) => `<div class="ai-scene"><b>${i + 1}</b><textarea data-i="${i}" class="aiSc" rows="2" dir="auto">${esc(x.text)}</textarea><input data-i="${i}" class="aiVis ai-in" value="${esc(x.visual)}" title="Stock footage keywords" placeholder="visual keywords"></div>`).join('')}</div>
    <p class="note">Edit any line. ${o.lang === 'roman' ? 'The voice reads the Urdu-script version the AI wrote alongside.' : ''}</p>
    <div class="field"><span class="lbl">Voice</span>${segHtml('aiVoice', o.voice, VOICES.concat([['none', 'No voice']]))}</div>
    <div class="field"><label for="aiTone">Voice style</label><input id="aiTone" class="ai-in" value="${esc(o.tone)}"></div>
    <div class="field"><span class="lbl">Visuals</span>${segHtml('aiVis', o.visuals, [['stock', 'Stock videos (Pexels)'], ['ai', 'AI images (Gemini)'], ['bg', 'Clean backgrounds'], ['mine', 'My own clips']])}</div>
    ${o.visuals === 'mine' ? `<div class="btnrow"><label class="btn" for="aiMine">Choose clips / photos</label><span class="note">${(AI.mine || []).length} chosen</span></div><input type="file" id="aiMine" accept="video/*,image/*" multiple hidden>` : ''}
    ${o.visuals === 'stock' && !store.get('pexels') ? '<p class="note">Add a Pexels key in Setup to use stock videos. Without it, clean backgrounds are used.</p>' : ''}
    ${o.visuals === 'ai' ? '<p class="note">AI images use Gemini image generation, which may not be on the free plan. If it fails, clean backgrounds are used.</p>' : ''}
    <div class="field"><span class="lbl">Size</span>${segHtml('aiRatio', o.ratio, [['9:16', '9:16 Shorts'], ['1:1', '1:1'], ['16:9', '16:9 YouTube']])}</div>
    <div class="btnrow"><button id="aiBuild" class="btn primary" ${b ? 'disabled' : ''}>▶ Make the video</button><button id="aiAgain" ${b ? 'disabled' : ''}>Write another</button></div>
    <p class="note" id="aiProgress">This replaces the project in the editor. Undo brings the old one back.</p>
  </section>` : ''}
  ${AI.kit ? `<section class="grp"><h4>Upload kit</h4>
    <div class="kit"><b dir="auto">${esc(AI.kit.title || '')}</b><button data-copy="title">Copy</button></div>
    ${AI.kit.description ? `<div class="kit"><span dir="auto">${esc(AI.kit.description).replace(/\n/g, '<br>')}</span><button data-copy="description">Copy</button></div>` : ''}
    ${AI.kit.hashtags.length ? `<div class="kit"><span>${esc(AI.kit.hashtags.join(' '))}</span><button data-copy="hashtags">Copy</button></div>` : ''}
  </section>` : ''}
  <section class="grp"><h4>2 · Auto Shorts from your long video</h4>
    <p class="note">Add your own podcast, vlog, lecture or stream. ClipJod listens, finds the best moments and makes 9:16 shorts with captions. Use videos you own or have permission to use.</p>
    <div class="btnrow"><label class="btn" for="aiSrc">${AI.src ? 'Change video' : 'Choose long video'}</label><input type="file" id="aiSrc" accept="video/*" hidden>${AI.src ? `<span class="note">${esc(AI.src.name)} · ${fmt(AI.src.dur)}</span>` : ''}</div>
    ${AI.src ? `<div class="field"><span class="lbl">How many shorts</span>${segHtml('asCount', store.get('asCount', 5), [[3, '3'], [5, '5'], [8, '8']])}</div>
    <div class="field"><span class="lbl">Length of each</span>${segHtml('asLen', store.get('asLen', '20-45'), [['15-30', '15–30s'], ['20-45', '20–45s'], ['30-60', '30–60s'], ['45-90', '45–90s']])}</div>
    <div class="field"><span class="lbl">Spoken language</span>${segHtml('asLang', store.get('asLang', 'auto'), [['auto', 'Auto'], ['urdu', 'Urdu'], ['hindi', 'Hindi'], ['english', 'English']])}</div>
    <div class="btnrow"><button id="asFind" class="btn primary" ${b ? 'disabled' : ''}>✦ Find best moments</button></div>` : ''}
    ${AI.moments ? `<div class="moments">${AI.moments.map((m, i) => `<div class="moment"><span class="mthumb" style="background-image:url(${m.thumb || ''})"><i>${fmt(m.start)}–${fmt(m.end)}</i></span><div><b dir="auto">${esc(m.title || 'Moment ' + (i + 1))}</b><small>${m.score ? `<span class="pill">${m.score}</span> ` : ''}${esc(m.why)}</small><button data-m="${i}" class="soft">Edit this short</button></div></div>`).join('')}</div>` : ''}
  </section>
  <section class="grp"><h4>Earn with it</h4>
    <p class="note">Platforms pay for original content. Mass-copied or re-uploaded videos get demonetised. Add your own voice, opinion or footage, check facts, and post consistently.</p>
  </section>`;
  // setup
  const saveIn = (id, k) => on(id, 'change', e => { store.set(k, e.target.value.trim()); renderAI(); });
  saveIn('aiKey', 'gemini'); saveIn('pxKey', 'pexels'); saveIn('mText', 'mText'); saveIn('mTts', 'mTts'); saveIn('mImg', 'mImg');
  on('aiTopic', 'input', e => store.set('topic', e.target.value));
  segOn('aiStyle', v => store.set('style', v)); segOn('aiLang', v => store.set('lang', v)); segOn('aiSecs', v => store.set('secs', v));
  on('aiScript', 'click', async () => {
    const topic = ($('#aiTopic').value || '').trim(); if (!topic) return toast('Type a topic, title or link first');
    AI.busy = true; renderAI(); busy('Writing your script…');
    try { AI.script = await makeScript({ topic, style: store.get('style', 'facts'), lang: store.get('lang', 'urdu'), seconds: +store.get('secs', 45) }); busy(null); toast('Script ready. Edit it, then press Make the video.'); }
    catch (e) { busy(null); console.warn(e); toast(e.message || String(e), 6000); }
    finally { AI.busy = false; renderAI(); }
  });
  on('aiAgain', 'click', () => $('#aiScript') && $('#aiScript').click());
  if (s) {
    on('aiTitle', 'input', e => { s.title = e.target.value; }); on('aiHook', 'input', e => { s.hook = e.target.value; });
    p.querySelectorAll('.aiSc').forEach(t => t.addEventListener('input', () => { s.scenes[+t.dataset.i].text = t.value; s.scenes[+t.dataset.i].speech = ''; }));
    p.querySelectorAll('.aiVis').forEach(t => t.addEventListener('input', () => { s.scenes[+t.dataset.i].visual = t.value; }));
    segOn('aiVoice', v => store.set('voice', v)); on('aiTone', 'change', e => store.set('tone', e.target.value));
    segOn('aiVis', v => { store.set('vis', v); renderAI(); }); segOn('aiRatio', v => store.set('ratio', v));
    on('aiMine', 'change', e => { AI.mine = [...e.target.files]; renderAI(); });
    on('aiBuild', 'click', () => buildVideo({ voice: store.get('voice', 'Kore'), tone: store.get('tone', 'Say in an energetic, engaging short-video narrator voice'), visuals: store.get('vis', store.get('pexels') ? 'stock' : 'bg'), ratio: store.get('ratio', '9:16') }));
  }
  p.querySelectorAll('[data-copy]').forEach(bt => bt.addEventListener('click', () => { const k = bt.dataset.copy; copyText(k === 'hashtags' ? AI.kit.hashtags.join(' ') : AI.kit[k]); }));
  on('aiSrc', 'change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadSource(f); });
  segOn('asCount', v => store.set('asCount', v)); segOn('asLen', v => store.set('asLen', v)); segOn('asLang', v => { store.set('asLang', v); AI.transcript = null; });
  on('asFind', 'click', () => findMoments({ count: +store.get('asCount', 5), len: store.get('asLen', '20-45'), lang: store.get('asLang', 'auto') }));
  p.querySelectorAll('[data-m]').forEach(bt => bt.addEventListener('click', () => openMoment(+bt.dataset.m)));
  enhanceSections(p);
}
