/* =====================================================================
   Rancho El Descanso · capa de experiencia (lux.js)
   - Intro "Entrar al rancho" (una vez cada pocos días)
   - Sonido ambiente del rancho que sube poco a poco
   - Apariciones suaves al bajar, parallax, galería a pantalla completa
   - Cursor dorado (escritorio) y barra de avance
   - Recorrido 360° (se activa solo cuando haya fotos 360 en TOUR_360)

   Para usar una grabación real del rancho en lugar del sonido generado,
   sube el archivo a /sonido/rancho.mp3 y cambia SONIDO_REAL a true.
   ===================================================================== */
(function(){
"use strict";
const SONIDO_REAL = false;                 // true = usa /sonido/rancho.mp3
const SONIDO_URL  = "/sonido/rancho.mp3";
const VOLUMEN     = 0.62;                  // volumen final (0 a 1)
const SUBIDA_SEG  = 26;                    // segundos en llegar al volumen final la primera vez
const MUSICA_VOL  = 0.36;                  // volumen de la guitarra respecto al ambiente (0 a 1)

/* Recorrido 360°: agrega fotos equirectangulares (2:1) a /tour/ y ponlas aquí.
   { titulo:"La pista", foto:"/tour/pista.jpg" }                                  */
const TOUR_360 = [];

const d=document, html=d.documentElement, W=window;
const reduce = W.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fino   = W.matchMedia("(hover: hover) and (pointer: fine)").matches;
const ls = { get(k){ try{return localStorage.getItem(k)}catch(e){return null} }, set(k,v){ try{localStorage.setItem(k,v)}catch(e){} } };
const esInicio = !!d.querySelector(".hero .hero-claim");
const raiz = (d.currentScript && d.currentScript.src) ? new URL(".", d.currentScript.src).pathname : "/";

if(!("IntersectionObserver" in W)) return;
html.classList.add("lux");

/* =================================================================
   1. SONIDO AMBIENTE (se genera en vivo: viento, hojas, aves, palomas,
      cascos y resoplidos a lo lejos; nunca se repite igual)
   ================================================================= */
const Amb = (function(){
  let ctx=null, master=null, bus=null, wet=null, started=false, playing=false, timers=[], file=null, gust=null;
  const R=(a,b)=>a+Math.random()*(b-a), pick=a=>a[Math.floor(Math.random()*a.length)];
  function later(fn,ms){ const t=setTimeout(()=>{ timers.splice(timers.indexOf(t),1); fn(); },ms); timers.push(t); }

  function noise(sec,pink){
    const n=Math.floor(ctx.sampleRate*sec), b=ctx.createBuffer(2,n,ctx.sampleRate);
    for(let c=0;c<2;c++){ const o=b.getChannelData(c); let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for(let i=0;i<n;i++){ const w=Math.random()*2-1;
        if(!pink){ o[i]=w; continue; }
        b0=.99886*b0+w*.0555179; b1=.99332*b1+w*.0750759; b2=.969*b2+w*.153852; b3=.8665*b3+w*.3104856; b4=.55*b4+w*.5329522; b5=-.7616*b5-w*.016898;
        o[i]=(b0+b1+b2+b3+b4+b5+b6+w*.5362)*.11; b6=w*.115926; } }
    return b;
  }
  function impulse(sec,decay){
    const n=Math.floor(ctx.sampleRate*sec), b=ctx.createBuffer(2,n,ctx.sampleRate);
    for(let c=0;c<2;c++){ const o=b.getChannelData(c); for(let i=0;i<n;i++) o[i]=(Math.random()*2-1)*Math.pow(1-i/n,decay)*(i<ctx.sampleRate*.012?0:1); }
    return b;
  }
  /* una voz de ave/tono con barrido, armónico y distancia */
  function voice(t,f0,f1,dur,amp,pan,dist,opts){
    opts=opts||{};
    const o=ctx.createOscillator(), g=ctx.createGain(), p=ctx.createStereoPanner(), lp=ctx.createBiquadFilter();
    o.type=opts.type||"sine";
    o.frequency.setValueAtTime(f0,t);
    if(opts.mid){ o.frequency.exponentialRampToValueAtTime(opts.mid,t+dur*.45); o.frequency.exponentialRampToValueAtTime(f1,t+dur); }
    else o.frequency.exponentialRampToValueAtTime(f1,t+dur);
    const a=Math.min(opts.att||.012,dur/3);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(amp,t+a);
    g.gain.setValueAtTime(amp,t+Math.max(a,dur*(opts.hold||.55)));
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    lp.type="lowpass"; lp.frequency.value=opts.lp||(12000-dist*8000); lp.Q.value=.3;
    p.pan.value=pan;
    o.connect(g); g.connect(lp); lp.connect(p); p.connect(bus);
    if(opts.h2){ const o2=ctx.createOscillator(), g2=ctx.createGain(); o2.frequency.setValueAtTime(f0*2,t);
      if(opts.mid){ o2.frequency.exponentialRampToValueAtTime(opts.mid*2,t+dur*.45); o2.frequency.exponentialRampToValueAtTime(f1*2,t+dur);} else o2.frequency.exponentialRampToValueAtTime(f1*2,t+dur);
      g2.gain.value=opts.h2; o2.connect(g2); g2.connect(g); o2.start(t); o2.stop(t+dur+.05); }
    if(opts.vib){ const l=ctx.createOscillator(), lg=ctx.createGain(); l.frequency.value=opts.vib[0]; lg.gain.value=opts.vib[1]; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t+dur+.05); }
    o.start(t); o.stop(t+dur+.05);
  }
  /* ---- especies (inspiradas en aves comunes de Jalisco) ---- */
  const birds = {
    // gorrión / mosquero: serie de "chips" descendentes
    chips(t,pan,dist){ const n=Math.round(R(3,7)), f=R(4300,6200), a=R(.05,.11)*(1-dist*.6); let x=t;
      for(let i=0;i<n;i++){ const d=R(.035,.06); voice(x,f*R(.97,1.03),f*R(.62,.72),d,a,pan,dist,{h2:.08,att:.004}); x+=R(.085,.14); } return x-t; },
    // jilguero / dominico: trino rápido
    trill(t,pan,dist){ const dur=R(.7,1.6), rate=R(16,26), f=R(3600,5200), a=R(.04,.08)*(1-dist*.6); const n=Math.floor(dur*rate);
      for(let i=0;i<n;i++){ const x=t+i/rate; voice(x,f*.86,f*R(1.05,1.12),.9/rate,a*(.6+.4*Math.sin(Math.PI*i/n)),pan,dist,{att:.003}); } return dur; },
    // cenzontle / primavera: frase melódica silbada
    song(t,pan,dist){ const n=Math.round(R(4,8)), base=R(1900,3000), a=R(.06,.12)*(1-dist*.55); let x=t;
      const notas=[1,1.122,1.26,1.335,1.498,1.68,2]; for(let i=0;i<n;i++){ const f=base*pick(notas), d=R(.08,.22), g=R(.82,1.22);
        voice(x,f,f*g,d,a,pan,dist,{h2:.12,att:.015,hold:.7,vib:Math.random()<.3?[R(30,60),f*.04]:null}); x+=d+R(.03,.09); }
      if(Math.random()<.45){ later(()=>{ if(playing) birds.song(ctx.currentTime+.05,pan+R(-.05,.05),dist); }, (x-t)*1000+R(900,2400)); } return x-t; },
    // paloma de alas blancas: "hu-hu-HUU-hu"
    dove(t,pan,dist){ const f=R(480,600), a=R(.07,.11)*(1-dist*.5); const pat=pick([[.22,.22,.55,.3],[.35,.25,.6],[.3,.3,.3,.55,.28]]); let x=t;
      pat.forEach((d,i)=>{ const up=d>.4?1.08:1.02; voice(x,f*.94,f*.9,d,a*(d>.4?1:.75),pan,dist,{mid:f*up,h2:.22,att:.06,hold:.5,lp:1600}); x+=d+R(.07,.14); }); return x-t; },
    // tórtola coquena: "ka-HUU" suave y repetido
    inca(t,pan,dist){ const f=R(560,680), a=R(.05,.08)*(1-dist*.5); let x=t; const reps=Math.round(R(2,4));
      for(let i=0;i<reps;i++){ voice(x,f*1.06,f*.93,.42,a,pan,dist,{mid:f*1.1,h2:.18,att:.05,lp:1500}); x+=R(1.1,1.5); } return x-t; },
    // zanate a lo lejos: silbido ascendente
    whistle(t,pan,dist){ const a=R(.035,.06)*(1-dist*.5); voice(t,R(1300,1800),R(5200,6400),R(.35,.55),a,pan,Math.max(dist,.5),{att:.04,hold:.65}); return .6; }
  };
  const peso=[["chips",5],["song",6],["trill",4],["dove",3],["inca",2],["whistle",1]];
  function birdLoop(){
    if(!playing) return;
    if(ctx.state!=="running") return later(birdLoop,1500);
    let r=Math.random()*peso.reduce((s,x)=>s+x[1],0), sp="chips"; for(const [k,w] of peso){ if((r-=w)<0){ sp=k; break; } }
    const dist=Math.random()<.35?R(.55,.9):R(.05,.5);
    const len=birds[sp](ctx.currentTime+.05,R(-.85,.85),dist);
    later(birdLoop,(len*1000)+R(500,3200));
  }
  /* viento y hojas */
  function wind(){
    const src=ctx.createBufferSource(); src.buffer=noise(6,true); src.loop=true;
    const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=900; lp.Q.value=.3;
    const hp0=ctx.createBiquadFilter(); hp0.type="highpass"; hp0.frequency.value=170; hp0.Q.value=.5;
    const g=ctx.createGain(); g.gain.value=.16;
    src.connect(hp0); hp0.connect(lp); lp.connect(g); g.connect(bus); src.start();
    const s2=ctx.createBufferSource(); s2.buffer=noise(5,false); s2.loop=true;
    const hp=ctx.createBiquadFilter(); hp.type="bandpass"; hp.frequency.value=4800; hp.Q.value=.5;
    const g2=ctx.createGain(); g2.gain.value=.0;
    s2.connect(hp); hp.connect(g2); g2.connect(bus); s2.start();
    gust={lp,g,g2};
  }
  function gustLoop(){ if(!playing) return; if(ctx.state==="running"){ const {lp,g,g2}=gust, now=ctx.currentTime, k=R(0,1);
      lp.frequency.setTargetAtTime(R(550,1500),now,R(1.2,2.6));
      g.gain.setTargetAtTime(.08+k*.2,now,R(1,2.2));
      g2.gain.setTargetAtTime(k>.55?R(.012,.03):R(.002,.008),now+.4,R(.8,1.8)); }
      later(gustLoop,R(2600,6200)); }
  /* caballo: cascos al paso y resoplido */
  function hoof(t,pan,amp){
    const s=ctx.createBufferSource(); s.buffer=noise(.08,false);
    const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=R(450,750); bp.Q.value=1.2;
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(amp,t+.004); g.gain.exponentialRampToValueAtTime(0.0001,t+.07);
    const o=ctx.createOscillator(), og=ctx.createGain(); o.frequency.setValueAtTime(R(95,120),t); o.frequency.exponentialRampToValueAtTime(55,t+.09);
    og.gain.setValueAtTime(0.0001,t); og.gain.exponentialRampToValueAtTime(amp*1.3,t+.006); og.gain.exponentialRampToValueAtTime(0.0001,t+.1);
    const p=ctx.createStereoPanner(); p.pan.value=pan;
    s.connect(bp); bp.connect(g); g.connect(p); o.connect(og); og.connect(p); p.connect(bus);
    s.start(t); s.stop(t+.09); o.start(t); o.stop(t+.12);
  }
  function snort(t,pan,amp){
    const s=ctx.createBufferSource(); s.buffer=noise(.9,false);
    const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.setValueAtTime(1300,t); bp.frequency.exponentialRampToValueAtTime(700,t+.7); bp.Q.value=.8;
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(amp,t+.05); g.gain.setTargetAtTime(0.0001,t+.18,.16);
    const am=ctx.createOscillator(), amg=ctx.createGain(); am.frequency.value=R(22,32); amg.gain.value=amp*.5; am.connect(amg); amg.connect(g.gain);
    const p=ctx.createStereoPanner(); p.pan.value=pan;
    s.connect(bp); bp.connect(g); g.connect(p); p.connect(bus); s.start(t); s.stop(t+.9); am.start(t); am.stop(t+.9);
  }
  function horseLoop(){
    if(!playing) return;
    if(ctx.state!=="running") return later(horseLoop,4000);
    const now=ctx.currentTime+.1, steps=Math.round(R(10,22)), from=R(-.9,-.3)*(Math.random()<.5?1:-1), to=-from*R(.3,.8), amp=R(.05,.1);
    let x=now; const ritmo=[.30,.24,.30,.22];
    for(let i=0;i<steps;i++){ const k=i/steps; hoof(x,from+(to-from)*k,amp*(.55+.45*Math.sin(Math.PI*k))); x+=ritmo[i%4]*R(.92,1.1); }
    if(Math.random()<.6) snort(x+R(.4,1.2),to,amp*1.1);
    later(horseLoop,(x-now)*1000+R(22000,42000));
  }
  /* ---- grabaciones reales: relinchos, cascos al paso, trote, galope, caballeriza ---- */
  const API = raiz+"api/sonido?s=", bufs={};
  function sample(key,desde,largo){
    const k=key+(desde!=null?"@"+desde:"");
    if(!bufs[k]) bufs[k]=fetch(API+key+(desde!=null?`&desde=${desde}&largo=${largo}`:""))
      .then(r=>{ if(!r.ok) throw new Error("sonido"); return r.arrayBuffer(); })
      .then(b=>new Promise((ok,ko)=>ctx.decodeAudioData(b,ok,ko)))
      .then(buf=>{ let pk=0; for(let c=0;c<buf.numberOfChannels;c++){ const a=buf.getChannelData(c); for(let i=0;i<a.length;i+=7){ const v=Math.abs(a[i]); if(v>pk) pk=v; } } buf._pk=pk||1; return buf; })
      .catch(e=>{ delete bufs[k]; throw e; });
    return bufs[k];
  }
  /* toca una grabación: nivel normalizado (pico = nivel), paneo que se mueve, distancia */
  function playBuf(buf,o){
    const now=ctx.currentTime+.05, src=ctx.createBufferSource(); src.buffer=buf; src.playbackRate.value=o.rate||1;
    const g=ctx.createGain(), p=ctx.createStereoPanner(), lp=ctx.createBiquadFilter();
    lp.type="lowpass"; lp.frequency.value=12000-(o.dist||.3)*8500; lp.Q.value=.3;
    const dur=buf.duration/(o.rate||1), amp=Math.min(1.2,o.nivel/buf._pk), fi=o.fi||.04, fo=Math.min(o.fo||.3,dur/2);
    g.gain.setValueAtTime(0.0001,now); g.gain.exponentialRampToValueAtTime(amp,now+fi);
    g.gain.setValueAtTime(amp,now+Math.max(fi,dur-fo)); g.gain.exponentialRampToValueAtTime(0.0001,now+dur);
    p.pan.setValueAtTime(o.pan||0,now); if(o.pan2!=null) p.pan.linearRampToValueAtTime(o.pan2,now+dur);
    src.connect(lp); lp.connect(g); g.connect(p); p.connect(bus); src.start(now); src.stop(now+dur+.05);
    return dur;
  }
  const EVENTOS=[["paso",5],["relincho",4],["trote",3],["establo",3],["resoplido",3],["galope",1]];
  /* tramos medidos en cada grabación: donde los caballos pasan cerca */
  const TROZOS={paso:[18,30],trote:[24,26],establo:[10,16]};
  async function realLoop(){
    if(!playing) return;
    if(ctx.state!=="running") return later(realLoop,4000);
    let r=Math.random()*EVENTOS.reduce((t,x)=>t+x[1],0), ev="paso"; for(const [k,w] of EVENTOS){ if((r-=w)<0){ ev=k; break; } }
    if(!realLoop.n){ ev="relincho"; } else if(realLoop.n===1){ ev="paso"; } realLoop.n=(realLoop.n||0)+1;
    let dur=3; const lado=R(-.9,.9);
    try{
      if(ev==="paso")      dur=playBuf(await sample("paso",...TROZOS.paso),{nivel:R(.14,.2),pan:lado*.6,pan2:-lado*.6,dist:R(.25,.5),fi:2.5,fo:4,rate:R(.97,1.02)});
      else if(ev==="trote") dur=playBuf(await sample("trote",...TROZOS.trote),{nivel:R(.14,.2),pan:lado*.7,pan2:-lado*.7,dist:R(.3,.55),fi:2,fo:4,rate:R(.97,1.03)});
      else if(ev==="relincho") dur=playBuf(await sample(pick(["relincho1","relincho1","relincho2","relincho3"])),{nivel:R(.15,.24),pan:R(-.8,.8),dist:R(.35,.75),rate:R(.95,1.03)});
      else if(ev==="establo") dur=playBuf(await sample("establo",...TROZOS.establo),{nivel:R(.15,.22),pan:R(-.5,.5),dist:.3,fi:1,fo:2});
      else if(ev==="resoplido") dur=playBuf(await sample("resoplido"),{nivel:R(.14,.2),pan:R(-.7,.7),dist:R(.2,.5)});
      else dur=playBuf(await sample("galope"),{nivel:R(.12,.17),pan:lado,pan2:-lado*.5,dist:R(.45,.75),fo:.6});
    }catch(e){ return horseLoop(); }               // sin conexión al sonido: cascos generados
    later(realLoop,dur*1000+R(8000,20000));
  }
  /* ---- música de fondo (guitarra acústica) ---- */
  let music=null, musicG=null;
  function musica(){
    if(SONIDO_REAL) return;
    if(!music){
      music=new Audio(); music.crossOrigin="anonymous"; music.setAttribute("playsinline",""); music.loop=true; music.preload="auto"; music.src=API+"musica";
      try{ const src=ctx.createMediaElementSource(music); musicG=ctx.createGain(); musicG.gain.value=0.0001; src.connect(musicG); musicG.connect(master); }catch(e){ musicG=null; }
    }
    const p=music.play(); if(p&&p.catch) p.catch(()=>{});
    if(musicG){ const t=ctx.currentTime; musicG.gain.cancelScheduledValues(t); musicG.gain.setValueAtTime(Math.max(musicG.gain.value,0.0001),t); musicG.gain.setTargetAtTime(MUSICA_VOL,t+3,5); }
  }
  /* iPhone/iPad: sin esto el sonido sale mudo si el interruptor de silencio está activado
     (sobre todo en la app instalada). "playback" lo trata como música, igual que un video. */
  let llave=null;
  function desbloquearIOS(){
    try{ if(navigator.audioSession) navigator.audioSession.type="playback"; }catch(e){}
    try{
      if(!llave){
        const sr=8000, n=sr/2, b=new ArrayBuffer(44+n*2), v=new DataView(b), w=(o,t)=>{ for(let i=0;i<t.length;i++) v.setUint8(o+i,t.charCodeAt(i)); };
        w(0,"RIFF"); v.setUint32(4,36+n*2,true); w(8,"WAVEfmt "); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
        v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,"data"); v.setUint32(40,n*2,true);
        llave=new Audio(URL.createObjectURL(new Blob([b],{type:"audio/wav"}))); llave.loop=true; llave.setAttribute("playsinline",""); llave.volume=0.01;
      }
      const p=llave.play(); if(p&&p.catch) p.catch(()=>{});
    }catch(e){}
  }
  function build(){
    const AC=W.AudioContext||W.webkitAudioContext; if(!AC) return false;
    try{ if(navigator.audioSession) navigator.audioSession.type="playback"; }catch(e){}
    ctx=new AC();
    master=ctx.createGain(); master.gain.value=0.0001;
    const comp=ctx.createDynamicsCompressor(); comp.threshold.value=-18; comp.ratio.value=3;
    master.connect(comp); comp.connect(ctx.destination);
    bus=ctx.createGain(); bus.gain.value=2.2; bus.connect(master);
    const rev=ctx.createConvolver(); rev.buffer=impulse(2.6,3.2); wet=ctx.createGain(); wet.gain.value=.32;
    bus.connect(rev); rev.connect(wet); wet.connect(master);
    if(SONIDO_REAL){
      file=new Audio(SONIDO_URL); file.loop=true; file.crossOrigin="anonymous";
      const src=ctx.createMediaElementSource(file); src.connect(master);
    }
    return true;
  }
  function startLayers(){
    if(SONIDO_REAL){ file.play().catch(()=>{}); return; }
    if(!gust) wind();
    gustLoop();
    later(birdLoop,R(1200,2600));
    later(realLoop,R(5000,9000));
    sample("relincho1").catch(()=>{}); sample("resoplido").catch(()=>{}); sample("paso",...TROZOS.paso).catch(()=>{});
  }
  function fade(to,sec){ const now=ctx.currentTime; master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(Math.max(master.gain.value,0.0001),now); master.gain.setTargetAtTime(Math.max(to,0.0001),now,sec/3.2); }
  return {
    get on(){ return playing; },
    play(first){
      desbloquearIOS();
      if(!ctx && !build()) return false;
      if(ctx.state!=="running") ctx.resume().catch(()=>{});   // se pide dentro del toque (iPhone lo exige)
      musica();
      if(!playing){ playing=true; timers.forEach(clearTimeout); timers=[]; startLayers(); }
      fade(VOLUMEN, first?SUBIDA_SEG:7);
      started=true; return true;
    },
    stop(){ if(!ctx) return; playing=false; timers.forEach(clearTimeout); timers=[]; fade(0,1.4); setTimeout(()=>{ if(!playing){ ctx.suspend(); if(file) file.pause(); if(music) music.pause(); if(llave) llave.pause(); } },1700); },
    /* si el teléfono pausó el audio (llamada, otra app, bloqueo), lo reanuda con el siguiente toque */
    revivir(){ if(!ctx||!playing||d.hidden) return; if(ctx.state!=="running") ctx.resume().catch(()=>{}); if(music&&music.paused) music.play().catch(()=>{}); if(llave&&llave.paused) llave.play().catch(()=>{}); },
    pause(){ if(ctx&&playing){ ctx.suspend(); if(music) music.pause(); if(llave) llave.pause(); } },
    resume(){ if(ctx&&playing){ ctx.resume().catch(()=>{}); if(music) music.play().catch(()=>{}); if(llave) llave.play().catch(()=>{}); } },
    get started(){ return started; }
  };
})();

