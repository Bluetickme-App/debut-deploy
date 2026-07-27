/* DebutDeploy public site — shared behaviour.
 *
 * Replaces the reactive bits of the Claude Design source (`sc-if`, `onClick`,
 * state) with progressive enhancement over static HTML, so every page renders
 * its content without JS and only the interactions need it.
 *
 * Hooks, all opt-in per page:
 *   [data-shrink-nav]                 sticky header shrinks past 24px scroll
 *   [data-menu="platform|compare"]    dropdown trigger + [data-menu-panel]
 *   [data-nav-toggle] / [data-mobile-nav]
 *   [data-currency] / [data-cur="usd|gbp"]   currency switch
 *   [data-usd="45"]                   price span rewritten on switch
 *   [data-cur-note="usd|gbp"]         note paragraph shown per currency
 *   [data-accordion] > [data-q]       FAQ disclosure
 *   [data-steps] / [data-step="1"]    deploy walkthrough tabs
 *   [data-rail] + [data-rail-prev/next]      showcase carousel
 *   [data-case="0"] / [data-case-panel]      showcase detail panel
 */
(function () {
  'use strict';

  var GBP_RATE = 0.79;

  var DD = window.DD = window.DD || {};
  DD.currency = 'usd';
  DD.money = function (usd) {
    var n = Number(usd) || 0;
    return DD.currency === 'gbp' ? '£' + Math.round(n * GBP_RATE) : '$' + Math.round(n);
  };

  function qa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /* ---------- sticky header ---------- */
  function stickyNav() {
    var bar = document.querySelector('[data-shrink-nav]');
    if (!bar) return;
    var header = bar.closest('header');
    function onScroll() {
      var on = window.scrollY > 24;
      bar.style.height = on ? '60px' : '72px';
      if (header) header.style.borderBottomColor = on ? '#e5e8ee' : 'transparent';
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- header menus ---------- */
  function menus() {
    var open = null;
    function setOpen(name) {
      open = name;
      qa('[data-menu-panel]').forEach(function (p) {
        p.style.display = p.getAttribute('data-menu-panel') === name ? 'block' : 'none';
      });
      qa('[data-menu]').forEach(function (b) {
        b.setAttribute('aria-expanded', b.getAttribute('data-menu') === name ? 'true' : 'false');
      });
      var mob = document.querySelector('[data-mobile-nav]');
      var tog = document.querySelector('[data-nav-toggle]');
      if (mob) mob.style.display = name === 'mobile' ? 'block' : 'none';
      if (tog) {
        tog.textContent = name === 'mobile' ? '✕' : '☰';
        tog.setAttribute('aria-expanded', name === 'mobile' ? 'true' : 'false');
      }
    }

    qa('[data-menu]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var name = btn.getAttribute('data-menu');
        setOpen(open === name ? null : name);
      });
    });
    var toggle = document.querySelector('[data-nav-toggle]');
    if (toggle) {
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        setOpen(open === 'mobile' ? null : 'mobile');
      });
    }
    qa('[data-mobile-nav] a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(null); });
    });
    document.addEventListener('click', function () { if (open) setOpen(null); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) setOpen(null);
    });
    setOpen(null);
  }

  /* ---------- currency ---------- */
  function currency() {
    var buttons = qa('[data-cur]');
    if (!buttons.length) return;

    function paint() {
      buttons.forEach(function (b) {
        var on = b.getAttribute('data-cur') === DD.currency;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.style.background = on ? '#0b0d12' : 'transparent';
        b.style.color = on ? '#fff' : '#4d5661';
      });
      qa('[data-usd]').forEach(function (el) {
        el.textContent = DD.money(el.getAttribute('data-usd'));
      });
      qa('[data-cur-note]').forEach(function (el) {
        el.style.display = el.getAttribute('data-cur-note') === DD.currency ? 'block' : 'none';
      });
      document.dispatchEvent(new CustomEvent('dd:currency', { detail: DD.currency }));
    }

    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        DD.currency = b.getAttribute('data-cur');
        paint();
      });
    });
    paint();
  }

  /* ---------- FAQ accordions ---------- */
  function accordions() {
    qa('[data-accordion]').forEach(function (group) {
      var items = qa('[data-q]', group);
      items.forEach(function (item, i) {
        var btn = item.querySelector('button');
        var body = item.querySelector('[data-a]');
        var sign = item.querySelector('[data-sign]');
        if (!btn || !body) return;

        function set(on) {
          btn.setAttribute('aria-expanded', on ? 'true' : 'false');
          body.style.display = on ? 'block' : 'none';
          if (sign) sign.textContent = on ? '−' : '+';
        }
        set(i === 0 && group.hasAttribute('data-open-first'));
        btn.addEventListener('click', function () {
          var willOpen = btn.getAttribute('aria-expanded') !== 'true';
          items.forEach(function (other) {
            var ob = other.querySelector('button');
            var od = other.querySelector('[data-a]');
            var os = other.querySelector('[data-sign]');
            if (!ob || !od) return;
            ob.setAttribute('aria-expanded', 'false');
            od.style.display = 'none';
            if (os) os.textContent = '+';
          });
          if (willOpen) set(true);
        });
      });
    });
  }

  /* ---------- deploy walkthrough ---------- */
  function steps() {
    var group = document.querySelector('[data-steps]');
    if (!group) return;
    var tabs = qa('[data-step]', group);
    var panels = qa('[data-step-panel]');
    var crumb = document.querySelector('[data-step-crumb]');

    function select(n) {
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-step') === n;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.style.background = on ? '#ffffff' : 'transparent';
        t.style.borderColor = on ? '#c9d4e8' : '#e5e8ee';
        var num = t.querySelector('[data-step-num]');
        if (num) num.style.color = on ? '#2563eb' : '#9aa2ae';
        if (on && crumb) crumb.textContent = t.getAttribute('data-crumb') || '';
      });
      panels.forEach(function (p) {
        p.style.display = p.getAttribute('data-step-panel') === n ? 'block' : 'none';
      });
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () { select(t.getAttribute('data-step')); });
    });
    select('1');
  }

  /* ---------- showcase rail ---------- */
  function rail() {
    var el = document.querySelector('[data-rail]');
    if (!el) return;

    var prev = document.querySelector('[data-rail-prev]');
    var next = document.querySelector('[data-rail-next]');
    if (prev) prev.addEventListener('click', function () { el.scrollBy({ left: -400, behavior: 'smooth' }); });
    if (next) next.addEventListener('click', function () { el.scrollBy({ left: 400, behavior: 'smooth' }); });

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var hold = false, pos = 0, raf;
    ['mouseenter', 'focusin', 'touchstart', 'pointerdown'].forEach(function (ev) {
      el.addEventListener(ev, function () { hold = true; }, { passive: true });
    });
    ['mouseleave', 'focusout'].forEach(function (ev) {
      el.addEventListener(ev, function () { hold = false; }, { passive: true });
    });

    function tick() {
      raf = requestAnimationFrame(tick);
      if (hold || document.hidden) return;
      var max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      if (Math.abs(el.scrollLeft - pos) > 4) pos = el.scrollLeft;
      pos += 0.35;
      if (pos > max) pos = 0;
      el.scrollLeft = pos;
    }
    raf = requestAnimationFrame(tick);
    window.addEventListener('pagehide', function () { cancelAnimationFrame(raf); });
  }

  /* ---------- showcase case detail ---------- */
  function caseDetail() {
    var panel = document.querySelector('[data-case-panel]');
    if (!panel) return;
    var bodies = qa('[data-case-body]', panel);

    function open(id) {
      panel.style.display = 'block';
      bodies.forEach(function (b) {
        b.style.display = b.getAttribute('data-case-body') === id ? 'block' : 'none';
      });
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    qa('[data-case]').forEach(function (btn) {
      btn.addEventListener('click', function () { open(btn.getAttribute('data-case')); });
    });
    var close = panel.querySelector('[data-case-close]');
    if (close) close.addEventListener('click', function () { panel.style.display = 'none'; });
    panel.style.display = 'none';
  }

  /* ---------- logo fallbacks ---------- */
  /* Product logos are dropped in later; until then show a monogram instead of a
     broken image icon. */
  function logoFallbacks() {
    qa('img[data-monogram]').forEach(function (img) {
      img.addEventListener('error', function () {
        var span = document.createElement('span');
        span.className = 'logo-fallback';
        span.textContent = img.getAttribute('data-monogram');
        img.replaceWith(span);
      });
    });
  }

  function init() {
    stickyNav();
    menus();
    currency();
    accordions();
    steps();
    rail();
    caseDetail();
    logoFallbacks();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
