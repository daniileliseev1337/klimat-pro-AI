/* select.js — общий выбор карточек-тем для КЛИМАТ Pro.
   Ставит галочку рядом с каждой карточкой (.dir + .num), хранит выбор в
   localStorage (общий для всех бордов) и показывает плавающий счётчик
   «Выбрано N / 10» со списком и копированием. Подключать ПОСЛЕ инлайн-скрипта,
   который строит .grid. */
(function(){
  var KEY='kp_cards_selected', LIMIT=10;
  function load(){try{return JSON.parse(localStorage.getItem(KEY))||[];}catch(e){return [];}}
  function save(a){localStorage.setItem(KEY,JSON.stringify(a));}
  var sel=load();

  function boardName(){var h=document.querySelector('h1');return h?h.textContent:'';}

  // ── галочки на карточках ──
  var dirs=document.querySelectorAll('.dir');
  dirs.forEach(function(dir){
    var num=dir.querySelector('.num'); if(!num) return;
    var id=num.textContent.trim();
    var name=(dir.querySelector('.dname')||{}).textContent||('Карточка '+id);
    // строка-шапка: номер + галочка
    var bar=document.createElement('div');
    bar.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;';
    dir.insertBefore(bar,num); bar.appendChild(num);
    var cb=document.createElement('button');
    cb.type='button';
    cb.setAttribute('aria-label','Выбрать');
    cb.style.cssText='display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;color:#a8a8a3;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 10px 4px 5px;transition:all .18s;';
    cb.innerHTML='<span class="dot" style="width:17px;height:17px;border-radius:50%;border:1.5px solid rgba(212,175,55,.5);display:grid;place-items:center;transition:all .18s;flex-shrink:0"></span><span class="lbl">выбрать</span>';
    bar.appendChild(cb);

    function paint(){
      var on=sel.indexOf(id)>-1;
      var dot=cb.querySelector('.dot'), lbl=cb.querySelector('.lbl');
      if(on){cb.style.color='#1a1408';cb.style.background='linear-gradient(#e8c860,#c9a431)';cb.style.borderColor='#e8c860';cb.style.boxShadow='0 0 14px -3px rgba(212,175,55,.6)';
        dot.style.background='#1a1408';dot.style.borderColor='#1a1408';dot.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e8c860" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 5 5L20 6"/></svg>';lbl.textContent='выбрано';
        dir.style.outline='2px solid rgba(212,175,55,.55)';dir.style.outlineOffset='4px';dir.style.borderRadius='18px';}
      else{cb.style.color='#a8a8a3';cb.style.background='rgba(255,255,255,.04)';cb.style.borderColor='rgba(255,255,255,.12)';cb.style.boxShadow='none';
        dot.style.background='transparent';dot.style.borderColor='rgba(212,175,55,.5)';dot.innerHTML='';lbl.textContent='выбрать';
        dir.style.outline='none';}
    }
    cb.addEventListener('click',function(e){
      e.stopPropagation();
      var i=sel.indexOf(id);
      if(i>-1){sel.splice(i,1);}
      else{ if(sel.length>=LIMIT){flash();return;} sel.push(id); sel.sort(function(a,b){return a-b;}); }
      save(sel); paint(); renderTray();
    });
    paint();
  });

  // ── плавающий счётчик ──
  var tray=document.createElement('div');
  tray.style.cssText='position:fixed;right:20px;bottom:20px;z-index:9999;width:230px;background:rgba(16,15,13,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(212,175,55,.4);border-radius:16px;padding:14px 15px;box-shadow:0 18px 46px rgba(0,0,0,.6);font-family:Geist,system-ui,sans-serif;color:#fafaf7;';
  document.body.appendChild(tray);
  var pulse=document.createElement('style');
  pulse.textContent='@keyframes trayflash{0%,100%{border-color:rgba(212,175,55,.4)}50%{border-color:#f8a3a3}}';
  document.head.appendChild(pulse);
  function flash(){tray.style.animation='trayflash .4s ease 2';setTimeout(function(){tray.style.animation='';},900);}

  function renderTray(){
    var n=sel.length;
    tray.innerHTML=
      '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:9px">'
      +'<span style="font-size:12px;font-weight:600;letter-spacing:.02em">Мои темы</span>'
      +'<span style="font-family:Geist Mono,monospace;font-size:13px;color:'+(n>=LIMIT?'#e8c860':'#a8a8a3')+'"><b style="color:#f7f8f8">'+n+'</b> / '+LIMIT+'</span></div>'
      +'<div style="display:flex;flex-wrap:wrap;gap:5px;min-height:24px;margin-bottom:10px">'
      +(n?sel.map(function(id){return '<span data-rm="'+id+'" style="cursor:pointer;font-family:Geist Mono,monospace;font-size:11px;font-weight:600;color:#1a1408;background:linear-gradient(#e8c860,#c9a431);border-radius:6px;padding:2px 7px">'+id+' ✕</span>';}).join(''):'<span style="font-size:11px;color:#6b6b67">ставь галочки на карточках…</span>')
      +'</div>'
      +'<div style="display:flex;gap:6px">'
      +'<button data-copy style="flex:1;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;color:#1a1408;background:linear-gradient(#e8c860,#a9821f);border:none;border-radius:9px;padding:8px">Скопировать выбор</button>'
      +(n?'<button data-clear style="cursor:pointer;font-family:inherit;font-size:11px;color:#a8a8a3;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:8px 10px">Сброс</button>':'')
      +'</div>';
    tray.querySelectorAll('[data-rm]').forEach(function(t){t.addEventListener('click',function(){var id=t.dataset.rm,i=sel.indexOf(id);if(i>-1){sel.splice(i,1);save(sel);syncCards();renderTray();}});});
    var cp=tray.querySelector('[data-copy]');
    if(cp)cp.addEventListener('click',function(){var txt='Выбранные темы карточек: '+(sel.length?sel.join(', '):'—');
      navigator.clipboard&&navigator.clipboard.writeText(txt);cp.textContent='Скопировано ✓';setTimeout(function(){renderTray();},1200);});
    var cl=tray.querySelector('[data-clear]');
    if(cl)cl.addEventListener('click',function(){sel=[];save(sel);syncCards();renderTray();});
  }
  function syncCards(){ // перекрасить галочки после изменений из трея
    document.querySelectorAll('.dir').forEach(function(dir){
      var num=dir.querySelector('.num'); if(!num)return; var id=num.textContent.trim();
      var cb=dir.querySelector('button[aria-label="Выбрать"]'); if(!cb)return;
      var on=sel.indexOf(id)>-1, dot=cb.querySelector('.dot'), lbl=cb.querySelector('.lbl');
      if(on){cb.style.color='#1a1408';cb.style.background='linear-gradient(#e8c860,#c9a431)';cb.style.borderColor='#e8c860';cb.style.boxShadow='0 0 14px -3px rgba(212,175,55,.6)';dot.style.background='#1a1408';dot.style.borderColor='#1a1408';dot.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e8c860" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 5 5L20 6"/></svg>';lbl.textContent='выбрано';dir.style.outline='2px solid rgba(212,175,55,.55)';dir.style.outlineOffset='4px';dir.style.borderRadius='18px';}
      else{cb.style.color='#a8a8a3';cb.style.background='rgba(255,255,255,.04)';cb.style.borderColor='rgba(255,255,255,.12)';cb.style.boxShadow='none';dot.style.background='transparent';dot.style.borderColor='rgba(212,175,55,.5)';dot.innerHTML='';lbl.textContent='выбрать';dir.style.outline='none';}
    });
  }
  renderTray();
})();