/* ---- botón de sonido ---- */
let btn=null;
function soundButton(){
  btn=d.createElement("button"); btn.type="button"; btn.className="lux-snd"; btn.setAttribute("aria-pressed","false");
  btn.innerHTML='<span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="lbl">Escuchar el rancho</span>';
  btn.addEventListener("click",()=>{ if(Amb.on){ Amb.stop(); setBtn(false); ls.set("crd-sonido","off"); } else { Amb.play(!Amb.started); setBtn(true); ls.set("crd-sonido","on"); } });
  d.body.appendChild(btn);
  setTimeout(()=>btn.classList.add("min"),9000);
  btn.addEventListener("mouseenter",()=>btn.classList.remove("min")); btn.addEventListener("mouseleave",()=>btn.classList.add("min"));
}
function setBtn(on){ if(!btn) return; btn.setAttribute("aria-pressed",String(on)); btn.querySelector(".lbl").textContent=on?"Sonido del rancho":"Escuchar el rancho"; btn.setAttribute("aria-label",on?"Silenciar el sonido del rancho":"Activar el sonido del rancho"); }
d.addEventListener("visibilitychange",()=>{ d.hidden?Amb.pause():Amb.resume(); });
["pointerdown","touchend","keydown"].forEach(t=>W.addEventListener(t,()=>Amb.revivir(),{passive:true,capture:true}));
/* Si ya lo tenía encendido, vuelve a sonar con el primer toque o clic (el navegador no deja antes) */
function armarReanudar(){
  if(ls.get("crd-sonido")!=="on") { if(btn && !ls.get("crd-sonido")) btn.classList.add("hint"); return; }
  const go=e=>{ if(btn && btn.contains(e.target)) return; ["pointerdown","keydown","touchend"].forEach(t=>W.removeEventListener(t,go,true)); if(!Amb.on){ Amb.play(true); setBtn(true); } };
  ["pointerdown","keydown","touchend"].forEach(t=>W.addEventListener(t,go,true));
}

