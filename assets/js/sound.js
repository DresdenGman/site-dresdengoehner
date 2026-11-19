/* Site music toggle.
 *
 * One typographic control injected into every page. The music (Dresden's own
 * marimba recording) is ON by default, within the browser's autoplay rules:
 * on load the page tries audio.play() straight away; if the browser blocks
 * it, the toggle shows SOUND ON · TAP ANYWHERE and the first user gesture
 * anywhere (pointerdown, keydown, touchend - never scroll or wheel, which do
 * not count as activation) starts it. The gesture itself is never swallowed.
 *
 * State rules:
 * - localStorage 'sound-off' ('1') is written when the visitor turns the
 *   music OFF and cleared when they turn it ON. While it is set the music is
 *   never started or armed on later pages or visits.
 * - sessionStorage 'dg-sound-done' ('1') is written when the piece has played
 *   to its end, so it is not restarted on every page of the same visit
 *   (cleared when the visitor turns it ON).
 * - sessionStorage 'dg-sound-t' keeps the playback position so the next page
 *   of the same visit resumes roughly where it was, when the server allows
 *   seeking; otherwise it starts from 0.
 * - The label always reflects actual playback: ON only while audio is really
 *   playing; ON-pending (hint shown) while waiting for the first gesture.
 *   (No pressed-state attribute: the switching aria-label already announces
 *   the action; the on state is carried visually by the button's is-on /
 *   is-pending classes and on <body> as sound-on / sound-pending.)
 * - The OFF control is always visible and keyboard-reachable (WCAG 1.4.2).
 */
