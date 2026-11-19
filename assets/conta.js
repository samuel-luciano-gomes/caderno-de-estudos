// Conta e sincronização das notas com o Supabase.
// O site continua funcionando sem conta (notas só no navegador). Com a conta,
// cada caderno é guardado numa linha da tabela "cadernos", visível só para o dono.
(function () {
  'use strict';
  var CFG = window.CADERNO_SUPABASE || {};
  var KEYS = { 'caderno-estudos-v1': 'estudos', 'caderno-teologia-v1': 'teologia' };
  var UID_KEY = 'caderno-conta';                 // id do usuário dono dos dados deste navegador
  var pendKey = function (k) { return k + '-pendente'; };
  var sb = null, user = null, timers = {}, lastSeen = {}, pushing = {};

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function readLocal(k) { try { return JSON.parse(ls(k) || 'null'); } catch (e) { return null; } }
  function hasContent(d) { return !!(d && ((d.notes && d.notes.length) || (d.subjects && d.subjects.length))); }
  // resumo dos dados para saber se algo mudou (a ordem das chaves no banco pode variar)
  function sig(d) {
    d = d || {};
    var s = (d.subjects || []).map(function (x) { return x.id + ':' + x.name + ':' + x.color; }).sort().join('|');
    var n = (d.notes || []).map(function (x) { return x.id + ':' + (x.updated || 0); }).sort().join('|');
    return s + '#' + n;
  }
  function emit(k) { document.dispatchEvent(new CustomEvent('caderno:dados', { detail: { key: k } })); }

  // ---------- indicador de salvamento ----------
  function status(s, text) {
    var el = document.getElementById('save'); if (!el) return;
    el.dataset.s = s; var sp = el.querySelector('span'); if (sp) sp.textContent = text;
  }

  // ---------- mesclagem na primeira vez que este navegador entra na conta ----------
  function merge(remote, local) {
    var out = { subjects: [], notes: [], materials: [] };
    var subj = {}, notes = {};
    (remote.subjects || []).concat(local.subjects || []).forEach(function (s) { if (!subj[s.id]) { subj[s.id] = 1; out.subjects.push(s); } });
    (remote.notes || []).concat(local.notes || []).forEach(function (n) {
      var cur = notes[n.id];
      if (!cur || (n.updated || 0) > (cur.updated || 0)) notes[n.id] = n;
    });
    out.notes = Object.keys(notes).map(function (id) { return notes[id]; });
    return out;
  }

  // ---------- leitura e envio ----------
  async function pull(k) {
    var nome = KEYS[k];
    var res = await sb.from('cadernos').select('dados, atualizado_em').eq('caderno', nome).maybeSingle();
    if (res.error) throw res.error;
    var row = res.data, local = readLocal(k);
    var owner = ls(UID_KEY);
    if (!row) {                                   // conta ainda não tem este caderno
      if (hasContent(local)) await push(k);
      return;
    }
    if (owner !== user.id) {                      // primeira vez deste navegador nesta conta
      var merged = hasContent(local) ? merge(row.dados || {}, local) : (row.dados || {});
      ls(k, JSON.stringify(merged)); emit(k);
      if (hasContent(local)) await push(k); else lastSeen[k] = row.atualizado_em;
      return;
    }
    if (ls(pendKey(k))) { await push(k); return; } // há mudanças deste aparelho ainda não enviadas
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
          var d = readLocal(k) || { subjects: [], notes: [] };
          var row = { user_id: user.id, caderno: KEYS[k], dados: { subjects: d.subjects || [], notes: d.notes || [] }, atualizado_em: new Date().toISOString() };
          var res = await sb.from('cadernos').upsert(row, { onConflict: 'user_id,caderno' }).select('atualizado_em').single();
          if (res.error) throw res.error;
          lastSeen[k] = res.data.atualizado_em;
        } while (job.again);
        ls(pendKey(k), null);
        status('ok', 'Sincronizado na sua conta');
      } catch (e) {
        status('error', navigator.onLine === false ? 'Sem internet: salvo neste navegador' : 'Não sincronizou: salvo neste navegador');
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
    } catch (e) {
      status('error', 'Não foi possível sincronizar agora');
    }
  }

  // chamado pelos cadernos depois de salvar no navegador
  function changed(k) {
    if (!KEYS[k]) return;
    if (!user) return;
    ls(pendKey(k), '1');
    clearTimeout(timers[k]);
    setTimeout(function () { status('saving', 'Sincronizando…'); }, 0);
    timers[k] = setTimeout(function () { push(k).catch(function () {}); }, 1200);
  }

  // ---------- interface: botão da conta e janela de login ----------
  var slot, dlg, mode = 'entrar';
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var a in attrs || {}) { if (a === 'text') e.textContent = attrs[a]; else if (a.slice(0, 2) === 'on') e.addEventListener(a.slice(2), attrs[a]); else e.setAttribute(a, attrs[a]); }
    (kids || []).forEach(function (c) { if (c != null) e.append(c); });
    return e;
  }
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
      el('button', { role: 'menuitem', type: 'button', onclick: sair }, ['Sair', el('span', { text: 'As notas saem deste navegador e ficam na conta' })])
    ]);
    btn.addEventListener('click', function (e) { e.stopPropagation(); var o = menu.hidden; menu.hidden = !o; btn.setAttribute('aria-expanded', String(o)); });
    document.addEventListener('click', function (e) { if (!menu.hidden && !wrap.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    menu.addEventListener('click', function (e) { if (e.target.closest('button')) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    wrap.append(btn, menu);
    slot.append(wrap);
  }

  function buildDialog() {
    dlg = el('dialog', { class: 'auth', 'aria-labelledby': 'auth-title' });
    dlg.innerHTML =
      '<form id="auth-form" novalidate>' +
      '<h2 id="auth-title"></h2><p class="auth-sub" id="auth-sub"></p>' +
      '<div class="auth-tabs" role="tablist"><button type="button" role="tab" data-m="entrar">Entrar</button><button type="button" role="tab" data-m="criar">Criar conta</button></div>' +
      '<label class="auth-field" id="f-email">E-mail<input id="auth-email" type="email" autocomplete="email" required></label>' +
      '<label class="auth-field" id="f-senha">Senha<input id="auth-senha" type="password" autocomplete="current-password" minlength="6" required></label>' +
      '<button type="button" class="auth-link" id="auth-esqueci">Esqueci minha senha</button>' +
      '<p class="auth-msg" id="auth-msg" role="status"></p>' +
      '<div class="auth-acts"><button type="button" class="btn ghost" id="auth-cancelar">Cancelar</button><button type="submit" class="btn pri" id="auth-ok"></button></div>' +
      '</form>';
    document.body.append(dlg);
    dlg.querySelectorAll('.auth-tabs button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.m); }); });
    dlg.querySelector('#auth-cancelar').addEventListener('click', function () { dlg.close(); });
    dlg.querySelector('#auth-esqueci').addEventListener('click', function () { setMode('esqueci'); });
    dlg.querySelector('#auth-form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  }
  var TEXTS = {
    entrar: ['Entrar na sua conta', 'Suas notas ficam iguais em todos os aparelhos em que você entrar.', 'Entrar'],
    criar: ['Criar conta', 'Use seu e-mail e uma senha de pelo menos 6 caracteres. As notas que já estão neste navegador vão para a conta.', 'Criar conta'],
    esqueci: ['Redefinir senha', 'Enviaremos um link para você criar uma senha nova.', 'Enviar link'],
    nova: ['Criar senha nova', 'Digite a senha nova da sua conta.', 'Salvar senha']
  };
  function setMode(m) {
    mode = m; var t = TEXTS[m];
    dlg.querySelector('#auth-title').textContent = t[0];
    dlg.querySelector('#auth-sub').textContent = t[1];
    dlg.querySelector('#auth-ok').textContent = t[2];
    dlg.querySelector('.auth-tabs').hidden = (m === 'esqueci' || m === 'nova');
    dlg.querySelectorAll('.auth-tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.m === m)); });
    dlg.querySelector('#f-email').hidden = (m === 'nova');
    dlg.querySelector('#f-senha').hidden = (m === 'esqueci');
    dlg.querySelector('#auth-esqueci').hidden = (m !== 'entrar');
    dlg.querySelector('#auth-senha').setAttribute('autocomplete', m === 'entrar' ? 'current-password' : 'new-password');
    msg('');
  }
  function msg(t, kind) { var m = dlg.querySelector('#auth-msg'); m.textContent = t; m.dataset.kind = kind || ''; }
  function open(m) {
    if (!dlg) buildDialog();
    setMode(m);
    if (!dlg.open) dlg.showModal();
    var first = dlg.querySelector(m === 'nova' ? '#auth-senha' : '#auth-email'); if (first) first.focus();
  }
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
  async function submit() {
    var email = dlg.querySelector('#auth-email').value.trim(), senha = dlg.querySelector('#auth-senha').value;
    var okBtn = dlg.querySelector('#auth-ok');
    if (mode !== 'nova' && !/^\S+@\S+\.\S+$/.test(email)) { msg('Digite um e-mail válido.', 'erro'); return; }
    if (mode !== 'esqueci' && senha.length < 6) { msg('A senha precisa ter pelo menos 6 caracteres.', 'erro'); return; }
    okBtn.disabled = true; msg('Aguarde…');
    try {
      if (mode === 'entrar') {
        var r = await sb.auth.signInWithPassword({ email: email, password: senha });
        if (r.error) throw r.error;
        dlg.close();
      } else if (mode === 'criar') {
        var r2 = await sb.auth.signUp({ email: email, password: senha, options: { emailRedirectTo: pageUrl() } });
        if (r2.error) throw r2.error;
        if (r2.data.user && r2.data.user.identities && r2.data.user.identities.length === 0) { msg('Esse e-mail já tem conta. Use Entrar.', 'erro'); }
        else if (!r2.data.session) { msg('Pronto! Enviamos um link de confirmação para ' + email + '. Abra o e-mail e clique no link para ativar a conta.', 'ok'); }
        else dlg.close();
      } else if (mode === 'esqueci') {
        var r3 = await sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl() });
        if (r3.error) throw r3.error;
        msg('Se houver uma conta com esse e-mail, enviamos um link para criar a senha nova.', 'ok');
      } else if (mode === 'nova') {
        var r4 = await sb.auth.updateUser({ password: senha });
        if (r4.error) throw r4.error;
        msg('Senha alterada. Você já está conectado.', 'ok');
        setTimeout(function () { dlg.close(); }, 1200);
      }
    } catch (e) { msg(errText(e), 'erro'); }
    finally { okBtn.disabled = false; }
  }

  async function sair() {
    status('saving', 'Enviando as últimas mudanças…');
    try {
      for (var k in KEYS) if (ls(pendKey(k))) await push(k);
    } catch (e) {
      status('error', 'Não saiu: há mudanças que ainda não foram para a conta');
      alertBar('Não foi possível enviar as últimas mudanças para a conta. Verifique a internet e tente sair de novo.');
      return;
    }
    await sb.auth.signOut();
    for (var k2 in KEYS) { ls(k2, null); ls(pendKey(k2), null); emit(k2); }
    ls(UID_KEY, null);
    status('local', 'Salvo neste navegador');
  }
  function alertBar(t) { var b = document.getElementById('banner'); if (b) { b.textContent = t; b.hidden = false; } }

  // ---------- início ----------
  window.Nuvem = { changed: changed, open: open, get user() { return user; } };

  if (!CFG.url || !CFG.key || !window.supabase) return;   // site sem conta configurada
  sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  document.addEventListener('DOMContentLoaded', function () {
    slot = document.getElementById('account-slot');
    renderSlot();
  });
  sb.auth.onAuthStateChange(function (event, session) {
    var before = user && user.id;
    user = session ? session.user : null;
    renderSlot();
    if (event === 'PASSWORD_RECOVERY') { setTimeout(function () { open('nova'); }, 0); }
    if (user && (event === 'INITIAL_SESSION' || (event === 'SIGNED_IN' && before !== user.id))) setTimeout(syncAll, 0);
  });
  // ao voltar para a aba, busca o que mudou em outro aparelho
  var lastFocus = 0;
  window.addEventListener('focus', function () {
    if (!user || Date.now() - lastFocus < 15000) return;
    lastFocus = Date.now(); syncAll();
  });
})();