/* =================================================================
   2. INTRO "ENTRAR AL RANCHO"
   ================================================================= */
function intro(){
  let visto=false; try{ visto=sessionStorage.getItem("crd-intro")==="1"; }catch(e){}
  const qs=new URLSearchParams(location.search); ["app","fbclid","gclid"].forEach(k=>qs.delete(k)); [...qs.keys()].forEach(k=>{ if(/^utm_/.test(k)) qs.delete(k); });
  const limpio=![...qs.keys()].length && (!location.hash || location.hash==="#inicio");
  if(!esInicio || !limpio || visto || W.self!==W.top || /bot|crawl|spider|lighthouse/i.test(navigator.userAgent)) return false;
  const el=d.createElement("div"); el.className="lux-intro"; el.setAttribute("role","dialog"); el.setAttribute("aria-label","Bienvenida a Rancho El Descanso");
  el.innerHTML=`<div class="lux-intro-bg" style="background-image:url('${raiz}galope.webp')"></div>
  <div class="lux-intro-in">
    <img class="lux-intro-mark" src="${raiz}marca/simbolo-oro.png" alt="" width="92" height="92">
    <p class="lux-intro-k">San Miguel Cuyutlán · Jalisco</p>
    <h2 class="lux-intro-t">Rancho <em>El Descanso</em></h2>
    <div class="lux-intro-line"></div>
    <p class="lux-intro-s">Salir de la ciudad. Volver a la tierra.</p>
    <div class="lux-intro-a">
      <button type="button" class="lux-enter" data-s="1"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Entrar al rancho</button>
      <p class="lux-intro-n">Con sonido ambiente · mejor con audífonos</p>
      <button type="button" class="lux-silent" data-s="0">Entrar en silencio</button>
    </div>
  </div>`;
  d.body.appendChild(el); html.classList.add("lux-lock");
  const enter=con=>{
    try{ sessionStorage.setItem("crd-intro","1"); }catch(e){}
    if(con){ Amb.play(true); setBtn(true); ls.set("crd-sonido","on"); } else { ls.set("crd-sonido","off"); }
    el.classList.add("out"); html.classList.remove("lux-lock");
    setTimeout(()=>html.classList.add("lux-go"),350);
    setTimeout(()=>el.remove(),1500);
  };
  el.addEventListener("click",e=>{ const b=e.target.closest("[data-s]"); if(b) enter(b.dataset.s==="1"); });
  el.addEventListener("keydown",e=>{ if(e.key==="Escape") enter(false); });
  setTimeout(()=>{ const b=el.querySelector(".lux-enter"); if(b) b.focus({preventScroll:true}); },2100);
  return true;
}