(function () {
  'use strict';

  var scriptEl = document.currentScript ||
    document.querySelector('script[src*="sound.js"]');
  var audioBase = null;
  if (scriptEl && scriptEl.src) {
    try { audioBase = new URL('../audio/', scriptEl.src); } catch (e) { audioBase = null; }
  }

  var OFF_KEY = 'sound-off';
  var DONE_KEY = 'dg-sound-done';
  var T_KEY = 'dg-sound-t';
  var FADE_MS = 400;

  // Subtle UI tones on the homepage's "View the full record" links while
  // the music plays (see bindUiTones below). Set to false to remove the
  // feature completely.
  const UI_SOUNDS = true;

  // Small music-note glyphs that float up on detected beats while the music
  // plays (see the notes block below). Set to false to remove the feature
  // completely.
  const NOTES = true;

  /* ---------- control ---------- */

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sound-toggle';
  btn.setAttribute('aria-label', 'Play background audio');
  btn.title = 'Music: played by Dresden Goehner';

  // Line 1 is the state; the detail block (now-playing label, progress
  // line, elapsed time) is only visible while sound is on — sound.css
  // expands and collapses it off the button's is-on class. The whole
  // block is aria-hidden: the button's own label carries the action.
  var stateEl = document.createElement('span');
  stateEl.className = 'sound-state';
  var labelEl = document.createElement('span');
  labelEl.className = 'sound-label';
  labelEl.textContent = 'SOUND OFF';
  var hintEl = document.createElement('span');
  hintEl.className = 'sound-hint';
  hintEl.innerHTML = ' · TAP<span class="sound-hint-more"> ANYWHERE</span>';
  stateEl.appendChild(labelEl);
  stateEl.appendChild(hintEl);
  btn.appendChild(stateEl);

  var detailEl = document.createElement('span');
  detailEl.className = 'sound-detail';
  detailEl.setAttribute('aria-hidden', 'true');
  detailEl.innerHTML =
    '<span class="sound-np"><span class="sound-np-full">Marimba — played by Dresden Goehner</span>' +
    '<span class="sound-np-short">Marimba</span></span>' +
    '<span class="sound-bar"><span class="sound-bar-fill"></span></span>' +
    '<span class="sound-time">0:00 / 0:00</span>';
  btn.appendChild(detailEl);
  var fillEl = detailEl.querySelector('.sound-bar-fill');
  var timeEl = detailEl.querySelector('.sound-time');

  if (document.body) {
    document.body.appendChild(btn);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.appendChild(btn);
    });
  }

  /* ---------- playback state ---------- */

  var audio = null;          // created lazily on first use
  var isOn = false;          // the toggle intent, as displayed (ON or ON-pending)
  var pending = false;       // intent is ON but the browser has not allowed playback yet
  var armed = false;         // first-gesture listeners are installed
  var wantPlay = false;      // a start attempt is wanted / in flight
  var hasPlayed = false;     // playback actually started at least once
  var unavailable = false;   // both sources failed
  var triedFallback = false; // webm -> mp3 retry already used
  var fadeTimer = null;
  var fadeGen = 0;
  var playGen = 0;           // invalidates stale play() promise handlers

  function store(storage, key, value) {
    try {
      if (value === null) { storage.removeItem(key); }
      else { storage.setItem(key, value); }
    } catch (e) { /* private mode etc. — playback still works */ }
  }
  function read(storage, key) {
    try { return storage.getItem(key); } catch (e) { return null; }
  }

  var LABEL_ON = 'Mute background audio';
  var LABEL_OFF = 'Play background audio';
  var LABEL_PENDING = 'Mute background audio. Music starts on your first tap or key press.';

  function setUI(on) {
    pending = false;
    btn.classList.toggle('is-on', on);
    btn.classList.remove('is-pending');
    if (document.body) {
      document.body.classList.toggle('sound-on', on);
      document.body.classList.remove('sound-pending');
    }
    if (!unavailable) {
      btn.setAttribute('aria-label', on ? LABEL_ON : LABEL_OFF);
    }
    labelEl.textContent = on ? 'SOUND ON' : 'SOUND OFF';
  }

  // ON by default but not allowed to play yet: intent shown as ON with a
  // short hint, until the first gesture really starts the music.
  function setPending() {
    pending = true;
    isOn = true;
    btn.classList.remove('is-on');
    btn.classList.add('is-pending');
    if (document.body) {
      document.body.classList.remove('sound-on');
      document.body.classList.add('sound-pending');
    }
    if (!unavailable) { btn.setAttribute('aria-label', LABEL_PENDING); }
    labelEl.textContent = 'SOUND ON';
  }

  /* ---------- now-playing progress ---------- */

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) { s = 0; }
    s = Math.floor(s);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function updateProgress() {
    if (!audio) { return; }
    var d = audio.duration;
    var c = audio.currentTime || 0;
    var pct = (isFinite(d) && d > 0) ? Math.min(100, Math.max(0, (c / d) * 100)) : 0;
    fillEl.style.width = pct.toFixed(1) + '%';
    timeEl.textContent = fmtTime(c) + ' / ' + fmtTime(d);
    saveTime(c);
  }

  var lastSavedSec = -1;
  function saveTime(c) {
    var sec = Math.floor(c);
    if (sec === lastSavedSec || !(c > 0)) { return; }
    lastSavedSec = sec;
    store(sessionStorage, T_KEY, c.toFixed(1));
  }

  // Resume roughly where the previous page of this visit left off, only
  // when the server lets the browser seek there; otherwise start from 0.
  function restoreTime() {
    var t = parseFloat(read(sessionStorage, T_KEY));
    if (!(t > 1) || !audio) { return; }
    var d = audio.duration;
    if (!isFinite(d) || t > d - 4) { return; }
    try {
      if (audio.seekable && audio.seekable.length && audio.seekable.end(audio.seekable.length - 1) >= t) {
        audio.currentTime = t;
      }
    } catch (e) { /* start from 0 */ }
  }

  function resetProgress() {
    fillEl.style.width = '0%';
    timeEl.textContent = '0:00 / ' + fmtTime(audio ? audio.duration : NaN);
  }

  function fadeTo(target, ms, done) {
    if (!audio) { if (done) { done(); } return; }
    fadeGen += 1;
    var gen = fadeGen;
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    var start = audio.volume;
    var steps = Math.max(1, Math.round(ms / 25));
    var i = 0;
    fadeTimer = setInterval(function () {
      if (gen !== fadeGen) { return; }
      i += 1;
      var v = start + (target - start) * (i / steps);
      try { audio.volume = Math.min(1, Math.max(0, v)); } catch (e) { /* noop */ }
      if (i >= steps) {
        clearInterval(fadeTimer); fadeTimer = null;
        try { audio.volume = target; } catch (e) { /* noop */ }
        if (done) { done(); }
      }
    }, 25);
  }

  function pickSource() {
    if (!audio || !audioBase) { return null; }
    var opus = '';
    try { opus = audio.canPlayType('audio/webm; codecs=opus'); } catch (e) { opus = ''; }
    var file = (opus && opus !== 'no' && !triedFallback) ? 'dresden-marimba.webm' : 'dresden-marimba.mp3';
    return new URL(file, audioBase).href;
  }

  function ensureAudio() {
    if (audio || !audioBase) { return audio; }
    audio = new Audio();
    audio.loop = false;
    audio.volume = 0;
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('playing', function () { hasPlayed = true; });
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', function () { restoreTime(); updateProgress(); });
    var src = pickSource();
    if (src) {
      audio.src = src;
      audio.load();
    }
    return audio;
  }

  /* ---------- audio-reactive headline ----------
   *
   * Only the homepage's big headline rows (#lines) move with the music; every
   * other element on every page is static. While the music plays, an analyser
   * feeds a smoothed loudness value and an onset (beat) detector. Once per
   * animation frame, and only while the headline is in the viewport, the
   * result is written to CSS custom properties on #lines: --amp (loudness,
   * the block swell) and --b0..--b6 (the beat, staggered down the rows). The
   * visuals are in sound.css (standalone scale, per-row skew/scale). The beat
   * detector keeps running on every page (the music notes use it) but then
   * writes nothing. Sound off, or prefers-reduced-motion: the loop does not
   * run and nothing moves. The Web Audio graph is only built once the
   * context is really running, so the music itself can never be silenced by
   * it; if Web Audio is unavailable the music still plays, just without the
   * reaction. Beats are at least 380 ms apart, so nothing pulses faster than
   * 3 Hz (WCAG 2.3.1). */

  var heroEl = document.getElementById('lines');
  var gestured = false;      // a real user gesture has happened
  var actx = null;
  var analyser = null;
  var freqData = null;
  var prevData = null;
  var graphBuilt = false;
  var graphFailed = false;
  var rafId = null;
  var lastFrameT = 0;
  var heroVisible = true;    // #lines is in the viewport (IntersectionObserver)
  var ROWS = 7;

  // smoothed loudness 0..1
  var v = { amp: 0 };
  var written = -1;
  var peak = { amp: 0.12 };
  var fluxAvg = 0.01;
  var beats = [{ t: -1e9, s: 0 }, { t: -1e9, s: 0 }]; // newest first
  var BEAT_TAU = 230;        // ms, decay of a beat pulse
  var BEAT_GAP = 380;        // ms, minimum spacing between beats (< 3 Hz)
  var ROW_STAGGER = 45;      // ms between hero rows
  var rowWritten = [];

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function observeHero() {
    if (!heroEl || !('IntersectionObserver' in window)) {
      if (heroEl) { heroEl.classList.add('rx'); }
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      heroVisible = e.isIntersecting;
      heroEl.classList.toggle('rx', heroVisible);
    }, { rootMargin: '60px 0px' });
    io.observe(heroEl);
  }

  function buildGraph() {
    if (graphBuilt || graphFailed || !actx || !audio || actx.state !== 'running') { return; }
    var source = null;
    try {
      source = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.25;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      prevData = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);
      analyser.connect(actx.destination);
      graphBuilt = true;
      observeHero();
      startReactive();
    } catch (e) {
      // Once an element is captured by createMediaElementSource its sound
      // only reaches the speakers through the graph, so if a later step
      // failed, reconnect the source straight to the output.
      if (source && actx) {
        try { source.connect(actx.destination); } catch (e2) { /* noop */ }
      }
      analyser = null;
      freqData = null;
      graphFailed = true;
    }
  }

  // Create the context (only while a gesture has happened or audio is really
  // playing), resume it, and build the analysis graph once it is running.
  function ensureGraph() {
    if (graphBuilt || graphFailed || !audio || reducedMotion()) { return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { graphFailed = true; return; }
    try {
      if (!actx) { actx = new AC(); }
      if (actx.state === 'running') { buildGraph(); return; }
      var p = actx.resume();
      if (p && typeof p.then === 'function') {
        p.then(buildGraph, function () { /* stays suspended: audio plays without reaction */ });
      }
    } catch (e) {
      actx = null;
      graphFailed = true;
    }
  }

  function resumeContext() {
    if (actx && actx.state === 'suspended') {
      try {
        var p = actx.resume();
        if (p && typeof p.catch === 'function') { p.catch(function () { /* noop */ }); }
      } catch (e) { /* noop */ }
    }
  }

  function rowEnv(i, t) {
    var best = 0;
    for (var k = 0; k < beats.length; k++) {
      var dtb = t - beats[k].t - i * ROW_STAGGER;
      if (dtb >= 0) {
        var e = beats[k].s * Math.exp(-dtb / BEAT_TAU);
        if (e > best) { best = e; }
      }
    }
    return best;
  }

  function writeVars(t, force) {
    if (!heroEl || (!heroVisible && !force)) { return; }
    if (Math.abs(v.amp - written) >= 0.004 || (v.amp === 0 && written !== 0)) {
      written = v.amp;
      heroEl.style.setProperty('--amp', v.amp.toFixed(3));
    }
    for (var i = 0; i < ROWS; i++) {
      var e = rowEnv(i, t);
      if (e < 0.004) { e = 0; }
      if (rowWritten[i] === undefined || Math.abs(e - rowWritten[i]) >= 0.004 || (e === 0 && rowWritten[i] !== 0)) {
        rowWritten[i] = e;
        heroEl.style.setProperty('--b' + i, e.toFixed(3));
      }
    }
  }

  function startReactive() {
    if (!analyser || rafId !== null || reducedMotion()) { return; }
    lastFrameT = 0;
    rafId = requestAnimationFrame(reactiveFrame);
  }

  function smooth(cur, target, dt, up, down) {
    return cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? up : down)));
  }

  function bandAvg(lo, hi) {
    var sum = 0;
    for (var i = lo; i < hi; i++) { sum += freqData[i]; }
    return sum / ((hi - lo) * 255);
  }

  function norm(name, x) {
    // Slow automatic gain: scale to the recent peak so quiet and loud
    // recordings both use the 0..1 range. Only the upper part of that range
    // counts (below ~35% of the peak is rest) and it is curved, so steady
    // sound barely moves things while accents stand out clearly.
    if (x > peak[name]) { peak[name] = x; } else { peak[name] = Math.max(0.06, peak[name] * 0.9985); }
    var y = (x / peak[name] - 0.35) / 0.65;
    if (y <= 0) { return 0; }
    y = y > 1 ? 1 : y;
    return y * Math.sqrt(y);
  }

  /* ---------- music notes ----------
   *
   * On a detected beat (the same detector that drives the type, so at least
   * 380 ms apart) one or two small note glyphs (quarter, eighth, two beamed
   * eighths, two double-beamed) rise 60-120 px with a little drift and
   * rotation and fade out over 1.5-2.5 s. White / grey, now and then yellow.
   * They live in one aria-hidden, pointer-events:none layer that scrolls with the page, are drawn
   * as inline SVG (same on every platform), use pooled nodes (11 live + 1 chip note at
   * most, 3 + 1 on phones) and animate only transform and opacity with the Web
   * Animations API (compositor, no per-frame script). Positions are chosen
   * in free space: each candidate is checked against the rectangles of the
   * text on screen along the whole path of the note, so a note never crosses
   * body text. On a strong beat one note also rises from the sound chip.
   * Reduced motion never gets this far (the reactive loop does not run).
   * Off, pending, a hidden tab or a paused piece: no new notes, the live
   * ones are cleared. */

  var noteLayer = null;
  var notePool = [];
  var noteLive = 0;
  var noteFlip = 0;
  var NOTE_KINDS = ['n1', 'n2', 'n3', 'n4'];
  var NOTE_SYMBOLS =
    '<symbol id="dg-n1" viewBox="0 0 24 32"><ellipse cx="8" cy="25" rx="6.4" ry="4.5" transform="rotate(-22 8 25)"/><rect x="12.6" y="3" width="2" height="22.5"/></symbol>' +
    '<symbol id="dg-n2" viewBox="0 0 24 32"><ellipse cx="8" cy="25" rx="6.4" ry="4.5" transform="rotate(-22 8 25)"/><rect x="12.6" y="3" width="2" height="22.5"/><path d="M14.6 3 C15.2 11 22.5 13 21.4 22 C20.6 17.5 17.8 15.6 14.6 15.2Z"/></symbol>' +
    '<symbol id="dg-n3" viewBox="0 0 32 32"><ellipse cx="7" cy="26" rx="6" ry="4.2" transform="rotate(-22 7 26)"/><ellipse cx="24" cy="23" rx="6" ry="4.2" transform="rotate(-22 24 23)"/><rect x="11" y="7" width="2" height="19"/><rect x="28" y="4" width="2" height="19"/><path d="M11 7 L30 4 L30 9.6 L11 12.6Z"/></symbol>' +
    '<symbol id="dg-n4" viewBox="0 0 32 32"><ellipse cx="7" cy="26" rx="6" ry="4.2" transform="rotate(-22 7 26)"/><ellipse cx="24" cy="23" rx="6" ry="4.2" transform="rotate(-22 24 23)"/><rect x="11" y="5" width="2" height="21"/><rect x="28" y="2" width="2" height="21"/><path d="M11 5 L30 2 L30 7 L11 10Z"/><path d="M11 11.2 L30 8.2 L30 13.2 L11 16.2Z"/></symbol>';
  var NOTE_TEXT = 'h1,h2,h3,h4,p,li,blockquote,figcaption,dt,dd,td,th,label,a,button,.cap,.num b,.num span,.claim,.q,.ln .w,.big,.code,.lang';
  var NOTE_COLORS = ['#f4f1ea', '#f4f1ea', '#f4f1ea', '#b9b6af', '#8f8c86', '#f2e600'];

  function noteMax() {
    var small = false;
    try { small = window.matchMedia('(max-width: 480px)').matches; } catch (e) { small = false; }
    return small ? { live: 3, perBeat: 1, min: 14, max: 22 } : { live: 11, perBeat: 2, min: 20, max: 30 };
  }

  function ensureNoteLayer() {
    if (noteLayer) { return true; }
    if (!document.body || typeof Element.prototype.animate !== 'function') { return false; }
    noteLayer = document.createElement('div');
    noteLayer.className = 'dg-notes';
    noteLayer.setAttribute('aria-hidden', 'true');
    noteLayer.innerHTML = '<svg width="0" height="0" focusable="false" style="position:absolute">' + NOTE_SYMBOLS + '</svg>';
    document.body.appendChild(noteLayer);
    return true;
  }

  function takeNote() {
    for (var i = 0; i < notePool.length; i++) {
      if (!notePool[i].busy) { return notePool[i]; }
    }
    var el = document.createElement('div');
    el.className = 'dg-note';
    el.innerHTML = '<svg viewBox="0 0 24 32" focusable="false"><use href="#dg-n1"></use></svg>';
    noteLayer.appendChild(el);
    var rec = { el: el, use: el.firstChild.firstChild, svg: el.firstChild, anim: null, busy: false };
    notePool.push(rec);
    return rec;
  }

  // Rectangles of the text on screen (a little padded), read once per beat.
  function textRects() {
    var out = [];
    var vh = window.innerHeight || 800, vw = window.innerWidth || 1280;
    var nodes = document.querySelectorAll(NOTE_TEXT);
    var range = document.createRange();
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === btn || btn.contains(n) || (noteLayer && noteLayer.contains(n))) { continue; }
      var r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < -140 || r.top > vh + 140 || r.right < -40 || r.left > vw + 40) { continue; }
      // the tight box of the text itself, not of the (often full-width) block
      try {
        range.selectNodeContents(n);
        var t = range.getBoundingClientRect();
        if (t.width > 0 && t.height > 0) { r = t; }
      } catch (e) { /* use the element box */ }
      // the headline rows and big words swell on the beat: leave room for it
      var gx = 8, gy = 8;
      if (n.classList.contains('w') || n.classList.contains('big')) { gx += r.width * 0.05; gy += 12; }
      var disp = n.classList.contains('w') || n.classList.contains('big') || n.tagName === 'H1' || n.tagName === 'H2';
      out.push({ l: r.left - gx, t: r.top - gy, r: r.right + gx, b: r.bottom + gy, d: disp });
    }
    return out;
  }

  // 0 = blocked by body text; 1 = free; 2 = free of body text but it crosses
  // display type (the big headline words). Notes carry a thin dark outline, so
  // they stay readable over white letters; they are only sent there when the
  // free space has run out, and then half of them are yellow. The path is walked in 6 steps (about
  // 20 px apart, so the boxes overlap) and each box is tested against every
  // text rectangle.
  function pathFree(x, y, size, rise, drift, rects) {
    var crosses = false;
    for (var k = 0; k <= 5; k++) {
      var px = x + drift * k / 5 - 5, py = y - rise * k / 5 - 5, sz = size + 10;
      for (var i = 0; i < rects.length; i++) {
        var q = rects[i];
        if (px + sz > q.l && px < q.r && py + sz > q.t && py < q.b) {
          if (!q.d) { return 0; }
          crosses = true;
        }
      }
    }
    return crosses ? 2 : 1;
  }

  function launchNote(x, y, size, rise, drift, rects, allowCross) {
    var free = rects ? pathFree(x, y, size, rise, drift, rects) : 1;
    if (!free || (free === 2 && !allowCross)) { return false; }
    var rec = takeNote();
    rec.busy = true;
    noteLive += 1;
    var kind = NOTE_KINDS[Math.floor(Math.random() * NOTE_KINDS.length)];
    rec.use.setAttribute('href', '#dg-' + kind);
    rec.svg.setAttribute('viewBox', (kind === 'n3' || kind === 'n4') ? '0 0 32 32' : '0 0 24 32');
    rec.el.style.color = (free === 2 && Math.random() < 0.5) ? NOTE_COLORS[5] : NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    // Document coordinates: the note scrolls with the page, so text that
    // scrolls by never runs into it (the free space was checked at spawn).
    y += window.pageYOffset || 0;
    var k = size / 28;
    var r0 = (Math.random() * 28 - 14);
    var r1 = r0 + (drift >= 0 ? 1 : -1) * (10 + Math.random() * 16);
    var dur = 1500 + Math.random() * 1000;
    rec.el.classList.add('live');
    var a;
    try {
      a = rec.el.animate([
        { transform: 'translate(' + x + 'px,' + y + 'px) rotate(' + r0 + 'deg) scale(' + (k * 0.7) + ')', opacity: 0 },
        { transform: 'translate(' + (x + drift * 0.2) + 'px,' + (y - rise * 0.25) + 'px) rotate(' + (r0 + (r1 - r0) * 0.2) + 'deg) scale(' + k + ')', opacity: 0.95, offset: 0.14 },
        { transform: 'translate(' + (x + drift * 0.6) + 'px,' + (y - rise * 0.65) + 'px) rotate(' + (r0 + (r1 - r0) * 0.6) + 'deg) scale(' + k + ')', opacity: 0.8, offset: 0.55 },
        { transform: 'translate(' + (x + drift) + 'px,' + (y - rise) + 'px) rotate(' + r1 + 'deg) scale(' + (k * 0.95) + ')', opacity: 0 }
      ], { duration: dur, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'both' });
    } catch (e) { rec.busy = false; noteLive -= 1; rec.el.classList.remove('live'); return false; }
    rec.anim = a;
    a.onfinish = function () { releaseNote(rec); };
    return true;
  }

  function releaseNote(rec) {
    if (!rec.busy) { return; }
    rec.busy = false;
    noteLive = Math.max(0, noteLive - 1);
    if (rec.anim) { rec.anim.onfinish = null; try { rec.anim.cancel(); } catch (e) { /* noop */ } rec.anim = null; }
    rec.el.classList.remove('live');
  }

  function clearNotes() {
    for (var i = 0; i < notePool.length; i++) { releaseNote(notePool[i]); }
  }

  function spawnNotes(strength) {
    if (!NOTES || document.hidden || reducedMotion() || !ensureNoteLayer()) { return; }
    var cfg = noteMax();
    var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
    var rects = textRects();
    var want = 1 + (cfg.perBeat > 1 && Math.random() < 0.45 ? 1 : 0);
    var tries = 0;
    while (want > 0 && noteLive < cfg.live && tries < 24) {
      tries += 1;
      var size = cfg.min + Math.random() * (cfg.max - cfg.min);
      var rise = 60 + Math.random() * 60;
      var drift = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 20);
      // half the candidates hug the side margins, half roam the screen
      var x;
      if (Math.random() < 0.5) {
        var edge = Math.min(vw * 0.14, 150) * Math.random();
        x = Math.random() < 0.5 ? 4 + edge : vw - size - 4 - edge;
      } else {
        x = 8 + Math.random() * (vw - size - 16);
      }
      var y = vh * 0.14 + Math.random() * (vh * 0.78) + rise;
      if (y > vh - size - 6) { y = vh - size - 6; }
      if (x + drift < 10 || x + drift + size > vw - 10) { drift = -drift; }
      if (x + drift < 10 || x + drift + size > vw - 10) { continue; }
      // keep clear of the chip itself; the chip has its own note
      var cr = btn.getBoundingClientRect();
      if (x + size + drift > cr.left - 10 && x + drift < cr.right + 10 && y + size > cr.top - 130) { continue; }
      if (launchNote(x, y, size, rise, drift, rects, tries > 5)) { want -= 1; }
    }
    // strong beat: one note rises from the sound chip, the "it is playing" cue
    if (strength >= 0.85 && noteLive < cfg.live + 1) {
      var c = btn.getBoundingClientRect();
      var cs = cfg.min + Math.random() * 4;
      var cx = c.left + 6 + Math.random() * Math.max(10, c.width - cs - 12);
      noteFlip = -noteFlip || 1;
      var cd = noteFlip * (6 + Math.random() * 10);
      var cy = c.top - cs - 2;
      if (cx + cd > 10 && cx + cd + cs < vw - 10) { launchNote(cx, cy, cs, 56 + Math.random() * 30, cd, rects, true); }
    }
  }

  function reactiveFrame(t) {
    rafId = null;
    if (!analyser || !audio) { zeroAll(); return; }
    var dt = lastFrameT ? Math.min(100, t - lastFrameT) : 16;
    lastFrameT = t;
    var playing = !audio.paused && !audio.ended;
    if (!playing && noteLive) { clearNotes(); }
    var tAmp = 0;
    if (playing) {
      analyser.getByteFrequencyData(freqData);
      var hz = (actx && actx.sampleRate ? actx.sampleRate : 48000) / analyser.fftSize;
      var nb = freqData.length;
      var b3 = Math.min(nb, Math.max(4, Math.round(8000 / hz)));
      tAmp = norm('amp', bandAvg(1, b3));
      // Onset: positive spectral flux against its moving average.
      var flux = 0;
      for (var i = 2; i < b3; i++) {
        var d = freqData[i] - prevData[i];
        if (d > 0) { flux += d; }
        prevData[i] = freqData[i];
      }
      flux = flux / ((b3 - 2) * 255);
      if (flux > fluxAvg * 1.9 + 0.004 && t - beats[0].t > BEAT_GAP) {
        var s = Math.min(1, 0.6 + (flux / (fluxAvg * 1.9 + 0.004) - 1) * 0.25);
        beats[1] = beats[0];
        beats[0] = { t: t, s: s };
        if (NOTES && isOn && !pending) { spawnNotes(s); }
      }
      fluxAvg += (flux - fluxAvg) * (dt / 700);
    }
    // Attack fast, release musically; once playback stops (paused, ended,
    // hidden) everything eases back to rest and the loop stops.
    var up = 60, dn = playing ? 320 : 130;
    v.amp = smooth(v.amp, tAmp, dt, up, dn);
    if (!playing) {
      beats[0].s *= Math.exp(-dt / 90); beats[1].s *= Math.exp(-dt / 90);
    }
    var rest = v.amp + beats[0].s + beats[1].s;
    if (!playing && rest < 0.02) { zeroAll(); return; }
    writeVars(t);
    rafId = requestAnimationFrame(reactiveFrame);
  }

  function zeroAll() {
    v.amp = 0;
    beats[0] = { t: -1e9, s: 0 }; beats[1] = { t: -1e9, s: 0 };
    writeVars(performance.now(), true);
  }

  /* ---------- subtle UI tones (homepage detail links) ----------
   *
   * While the music is playing, hovering (fine pointer only) or
   * activating one of the homepage's "View the full record" links sounds
   * one very soft synthesized marimba-like tone through the shared
   * AudioContext, routed straight to the destination — never through
   * the analyser, so the headline does not react to it. Sound off means
   * no tones, and this feature never creates a context of its own: if
   * there is no shared context, it fails silently. Each link keeps its
   * own note from a pentatonic set, cycling through the links in page
   * order, and tones are throttled to one per 250 ms per link. */

  var TONE_NOTES = [523.25, 587.33, 659.25, 783.99, 880.00]; // C5 D5 E5 G5 A5

  function playTone(freq) {
    if (!actx) { return; }
    try {
      resumeContext();
      var t = actx.currentTime;
      // Wooden-mallet strike: near-instant attack, short decay (~300 ms).
      var out = actx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.03, t + 0.002);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      out.connect(actx.destination);
      // Marimba bar partials: fundamental, a quiet partial near 3.9x (the
      // tuned fourth-partial of the bar) and a very quiet, very short ~10x
      // click of the mallet. [ratio, level, decay seconds]
      var partials = [[1, 1, 0.3], [3.9, 0.2, 0.12], [10, 0.05, 0.04]];
      for (var i = 0; i < partials.length; i++) {
        var osc = actx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * partials[i][0];
        var og = actx.createGain();
        og.gain.setValueAtTime(partials[i][1], t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + partials[i][2]);
        osc.connect(og);
        og.connect(out);
        osc.start(t);
        osc.stop(t + 0.35);
      }
    } catch (e) { /* fail silently */ }
  }

  function bindUiTones() {
    if (!UI_SOUNDS) { return; }
    var finePointer = false;
    try { finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches; }
    catch (e) { finePointer = false; }
    var links = document.querySelectorAll('a.go');
    var picked = [];
    for (var i = 0; i < links.length; i++) {
      var label = (links[i].textContent || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (label.indexOf('View the full record') === 0) { picked.push(links[i]); }
    }
    for (var j = 0; j < picked.length; j++) {
      (function (el, idx) {
        var last = 0;
        function ring() {
          if (!isOn || !audio || audio.paused || audio.ended || !actx) { return; }
          var now = Date.now();
          if (now - last < 250) { return; }
          last = now;
          playTone(TONE_NOTES[idx % TONE_NOTES.length]);
        }
        if (finePointer) { el.addEventListener('mouseenter', ring); }
        el.addEventListener('click', ring);
      })(picked[j], j);
    }
  }

  function onEnded() {
    // The piece finished: back to off, but this is not a preference for
    // silence. It is not restarted on the other pages of this visit; a click
    // on the toggle plays it again from the start.
    isOn = false;
    wantPlay = false;
    playGen += 1;
    disarm();
    if (audio) { try { audio.volume = 0; } catch (e) { /* noop */ } }
    store(sessionStorage, DONE_KEY, '1');
    store(sessionStorage, T_KEY, null);
    lastSavedSec = -1;
    setUI(false);
    resetProgress();
  }

  function onError() {
    if (hasPlayed) {
      // Playback had started; a later stream error is not a load failure.
      // Stop honestly without declaring the music unavailable.
      isOn = false;
      wantPlay = false;
      playGen += 1;
      disarm();
      setUI(false);
      return;
    }
    if (audio && !triedFallback && /\.webm($|\?)/.test(audio.src || '')) {
      // The Opus file failed; try the MP3 once before giving up.
      triedFallback = true;
      var src = pickSource();
      if (src) {
        audio.src = src;
        audio.load();
        if (wantPlay) { startPlayback(lastStartOpts); }
        return;
      }
    }
    unavailable = true;
    isOn = false;
    wantPlay = false;
    playGen += 1;
    disarm();
    pending = false;
    btn.classList.remove('is-on');
    btn.classList.remove('is-pending');
    if (document.body) {
      document.body.classList.remove('sound-on');
      document.body.classList.remove('sound-pending');
    }
    btn.setAttribute('aria-label', 'Site music unavailable');
    labelEl.textContent = 'SOUND OFF';
  }

  /* ---------- start / first-gesture arming ---------- */

  var GESTURES = ['pointerdown', 'keydown', 'touchend'];

  function onGesture(e) {
    if (!pending) { disarm(); return; }
    // The toggle itself handles its own click (a press on it means OFF).
    if (e && e.target && btn.contains(e.target)) { return; }
    gestured = true;
    // Not swallowed: nothing is prevented or stopped, links still navigate.
    startPlayback({ gesture: true });
  }

  function armGesture() {
    if (armed) { return; }
    armed = true;
    for (var i = 0; i < GESTURES.length; i++) {
      document.addEventListener(GESTURES[i], onGesture, { capture: true, passive: true });
    }
  }

  function disarm() {
    if (!armed) { return; }
    armed = false;
    for (var i = 0; i < GESTURES.length; i++) {
      document.removeEventListener(GESTURES[i], onGesture, { capture: true });
    }
  }

  // opts.auto: page-load attempt (a block leaves the toggle ON-pending and
  // arms the first-gesture listeners); opts.gesture: started by a real
  // gesture (a rejection keeps waiting, e.g. pointerdown before touchend).
  var lastStartOpts = null;
  function startPlayback(opts) {
    opts = opts || {};
    lastStartOpts = opts;
    if (!ensureAudio()) { setUI(false); return; }
    if (gestured) { ensureGraph(); }
    resumeContext();
    wantPlay = true;
    playGen += 1;
    var gen = playGen;
    if (audio.ended) {
      try { audio.currentTime = 0; } catch (e) { /* noop */ }
    }
    var result;
    try { result = audio.play(); } catch (e) { result = null; }
    function started() {
      disarm();
      isOn = true;
      setUI(true);
      updateProgress();
      fadeTo(1, FADE_MS);
      if (!graphBuilt) { ensureGraph(); }
      startReactive();
    }
    function blocked() {
      if (opts.auto || opts.gesture) {
        // Not allowed (yet): stay ON-pending and wait for a real gesture.
        wantPlay = false;
        setPending();
        armGesture();
      } else {
        // Blocked or interrupted: stay honestly off.
        wantPlay = false;
        isOn = false;
        setUI(false);
      }
    }
    if (result && typeof result.then === 'function') {
      result.then(function () {
        if (gen !== playGen || !wantPlay) { return; }
        started();
      }).catch(function () {
        if (gen !== playGen) { return; }
        blocked();
      });
    } else {
      started();
    }
  }

  function stopPlayback() {
    wantPlay = false;
    playGen += 1;
    if (!audio) { isOn = false; setUI(false); return; }
    fadeTo(0, FADE_MS, function () {
      // Pause only if the user has not turned it back on meanwhile.
      if (!isOn && audio) { audio.pause(); }
    });
  }

  /* ---------- events ---------- */

  btn.addEventListener('click', function () {
    if (unavailable) { return; }
    gestured = true;
    if (audio) { ensureGraph(); resumeContext(); }
    if (isOn || pending) {
      // ON (playing) or ON-pending -> OFF, and remember it.
      isOn = false;
      store(localStorage, OFF_KEY, '1');
      disarm();
      setUI(false);
      stopPlayback();
    } else {
      isOn = true;
      store(localStorage, OFF_KEY, null);
      store(sessionStorage, DONE_KEY, null);
      startPlayback(); // resolves the UI to the true state
      if (!audio) { isOn = false; setUI(false); }
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (audio && audio.currentTime > 0) { store(sessionStorage, T_KEY, audio.currentTime.toFixed(1)); }
    if (!audio) { return; }
    if (document.hidden) {
      clearNotes();
      if (isOn && !audio.paused && !audio.ended) {
        // A pause, not a user-off: the toggle stays ON. Hidden tabs throttle
        // or suspend timers, so a timed fade could leave the sound playing:
        // silence and pause immediately instead.
        fadeGen += 1;
        if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
        try { audio.volume = 0; } catch (e) { /* noop */ }
        audio.pause();
      }
    } else if (isOn && !pending && audio.paused && !audio.ended) {
      // Back to the tab with the toggle still on: continue the piece.
      wantPlay = true;
      resumeContext();
      var result;
      try { result = audio.play(); } catch (e) { result = null; }
      if (result && typeof result.then === 'function') {
        result.then(function () { if (isOn) { fadeTo(1, FADE_MS); startReactive(); } })
          .catch(function () { wantPlay = false; isOn = false; setUI(false); });
      } else {
        fadeTo(1, FADE_MS);
        startReactive();
      }
    }
  });

  window.addEventListener('pagehide', function () {
    if (audio && audio.currentTime > 0 && !audio.ended) {
      store(sessionStorage, T_KEY, audio.currentTime.toFixed(1));
    }
  });

  bindUiTones();

  /* ---------- on by default ---------- */

  // Footer note next to the credit: the music starts with the page and the
  // OFF control stops it.
  (function addCreditNotes() {
    var credits = document.querySelectorAll('.sound-credit');
    for (var i = 0; i < credits.length; i++) {
      var note = document.createElement(credits[i].tagName.toLowerCase());
      note.className = credits[i].className.replace('sound-credit', 'sound-credit-note');
      note.textContent = 'Plays automatically · SOUND OFF stops it';
      credits[i].insertAdjacentElement('afterend', note);
    }
  })();

  if (read(localStorage, OFF_KEY) !== '1' && read(sessionStorage, DONE_KEY) !== '1') {
    // Try straight away (it succeeds where the site has media engagement or
    // after a gesture on the previous page); otherwise wait for the first
    // gesture. Nothing is created for Web Audio until the audio is allowed.
    setPending();
    startPlayback({ auto: true });
  }
})();
