// Runs before the page paints (classic script, allowed by the CSP) so there is no light/dark flash.
// Mirrors resolveTheme() in src/theme.ts.
(function () {
  var t = 'light';
  try {
    var p = localStorage.getItem('gt_theme') || 'light';
    t = p === 'dark' || (p === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  } catch (e) { /* storage blocked: stay light */ }
  document.documentElement.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name=theme-color]');
  if (m) m.setAttribute('content', t === 'dark' ? '#14161a' : '#F6EFE4');
})();