/* =================================================================
   3. APARICIONES AL BAJAR
   ================================================================= */
const SEL_TXT = ".sec-title,.sec-lede,.eyebrow,.rb-label,.rb-title,.rb-lede,.rb-btn,.rb-facts > div,.etype,.visit-box,.miss-text,.perks li,.app-list li,.community-inner > div > *,.app-inner > div > *:not([hidden]),.xp-text > *,.cap-num,.stud-card,.mare,.card,.pack,.quote,.how,.shoots-head > *,.events-top > div > *";
const SEL_FIG = ".tile,.topic,.events-top figure,.ev-gallery figure,.shoots figure,.shoot-hero,.editorial figure,.miss figure,.gallery figure,.xp-strip a,.xp-poster,.visit-reel";
let io=null;
function marcar(root){
  (root||d).querySelectorAll(SEL_TXT).forEach(el=>{ if(!el.classList.contains("lux-r")&&!el.closest(".lux-f,.hero,.lux-lb,dialog")) { el.classList.add("lux-r"); io.observe(el); } });
  (root||d).querySelectorAll(SEL_FIG).forEach(el=>{ if(!el.classList.contains("lux-f")&&!el.closest("dialog")){ el.classList.remove("lux-r"); el.classList.add("lux-f"); io.observe(el); } });
}
function apariciones(){
  io=new IntersectionObserver(entries=>{
    const vis=entries.filter(e=>e.isIntersecting);
    vis.forEach((e,i)=>{ e.target.style.setProperty("--d",(Math.min(i,6)*0.09)+"s"); e.target.classList.add("in"); io.unobserve(e.target); });
  },{rootMargin:"0px 0px -8% 0px",threshold:0.06});
  marcar();
  const mo=new MutationObserver(ms=>{ for(const m of ms) m.addedNodes.forEach(n=>{ if(n.nodeType===1) marcar(n.parentElement||n); }); });
  ["#grid","#studs","#mares","#packs","#more-chips","#quotes"].forEach(s=>{ const el=d.querySelector(s); if(el) mo.observe(el,{childList:true}); });
  /* al cambiar de vista, mostrar lo que ya está en pantalla */
  W.addEventListener("hashchange",()=>setTimeout(()=>{ d.querySelectorAll(".lux-r:not(.in),.lux-f:not(.in)").forEach(el=>{ const r=el.getBoundingClientRect(); if(r.top<innerHeight && r.bottom>0 && r.width) el.classList.add("in"); }); },80));
}

