/* Dresden Goehner — v4 interaction layer.
   Progressive enhancement only: without JS the page is complete,
   every number shows its final value, every block is visible. */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- scroll-triggered reveals ---- */
  var rvEls = document.querySelectorAll(".rv");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    rvEls.forEach(function (el) { io.observe(el); });
  } else {
    rvEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---- Kaggle band: lines resolve on entry ---- */
  var band = document.querySelector(".score-band");
  if (band) {
    if ("IntersectionObserver" in window && !reduced) {
      var bio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { band.classList.add("in"); bio.disconnect(); }
        });
      }, { threshold: 0.35 });
      bio.observe(band);
    } else { band.classList.add("in"); }
  }

  /* ---- evidence strip: count-up to the exact printed values ---- */
  document.querySelectorAll(".evidence-num").forEach(function (el) {
    var m = el.textContent.trim().match(/^([\d,]+)(.*)$/);
    if (!m || reduced || !("IntersectionObserver" in window)) return;
    var target = parseInt(m[1].replace(/,/g, ""), 10), suffix = m[2];
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        cio.disconnect();
        var t0 = null, dur = 950;
        function step(t) {
          if (!t0) t0 = t;
          var p = Math.min((t - t0) / dur, 1), ease = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * ease).toLocaleString("en-US") + suffix;
          if (p < 1) requestAnimationFrame(step);
          else el.textContent = m[1] + suffix; /* land exactly on the printed value */
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.4 });
    cio.observe(el);
  });

  /* ---- instrument rail: chapter readout (scrollspy) ---- */
  var railNow = document.getElementById("railNow");
  var railTot = document.getElementById("railTot");
  var chapters = Array.prototype.slice.call(
    document.querySelectorAll("main > section[id], main > section.hero"));
  if (railNow && chapters.length) {
    if (railTot) railTot.textContent = String(chapters.length).padStart(2, "0");
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var i = chapters.indexOf(e.target);
          if (i >= 0) railNow.textContent = String(i + 1).padStart(2, "0");
        }
      });
    }, { rootMargin: "-38% 0px -55% 0px" });
    chapters.forEach(function (s) { spy.observe(s); });
  }

  /* ---- index rows: plate preview follows the cursor (fine pointers only) ---- */
  if (window.matchMedia("(pointer: fine)").matches && !reduced) {
    var items = document.querySelectorAll(".index-item[data-plate]");
    if (items.length) {
      var pv = document.createElement("img");
      pv.id = "platePreview"; pv.alt = "";
      document.body.appendChild(pv);
      var x = 0, y = 0, raf = null;
      function move() {
        pv.style.transform = "translate(" + (x + 24) + "px," + (y - 95) + "px)";
        raf = null;
      }
      document.addEventListener("mousemove", function (e) {
        x = e.clientX; y = e.clientY;
        if (!raf) raf = requestAnimationFrame(move);
      });
      items.forEach(function (it) {
        it.addEventListener("mouseenter", function () {
          pv.src = it.getAttribute("data-plate");
          pv.classList.add("on");
        });
        it.addEventListener("mouseleave", function () { pv.classList.remove("on"); });
      });
    }
  }
})();
