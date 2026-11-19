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

  /* ---------- audio-reactive type ----------
   *
   * While the music plays, an analyser feeds a few smoothed bands (bass,
   * low-mid, high) and an onset (beat) detector. Once per animation frame
   * the result is written to CSS custom properties on the in-view elements (--amp, --bass,
   * --mid, --high, --beat) and, for the hero rows, --b0..--b6 on #lines (the
   * same beat, staggered down the rows). All visuals are done in sound.css,
   * only on elements currently in the viewport (they carry the .rx class),
   * with transform-like properties. Sound off, or prefers-reduced-motion:
   * the variables are never set and nothing moves. The Web Audio graph is
   * only built once the context is really running, so the music itself can
   * never be silenced by it; if Web Audio is unavailable the music still
   * plays, just without the reaction. Beats are at least 380 ms apart, so
   * nothing pulses faster than 3 Hz (WCAG 2.3.1). */

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
  var RX_SELECTORS = [
    '#lines', '.hero-foot .claim', '.hero-foot .q', '.label', '.ex .big', '.ex .tag .no',
    '.wall h3', '.wall p', '.wall .med', '.ex figcaption', '.sub', '.num b', '.num span',
    '.ev-note', '.quote blockquote', '.item h4', '.item p', '.drawer-note', 'footer .sig',
    '.inst .mark', 'header.page h1', 'header.page .lede', 'section h2', 'section .kicker'
  ].join(',');
  var rxObserver = null;
  var rxEls = [];   // elements currently in view; the variables are written on these only
  var VAR_NAMES = ['amp', 'bass', 'mid', 'high', 'beat'];
  var ROWS = 7;

  // smoothed 0..1 values and beat state
  var v = { amp: 0, bass: 0, mid: 0, high: 0, beat: 0 };
  var written = { amp: -1, bass: -1, mid: -1, high: -1, beat: -1 };
  var peak = { amp: 0.12, bass: 0.12, mid: 0.12, high: 0.12 };
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

  function observeTargets() {
    if (rxObserver || !('IntersectionObserver' in window)) { return; }
    rxObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var el = entries[i].target;
        var at = rxEls.indexOf(el);
        if (entries[i].isIntersecting) {
          if (at < 0) {
            rxEls.push(el);
            el.classList.add('rx');
            // start from the current values, not from rest
            for (var n = 0; n < VAR_NAMES.length; n++) {
              if (written[VAR_NAMES[n]] > 0) { el.style.setProperty('--' + VAR_NAMES[n], written[VAR_NAMES[n]].toFixed(3)); }
            }
          }
        } else if (at >= 0) {
          rxEls.splice(at, 1);
          el.classList.remove('rx');
          for (var m = 0; m < VAR_NAMES.length; m++) { el.style.removeProperty('--' + VAR_NAMES[m]); }
        }
      }
    }, { rootMargin: '60px 0px' });
    var nodes = document.querySelectorAll(RX_SELECTORS);
    for (var j = 0; j < nodes.length; j++) { rxObserver.observe(nodes[j]); }
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
      observeTargets();
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

  function setVar(name, val) {
    if (Math.abs(val - written[name]) < 0.004 && !(val === 0 && written[name] !== 0)) { return; }
    written[name] = val;
    // Written on the in-view elements only (not :root), so the browser
    // restyles a handful of nodes per frame instead of the whole document.
    var str = val.toFixed(3);
    for (var i = 0; i < rxEls.length; i++) { rxEls[i].style.setProperty('--' + name, str); }
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

  function writeVars(t) {
    setVar('amp', v.amp);
    setVar('bass', v.bass);
    setVar('mid', v.mid);
    setVar('high', v.high);
    setVar('beat', v.beat);
    if (heroEl) {
      for (var i = 0; i < ROWS; i++) {
        var e = rowEnv(i, t);
        if (e < 0.004) { e = 0; }
        if (rowWritten[i] === undefined || Math.abs(e - rowWritten[i]) >= 0.004 || (e === 0 && rowWritten[i] !== 0)) {
          rowWritten[i] = e;
          heroEl.style.setProperty('--b' + i, e.toFixed(3));
        }
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

  function reactiveFrame(t) {
    rafId = null;
    if (!analyser || !audio) { zeroAll(); return; }
    var dt = lastFrameT ? Math.min(100, t - lastFrameT) : 16;
    lastFrameT = t;
    var playing = !audio.paused && !audio.ended;
    var tAmp = 0, tBass = 0, tMid = 0, tHigh = 0;
    if (playing) {
      analyser.getByteFrequencyData(freqData);
      var hz = (actx && actx.sampleRate ? actx.sampleRate : 48000) / analyser.fftSize;
      var nb = freqData.length;
      var b1 = Math.max(2, Math.round(400 / hz));
      var b2 = Math.max(b1 + 1, Math.round(2000 / hz));
      var b3 = Math.min(nb, Math.max(b2 + 1, Math.round(8000 / hz)));
      tBass = norm('bass', bandAvg(1, b1));
      tMid = norm('mid', bandAvg(b1, b2));
      tHigh = norm('high', bandAvg(b2, b3));
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
        if (s > v.beat) { v.beat = s; }
      }
      fluxAvg += (flux - fluxAvg) * (dt / 700);
    }
    // Attack fast, release musically; once playback stops (paused, ended,
    // hidden) everything eases back to rest and the loop stops.
    var up = 60, dn = playing ? 320 : 130;
    v.amp = smooth(v.amp, tAmp, dt, up, dn);
    v.bass = smooth(v.bass, tBass, dt, up, dn);
    v.mid = smooth(v.mid, tMid, dt, up, dn);
    v.high = smooth(v.high, tHigh, dt, up, dn);
    v.beat = v.beat * Math.exp(-dt / (playing ? BEAT_TAU : 90));
    if (!playing) {
      beats[0].s *= Math.exp(-dt / 90); beats[1].s *= Math.exp(-dt / 90);
    }
    var rest = v.amp + v.bass + v.mid + v.high + v.beat;
    if (!playing && rest < 0.02) { zeroAll(); return; }
    writeVars(t);
    rafId = requestAnimationFrame(reactiveFrame);
  }

  function zeroAll() {
    v.amp = v.bass = v.mid = v.high = v.beat = 0;
    beats[0] = { t: -1e9, s: 0 }; beats[1] = { t: -1e9, s: 0 };
    writeVars(performance.now());
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