/* =================================================================
   4. PARALLAX + BARRA DE AVANCE + PORTADA
   ================================================================= */
function movimiento(){
  const hero=d.querySelector(".hero"), media=hero&&hero.querySelector(".hero-media"), body=hero&&hero.querySelector(".hero-body");
  const capas=[...d.querySelectorAll(".visit > img,.shoot-hero img,.events-top figure img")];
  capas.forEach(im=>{ im.style.willChange="transform"; im.classList.add("lux-plx"); });
  const prog=d.createElement("div"); prog.className="lux-prog"; d.body.appendChild(prog);
  let mx=0,my=0,cx=0,cy=0,tick=false;
  if(fino && hero) hero.addEventListener("pointermove",e=>{ mx=(e.clientX/innerWidth-.5); my=(e.clientY/innerHeight-.5); req(); },{passive:true});
  function frame(){
    tick=false; const y=scrollY, vh=innerHeight;
    const max=d.documentElement.scrollHeight-vh; prog.style.transform=`scaleX(${max>0?Math.min(1,y/max):0})`;
    cx+=(mx-cx)*.08; cy+=(my-cy)*.08;
    if(media && y<vh*1.4){
      media.style.transform=`translate3d(${(-cx*18).toFixed(2)}px,${(y*.38-cy*12).toFixed(2)}px,0)`;
      if(body){ body.style.transform=`translate3d(0,${(y*-.12).toFixed(2)}px,0)`; body.style.opacity=String(Math.max(0,1-y/(vh*.9))); }
    }
    for(const im of capas){ const r=im.parentElement.getBoundingClientRect(); if(r.bottom<-50||r.top>vh+50||!r.height) continue;
      const k=((r.top+r.height/2)-vh/2)/vh; im.style.transform=`translate3d(0,${(k*-9).toFixed(2)}%,0) scale(1.2)`; }
    if(Math.abs(mx-cx)>.001||Math.abs(my-cy)>.001) req();
  }
  function req(){ if(!tick){ tick=true; requestAnimationFrame(frame); } }
  W.addEventListener("scroll",req,{passive:true}); W.addEventListener("resize",req); req();
}
function portada(){
  d.querySelectorAll(".hero-claim > span").forEach(s=>{ if(!s.querySelector(":scope > i")){ const i=d.createElement("i"); while(s.firstChild) i.appendChild(s.firstChild); s.appendChild(i); } });
}

