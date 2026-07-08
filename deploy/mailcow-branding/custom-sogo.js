// DebutDeploy brand — recolour SOGo's Material green to blue (#2563eb). Runs FIRST so nothing
// downstream can prevent it. custom-theme.js is not loaded by mailcow's SOGo, so we override
// the generated theme classes with injected CSS instead.
(function () {
  var B = '#2563eb', BH = '#1d4ed8';
  var css = [
    'md-toolbar:not(.md-menu-toolbar),md-toolbar.md-default-theme:not(.md-menu-toolbar),.md-toolbar-tools{background-color:' + B + '!important;color:#fff!important;}',
    '.md-button.md-fab,.md-button.md-fab.md-accent,.md-button.md-accent.md-fab.md-default-theme,.md-fab.md-accent{background-color:' + B + '!important;}',
    '.md-button.md-fab:not([disabled]):hover,.md-button.md-fab.md-focused{background-color:' + BH + '!important;}',
    '.md-button.md-raised.md-primary,.md-button.md-fab.md-primary,.md-button.md-raised.md-accent{background-color:' + B + '!important;color:#fff!important;}',
    '.md-button.md-primary:not(.md-raised):not(.md-fab){color:' + B + '!important;}',
    'md-tabs md-ink-bar{color:' + B + '!important;background-color:' + B + '!important;}',
    'a:not(.md-button){color:' + B + ';}',
    'input:focus{border-color:' + B + '!important;}'
  ].join('');
  function inject(){ if(document.querySelector('style[data-debutdeploy]'))return;
    var s=document.createElement('style'); s.setAttribute('data-debutdeploy','1'); s.textContent=css;
    (document.head||document.documentElement).appendChild(s); }
  inject();
  document.addEventListener('DOMContentLoaded', inject);
})();

// redirect to mailcow login form
document.addEventListener('DOMContentLoaded', function () {
    var loginForm = document.forms.namedItem("loginForm");
    if (loginForm) { window.location.href = '/user'; }
});
// logout function
function mc_logout() {
    fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "logout=1" })
      .then(() => window.location.href = '/');
}
// Guarded: CKEDITOR only exists in the compose view (was throwing on the inbox).
if (typeof CKEDITOR !== 'undefined') { CKEDITOR.addCss("body {font-size: 16px !important}"); }
