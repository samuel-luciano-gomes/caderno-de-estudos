// Conta e sincronização das notas com o Supabase.
// Páginas marcadas com <html data-requer-login> (os cadernos) só abrem com a conta conectada.
// Cada caderno é guardado numa linha da tabela "cadernos", visível só para o dono.
(function () {
  'use strict';
  var CFG = window.CADERNO_SUPABASE || {};
  var root = document.documentElement;
  var REQUIRE = root.hasAttribute('data-requer-login');
  var KEYS = { 'caderno-estudos-v1': 'estudos', 'caderno-teologia-v1': 'teologia' };
  var UID_KEY = 'caderno-conta';
  var pendKey = function (k) { return k + '-pendente'; };
  var sb = null, user = null, timers = {}, lastSeen = {}, pushing = {};

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function readLocal(k) { try { return JSON.parse(ls(k) || 'null'); } catch (e) { return null; } }
  function hasContent(d) { return !!(d && ((d.notes && d.notes.length) || (d.subjects && d.subjects.length))); }
  function sig(d) {
    d = d || {};
    var s = (d.subjects || []).map(function (x) { return x.id + ':' + x.name + ':' + x.color; }).sort().join('|');
    var n = (d.notes || []).map(function (x) { return x.id + ':' + (x.updated || 0); }).sort().join('|');
    return s + '#' + n;
  }
  function emit(k) { document.dispatchEvent(new CustomEvent('caderno:dados', { detail: { key: k } })); }
  function status(s, text) {
    var el = document.getElementById('save'); if (!el) return;
    el.dataset.s = s; el.title = text; var sp = el.querySelector('span'); if (sp) sp.textContent = text;
  }

  // ---------- sincronização ----------
  function merge(remote, local) {
    var out = { subjects: [], notes: [] }, subj = {}, notes = {};
    (remote.subjects || []).concat(local.subjects || []).forEach(function (s) { if (!subj[s.id]) { subj[s.id] = 1; out.subjects.push(s); } });
    (remote.notes || []).concat(local.notes || []).forEach(function (n) { var c = notes[n.id]; if (!c || (n.updated || 0) > (c.updated || 0)) notes[n.id] = n; });
    out.notes = Object.keys(notes).map(function (id) { return notes[id]; });
    return out;
  }
  async function pull(k) {
    var res = await sb.from('cadernos').select('dados, atualizado_em').eq('caderno', KEYS[k]).maybeSingle();
    if (res.error) throw res.error;
    var row = res.data, local = readLocal(k);
    if (!row) { if (hasContent(local)) await push(k); return; }
    if (ls(UID_KEY) !== user.id) {                 // primeira vez deste navegador nesta conta
      var merged = hasContent(local) ? merge(row.dados || {}, local) : (row.dados || {});
      ls(k, JSON.stringify(merged)); emit(k);
      if (hasContent(local)) await push(k); else lastSeen[k] = row.atualizado_em;
      return;
    }
    if (ls(pendKey(k))) { await push(k); return; } // mudanças deste aparelho ainda não enviadas
    if (lastSeen[k] !== row.atualizado_em) {
      lastSeen[k] = row.atualizado_em;
      if (sig(row.dados) !== sig(local)) { ls(k, JSON.stringify(row.dados || {})); emit(k); }
    }
  }
  async function push(k) {
    if (!sb || !user) return;
    if (pushing[k]) { pushing[k].again = true; return pushing[k].p; }
    var job = pushing[k] = { again: false };
    job.p = (async function () {
      try {
        do {
          job.again = false;
          var d = readLocal(k) || {};
          var row = { user_id: user.id, caderno: KEYS[k], dados: { subjects: d.subjects || [], notes: d.notes || [] }, atualizado_em: new Date().toISOString() };
          var res = await sb.from('cadernos').upsert(row, { onConflict: 'user_id,caderno' }).select('atualizado_em').single();
          if (res.error) throw res.error;
          lastSeen[k] = res.data.atualizado_em;
        } while (job.again);
        ls(pendKey(k), null);
        status('ok', 'Sincronizado na sua conta');
      } catch (e) {
        status('error', navigator.onLine === false ? 'Sem internet: salvo neste aparelho' : 'Não sincronizou: salvo neste aparelho');
        throw e;
      } finally { pushing[k] = null; }
    })();
    return job.p;
  }
  async function syncAll() {
    if (!user) return;
    status('saving', 'Sincronizando…');
    try {
      for (var k in KEYS) await pull(k);
      ls(UID_KEY, user.id);
      status('ok', 'Sincronizado na sua conta');
    } catch (e) { status('error', 'Não foi possível sincronizar agora'); }
  }
  function changed(k) {
    if (!KEYS[k] || !user) return;
    ls(pendKey(k), '1');
    clearTimeout(timers[k]);
    setTimeout(function () { status('saving', 'Sincronizando…'); }, 0);
    timers[k] = setTimeout(function () { push(k).catch(function () {}); }, 1200);
  }

  // ---------- formulário de login (na janela ou na tela de bloqueio) ----------
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var a in attrs || {}) { if (a === 'text') e.textContent = attrs[a]; else if (a.slice(0, 2) === 'on') e.addEventListener(a.slice(2), attrs[a]); else e.setAttribute(a, attrs[a]); }
    (kids || []).forEach(function (c) { if (c != null) e.append(c); });
    return e;
  }
  var TEXTS = {
    entrar: ['Entrar na sua conta', 'Suas notas ficam iguais em todos os aparelhos em que você entrar.', 'Entrar'],
    criar: ['Criar sua conta', 'Use seu e-mail e uma senha de pelo menos 6 caracteres. É grátis.', 'Criar conta'],
    esqueci: ['Redefinir senha', 'Enviaremos um link para você criar uma senha nova.', 'Enviar link'],
    nova: ['Criar senha nova', 'Digite a senha nova da sua conta.', 'Salvar senha']
  };
  var F = null; // formulário ativo: { box, mode, onDone }
  function formMarkup(withCancel, gateTitle) {
    return '<form class="auth-form" novalidate>' +
      '<h2 class="auth-title"></h2><p class="auth-sub"></p>' +
      '<div class="auth-tabs" role="tablist"><button type="button" role="tab" data-m="entrar">Entrar</button><button type="button" role="tab" data-m="criar">Criar conta</button></div>' +
      '<label class="auth-field f-email">E-mail<input class="auth-email" type="email" autocomplete="email" required></label>' +
      '<label class="auth-field f-senha">Senha<input class="auth-senha" type="password" autocomplete="current-password" minlength="6" required></label>' +
      '<button type="button" class="auth-link auth-esqueci">Esqueci minha senha</button>' +
      '<p class="auth-msg" role="status"></p>' +
      '<div class="auth-acts">' + (withCancel ? '<button type="button" class="btn ghost auth-cancelar">Cancelar</button>' : '') + '<button type="submit" class="btn pri auth-ok"></button></div>' +
      '</form>';
  }
  function bindForm(box, onCancel) {
    var q = function (s) { return box.querySelector(s); };
    var f = { box: box, mode: 'entrar', q: q };
    box.querySelectorAll('.auth-tabs button').forEach(function (b) { b.addEventListener('click', function () { setMode(f, b.dataset.m); }); });
    q('.auth-esqueci').addEventListener('click', function () { setMode(f, 'esqueci'); });
    var c = q('.auth-cancelar'); if (c) c.addEventListener('click', onCancel);
    q('.auth-form').addEventListener('submit', function (e) { e.preventDefault(); submit(f); });
    return f;
  }
  function setMode(f, m) {
    f.mode = m; var t = TEXTS[m], q = f.q;
    var title = (f.gate && m === 'entrar') ? 'Entre para abrir seu caderno' : t[0];
    q('.auth-title').textContent = title;
    q('.auth-sub').textContent = t[1];
    q('.auth-ok').textContent = t[2];
    q('.auth-tabs').hidden = (m === 'esqueci' || m === 'nova');
    f.box.querySelectorAll('.auth-tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.m === m)); });
    q('.f-email').hidden = (m === 'nova');
    q('.f-senha').hidden = (m === 'esqueci');
    q('.auth-esqueci').textContent = 'Esqueci minha senha';
    q('.auth-esqueci').hidden = (m !== 'entrar');
    q('.auth-senha').setAttribute('autocomplete', m === 'entrar' ? 'current-password' : 'new-password');
    msg(f, '');
  }
  function msg(f, t, kind) { var m = f.q('.auth-msg'); m.textContent = t; m.dataset.kind = kind || ''; }
  function errText(e) {
    var c = (e && (e.code || '')) + ' ' + (e && e.message || '');
    if (/invalid_credentials|Invalid login/i.test(c)) return 'E-mail ou senha incorretos.';
    if (/email_not_confirmed|not confirmed/i.test(c)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (/rate_limit|rate limit|too many/i.test(c)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
    if (/weak_password|at least/i.test(c)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/user_already_exists|already registered/i.test(c)) return 'Esse e-mail já tem conta. Use Entrar.';
    if (/email_address_invalid|invalid.*email/i.test(c)) return 'Esse e-mail não parece válido.';
    if (/fetch|network/i.test(c)) return 'Sem conexão com o servidor. Verifique a internet.';
    return 'Não deu certo agora. Tente de novo em instantes.';
  }
  var pageUrl = function () { return location.origin + location.pathname; };
  async function submit(f) {
    var q = f.q, email = q('.auth-email').value.trim(), senha = q('.auth-senha').value, okBtn = q('.auth-ok');
    if (!sb) { msg(f, 'O serviço de login não carregou. Recarregue a página.', 'erro'); return; }
    if (f.mode !== 'nova' && !/^\S+@\S+\.\S+$/.test(email)) { msg(f, 'Digite um e-mail válido.', 'erro'); return; }
    if (f.mode !== 'esqueci' && senha.length < 6) { msg(f, 'A senha precisa ter pelo menos 6 caracteres.', 'erro'); return; }
    okBtn.disabled = true; msg(f, 'Aguarde…');
    try {
      if (f.mode === 'entrar') {
        var r = await sb.auth.signInWithPassword({ email: email, password: senha });
        if (r.error) throw r.error;
        if (f.onDone) f.onDone();
      } else if (f.mode === 'criar') {
        var r2 = await sb.auth.signUp({ email: email, password: senha, options: { emailRedirectTo: pageUrl() } });
        if (r2.error) throw r2.error;
        if (r2.data.user && r2.data.user.identities && r2.data.user.identities.length === 0) msg(f, 'Esse e-mail já tem conta. Use Entrar.', 'erro');
        else if (!r2.data.session) msg(f, 'Pronto! Enviamos um link de confirmação para ' + email + '. Abra o e-mail e clique no link para ativar a conta.', 'ok');
        else if (f.onDone) f.onDone();
      } else if (f.mode === 'esqueci') {
        var r3 = await sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl() });
        if (r3.error) throw r3.error;
        msg(f, 'Se houver uma conta com esse e-mail, enviamos um link para criar a senha nova.', 'ok');
      } else if (f.mode === 'nova') {
        var r4 = await sb.auth.updateUser({ password: senha });
        if (r4.error) throw r4.error;
        msg(f, 'Senha alterada. Você já está conectado.', 'ok');
        setTimeout(function () { if (f.onDone) f.onDone(); }, 1200);
      }
    } catch (e) { msg(f, errText(e), 'erro'); }
    finally { okBtn.disabled = false; }
  }

  // janela (página inicial e cabeçalho)
  var dlg, dlgForm, afterLogin = null;
  function open(m, href) {
    afterLogin = href || null;
    if (REQUIRE && !user) { showGate(m); return; }
    if (!dlg) {
      dlg = el('dialog', { class: 'auth' });
      dlg.innerHTML = formMarkup(true);
      document.body.append(dlg);
      dlgForm = bindForm(dlg, function () { dlg.close(); });
      dlgForm.onDone = function () { dlg.close(); };
    }
    setMode(dlgForm, m || 'entrar');
    if (!dlg.open) dlg.showModal();
    var first = dlg.querySelector(m === 'nova' ? '.auth-senha' : '.auth-email'); if (first) first.focus();
  }

  // tela de bloqueio dos cadernos
  var gateForm;
  function showGate(m) {
    var body = document.getElementById('gate-body'); if (!body) return;
    if (!gateForm) {
      body.innerHTML = formMarkup(false) + '<p class="gate-foot"><a href="../">Voltar para a página inicial</a></p>';
      gateForm = bindForm(body);
      gateForm.gate = true;
      gateForm.onDone = function () {};
    }
    setMode(gateForm, m || 'entrar');
    var first = body.querySelector(m === 'nova' ? '.auth-senha' : '.auth-email'); if (first) setTimeout(function () { first.focus(); }, 0);
  }
  function gateError(t) {
    var body = document.getElementById('gate-body'); if (!body) return;
    body.innerHTML = '';
    body.append(el('h2', { class: 'auth-title', text: 'Não foi possível abrir o login' }),
      el('p', { class: 'auth-sub', text: t }),
      el('div', { class: 'auth-acts' }, [el('button', { class: 'btn pri', type: 'button', text: 'Recarregar', onclick: function () { location.reload(); } })]));
  }

  // botão da conta no cabeçalho
  var slot;
  function renderSlot() {
    if (!slot) return;
    slot.replaceChildren();
    if (!user) {
      slot.append(el('button', { class: 'btn-entrar', type: 'button', text: 'Entrar', onclick: function () { open('entrar'); } }));
      return;
    }
    var email = user.email || '';
    var wrap = el('div', { class: 'more-wrap conta-wrap' });
    var btn = el('button', { class: 'avatar', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: email, 'aria-label': 'Sua conta: ' + email, text: (email[0] || '?').toUpperCase() });
    var menu = el('div', { class: 'top-menu', role: 'menu', hidden: '' }, [
      el('div', { class: 'conta-info' }, [el('b', { text: 'Conectado como' }), el('span', { text: email })]),
      el('hr'),
      el('button', { role: 'menuitem', type: 'button', onclick: function () { syncAll(); } }, ['Sincronizar agora', el('span', { text: 'Busca as notas mais recentes da conta' })]),
      el('button', { role: 'menuitem', type: 'button', onclick: sair }, ['Sair', el('span', { text: 'As notas saem deste aparelho e ficam na conta' })])
    ]);
    btn.addEventListener('click', function (e) { e.stopPropagation(); var o = menu.hidden; menu.hidden = !o; btn.setAttribute('aria-expanded', String(o)); });
    document.addEventListener('click', function (e) { if (!menu.hidden && !wrap.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    menu.addEventListener('click', function (e) { if (e.target.closest('button')) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    wrap.append(btn, menu);
    slot.append(wrap);
  }

  async function sair() {
    status('saving', 'Enviando as últimas mudanças…');
    try { for (var k in KEYS) if (ls(pendKey(k))) await push(k); }
    catch (e) {
      status('error', 'Não saiu: há mudanças que ainda não foram para a conta');
      var b = document.getElementById('banner'); if (b) { b.textContent = 'Não foi possível enviar as últimas mudanças para a conta. Verifique a internet e tente sair de novo.'; b.hidden = false; }
      return;
    }
    await sb.auth.signOut();
    for (var k2 in KEYS) { ls(k2, null); ls(pendKey(k2), null); emit(k2); }
    ls(UID_KEY, null);
  }

  function applyAuth() {
    root.setAttribute('data-auth', user ? 'in' : 'out');
    renderSlot();
    if (REQUIRE && !user) showGate('entrar');
  }

  // ---------- início ----------
  window.Nuvem = { changed: changed, open: open, get user() { return user; } };

  // botões da página com data-auth-open="entrar|criar"
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-auth-open]'); if (!b) return;
    e.preventDefault(); open(b.getAttribute('data-auth-open'), b.getAttribute('href') || null);
  });
  document.addEventListener('DOMContentLoaded', function () { slot = document.getElementById('account-slot'); renderSlot(); });

  if (!CFG.url || !CFG.key || !window.supabase) {
    root.setAttribute('data-auth', 'out');
    if (REQUIRE) document.addEventListener('DOMContentLoaded', function () { gateError('O serviço de login não carregou. Verifique sua conexão com a internet e recarregue a página.'); });
    return;
  }
  sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  sb.auth.onAuthStateChange(function (event, session) {
    var before = user && user.id;
    user = session ? session.user : null;
    var run = function () {
      applyAuth();
      if (event === 'PASSWORD_RECOVERY') open('nova');
      if (user && afterLogin && event === 'SIGNED_IN') { var h = afterLogin; afterLogin = null; location.href = h; return; }
      if (user && (event === 'INITIAL_SESSION' || (event === 'SIGNED_IN' && before !== user.id))) syncAll();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else setTimeout(run, 0);
  });
  var lastFocus = 0;
  window.addEventListener('focus', function () {
    if (!user || Date.now() - lastFocus < 15000) return;
    lastFocus = Date.now(); syncAll();
  });
})();