/* =================================================================
   5. GALERÍA A PANTALLA COMPLETA (se desliza con el dedo)
   ================================================================= */
const GRUPOS = [".ev-gallery",".shoots",".editorial",".miss",".gallery",".strip"];
function galeria(){
  const lb=d.createElement("div"); lb.className="lux-lb"; lb.setAttribute("role","dialog"); lb.setAttribute("aria-modal","true"); lb.setAttribute("aria-label","Galería");
  const ic={x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 6l12 12M18 6L6 18"/></svg>',p:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 5l-7 7 7 7"/></svg>',n:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5l7 7-7 7"/></svg>'};
  lb.innerHTML=`<div class="lux-lb-track"></div><p class="lux-lb-hint">Desliza para ver más</p><button type="button" class="lux-lb-x" aria-label="Cerrar">${ic.x}</button><button type="button" class="lux-lb-p" aria-label="Anterior">${ic.p}</button><button type="button" class="lux-lb-nx" aria-label="Siguiente">${ic.n}</button><div class="lux-lb-bar"><span class="lux-lb-n"></span><p class="lux-lb-c"></p><span class="lux-lb-dots"></span></div>`;
  d.body.appendChild(lb);
  const tr=lb.querySelector(".lux-lb-track"), num=lb.querySelector(".lux-lb-n"), cap=lb.querySelector(".lux-lb-c"), dots=lb.querySelector(".lux-lb-dots");
  let items=[], cur=0, foco=null;
  const two=n=>String(n).padStart(2,"0");
  function show(i){ cur=Math.max(0,Math.min(items.length-1,i)); num.textContent=`${two(cur+1)} / ${two(items.length)}`; cap.textContent=items[cur].cap||"";
    [...tr.children].forEach((s,k)=>s.classList.toggle("cur",k===cur)); [...dots.children].forEach((x,k)=>x.classList.toggle("on",k===cur)); }
  function go(i){ tr.scrollTo({left:tr.clientWidth*Math.max(0,Math.min(items.length-1,i)),behavior:reduce?"auto":"smooth"}); }
  function open(list,i){
    items=list; foco=d.activeElement;
    tr.innerHTML=list.map((it,k)=>`<figure class="lux-lb-s"><img src="${it.src}" alt="${it.alt.replace(/"/g,"&quot;")}" ${Math.abs(k-i)>1?'loading="lazy"':''} decoding="async"></figure>`).join("");
    dots.innerHTML=list.length<=24?list.map(()=>"<i></i>").join(""):"";
    tr.querySelectorAll("img").forEach(im=>{ const ok=()=>im.classList.add("ok"); im.complete?ok():im.addEventListener("load",ok,{once:true}); });
    lb.classList.add("open"); html.classList.add("lux-lock");
    requestAnimationFrame(()=>{ tr.scrollLeft=tr.clientWidth*i; show(i); });
    setTimeout(()=>{ const h=lb.querySelector(".lux-lb-hint"); if(h) h.style.opacity="0"; },2600);
    lb.querySelector(".lux-lb-x").focus({preventScroll:true});
  }
  function close(){ lb.classList.remove("open"); html.classList.remove("lux-lock"); setTimeout(()=>{ if(!lb.classList.contains("open")) tr.innerHTML=""; },600); if(foco&&foco.focus) foco.focus({preventScroll:true}); }
  let st; tr.addEventListener("scroll",()=>{ clearTimeout(st); st=setTimeout(()=>show(Math.round(tr.scrollLeft/tr.clientWidth)),60); },{passive:true});
  lb.querySelector(".lux-lb-x").addEventListener("click",close);
  lb.querySelector(".lux-lb-p").addEventListener("click",()=>go(cur-1));
  lb.querySelector(".lux-lb-nx").addEventListener("click",()=>go(cur+1));
  tr.addEventListener("click",e=>{ if(e.target.classList.contains("lux-lb-s")) close(); });
  lb.addEventListener("keydown",e=>{ if(e.key==="Escape") close(); else if(e.key==="ArrowRight") go(cur+1); else if(e.key==="ArrowLeft") go(cur-1); });
  /* deslizar hacia abajo para cerrar */
  let sy=null,sx=0; tr.addEventListener("touchstart",e=>{ sy=e.touches[0].clientY; sx=e.touches[0].clientX; },{passive:true});
  tr.addEventListener("touchend",e=>{ if(sy==null) return; const t=e.changedTouches[0]; if(t.clientY-sy>110 && Math.abs(t.clientX-sx)<60) close(); sy=null; },{passive:true});

  const figsDe=g=>[...g.querySelectorAll("figure")].filter(f=>f.querySelector("img"));
  function item(f){ const im=f.querySelector("img"), fc=f.querySelector("figcaption"); return {src:im.currentSrc||im.src, alt:im.alt||"", cap:(fc&&fc.textContent.trim())||im.alt||""}; }
  const sueltas=[".shoot-hero",".events-top figure"];
  d.addEventListener("click",e=>{
    const f=e.target.closest("figure"); if(!f || e.target.closest("a,button,.lux-lb,dialog")) return;
    const g=GRUPOS.map(s=>f.closest(s)).find(Boolean);
    if(g){ const figs=figsDe(g); const i=figs.indexOf(f); if(i<0) return; e.preventDefault(); open(figs.map(item),i); return; }
    if(sueltas.some(s=>f.matches(s))){ e.preventDefault();
      const todas=[f,...d.querySelectorAll(".ev-gallery figure")].filter((x,k,a)=>a.indexOf(x)===k && x.querySelector("img"));
      open(todas.map(item),0); }
  });
  const marcarZoom=()=>{ d.querySelectorAll([...GRUPOS.map(s=>s+" figure"),...sueltas].join(",")).forEach(f=>{ if(f.querySelector("img") && !f.closest("dialog")) f.classList.add("lux-zoom"); }); };
  marcarZoom();
}

