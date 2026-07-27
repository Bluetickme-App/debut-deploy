/* DebutDeploy — shared bill comparison.
 *
 * ONE implementation, mounted on every page. Drop <div data-dd-calculator></div>
 * anywhere and this renders the full "Compare your current cloud bill" section
 * into it, identically on the homepage and on every comparison page.
 *
 * Pricing model is the same one the pricing section quotes, so the calculator
 * can never drift from the plan table:
 *   plan  = cheapest tier whose vCPU and RAM both meet the request
 *   total = plan price x number of services (+ $12 managed Postgres if ticked)
 *
 * Currency follows the page-wide toggle via window.DD (see dd-site.js).
 */
(function () {
  'use strict';

  var TIERS = [
    { name: 'Hobby',    cpu: 0.5, ram: 0.5, usd: 5 },
    { name: 'Starter',  cpu: 0.5, ram: 1,   usd: 9 },
    { name: 'Pro',      cpu: 1,   ram: 2,   usd: 15 },
    { name: 'Pro Plus', cpu: 2,   ram: 4,   usd: 45 },
    { name: 'Scale',    cpu: 4,   ram: 8,   usd: 85 }
  ];
  var DB_USD = 12;
  var CHECKED = '24 July 2026';

  var state = {
    tab: 'upload',
    provider: 'Render',
    services: 3,
    cpu: 2,
    ram: 4,
    transfer: 500,
    current: 412,
    db: true,
    source: 'sample'   // 'sample' until the visitor edits an input
  };

  function money(usd) {
    return (window.DD && window.DD.money) ? window.DD.money(usd) : '$' + Math.round(usd);
  }
  function planFor(cpu, ram) {
    for (var i = 0; i < TIERS.length; i++) {
      if (TIERS[i].cpu >= cpu && TIERS[i].ram >= ram) return TIERS[i];
    }
    return TIERS[TIERS.length - 1];
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var MONO = "font-family: 'IBM Plex Mono', monospace;";
  var LABEL = MONO + ' font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase; color: #9aa2ae;';
  var FIELD_LABEL = MONO + ' font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #6c7480; margin-bottom: 7px;';
  var INPUT = 'width: 100%; min-height: 44px; padding: 11px 12px; border: 1px solid #d8dde6; border-radius: 10px; background: #fff; font-size: 14px;';

  /* Responsive refinements for the calculator's own inner grids.
   *
   * The outer two-up already rides the site-wide [data-2col] hook and the manual
   * form rides [data-grid="2"] — both collapse in assets/dd.css. The grids INSIDE
   * the result panel had no hook, so they stayed 2-up / 3-up all the way down to
   * 320px and pushed the third saving tile off-screen. They are nested inside a
   * hook that has already collapsed, so their available width depends on the
   * column they land in rather than on the viewport; auto-fit tracks size them
   * from the space they actually get, which no viewport media query can know.
   * Everything else here reuses the site's existing breakpoints (1140/900/760).
   */
  var CSS = [
    '[data-dd-calculator] [data-dd-head]{flex-wrap:wrap;}',
    '[data-dd-calculator] [data-dd-tiles]>div,[data-dd-calculator] [data-dd-pair]>div{min-width:0;}',
    '@media (max-width:1140px){',
    /* 10–10.5px micro labels are under the 12px readable floor on touch screens */
    '[data-dd-calculator] [data-dd-micro]{font-size:12px !important;letter-spacing:0.06em !important;}',
    /* tap targets: standalone text button gets a real 44px box */
    '[data-dd-calculator] [data-dd-tap]{min-height:44px;display:inline-flex;align-items:center;justify-content:center;}',
    /* mid-sentence text button: 44px hit box, pulled back so the line box keeps its rhythm */
    '[data-dd-calculator] [data-dd-tap-inline]{min-height:44px;display:inline-flex;align-items:center;vertical-align:middle;margin-top:-12px;margin-bottom:-12px;}',
    '[data-dd-calculator] [data-dd-check]{min-height:44px;}',
    /* the 44px tap target is the label row above; the box itself clears the
       24x24 WCAG 2.5.8 minimum without becoming a comically large checkbox */
    '[data-dd-calculator] [data-dd-check] input{width:26px !important;height:26px !important;flex:none;}',
    '}'
  ].join('');

  function injectCss() {
    if (document.getElementById('dd-calc-css')) return;
    var s = document.createElement('style');
    s.id = 'dd-calc-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  var FIELDS = [
    { key: 'services', label: 'Number of services',      min: '1',   step: '1' },
    { key: 'cpu',      label: 'vCPU per service',        min: '0.5', step: '0.5' },
    { key: 'ram',      label: 'GB RAM per service',      min: '0.5', step: '0.5' },
    { key: 'transfer', label: 'Monthly transfer (GB)',   min: '0',   step: '50' },
    { key: 'current',  label: 'Current monthly cost ($)', min: '0',  step: '1' }
  ];
  var PROVIDERS = ['Render', 'Railway', 'Heroku', 'Fly.io', 'DigitalOcean', 'Other'];

  function shell() {
    return '' +
    '<div data-2col style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 48px; align-items: start;">' +
      '<div>' +
        '<h2 style="font-size: 42px; line-height: 1.08; letter-spacing: -0.035em; font-weight: 800;">Not sure what you&rsquo;d pay? <span style="color: #2563eb;">Compare your current cloud bill.</span></h2>' +
        '<p style="margin-top: 18px; font-size: 17.5px; line-height: 1.6; color: #4d5661; text-wrap: pretty;">Enter the services you run today and see the same workload priced on DebutDeploy. Every figure below is the published plan price &mdash; the same numbers as the pricing table, not a quote.</p>' +

        '<div role="tablist" aria-label="Calculator input method" style="margin-top: 26px; display: inline-flex; padding: 4px; background: #e8edf7; border-radius: 11px;">' +
          '<button type="button" role="tab" data-tab="upload" style="padding: 10px 16px; min-height: 44px; border: 0; border-radius: 8px; cursor: pointer; font-size: 13.5px; font-weight: 600;">Start from a bill</button>' +
          '<button type="button" role="tab" data-tab="manual" style="padding: 10px 16px; min-height: 44px; border: 0; border-radius: 8px; cursor: pointer; font-size: 13.5px; font-weight: 600;">Enter manually</button>' +
        '</div>' +

        '<div data-panel="upload" style="margin-top: 22px;">' +
          '<div data-drop style="border: 1.5px dashed #b9c7e6; border-radius: 15px; background: rgba(255,255,255,0.7); padding: 40px 24px; text-align: center; transition: border-color .18s, background .18s;">' +
            '<span aria-hidden="true" style="display: grid; place-items: center; width: 46px; height: 46px; margin: 0 auto; border-radius: 12px; background: #e8efff; color: #2563eb; font-size: 19px;">&uarr;</span>' +
            '<p style="margin-top: 14px; font-size: 15px; font-weight: 600;">Drop your monthly bill here</p>' +
            '<p style="margin-top: 6px; font-size: 13px; color: #6c7480;">PDF, CSV or a screenshot &mdash; Render, Railway, Fly, Heroku, DigitalOcean&hellip;</p>' +
            '<button type="button" data-browse style="margin-top: 16px; padding: 12px 20px; min-height: 44px; border-radius: 10px; border: 0; background: #2563eb; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;" class="h-primary">Browse files</button>' +
            '<input type="file" data-file accept=".pdf,.csv,.png,.jpg,.jpeg,.webp" style="position: absolute; width: 1px; height: 1px; opacity: 0; visibility: hidden; pointer-events: none;" />' +
            '<p style="margin-top: 14px;' + MONO + ' font-size: 12px;"><button type="button" data-sample data-dd-tap style="background: none; border: 0; padding: 0; color: #2563eb; font-size: 12px; text-decoration: underline; cursor: pointer;">or start from a typical Render bill &rarr;</button></p>' +
            '<p data-filename style="margin-top: 12px;' + MONO + ' font-size: 12px; color: #15803d; display: none;"></p>' +
          '</div>' +
          '<p style="margin-top: 14px;' + MONO + ' font-size: 12px; color: #8b939f; line-height: 1.7;">&#128274; Your file never leaves this page &mdash; nothing is uploaded, read or stored. It sets a typical starting configuration that you then confirm.</p>' +
          '<p style="margin-top: 8px; font-size: 12.5px; color: #6c7480; line-height: 1.6;">Switch to <button type="button" data-tab="manual" data-dd-tap-inline style="background: none; border: 0; padding: 0; color: #2563eb; font: inherit; text-decoration: underline; cursor: pointer;">enter manually</button> for a figure based on your own numbers. <a href="/privacy.html">Privacy policy</a></p>' +
        '</div>' +

        '<div data-panel="manual" data-grid="2" style="margin-top: 22px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;">' +
          '<label style="display: block;"><span data-dd-micro style="display: block;' + FIELD_LABEL + '">Current provider</span>' +
            '<select data-provider style="' + INPUT + '">' +
              PROVIDERS.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('') +
            '</select></label>' +
          FIELDS.map(function (f) {
            return '<label style="display: block;"><span data-dd-micro style="display: block;' + FIELD_LABEL + '">' + esc(f.label) + '</span>' +
              '<input type="number" data-field="' + f.key + '" min="' + f.min + '" step="' + f.step + '" ' +
              'style="' + INPUT + MONO + '" /></label>';
          }).join('') +
          // 1 / -1 spans the explicit grid whatever its column count. "span 2" would
          // conjure a phantom implicit column once dd.css collapses this to one.
          '<label data-dd-check style="display: flex; align-items: center; gap: 10px; grid-column: 1 / -1; font-size: 14px; color: #2b323c;">' +
            '<input type="checkbox" data-db style="width: 18px; height: 18px; accent-color: #2563eb;" />Include a managed Postgres instance</label>' +
        '</div>' +
      '</div>' +

      '<div style="border: 1px solid #d3e0ff; background: #fff; border-radius: 16px; padding: 26px; box-shadow: 0 24px 50px -34px rgba(37,99,235,0.4);">' +
        '<div data-dd-head style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">' +
          '<p data-dd-micro style="' + MONO + ' font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #8b939f;">Estimated result</p>' +
          '<span data-confidence data-dd-micro style="' + MONO + ' font-size: 10.5px; color: #15803d; background: #eafaf0; padding: 5px 9px; border-radius: 7px;"></span>' +
        '</div>' +
        // auto-fit + a fluid track floor: these grids live inside a column whose
        // width the viewport alone can't predict, so they drop to fewer columns
        // exactly when a tile would stop fitting. Desktop still resolves to 2-up.
        '<div data-dd-pair style="margin-top: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(130px, 100%), 1fr)); gap: 12px;">' +
          '<div style="border: 1px solid #eceff4; border-radius: 12px; padding: 16px; background: #fbfcfe;">' +
            '<p data-dd-micro style="' + LABEL + '">Current monthly</p>' +
            '<p data-current style="font-size: 27px; font-weight: 700; letter-spacing: -0.03em; margin-top: 7px; color: #4d5661;"></p>' +
          '</div>' +
          '<div style="border: 1px solid #d3e0ff; border-radius: 12px; padding: 16px; background: #f5f8ff;">' +
            '<p data-dd-micro style="' + MONO + ' font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase; color: #6f8bd6;">On DebutDeploy</p>' +
            '<p data-est style="font-size: 27px; font-weight: 800; letter-spacing: -0.03em; margin-top: 7px; color: #2563eb;"></p>' +
          '</div>' +
        '</div>' +
        '<div data-dd-tiles style="margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(112px, 100%), 1fr)); gap: 12px;">' +
          '<div style="border: 1px solid #eceff4; border-radius: 12px; padding: 14px; background: #fbfcfe;"><p data-dd-micro style="' + LABEL + '">Monthly saving</p><p data-save-m style="font-size: 19px; font-weight: 700; letter-spacing: -0.02em; margin-top: 6px; color: #15803d;"></p></div>' +
          '<div style="border: 1px solid #eceff4; border-radius: 12px; padding: 14px; background: #fbfcfe;"><p data-dd-micro style="' + LABEL + '">Annual saving</p><p data-save-y style="font-size: 19px; font-weight: 700; letter-spacing: -0.02em; margin-top: 6px; color: #15803d;"></p></div>' +
          '<div style="border: 1px solid #eceff4; border-radius: 12px; padding: 14px; background: #fbfcfe;"><p data-dd-micro style="' + LABEL + '">Percentage</p><p data-save-p style="font-size: 19px; font-weight: 700; letter-spacing: -0.02em; margin-top: 6px; color: #15803d;"></p></div>' +
        '</div>' +
        '<div style="margin-top: 18px; border-top: 1px solid #eceff4; padding-top: 16px;">' +
          '<p data-dd-micro style="' + MONO + ' font-size: 10.5px; letter-spacing: 0.09em; text-transform: uppercase; color: #9aa2ae;">Equivalent configuration</p>' +
          '<p data-equiv style="' + MONO + ' font-size: 12.5px; color: #2b323c; margin-top: 8px; line-height: 1.7;"></p>' +
          '<p data-assume style="margin-top: 12px; font-size: 12px; color: #8b939f; line-height: 1.6;"></p>' +
        '</div>' +
        '<a href="/#migrate" class="h-primary" style="margin-top: 20px; display: grid; place-items: center; min-height: 48px; border-radius: 11px; background: #2563eb; color: #fff; font-size: 15px; font-weight: 600;">Review my migration options</a>' +
        '<p style="margin-top: 10px; text-align: center; font-size: 12px; color: #8b939f;">No account required to see your result.</p>' +
      '</div>' +
    '</div>';
  }

  function mount(root) {
    root.innerHTML = shell();

    var q = function (sel) { return root.querySelector(sel); };
    var qa = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

    var fileInput = q('[data-file]');
    var drop = q('[data-drop]');

    function paint() {
      // tabs + panels
      qa('[role="tab"][data-tab]').forEach(function (b) {
        var on = b.getAttribute('data-tab') === state.tab;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.style.background = on ? '#fff' : 'transparent';
        b.style.color = on ? '#0b0d12' : '#5a6472';
      });
      qa('[data-panel]').forEach(function (p) {
        p.style.display = p.getAttribute('data-panel') === state.tab
          ? (p.getAttribute('data-panel') === 'manual' ? 'grid' : 'block')
          : 'none';
      });

      // inputs mirror state
      FIELDS.forEach(function (f) {
        var el = q('[data-field="' + f.key + '"]');
        if (el && document.activeElement !== el) el.value = state[f.key];
      });
      var prov = q('[data-provider]'); if (prov) prov.value = state.provider;
      var db = q('[data-db]'); if (db) db.checked = state.db;

      // maths
      var plan = planFor(Number(state.cpu), Number(state.ram));
      var est = plan.usd * Number(state.services) + (state.db ? DB_USD : 0);
      var current = Number(state.current) || 0;
      var saveMonth = Math.max(current - est, 0);
      var pct = current > 0 ? Math.round((saveMonth / current) * 100) : 0;

      q('[data-confidence]').textContent = state.source === 'sample' ? 'sample estimate' : 'your inputs';
      q('[data-current]').textContent = money(current);
      q('[data-est]').textContent = money(est);
      q('[data-save-m]').textContent = money(saveMonth);
      q('[data-save-y]').textContent = money(saveMonth * 12);
      q('[data-save-p]').textContent = pct + '%';
      q('[data-equiv]').textContent = state.services + ' × ' + plan.name +
        ' (' + plan.ram + ' GB · ' + plan.cpu + ' vCPU)' + (state.db ? ' + 1 × managed Postgres' : '');
      q('[data-assume]').textContent = 'Assumes ' + state.transfer +
        ' GB outbound transfer (inside the 20 TB included allowance), one team seat, nightly backups with 7-day retention, and ' +
        state.provider + ' list pricing checked ' + CHECKED + '. Excludes VAT.';
    }

    function setTab(tab) { state.tab = tab; paint(); }

    qa('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
    });

    FIELDS.forEach(function (f) {
      var el = q('[data-field="' + f.key + '"]');
      el.addEventListener('input', function () {
        state[f.key] = el.value === '' ? 0 : Number(el.value);
        state.source = 'manual';
        paint();
      });
    });
    q('[data-provider]').addEventListener('change', function (e) {
      state.provider = e.target.value; state.source = 'manual'; paint();
    });
    q('[data-db]').addEventListener('change', function (e) {
      state.db = e.target.checked; state.source = 'manual'; paint();
    });

    function fromBill(name) {
      var label = q('[data-filename]');
      label.style.display = 'block';
      label.textContent = name
        ? '✓ ' + name + ' — starting configuration set, confirm the numbers'
        : '✓ typical Render bill loaded — confirm the numbers';
      state.source = 'sample';
      setTab('manual');
    }

    q('[data-browse]').addEventListener('click', function () { fileInput.click(); });
    q('[data-sample]').addEventListener('click', function () { fromBill(''); });
    fileInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      fromBill(f ? f.name : '');
      fileInput.value = '';           // never retained
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.style.borderColor = '#2563eb';
        drop.style.background = '#eef3fe';
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.style.borderColor = '#b9c7e6';
        drop.style.background = 'rgba(255,255,255,0.7)';
      });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      fromBill(f ? f.name : '');
    });

    document.addEventListener('dd:currency', paint);
    paint();
  }

  function init() {
    var roots = Array.prototype.slice.call(document.querySelectorAll('[data-dd-calculator]'));
    if (!roots.length) return;
    injectCss();
    roots.forEach(mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
