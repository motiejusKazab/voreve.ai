/* Voreve.ai: one phone travelling through one call.
   No libraries. One rAF loop reads scrollY once per frame, smooths it (subtle inertia),
   and writes: one transform on the phone, a handful of CSS variables on its screen,
   and class/variable changes elsewhere only when a value actually changed. */
(() => {
  'use strict';
  const CFG = Object.assign({ BOOKING_URL: '', CONTACT_EMAIL: '', FORM_ENDPOINT: '' }, window.VOREVE_CONFIG || {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const fmt = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const isMobile = () => innerWidth < 900;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: fine */ } } };

  /* the pinned story needs a real viewport; landscape phones and reduced-motion users get the static layout */
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = innerHeight < 500;
  const motion = !reducedMq.matches && !compact;
  if (motion) root.classList.add('motion');
  reducedMq.addEventListener('change', () => location.reload());
  (() => { let id; addEventListener('resize', () => { clearTimeout(id); id = setTimeout(() => { if ((innerHeight < 500) !== compact) location.reload(); }, 350); }); })();

  /* ================= language ================= */
  const DICT = window.VOREVE_I18N || { en: {} };
  let lang = 'en';
  const t = (k) => (DICT[lang] && DICT[lang][k]) ?? (DICT.en && DICT.en[k]) ?? k;
  const emailCfg = (CFG.CONTACT_EMAIL || '').trim();
  if (emailCfg) $$('[data-email-link]').forEach((a) => a.removeAttribute('data-t')); // keep the real address
  const applyLang = (scope = document) => {
    $$('[data-t]', scope).forEach((el) => { const v = t(el.dataset.t); if (el.innerHTML !== v) el.innerHTML = v; });
    $$('[data-t-attr]', scope).forEach((el) => el.dataset.tAttr.split(';').forEach((p) => { const [a, k] = p.split(':'); el.setAttribute(a, t(k)); }));
  };

  /* ================= words (scrubbed / typed text) ================= */
  const splitWords = (el) => {
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((tok) => {
            if (!tok) return;
            if (/^\s+$/.test(tok)) frag.appendChild(document.createTextNode(' '));
            else { const s = document.createElement('span'); s.className = 'w'; s.textContent = tok; frag.appendChild(s); }
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(el);
    return $$('.w', el);
  };
  const splitTyped = (q) => { const ws = splitWords(q); q.style.setProperty('--n', ws.length); ws.forEach((w, i) => w.style.setProperty('--i', i)); };
  let leadWords = [];
  const splitLead = () => { leadWords = splitWords($('#lead')); };

  /* ================= the phone ================= */
  const TPL = $('#phoneTpl');
  const buildPhone = (slabs) => {
    const el = TPL.content.firstElementChild.cloneNode(true);
    const inner = $('.phone__in', el);
    const body = document.createElement('div'); body.className = 'body';
    const D = 28;
    for (let i = 0; i < slabs; i++) {
      const s = document.createElement('i');
      s.className = 'slab' + (i === 0 || i === slabs - 1 ? ' hi' : '');
      s.style.transform = `translateZ(${(-D / 2 + (i * D) / (slabs - 1)).toFixed(2)}px)`;
      body.appendChild(s);
    }
    inner.insertBefore(body, inner.firstChild);
    applyLang(el);
    splitTyped($('.u-q', el));
    $$('.uf__p', el).forEach((p, k) => {
      p.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setSpeaker(k, true, performance.now()); });
      p.addEventListener('click', () => setSpeaker(k, true, performance.now()));
    });
    return { el, screen: $('.screen', el), glass: $('.glass', el), canvas: $('.u-wave canvas', el), found: $('.u-found', el), foundCv: $('.uf__line canvas', el), time: $('.u-time', el), v: {}, secs: -1 };
  };

  /* the call, as a function of story position x (0 = hero ... 5 = result) */
  const timeline = (x) => {
    const p1 = smooth(clamp((x - 0.6) / 0.4));
    const p2 = smooth(clamp((x - 1.3) / 0.45));
    const ty = clamp((x - 1.6) / 0.55);
    const p3 = smooth(clamp((x - 2.55) / 0.5));
    const p4 = clamp((x - 3.3) / 0.7);
    const p5 = smooth(clamp((x - 4.55) / 0.4));
    return { p1, p2, ty, p3, p4, p5, hs: p1 + p2 + p3 + clamp(p4 * 5) + p5, secs: 138 * clamp((x - 0.8) / 4.1) };
  };
  const applyScreen = (ph, tl) => {
    const st = ph.screen.style;
    for (const k of ['p1', 'p2', 'p3', 'p4', 'p5', 'ty', 'hs', 'land']) {
      const val = tl[k] || 0;
      if (ph.v[k] === undefined || Math.abs(ph.v[k] - val) > 0.0015) { ph.v[k] = val; st.setProperty('--' + k, val.toFixed(3)); }
    }
    const s = Math.floor(tl.secs);
    if (s !== ph.secs) { ph.secs = s; ph.time.textContent = fmt(s); }
  };

  /* small live waveform inside the phone (only drawn while it is on screen) */
  const WV = { W: 320, H: 150, PITCH: 6, BAR: 3.2, NOW: 252 };
  const voiceEnv = (ms) => {
    const s = ms / 1000;
    const syl = Math.abs(Math.sin(s * 5.3 + Math.sin(s * 1.7) * 1.5)) ** 0.7;
    return clamp(0.1 + 0.9 * syl * (0.55 + 0.45 * Math.sin(s * 12.1 + 1.3)) * (0.78 + Math.random() * 0.22));
  };
  const wave = { hist: new Float32Array(Math.ceil(252 / 6) + 2).fill(0.03), acc: 0 };
  const drawPhoneWave = (cv, now, dt, speaking, energy) => {
    wave.acc += dt;
    while (wave.acc >= 40) {
      wave.acc -= 40;
      wave.hist.copyWithin(0, 1);
      wave.hist[wave.hist.length - 1] = speaking ? lerp(0.03, voiceEnv(now), energy) : 0.03 + Math.random() * 0.015;
    }
    const c = cv.getContext('2d'); c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, WV.W, WV.H);
    const n = wave.hist.length, mid = WV.H / 2;
    for (let j = 0; j < n; j++) {
      const x = WV.NOW - (n - 1 - j) * WV.PITCH; if (x < -4) continue;
      const a = wave.hist[j], h = Math.max(2, a * 124);
      c.globalAlpha = smooth(clamp(x / 70)) * (a > 0.055 ? 1 : 0.4);
      c.fillStyle = '#EEEAE0';
      c.fillRect(x, mid - h / 2, WV.BAR, h);
    }
    c.globalAlpha = 0.3; c.fillStyle = '#EEEAE0';
    for (let x = WV.NOW + 12; x < WV.W; x += 12) c.fillRect(x, mid - 1, 2, 2);
    c.globalAlpha = 0.6; c.fillRect(WV.NOW + 0.5, mid - 50, 1, 100); c.globalAlpha = 1;
  };
  const staticPhoneWave = (cv) => {
    const c = cv.getContext('2d'); c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, WV.W, WV.H); c.fillStyle = '#EEEAE0';
    for (let j = 0; j < 42; j++) { const x = 252 - (41 - j) * 6; const a = j > 6 && j < 30 ? 0.15 + 0.8 * Math.abs(Math.sin(j * 0.7) * Math.cos(j * 0.23)) : 0.03; const h = Math.max(2, a * 124); c.globalAlpha = smooth(clamp(x / 70)); c.fillRect(x, 75 - h / 2, 3.2, h); }
    c.globalAlpha = 1;
  };

  /* ================= poses: where the phone is, per story anchor =================
     [x (x viewport width), y (x viewport height), scale, rotX deg, rotY deg, rotZ deg]  */
  const POSES_D = [
    [0.235, 0.02, 1.0, 7, -24, 2],      // 0 hero: incoming call, on the right
    [0.225, 0.0, 1.0, 5, -18, 1.5],     // 1 the call
    [0.06, 0.0, 1.0, 3, -6, 0],         // 2 listens: toward the centre
    [-0.14, 0.0, 1.0, 4, 22, -1.5],     // 3 understands: turns to face the copy
    [-0.24, 0.0, 1.0, 2, 14, -1],       // 4 acts: moves left, information beside it
    [0.0, 0.0, 0.92, 0, -5, 0],         // 5 result: back to centre, relaxed
    [-0.285, 0.05, 0.58, 2, 16, 0],     // 6 value: rests on the left, smaller
    [-0.285, 0.05, 0.58, 2, 16, 0]      // 7 (same: leaves here, turning landscape)
  ];
  const POSES_M = [
    [0.03, 0.47, 0.9, 8, -14, 2],
    [0.0, -0.14, 1.0, 6, -10, 1],
    [0.04, -0.14, 1.0, 3, -4, 0],
    [-0.03, -0.14, 1.0, 3, 12, -1],
    [-0.04, -0.14, 1.0, 2, 8, 0],
    [0.0, -0.125, 1.0, 0, -3, 0],
    [0.0, -1.0, 0.7, 0, 0, 0],
    [0.0, 1.3, 0.8, 0, 0, 0]          // waits below, then rises into the founders slot
  ];

  /* ================= DOM handles ================= */
  const nav = $('#nav'), rail = $('#rail'), railSteps = $$('#railSteps li'), railFill = $('#railFill'), railCur = $('#railCur');
  const hero = $('#top'), heroCta = $('#heroCta');
  const scenes = $$('.scene');
  const secEls = { hero, story: $('#story'), value: $('#value'), about: $('#about'), demo: $('#demo') };
  const vrows = $$('.vrow'), dayEl = $('#day'), aboutPhoneEl = $('#aboutPhone'), valuePhoneEl = $('.value__phone');
  const panel = $('#bookPanel'), bookBtn = $('#bookBtn'), form = $('#demoForm'), embed = $('#bookingEmbed');
  const answerEl = $('#answer'), thumb = $('#thumb'), ringLabel = $('#ringLabel'), ringWrap = ringLabel.parentElement, demoPhoneEl = $('#demoPhone');
  const STEP_AT = [0, 1.35, 2.4, 3.05, 3.4, 4.5];
  const STEP_KEYS = ['rail.call', 'rail.listen', 'rail.understand', 'rail.think', 'rail.act', 'rail.result'];

  /* ================= geometry (cached; scrolling never reads layout) ================= */
  const G = { vh: 0, vw: 0, A: [], sec: {}, ctaBottom: 0, leadTop: 0, leadH: 0, vrowC: [], dayTop: 0, k: 0.8 };
  let stage = null, phone = null;
  const measure = () => {
    const sy = scrollY; G.vh = innerHeight; G.vw = innerWidth;
    for (const k in secEls) { const r = secEls[k].getBoundingClientRect(); G.sec[k] = { top: r.top + sy, bottom: r.bottom + sy }; }
    const A = [0];
    scenes.forEach((s) => { const r = s.getBoundingClientRect(); A.push(r.top + sy + (r.height - G.vh) / 2); });
    A.push(G.sec.value.top + G.vh * 0.2);                       // 6 value: phone rests on the left
    const ap = aboutPhoneEl.getBoundingClientRect(), apMid = ap.top + sy + ap.height / 2;
    const A8 = Math.max(A[6] + 2, apMid - G.vh / 2);              // 8 founders: phone landscape, centred on its slot
    A.push(Math.max(A[6] + 1, A8 - G.vh * (innerWidth < 900 ? 0.9 : 1.05))); // 7 leaves the left rest, turns landscape
    A.push(A8);
    A.push(Math.max(A8 + G.vh * 0.6, G.sec.demo.top - G.vh * 0.25)); // 9 contact: upright again, beside the CTA
    G.A = A;
    G.ctaBottom = heroCta.getBoundingClientRect().bottom + sy;
    const lr = $('#lead').getBoundingClientRect(); G.leadTop = lr.top + sy; G.leadH = lr.height;
    G.vrowC = vrows.map((r) => { const b = r.getBoundingClientRect(); return b.top + sy + b.height / 2; });
    G.dayTop = dayEl.getBoundingClientRect().top + sy;
    const m = isMobile();
    if (m) {
      // phones: size the phone from the room left above the copy, so the two never overlap
      const padB = parseFloat(getComputedStyle(scenes[0].firstElementChild).paddingBottom) || 90;
      let maxC = 0;
      scenes.forEach((sc) => { const pin = sc.firstElementChild; const r0 = pin.firstElementChild.getBoundingClientRect(), r1 = pin.lastElementChild.getBoundingClientRect(); maxC = Math.max(maxC, r1.bottom - r0.top); });
      const navH = 60, room = G.vh - padB - maxC - 14 - (navH + 6);
      const hPhone = clamp(room, G.vh * 0.3, G.vh * 0.56);
      G.k = Math.min(1, hPhone / 782, (G.vw * 0.66) / 380);
      const yf = (navH + 6 + (782 * G.k) / 2 - G.vh / 2) / G.vh;
      for (let i = 1; i <= 5; i++) POSES_M[i][1] = yf;
    } else G.k = Math.min(1, (G.vh * 0.8) / 782, (G.vw * 0.3) / 380);
    if (stage) stage.style.setProperty('--k', G.k.toFixed(4));
    if (stage) stage.classList.toggle('is-m', m);
    setAnswerTravel();
  };

  /* story position: 0 at the hero, k when scene k is centred, continuing through the later anchors */
  const posX = (sy) => {
    const A = G.A; if (sy <= A[0]) return 0;
    for (let i = 0; i < A.length - 1; i++) if (sy < A[i + 1]) return i + (sy - A[i]) / (A[i + 1] - A[i]);
    return A.length - 1;
  };
  const dynValue = [-0.283, 0.02, 0.9, 2, 14, 0];   // the left column of the value section (live, desktop)
  const dynAbout = [0, 0, 1, 3, -8, -90];   // the landscape slot in the founders section (live)
  const dynCta = [0, 0, 1, 4, -14, 1.5];    // the slot beside the contact section (live)
  const poseAt = (x, out) => {
    const m = isMobile(), P = m ? POSES_M : POSES_D;
    const pick = (i) => (i === 8 ? dynAbout : i === 9 ? dynCta : (!m && (i === 6 || i === 7)) ? dynValue : P[i]);
    if (x >= 9) { for (let k = 0; k < 6; k++) out[k] = dynCta[k]; return out; }
    if (m && x >= 6 && x < 7) { for (let k = 0; k < 6; k++) out[k] = P[6][k]; return out; }
    const i = Math.min(8, Math.floor(x)), tt = x - i;
    const u = smooth(clamp((tt - 0.18) / 0.64));
    const A = pick(i), B = pick(i + 1);
    for (let k = 0; k < 6; k++) out[k] = lerp(A[k], B[k], u);
    return out;
  };

  /* ================= a day of calls (interactive) ================= */
  const range = $('#dayRange'), hourOut = $('#dayHour'), cursor = $('#dayCursor'), dayMsg = $('#dayMsg');
  const rowV = $('.day__row--v'), rowT = $('.day__row--t'), callsEl = $('#dayCalls');
  const cellsV = [], cellsT = [];
  for (let h = 0; h < 24; h++) {
    const a = document.createElement('i'), b = document.createElement('i');
    if (h >= 9 && h < 17) b.className = 'on';
    rowV.appendChild(a); rowT.appendChild(b); cellsV.push(a); cellsT.push(b);
  }
  const working = (h) => h >= 9 && h < 17;
  let dayHour = -1, dayTouched = false;
  const setHour = (h) => {
    h = clamp(Math.round(h), 0, 23); if (h === dayHour) return;
    if (dayHour >= 0) { cellsV[dayHour].classList.remove('cur'); cellsT[dayHour].classList.remove('cur'); }
    dayHour = h; cellsV[h].classList.add('cur'); cellsT[h].classList.add('cur');
    cursor.style.setProperty('--h', h); range.value = h;
    hourOut.textContent = String(h).padStart(2, '0') + ':00';
    dayMsg.textContent = t(working(h) ? 'day.on' : 'day.off');
  };
  range.addEventListener('input', () => { dayTouched = true; setHour(+range.value); });
  let dayVisible = false, dayTimer = 0;
  const spawnCall = () => {
    if (!dayVisible || document.hidden) return;
    const h = Math.random() < 0.55 ? 9 + Math.floor(Math.random() * 8) : [0, 1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 20, 21, 22, 23][Math.floor(Math.random() * 16)];
    const i = document.createElement('i');
    i.style.setProperty('--x', ((h + 0.5) / 24).toFixed(4)); i.style.setProperty('--c', working(h) ? '#EEEAE0' : 'var(--signal)');
    callsEl.appendChild(i); setTimeout(() => i.remove(), 5500);
    while (callsEl.children.length > 16) callsEl.firstChild.remove();
  };
  if (motion) {
    new IntersectionObserver(([e]) => { dayVisible = e.isIntersecting; }, { threshold: 0.2 }).observe(dayEl);
    dayTimer = setInterval(spawnCall, 640);
  }

  /* ================= the founders, on the phone's landscape screen ================= */
  let speaker = 0, speakerPos = 0, manualUntil = 0, autoAt = 0;
  const setSpeaker = (side, manual, now) => {
    speaker = side; if (manual) manualUntil = now + 4500;
    if (phone) $$('.uf__p', phone.el).forEach((p, k) => p.classList.toggle('is-speaking', k === side));
  };
  const drawFound = (ph, now, dt, conn) => {
    if (!manualUntil || now > manualUntil) { autoAt += dt; if (autoAt > 2700) { autoAt = 0; setSpeaker(1 - speaker, false, now); } }
    speakerPos = lerp(speakerPos, speaker, 1 - Math.exp(-dt / 220));
    const c = ph.foundCv.getContext('2d'); c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, 300, 130);
    const pitch = 6, n = 50, mid = 65, maxH = 120, dir = speakerPos < 0.5 ? 1 : -1, tt = now * 0.011;
    c.fillStyle = speakerPos < 0.5 ? '#EEEAE0' : '#FF7F55';
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1), d = Math.abs(u - speakerPos);
      const env = Math.exp(-d * 2.6) * (0.35 + 0.65 * Math.abs(Math.sin(u * 38 - dir * tt))) * (0.7 + 0.3 * Math.abs(Math.sin(u * 9 + tt * 0.6)));
      const av = 0.04 + conn * 0.96 * env, hh = Math.max(2, av * maxH);
      c.globalAlpha = av > 0.06 ? 1 : 0.35; c.fillRect(k * pitch, mid - hh / 2, 3, hh);
    }
    c.globalAlpha = 1;
  };

  /* ================= main loop ================= */
  const pose = [0, 0, 1, 0, 0, 0];
  let ss = -1, lastSy = -1, lastT = '', lastGx = '', hidden = null, last = 0, needMeasure = true, E = 0, lastTy = 0, running = false;
  let ctaX = 0, ctaOpenAt = 0, ctaWasOpen = false, dragPP = 0, liveOn = false;
  let sceneV = [], navState = {}, lead = -1, vAct = -1, railIdx = -1, railOn = null, railW = -1, curLabel = '', ptX = 0, ptY = 0, ptTX = 0, ptTY = 0;
  const setCls = (el, c, on, key) => { if (navState[key] !== on) { navState[key] = on; el.classList.toggle(c, on); } };
  const toneAt = () => 'ink'; // one dark theme

  const frame = (now) => {
    if (!running) return;
    const dt = Math.min(64, now - (last || now)); last = now;
    if (needMeasure) { needMeasure = false; measure(); }
    const sy = scrollY, vh = G.vh, vw = G.vw;
    if (ss < 0) ss = sy;
    ss += (sy - ss) * (1 - Math.exp(-dt / 105)); if (Math.abs(sy - ss) < 0.3) ss = sy;
    const x = posX(ss), m = isMobile();

    /* --- the phone --- */
    const inCta = x >= 8;
    if (!m && x >= 4.9 && x < 8.1) { // the value column: the phone fills it and stays centred in it
      const r = valuePhoneEl.getBoundingClientRect();
      dynValue[0] = (r.left + r.width / 2 - vw / 2) / vw; dynValue[1] = (r.top + r.height / 2 - vh / 2) / vh;
      dynValue[2] = clamp(r.height / (782 * G.k), 0.3, 1);
    }
    if (x >= 6.6) { // live targets (rect reads happen before any writes): the landscape founders slot, then the contact slot
      const r = aboutPhoneEl.getBoundingClientRect();
      dynAbout[0] = (r.left + r.width / 2 - vw / 2) / vw; dynAbout[1] = (r.top + r.height / 2 - vh / 2) / vh;
      dynAbout[2] = clamp((r.width / (782 * G.k)) * 0.98, 0.3, 1); dynAbout[3] = 3; dynAbout[4] = m ? -4 : -8; dynAbout[5] = -90;
    }
    if (x >= 7.9) {
      const r = demoPhoneEl.getBoundingClientRect();
      dynCta[0] = (r.left + r.width / 2 - vw / 2) / vw; dynCta[1] = (r.top + r.height / 2 - vh / 2) / vh;
      dynCta[2] = clamp(r.height / (782 * G.k), 0.3, 1.1);
      dynCta[3] = m ? 4 : 5; dynCta[4] = m ? -8 : -15; dynCta[5] = m ? 0 : 1.5;
    }
    poseAt(x, pose);
    const ctaOpen = panel.classList.contains('is-open');
    const tsec = now / 1000, idle = Math.max(clamp(1 - x / 0.55), inCta && !ctaOpen ? clamp((x - 8.4) / 0.6) : 0);
    const px = pose[0] * vw, py = pose[1] * vh + Math.sin(tsec * 0.9) * 5 * idle;
    const half = 391 * G.k * pose[2] + 24;
    const gone = Math.abs(py) > vh / 2 + half || Math.abs(px) > vw / 2 + 391 * G.k * pose[2] + 60; // fully off-screen: skip all work
    if (gone !== hidden) { hidden = gone; stage.classList.toggle('is-hidden', gone); }
    if (!gone) {
      const buzz = idle > 0.3 && tsec % 3.4 < 0.32 ? Math.sin(tsec * 64) * 0.55 * (1 - (tsec % 3.4) / 0.32) : 0;
      const lean = clamp((sy - ss) * 0.012, -4, 4);
      ptX = lerp(ptX, ptTX, 1 - Math.exp(-dt / 160)); ptY = lerp(ptY, ptTY, 1 - Math.exp(-dt / 160));
      const ry = pose[4] + Math.sin(tsec * 0.45) * 1.5 * idle + ptX * 3.2, rx = pose[3] + Math.sin(tsec * 0.6) * 0.6 * idle + lean - ptY * 2.4, rz = pose[5] + buzz;
      const tf = `translate3d(${px.toFixed(1)}px,${py.toFixed(1)}px,0) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${pose[2].toFixed(3)})`;
      if (tf !== lastT) { lastT = tf; phone.el.style.transform = tf; }
      const gx = (50 + ry * 1.3).toFixed(1) + '% 0'; if (gx !== lastGx) { lastGx = gx; phone.glass.style.backgroundPosition = gx; }
      let tl;
      if (inCta) { // beside the contact section the phone answers with the visitor
        if (ctaOpen && !ctaWasOpen) ctaOpenAt = now;
        ctaWasOpen = ctaOpen;
        const target = ctaOpen ? 2.3 * (1 - Math.exp(-((now - ctaOpenAt) / 1000) / 1.4)) : (dragPP > 0.01 ? 0.6 + dragPP * 0.42 : 0);
        ctaX = ctaOpen ? Math.max(ctaX, target) : lerp(ctaX, target, 1 - Math.exp(-dt / 180));
        tl = timeline(ctaX); tl.secs = ctaOpen ? (now - ctaOpenAt) / 1000 : 0;
      } else tl = timeline(x);
      const land = clamp(-pose[5] / 90); tl.land = land;
      applyScreen(phone, tl);
      const live = land > 0.92; if (live !== liveOn) { liveOn = live; phone.found.classList.toggle('is-live', live); }
      if (land > 0.3) drawFound(phone, now, dt, clamp((land - 0.5) * 2));
      // live waveform: speaks while the caller's words are being scrubbed / played in
      if (Math.abs(tl.ty - lastTy) > 0.0008) E = 1; else E = Math.max(0, E - dt / 800);
      lastTy = tl.ty;
      if (tl.p2 > 0.05 && tl.p4 < 0.95) drawPhoneWave(phone.canvas, now, dt, tl.ty > 0.01 && tl.ty < 0.99, 0.12 + 0.88 * E);
    }

    /* --- copy scenes: lines slide up into a mask, scrubbed to position --- */
    scenes.forEach((s, i) => {
      const k = i + 1, a = clamp((x - (k - 0.55)) / 0.3), b = clamp((x - (k + 0.3)) / 0.3);
      const key = a.toFixed(3) + '/' + b.toFixed(3);
      if (sceneV[i] !== key) { sceneV[i] = key; s.style.setProperty('--a', a.toFixed(3)); s.style.setProperty('--b', b.toFixed(3)); }
    });

    /* --- rail: where we are in the call --- */
    let idx = 0; STEP_AT.forEach((v, i) => { if (x >= v) idx = i; });
    const inDemo = sy + vh * 0.55 > G.sec.demo.top;
    const on = m ? (sy + 40 > G.ctaBottom && !inDemo) : (x > 0.45 && x < 5.75);
    if (on !== railOn) { railOn = on; rail.classList.toggle('is-on', on); $('.rail__cta', rail).tabIndex = on && m ? 0 : -1; }
    if (idx !== railIdx) { railIdx = idx; railSteps.forEach((li, i) => { li.classList.toggle('is-on', i === idx); li.classList.toggle('is-done', i < idx); }); }
    const cur = x < 0.45 ? t('rail.incoming') : x > 5.75 ? t('rail.done') : t(STEP_KEYS[idx]);
    if (cur !== curLabel) { curLabel = cur; railCur.textContent = cur; }
    const w = Math.round(clamp((x - 0.4) / 5.0) * 1000) / 1000; if (w !== railW) { railW = w; railFill.style.transform = `scaleX(${w})`; }

    const navCur = sy + vh * 0.4 >= G.sec.demo.top ? '#contact' : sy + vh * 0.4 >= G.sec.about.top ? '#about' : x > 0.5 && x < 4.6 ? (x < 2.5 ? '#call' : '#understand') : '';
    if (navState.cur !== navCur) { navState.cur = navCur; $$('.nav__links a').forEach((a) => a.classList.toggle('is-cur', a.getAttribute('href') === navCur)); }

    /* --- chrome + scroll-linked text (real scroll position) --- */
    if (sy !== lastSy) {
      lastSy = sy;
      setCls(nav, 'is-solid', sy > 24, 'solid'); setCls(nav, 'is-mini', sy > vh * 0.6, 'mini');
      const tone = toneAt(sy + 36); if (navState.tone !== tone) { navState.tone = tone; nav.dataset.tone = tone; }
      setCls(nav, 'show-cta', sy + 40 > G.ctaBottom && !inDemo, 'cta');
      const ql = Math.round(clamp((sy + vh * 0.82 - G.leadTop) / (G.leadH + vh * 0.25)) * leadWords.length);
      if (ql !== lead) { leadWords.forEach((wd, i) => wd.classList.toggle('on', i < ql)); lead = ql; }
      const line = sy + vh * 0.5; let best = -1, bd = 1e9;
      G.vrowC.forEach((c, i) => { const d = Math.abs(c - line); if (d < bd) { bd = d; best = i; } });
      if (line < G.dayTop + 200 || line > G.sec.value.bottom) best = -1;
      if (best !== vAct) {
        vAct = best; vrows.forEach((r, i) => r.classList.toggle('is-on', i === best));
        if (!dayTouched) setHour(best === 3 ? 22 : 14); // "after hours" row moves the day to the evening
      }
    }
    requestAnimationFrame(frame);
  };
  const start = () => { if (running) return; running = true; last = 0; requestAnimationFrame(frame); };
  document.addEventListener('visibilitychange', () => { running = false; if (!document.hidden) start(); });

  /* ================= language switch ================= */
  const setLang = (l, persist) => {
    if (!DICT[l]) l = 'en';
    lang = l; root.lang = l;
    document.title = t('meta.title');
    const md = $('meta[name="description"]'); if (md) md.content = t('meta.desc');
    applyLang();
    $$('.u-q').forEach(splitTyped);
    splitLead(); lead = -1; curLabel = '';
    setHour(dayHour < 0 ? 14 : dayHour + 0); dayMsg.textContent = t(working(dayHour) ? 'day.on' : 'day.off');
    $$('#lang button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === l));
    if ($('#ringLabel') && $('#answer').classList.contains('is-answered')) $('#ringLabel').textContent = t('c.ring.on');
    if (persist) store.set('voreve.lang', l);
    needMeasure = true; lastSy = -1;
  };
  const qsLang = new URLSearchParams(location.search).get('lang');
  const initial = DICT[qsLang] ? qsLang : (store.get('voreve.lang') || ((navigator.language || '').toLowerCase().startsWith('lt') ? 'lt' : 'en'));
  setLang(initial, false);
  $$('#lang button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang, true)));

  /* ================= build ================= */
  if (motion) {
    stage = $('#stage');
    phone = buildPhone(isMobile() ? 7 : 12);
    stage.appendChild(phone.el);
    matchMedia('(max-width: 899px)').addEventListener('change', () => { needMeasure = true; });
    measure();
    requestAnimationFrame(() => hero.classList.add('is-in'));
    // the phone leans a little toward the pointer (fine pointers only)
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      addEventListener('pointermove', (e) => { ptTX = (e.clientX / innerWidth - 0.5) * 2; ptTY = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
    }
    setSpeaker(0, false, 0);
    start();
  } else {
    /* reduced motion / landscape phones: one beautiful static phone per story state */
    const STATIC_X = [0, 1.15, 2.3, 3.1, 4.1, 5.0, 0], SRY = [-14, -10, 8, 12, 10, -6, -12];
    const hostFor = (k) => (k === 0 ? $('.hero__in') : k === 6 ? demoPhoneEl : scenes[k - 1].querySelector('.scene__pin'));
    STATIC_X.forEach((x, k) => {
      const ph = buildPhone(9), wrap = document.createElement('div');
      wrap.className = 'sphone'; wrap.style.setProperty('--sry', SRY[k] + 'deg'); wrap.setAttribute('aria-hidden', 'true');
      wrap.appendChild(ph.el); hostFor(k).appendChild(wrap);
      applyScreen(ph, timeline(x)); ph.glass.style.backgroundPosition = '58% 0';
      if (k >= 2 && k <= 3) staticPhoneWave(ph.canvas);
    });
    { const ph = buildPhone(9), wrap = document.createElement('div');
      wrap.className = 'sphone sphone--land'; wrap.setAttribute('aria-hidden', 'true'); wrap.appendChild(ph.el); aboutPhoneEl.appendChild(wrap);
      applyScreen(ph, Object.assign(timeline(5), { land: 1 })); ph.glass.style.backgroundPosition = '58% 0'; speakerPos = 0.3; drawFound(ph, 0, 0, 0.9); }
    hero.classList.add('is-in');
    /* no animation loop here, so the nav still needs its scroll-aware tone and CTA */
    nav.classList.add('show-cta');
    let tick = false;
    const navUpdate = () => { tick = false; const sy = scrollY; nav.classList.toggle('is-solid', sy > 24); nav.classList.toggle('is-mini', sy > G.vh * 0.6); nav.dataset.tone = toneAt(sy + 36); };
    addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(navUpdate); } }, { passive: true });
    measure(); navUpdate();
    $$('.day__calls').forEach((el) => el.remove());
  }

  /* ================= anchors into the story ================= */
  const jumpTo = (k, instant) => { if (!G.A.length) return; scrollTo({ top: G.A[k], behavior: instant || !motion ? 'auto' : 'smooth' }); };
  $$('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { if (!motion) return; e.preventDefault(); jumpTo(+a.dataset.jump); if ($('#mnav').contains(a)) setMenu(false); }));
  if (motion && location.hash) { const mk = { '#call': 1, '#listen': 2, '#understand': 3, '#act': 4, '#result': 5 }[location.hash]; if (mk) setTimeout(() => { measure(); jumpTo(mk, true); }, 60); }

  /* ================= menu ================= */
  const toggle = $('#navToggle'), mnav = $('#mnav');
  const setMenu = (open) => { toggle.setAttribute('aria-expanded', open); nav.classList.toggle('is-open', open); mnav.inert = !open; };
  mnav.inert = true;
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  $$('a', mnav).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (nav.classList.contains('is-open')) { setMenu(false); toggle.focus(); } else if (panel.classList.contains('is-open')) openPanel(false); } });
  matchMedia('(min-width: 900px)').addEventListener('change', (m) => m.matches && setMenu(false));

  /* ================= heading reveals ================= */
  if (motion) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.35 });
    $$('.rv').forEach((el) => io.observe(el));
  }

  /* ================= the final call: answer it ================= */
  function travel() { return Math.max(0, bookBtn.clientWidth - thumb.offsetWidth - 16); }
  function setAnswerTravel() { bookBtn.style.setProperty('--max', travel() + 'px'); }
  const setAnswered = (on) => {
    answerEl.classList.toggle('is-answered', on); ringWrap.classList.toggle('is-on', on); demoPhoneEl.classList.toggle('is-answered', on);
    ringLabel.textContent = t(on ? 'c.ring.on' : 'c.ring');
  };
  const openPanel = (open, focus) => {
    panel.classList.toggle('is-open', open); panel.inert = !open; bookBtn.setAttribute('aria-expanded', open); setAnswered(open);
    bookBtn.style.setProperty('--dx', '0px'); bookBtn.style.setProperty('--pp', 0); setAnswerTravel();
    if (open && focus) setTimeout(() => { const el = embed.hidden ? form.elements.name : $('#bookingOpen'); el && el.focus({ preventScroll: true }); }, motion ? 700 : 0);
  };
  let drag = null, suppress = false;
  thumb.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    drag = { x: e.clientX, moved: false }; try { thumb.setPointerCapture(e.pointerId); } catch { /* pointer already released */ } thumb.classList.add('is-drag'); setAnswerTravel();
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const max = travel(), dx = clamp(e.clientX - drag.x, 0, max);
    if (dx > 5) drag.moved = true;
    dragPP = max ? dx / max : 0;
    thumb.style.setProperty('--dx', dx + 'px'); bookBtn.style.setProperty('--pp', max ? (dx / max).toFixed(3) : 0);
  });
  const endDrag = (e) => {
    if (!drag) return;
    const max = travel(), dx = clamp(e.clientX - drag.x, 0, max), d = drag; drag = null;
    thumb.classList.remove('is-drag'); thumb.style.removeProperty('--dx'); bookBtn.style.setProperty('--pp', 0); dragPP = 0;
    if (d.moved) {
      suppress = true; setTimeout(() => { suppress = false; }, 80);
      if (e.type !== 'pointercancel' && max && dx / max > 0.7) { openPanel(true, true); setTimeout(() => panel.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'center' }), 120); }
    }
  };
  thumb.addEventListener('pointerup', endDrag); thumb.addEventListener('pointercancel', endDrag);
  bookBtn.addEventListener('click', () => {
    if (suppress) return;
    const open = !panel.classList.contains('is-open');
    openPanel(open, open);
    if (open) setTimeout(() => panel.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'center' }), 120);
  });
  $$('[data-book]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const top = $('#demo').getBoundingClientRect().top + scrollY;
    scrollTo({ top, behavior: motion ? 'smooth' : 'auto' });
    setTimeout(() => openPanel(true, true), motion ? 900 : 0);
    if (mnav.contains(a)) setMenu(false);
  }));
  if (CFG.BOOKING_URL.trim()) {
    $('#bookingFrame').src = CFG.BOOKING_URL.trim(); $('#bookingOpen').href = CFG.BOOKING_URL.trim();
    embed.hidden = false; form.hidden = true;
  }

  /* ================= email ================= */
  const email = emailCfg;
  $$('[data-email-link]').forEach((a) => {
    if (email) { a.href = 'mailto:' + email; a.textContent = email; a.removeAttribute('aria-disabled'); }
    else a.addEventListener('click', (e) => e.preventDefault());
  });
  const copyBtn = $('[data-email-copy]'), copyStatus = $('[data-copy-status]');
  if (email && copyBtn) {
    copyBtn.hidden = false;
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(email); copyBtn.textContent = t('c.copied'); copyStatus.textContent = t('c.copiedsr'); }
      catch { copyBtn.textContent = t('c.copyfail'); copyStatus.textContent = t('c.copyfail'); }
      setTimeout(() => (copyBtn.textContent = t('c.copy')), 2000);
    });
  }

  /* ================= demo request form ================= */
  const status = $('#formStatus');
  const say = (msg, cls) => { status.textContent = msg; status.className = 'form__status ' + cls; };
  const validate = (input, errId, ok) => { const err = $(errId); input.setAttribute('aria-invalid', !ok); if (ok) input.removeAttribute('aria-describedby'); else input.setAttribute('aria-describedby', errId.slice(1)); err.hidden = ok; return ok; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = form.elements.name, m = form.elements.email, msg = form.elements.message;
    const okN = validate(n, '#e-name', n.value.trim().length > 1);
    const okM = validate(m, '#e-email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.value.trim()));
    if (!okN || !okM) { (okN ? m : n).focus(); say('', ''); return; }
    const data = { name: n.value.trim(), email: m.value.trim(), message: msg.value.trim(), lang };
    if (CFG.FORM_ENDPOINT.trim()) {
      const btn = $('button[type=submit]', form); btn.disabled = true; say(t('f.s.sending'), '');
      try {
        const r = await fetch(CFG.FORM_ENDPOINT.trim(), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
        if (!r.ok) throw new Error(r.status);
        form.reset(); say(t('f.s.ok'), 'is-ok');
      } catch { say(t('f.s.err'), 'is-err'); }
      btn.disabled = false; status.focus();
    } else if (email) {
      const body = `Name: ${data.name}\nEmail: ${data.email}\n\n${data.message}`;
      location.href = `mailto:${email}?subject=${encodeURIComponent(t('f.subject'))}&body=${encodeURIComponent(body)}`;
      say(t('f.s.mail'), 'is-ok'); status.focus();
    } else {
      say(t('f.s.none'), 'is-err'); status.focus();
    }
  });
  $$('input, textarea', form).forEach((el) => el.addEventListener('input', () => { if (el.getAttribute('aria-invalid') === 'true') { el.setAttribute('aria-invalid', 'false'); const er = $('#e-' + el.name); if (er) er.hidden = true; } }));

  /* ================= resize / fonts ================= */
  const remeasure = (() => { let id; return () => { clearTimeout(id); id = setTimeout(() => { needMeasure = true; if (!motion) measure(); }, 140); }; })();
  addEventListener('resize', remeasure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { needMeasure = true; if (!motion) measure(); });
  if ('ResizeObserver' in window) new ResizeObserver(remeasure).observe(document.body);
  if (!motion) measure();
  void dayTimer;
})();