/* =================================================================
   6. CURSOR DORADO (solo con mouse)
   ================================================================= */
function cursor(){
  if(!fino || reduce) return;
  const c=d.createElement("div"); c.className="lux-cur"; c.innerHTML="<span>Ver</span>"; d.body.appendChild(c);
  let x=-100,y=-100,tx=-100,ty=-100,run=false;
  W.addEventListener("pointermove",e=>{ tx=e.clientX; ty=e.clientY; c.classList.add("on");
    const t=e.target; const zoom=t.closest&&t.closest(".lux-zoom"); const link=t.closest&&t.closest("a,button,select,label,summary,[role=button]");
    const campo=t.closest&&t.closest("input,textarea,select,.lux-lb,dialog,.lux-intro");
    c.classList.toggle("view",!!zoom&&!campo); c.classList.toggle("link",!zoom&&!!link&&!campo); c.classList.toggle("hide",!!campo);
    if(!run){ run=true; requestAnimationFrame(loop); } },{passive:true});
  d.addEventListener("pointerleave",()=>c.classList.remove("on"));
  function loop(){ x+=(tx-x)*.2; y+=(ty-y)*.2; c.style.transform=`translate3d(${x}px,${y}px,0)`; if(Math.abs(tx-x)>.3||Math.abs(ty-y)>.3) requestAnimationFrame(loop); else run=false; }
}

