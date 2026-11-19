// Tema claro, escuro ou do sistema, compartilhado por todas as páginas.
// Roda no <head> para aplicar o tema antes de a página aparecer.
(function () {
  var KEY = 'caderno-tema', root = document.documentElement;
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONS = {
    system: SVG + '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    light: SVG + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: SVG + '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>'
  };
  var LABEL = { system: 'Tema do sistema', light: 'Tema claro', dark: 'Tema escuro' };
  var NEXT = { system: 'light', light: 'dark', dark: 'system' };

  function get() { try { var t = localStorage.getItem(KEY); return LABEL[t] ? t : 'system'; } catch (e) { return 'system'; } }
  function apply(t) { if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme'); }
  function paint(btn, t) { btn.innerHTML = ICONS[t]; btn.title = LABEL[t] + ' (clique para trocar)'; btn.setAttribute('aria-label', LABEL[t] + '. Clique para trocar'); }

  apply(get());

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-btn');
    if (btn) {
      paint(btn, get());
      btn.addEventListener('click', function () {
        var t = NEXT[get()];
        try { localStorage.setItem(KEY, t); } catch (e) {}
        apply(t); paint(btn, t);
      });
    }
    var mb = document.getElementById('more-btn'), mm = document.getElementById('more-menu');
    if (mb && mm) {
      var close = function () { mm.hidden = true; mb.setAttribute('aria-expanded', 'false'); };
      mb.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = mm.hidden; mm.hidden = !open; mb.setAttribute('aria-expanded', String(open));
        if (open) { var first = mm.querySelector('button, a, label'); if (first) first.focus(); }
      });
      document.addEventListener('click', function (e) { if (!mm.hidden && !e.target.closest('.more-wrap')) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !mm.hidden) { close(); mb.focus(); } });
      mm.addEventListener('click', function (e) { if (e.target.closest('button, a, label')) setTimeout(close, 0); });
    }
  });

  // mantém o tema igual em outras abas abertas do site
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    apply(get());
    var b = document.getElementById('theme-btn'); if (b) paint(b, get());
  });
})();
