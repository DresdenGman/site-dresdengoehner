/* Site music toggle.
 *
 * One typographic control, off by default, injected into every page.
 * Playback uses the native Audio API. The recording is Dresden's own piano
 * playing; it is never fetched until the first click that turns sound on,
 * it never autoplays on a fresh visit, and it plays once (no loop).
 *
 * State rules:
 * - localStorage 'dg-sound-pref' ('on' | 'off') is written only when the
 *   user toggles the control.
 * - sessionStorage 'dg-sound-armed' ('1') is written only after a play()
 *   call in this tab has actually started. Same-tab navigation may then
 *   attempt to continue playback; a new tab always starts silent.
 * - The label always reflects actual playback, never the stored
 *   preference. (No pressed-state attribute: the switching Play/Mute
 *   aria-label already announces the action; the on state is carried
 *   visually by the button's is-on class and on <body> as sound-on.)
 */
(function () {
  'use strict';

  var scriptEl = document.currentScript ||
    document.querySelector('script[src*="sound.js"]');
  var audioBase = null;
  if (scriptEl && scriptEl.src) {
    try { audioBase = new URL('../audio/', scriptEl.src); } catch (e) { audioBase = null; }
  }

  var PREF_KEY = 'dg-sound-pref';
  var ARMED_KEY = 'dg-sound-armed';
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
  stateEl.textContent = 'SOUND OFF';
  btn.appendChild(stateEl);

  var detailEl = document.createElement('span');
  detailEl.className = 'sound-detail';
  detailEl.setAttribute('aria-hidden', 'true');
  detailEl.innerHTML =
    '<span class="sound-np"><span class="sound-np-full">Piano — played by Dresden Goehner</span>' +
    '<span class="sound-np-short">Piano</span></span>' +
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
  var isOn = false;          // the user's toggle intent, as displayed
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

  function setUI(on) {
    btn.classList.toggle('is-on', on);
    if (document.body) { document.body.classList.toggle('sound-on', on); }
    if (!unavailable) {
      btn.setAttribute('aria-label', on ? 'Mute background audio' : 'Play background audio');
    }
    stateEl.textContent = on ? 'SOUND ON' : 'SOUND OFF';
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
    var file = (opus && opus !== 'no' && !triedFallback) ? 'dresden-piano.webm' : 'dresden-piano.mp3';
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
    audio.addEventListener('loadedmetadata', updateProgress);
    var src = pickSource();
    if (src) {
      audio.src = src;
      audio.load();
    }
    return audio;
  }

  /* ---------- audio-reactive hero headline (homepage only) ----------
   *
   * When the music plays, the hero kinetic headline (#lines) breathes with
   * it: the analyser level drives one CSS custom property, --amp, and
   * sound.css maps it to a subtle scale. Sound off = --amp is never set =
   * the page is exactly as it was. The AudioContext is created on the
   * first user click, never before; if Web Audio is unavailable the music
   * still plays, just without the reaction. Under prefers-reduced-motion
   * nothing is animated. */

  var heroEl = document.getElementById('lines');
  var gestured = false;      // a real click on the toggle has happened
  var actx = null;
  var analyser = null;
  var freqData = null;
  var graphFailed = false;
  var amp = 0;
  var rafId = null;
  var lastFrameT = 0;

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function initGraph() {
    if (!heroEl || actx || graphFailed || !audio || reducedMotion()) { return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { graphFailed = true; return; }
    var source = null;
    try {
      actx = new AC();
      source = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);
      analyser.connect(actx.destination);
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

  function resumeContext() {
    if (actx && actx.state === 'suspended') {
      try {
        var p = actx.resume();
        if (p && typeof p.catch === 'function') { p.catch(function () { /* noop */ }); }
      } catch (e) { /* noop */ }
    }
  }

  function setAmp(v) {
    if (heroEl) { heroEl.style.setProperty('--amp', v.toFixed(3)); }
  }

  function startReactive() {
    if (!heroEl || !analyser || rafId !== null || reducedMotion()) { return; }
    lastFrameT = 0;
    rafId = requestAnimationFrame(reactiveFrame);
  }

  function reactiveFrame(t) {
    rafId = null;
    if (!analyser || !audio) { amp = 0; setAmp(0); return; }
    var dt = lastFrameT ? Math.min(100, t - lastFrameT) : 16;
    lastFrameT = t;
    var playing = !audio.paused && !audio.ended;
    var target = 0;
    if (playing) {
      analyser.getByteFrequencyData(freqData);
      // Low-mid energy: bins 2..39 of 128 (bin width is sampleRate/256,
      // so at 48 kHz this averages roughly 375 Hz to 7.3 kHz, where the
      // piano's energy concentrates).
      var sum = 0;
      var hi = Math.min(freqData.length, 40);
      for (var i = 2; i < hi; i++) { sum += freqData[i]; }
      var level = (sum / (hi - 2)) / 255;
      level = (level - 0.06) / 0.94; // noise floor: quiet passages rest
      target = Math.max(0, Math.min(1, level * 1.6));
    }
    // Attack ~80 ms, musical release ~400 ms; once playback has stopped
    // (paused, ended, hidden) decay faster so --amp is back at rest within
    // about 500 ms and the loop can stop.
    var tau = !playing ? 120 : (target > amp ? 80 : 400);
    amp += (target - amp) * (1 - Math.exp(-dt / tau));
    if (!playing && amp < 0.005) {
      // Paused, ended or hidden and fully decayed: park at 0, stop the loop.
      amp = 0;
      setAmp(0);
      return;
    }
    setAmp(amp);
    rafId = requestAnimationFrame(reactiveFrame);
  }

  /* ---------- subtle UI tones (homepage detail links) ----------
   *
   * While the music is playing, hovering (fine pointer only) or
   * activating one of the homepage's "View the full record" links sounds
   * one very soft synthesized piano-like tone through the shared
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
      var out = actx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.03, t + 0.005);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      out.connect(actx.destination);
      var partials = [[1, 1], [2, 0.35]]; // fundamental + quiet 2nd harmonic
      for (var i = 0; i < partials.length; i++) {
        var osc = actx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * partials[i][0];
        var og = actx.createGain();
        og.gain.value = partials[i][1];
        osc.connect(og);
        og.connect(out);
        osc.start(t);
        osc.stop(t + 0.6);
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
    // The piece finished: back to off, but this is not a user preference,
    // so localStorage is not written. A later click restarts from 0.
    isOn = false;
    wantPlay = false;
    playGen += 1;
    if (audio) { try { audio.volume = 0; } catch (e) { /* noop */ } }
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
        if (wantPlay) { startPlayback(); }
        return;
      }
    }
    unavailable = true;
    isOn = false;
    wantPlay = false;
    playGen += 1;
    btn.classList.remove('is-on');
    if (document.body) { document.body.classList.remove('sound-on'); }
    btn.setAttribute('aria-label', 'Site music unavailable');
    stateEl.textContent = 'SOUND OFF';
  }

  function startPlayback() {
    if (!ensureAudio()) { setUI(false); return; }
    if (gestured) { initGraph(); }
    resumeContext();
    wantPlay = true;
    playGen += 1;
    var gen = playGen;
    if (audio.ended) {
      try { audio.currentTime = 0; } catch (e) { /* noop */ }
    }
    var result;
    try { result = audio.play(); } catch (e) { result = null; }
    if (result && typeof result.then === 'function') {
      result.then(function () {
        if (gen !== playGen || !wantPlay) { return; }
        store(sessionStorage, ARMED_KEY, '1');
        isOn = true;
        setUI(true);
        updateProgress();
        fadeTo(1, FADE_MS);
        startReactive();
      }).catch(function () {
        if (gen !== playGen) { return; }
        // Blocked or interrupted: stay honestly off.
        wantPlay = false;
        isOn = false;
        setUI(false);
      });
    } else {
      store(sessionStorage, ARMED_KEY, '1');
      isOn = true;
      setUI(true);
      updateProgress();
      fadeTo(1, FADE_MS);
      startReactive();
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
    if (audio) { initGraph(); resumeContext(); }
    if (isOn) {
      isOn = false;
      store(localStorage, PREF_KEY, 'off');
      setUI(false);
      stopPlayback();
    } else {
      isOn = true;
      store(localStorage, PREF_KEY, 'on');
      startPlayback(); // resolves the UI to the true state
      if (!audio) { isOn = false; setUI(false); }
    }
  });

  document.addEventListener('visibilitychange', function () {
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
    } else if (isOn && audio.paused && !audio.ended) {
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

  bindUiTones();

  /* ---------- same-tab continuation (never a fresh-visit autoplay) ---------- */

  if (read(localStorage, PREF_KEY) === 'on' && read(sessionStorage, ARMED_KEY) === '1') {
    startPlayback(); // if the browser blocks it, the control stays OFF
  }
})();