/* =================================================================
   7. RECORRIDO 360° (aparece solo si hay fotos en TOUR_360)
   ================================================================= */
function tour(){
  if(!TOUR_360.length || !esInicio) return;
  const ancla=d.querySelector("#rancho"); if(!ancla) return;
  const s=d.createElement("section"); s.className="lux-360"; s.id="recorrido"; s.dataset.view="rancho inicio"; s.setAttribute("aria-labelledby","t-360");
  s.innerHTML=`<div class="lux-360-in"><p class="lux-360-k">Recorrido 360°</p><h2 id="t-360">Camina el rancho <em>desde donde estés.</em></h2><p>Arrastra la imagen para mirar alrededor. En el celular, mueve el teléfono.</p><div class="lux-360-v" id="pano"></div><div class="lux-360-tabs"></div></div>`;
  ancla.after(s); if(d.body.classList.contains("vw")) s.classList.toggle("v-on",["rancho","inicio"].includes(d.body.dataset.v));
  const tabs=s.querySelector(".lux-360-tabs");
  tabs.innerHTML=TOUR_360.map((t,i)=>`<button type="button" aria-pressed="${i===0}" data-i="${i}">${t.titulo}</button>`).join("");
  let viewer=null;
  const cargar=()=>{ if(viewer!==null) return; viewer=false;
    const l=d.createElement("link"); l.rel="stylesheet"; l.href=raiz+"vendor/pannellum/pannellum.css"; d.head.appendChild(l);
    const sc=d.createElement("script"); sc.src=raiz+"vendor/pannellum/pannellum.js"; sc.onload=()=>{
      const scenes={}; TOUR_360.forEach((t,i)=>scenes["s"+i]={title:t.titulo,type:"equirectangular",panorama:t.foto,autoRotate:-2,hfov:105});
      viewer=W.pannellum.viewer("pano",{default:{firstScene:"s0",autoLoad:true,showControls:true,compass:false,sceneFadeDuration:900},scenes});
    }; d.head.appendChild(sc); };
  new IntersectionObserver((es,o)=>{ if(es[0].isIntersecting){ cargar(); o.disconnect(); } },{rootMargin:"300px"}).observe(s);
  tabs.addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b||!viewer) return; tabs.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); viewer.loadScene("s"+b.dataset.i); });
}

/* Créditos de los sonidos (licencias Creative Commons) */
function creditos(){
  const f=d.querySelector("footer"); if(!f || f.querySelector(".lux-cred")) return;
  const p=d.createElement("p"); p.className="lux-cred";
  p.innerHTML='Sonido ambiente: música “Calm Acoustic Guitar for Serene Moments” de Gustavo_Alivera; caballos de InspectorJ, YleArkisto, GoodListener, dobroide, n_audioman y TheKingOfGeeks360 · <a href="https://freesound.org" target="_blank" rel="noopener">Freesound</a>, licencias <a href="https://creativecommons.org/licenses/by/4.0/deed.es" target="_blank" rel="noopener">CC BY 4.0</a> y CC0.';
  (f.querySelector(".foot-inner")||f).appendChild(p);
}
/* ================================================================= */
function init(){
  soundButton();
  if(esInicio) portada();
  const conIntro = intro();
  if(!conIntro){ requestAnimationFrame(()=>requestAnimationFrame(()=>html.classList.add("lux-go"))); armarReanudar(); }
  if(!reduce){ if(esInicio) apariciones(); movimiento(); }
  galeria(); cursor(); tour(); creditos();
}
if(d.readyState==="loading") d.addEventListener("DOMContentLoaded",init); else init();
})();
