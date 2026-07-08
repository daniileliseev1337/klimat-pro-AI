/* LogoMark — compact живой логотип for the sidebar: a gold sheen-ring capsule
   whose inner mark morphs through the 5 тематических знака (Л). React + inline. */
(function () {
  const grad = (id, dur) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="48" y2="48">
    <stop offset="0" stop-color="#a9821f"/><stop offset="0.42" stop-color="#d4af37"/>
    <stop offset="0.5" stop-color="#fff6d5"/><stop offset="0.58" stop-color="#e8c860"/><stop offset="1" stop-color="#a9821f"/>
    <animateTransform attributeName="gradientTransform" type="translate" values="-48 -48;48 48;-48 -48" dur="${dur || 4}s" repeatCount="indefinite"/>
  </linearGradient>`;

  const ART = {
    apert: (s) => `<defs>${grad('g'+s)}</defs><g class="lm-spin" stroke="url(#g${s})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <polygon points="31,24 27.5,30.06 20.5,30.06 17,24 20.5,17.94 27.5,17.94" stroke-width="1.4" opacity="0.55"/>
      <line x1="31" y1="24" x2="31" y2="36.12"/><line x1="27.5" y1="30.06" x2="17" y2="36.12"/>
      <line x1="20.5" y1="30.06" x2="10" y2="24"/><line x1="17" y1="24" x2="17" y2="11.88"/>
      <line x1="20.5" y1="17.94" x2="31" y2="11.88"/><line x1="27.5" y1="17.94" x2="38" y2="24"/></g>`,
    gauge: (s) => `<defs>${grad('g'+s)}</defs>
      <circle cx="24" cy="24" r="13" fill="none" stroke="#d4af37" stroke-opacity="0.18" stroke-width="3" stroke-linecap="round" stroke-dasharray="61.3 20.4" transform="rotate(135 24 24)"/>
      <circle class="lm-fill" cx="24" cy="24" r="13" fill="none" stroke="url(#g${s})" stroke-width="3" stroke-linecap="round" stroke-dasharray="44 38" transform="rotate(135 24 24)"/>
      <circle cx="24" cy="24" r="3.1" fill="url(#g${s})"/><line x1="24" y1="24" x2="32.5" y2="15.5" stroke="url(#g${s})" stroke-width="2" stroke-linecap="round"/>`,
    hex: (s) => `<defs>${grad('g'+s,5)}</defs>
      <polygon points="24,7 38.7,15.5 38.7,32.5 24,41 9.3,32.5 9.3,15.5" fill="none" stroke="url(#g${s})" stroke-width="2" stroke-linejoin="round"/>
      <g stroke="url(#g${s})" stroke-width="2.4" stroke-linecap="round">
      <line class="lm-glow" x1="19" y1="20" x2="29" y2="20"/><line class="lm-glow" style="animation-delay:-1s" x1="16.5" y1="24" x2="31.5" y2="24"/>
      <line class="lm-glow" style="animation-delay:-2s" x1="19" y1="28" x2="29" y2="28"/></g>`,
    drop: (s) => `<defs>${grad('g'+s,4.2)}</defs>
      <path class="lm-breathe" d="M24 10C24 10 33 21 33 28a9 9 0 1 1-18 0C15 21 24 10 24 10Z" fill="url(#g${s})" fill-opacity="0.15" stroke="url(#g${s})" stroke-width="2" stroke-linejoin="round"/>
      <path class="lm-breathe" d="M19.5 27.5a4.5 4.5 0 0 0 3.4 5.4" fill="none" stroke="#fff6d5" stroke-opacity="0.7" stroke-width="1.6" stroke-linecap="round"/>`,
    flow: (s) => `<defs>${grad('g'+s)}</defs><g stroke="url(#g${s})" stroke-width="2.4" stroke-linecap="round" fill="none">
      <path class="lm-flow" d="M12 18h16a4 4 0 1 0-4-4"/>
      <path class="lm-flow" style="animation-delay:-0.8s" d="M12 24h22a4 4 0 1 1-4 4"/>
      <path class="lm-flow" style="animation-delay:-1.6s" d="M12 30h12a4 4 0 1 0-4 4"/></g>`,
  };
  const ORDER = ['apert', 'gauge', 'hex', 'drop', 'flow'];

  if (!document.getElementById('lm-style')) {
    const st = document.createElement('style');
    st.id = 'lm-style';
    st.textContent = `
      @keyframes lm-spin{to{transform:rotate(360deg)}}
      @keyframes lm-flow{to{stroke-dashoffset:-64}}
      @keyframes lm-fill{0%,100%{stroke-dasharray:30 52}50%{stroke-dasharray:52 30}}
      @keyframes lm-glow{0%,100%{opacity:.45}50%{opacity:1}}
      @keyframes lm-breathe{0%,100%{transform:scale(.95)}50%{transform:scale(1)}}
      @keyframes lm-sheen{0%{background-position:0 0}100%{background-position:280% 0}}
      .lm-spin{transform-origin:24px 24px;animation:lm-spin 18s linear infinite}
      .lm-flow{stroke-dasharray:10 8;animation:lm-flow 2.4s linear infinite}
      .lm-fill{animation:lm-fill 4s cubic-bezier(.4,0,.2,1) infinite}
      .lm-glow{animation:lm-glow 3s ease-in-out infinite}
      .lm-breathe{transform-origin:24px 25px;animation:lm-breathe 3.4s ease-in-out infinite}
      .lm-cap{position:relative;background:#0d0d0c;box-shadow:0 0 18px -4px var(--accent-glow),inset 0 0 12px -6px rgba(212,175,55,.45)}
      .lm-cap::before{content:'';position:absolute;inset:0;border-radius:inherit;padding:1.6px;pointer-events:none;
        background:linear-gradient(115deg,#8c6c18 0%,#b8901f 18%,#fff6d5 32%,#e8c860 42%,#a9821f 60%,#fff1c4 76%,#b8901f 90%,#8c6c18 100%);
        background-size:280% 100%;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
        -webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;
        filter:drop-shadow(0 0 4px rgba(212,175,55,.55));animation:lm-sheen 4s linear infinite}
      .lm-layer{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
      @media (prefers-reduced-motion:reduce){.lm-spin,.lm-flow,.lm-fill,.lm-glow,.lm-breathe,.lm-cap::before{animation:none}}
    `;
    document.head.appendChild(st);
  }

  function LogoMark({ size = 36, radius = 11, hold = 2600 }) {
    const [idx, setIdx] = React.useState(0);
    const trans = 1000;
    React.useEffect(() => {
      const t = setInterval(() => setIdx((i) => (i + 1) % ORDER.length), hold);
      return () => clearInterval(t);
    }, [hold]);
    const layer = (key, i) => {
      const on = i === idx;
      return React.createElement('div', {
        key,
        className: 'lm-layer',
        style: {
          opacity: on ? 1 : 0,
          transform: on ? 'scale(1)' : 'scale(0.66)',
          filter: on ? 'none' : 'blur(5px)',
          transition: on
            ? `opacity ${trans*0.62}ms ease-out ${trans*0.32}ms, transform ${trans*0.7}ms cubic-bezier(0.5,0,0.18,1.22) ${trans*0.22}ms, filter ${trans*0.62}ms ease-out ${trans*0.32}ms`
            : `opacity ${trans*0.5}ms cubic-bezier(0.5,0,0.75,0.4), transform ${trans*0.5}ms ease-in, filter ${trans*0.5}ms ease-in`,
        },
        dangerouslySetInnerHTML: { __html: `<svg width="${Math.round(size*0.72)}" height="${Math.round(size*0.72)}" viewBox="0 0 48 48" fill="none">${ART[key]('lm_'+key)}</svg>` },
      });
    };
    return React.createElement('div', {
      className: 'lm-cap',
      style: { width: size, height: size, borderRadius: radius, flexShrink: 0 },
    }, ORDER.map((k, i) => layer(k, i)));
  }

  window.LogoMark = LogoMark;
})();
