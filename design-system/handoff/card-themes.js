/* ============================================================================
   КЛИМАТ-ПРО · card-themes.js — применение темы карточки {skin, behavior}
   Использование:
     KPCardThemes.apply(cardEl, { skin:'marble', behavior:'tilt' });
     KPCardThemes.clear(cardEl);                 // снять тему
     KPCardThemes.skins / KPCardThemes.behaviors // списки id для UI выбора
   Хранение в профиле: user.cardTheme = { skin:'classic', behavior:'none' }.
   Требует card-themes.css. Содержимое карточки должно лежать (или будет
   обёрнуто автоматически) в <div class="kp-body">…</div>.
   Для behavior 'flip' карточке нужен <div class="kp-back">…</div> (обратная
   сторона); для 'exp' — блок <div class="kp-more">…</div> внутри .kp-body.
   ========================================================================== */
(function (global) {
  'use strict';
  var uid = 0;
  function sparkSVG() {
    var id = 'kpg' + (++uid);
    return '<svg viewBox="0 0 300 64" preserveAspectRatio="none">'
      + '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="rgba(212,175,55,.42)"/><stop offset="1" stop-color="rgba(212,175,55,0)"/></linearGradient></defs>'
      + '<polygon points="0,56 0,42 40,46 80,28 120,34 160,16 200,26 240,10 300,18 300,64" fill="url(#' + id + ')"/>'
      + '<polyline points="0,42 40,46 80,28 120,34 160,16 200,26 240,10 300,18" fill="none" stroke="#e8c860" stroke-width="2.2"/></svg>';
  }
  var VEINS = '<svg class="kp-veins" viewBox="0 0 300 160" preserveAspectRatio="none">'
    + '<path d="M-10,44 C60,18 120,86 185,52 S280,26 320,64" fill="none" stroke="rgba(232,200,96,.85)" stroke-width="1.6"/>'
    + '<path d="M-10,108 C70,92 132,142 210,108 S300,120 330,98" fill="none" stroke="rgba(232,200,96,.55)" stroke-width="1.3"/>'
    + '<path d="M40,-10 C60,50 30,90 70,150" fill="none" stroke="rgba(255,246,213,.4)" stroke-width="1"/></svg>';
  var DUST = ['18,26,3', '64,18,2', '82,52,3', '38,64,2', '55,40,2.5', '26,78,2'].map(function (s, i) {
    var p = s.split(',');
    return '<span class="kp-st" style="left:' + p[0] + '%;top:' + p[1] + '%;width:' + p[2] + 'px;height:' + p[2] + 'px;animation-delay:' + (i * 0.45) + 's"></span>';
  }).join('');

  var SKINS = {
    classic: '<span class="kp-edge"></span>',
    carbon:  '<span class="kp-gloss"></span>',
    ingot:   '<span class="kp-edge"></span>',
    data:    '', /* слой добавляется функцией — уникальный градиент */
    foil:    '<span class="kp-foil"></span>',
    neon:    '',
    holo:    '<span class="kp-irid"></span>',
    marble:  '<span class="kp-edge"></span>' + VEINS,
    dust:    DUST
  };
  var BEHAVIORS = ['none', 'flip', 'spark', 'exp', 'pulse', 'tilt', 'lev'];

  function ensureBody(el) {
    if (el.querySelector(':scope > .kp-body')) return;
    var body = document.createElement('div');
    body.className = 'kp-body';
    var keep = [];
    Array.prototype.slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 1 && (n.classList.contains('kp-back') || n.classList.contains('kp-layer'))) { keep.push(n); return; }
      body.appendChild(n);
    });
    el.appendChild(body);
  }

  function clear(el) {
    (el.__kpTeardown || []).forEach(function (fn) { fn(); });
    el.__kpTeardown = [];
    el.className = el.className.replace(/\bkp-(skin|bh)-[\w-]+\b/g, '').replace(/\bkp-themed\b/g, '').replace(/\s+/g, ' ').trim();
    el.classList.remove('kp-flip-on');
    Array.prototype.slice.call(el.querySelectorAll(':scope > .kp-layer')).forEach(function (n) { n.remove(); });
    el.style.transform = '';
  }

  function layer(el, html) {
    var w = document.createElement('span');
    w.className = 'kp-layer';
    w.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:block;border-radius:inherit;';
    w.innerHTML = html;
    el.appendChild(w);
  }

  function apply(el, theme) {
    theme = theme || {};
    var skin = SKINS.hasOwnProperty(theme.skin) ? theme.skin : 'classic';
    var bh = BEHAVIORS.indexOf(theme.behavior) > -1 ? theme.behavior : 'none';
    clear(el);
    ensureBody(el);
    el.classList.add('kp-themed', 'kp-skin-' + skin);
    if (bh !== 'none') el.classList.add('kp-bh-' + bh);

    var layers = SKINS[skin];
    if (skin === 'data') layers = '<span class="kp-dspark">' + sparkSVG() + '</span>';
    if (layers) layer(el, layers);
    if (bh === 'spark') layer(el, '<span class="kp-bspark">' + sparkSVG() + '</span>');

    var td = el.__kpTeardown;
    if (bh === 'tilt') {
      var mv = function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        el.style.transform = 'perspective(800px) rotateX(' + ((py - 0.5) * -11) + 'deg) rotateY(' + ((px - 0.5) * 13) + 'deg) translateY(-3px)';
      };
      var lv = function () { el.style.transform = ''; };
      el.addEventListener('mousemove', mv); el.addEventListener('mouseleave', lv);
      td.push(function () { el.removeEventListener('mousemove', mv); el.removeEventListener('mouseleave', lv); el.style.transform = ''; });
    }
    if (bh === 'flip') {
      var ck = function () { el.classList.toggle('kp-flip-on'); };
      el.addEventListener('click', ck);
      td.push(function () { el.removeEventListener('click', ck); el.classList.remove('kp-flip-on'); });
    }
    return el;
  }

  global.KPCardThemes = {
    apply: apply,
    clear: clear,
    skins: Object.keys(SKINS),
    behaviors: BEHAVIORS.slice()
  };
})(window);
