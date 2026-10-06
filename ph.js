/* PostHog — analítica de la página del rancho (proyecto "LEGAIUS + Rancho").
   Se carga en las páginas públicas; NO en /equipo (portal privado del equipo).
   La llave phc_ es pública (siempre va en el navegador), no es secreta. */
(function () {
  var SITIO = 'rancho';
  var h = location.hostname, p = location.pathname.toLowerCase();
  if (p.indexOf('/equipo') === 0 || h === 'localhost' || h === '127.0.0.1' || /github\.io$/i.test(h)) return;

  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  posthog.init('phc_kPN5z4ThgzsQuLDm9w4oetvCQPfH9kehHCwoheBfDsEM', {
    api_host: 'https://us.i.posthog.com',
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    session_recording: { maskAllInputs: true } // las grabaciones no muestran lo que la gente escribe
  });
  posthog.register({ sitio: SITIO, empresa: 'Rancho El Descanso' });

  /* Nombres en español para los eventos de venta que ya marca la página (los mismos del pixel de Meta) */
  var NOMBRES = {
    ViewContent: 'vio_ficha', Lead: 'pidio_informes', InitiateCheckout: 'inicio_pago',
    Schedule: 'abrio_reserva', Purchase: 'pago_completado', Contact: 'clic_whatsapp'
  };
  window.phTrack = function (ev, params) {
    if (ev === 'Contact') return; // los clics a WhatsApp ya se cuentan abajo
    try {
      var q = {}, k;
      for (k in (params || {})) q[k] = params[k];
      if (q.content_name !== undefined) { q.detalle = q.content_name; delete q.content_name; }
      if (q.content_category !== undefined) { q.categoria = q.content_category; delete q.content_category; }
      if (q.value !== undefined) { q.valor = q.value; delete q.value; }
      posthog.capture(NOMBRES[ev] || ev, q);
    } catch (e) {}
  };

  /* Clic a cualquier botón de WhatsApp: a qué número (Nico, Moni, etc.) y desde qué sección */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href*="wa.me/"], a[href*="whatsapp.com/"]');
    if (!a) return;
    var num = (a.href.match(/wa\.me\/(\d+)/) || a.href.match(/phone=(\d+)/) || [])[1] || '';
    posthog.capture('clic_whatsapp', {
      numero: num.slice(-4),
      boton: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60),
      seccion: (location.hash || '#inicio').slice(1) || 'inicio'
    });
  }, true);

  /* La portada cambia de sección con #sementales, #potros, #eventos…: registrar qué sección ven */
  var ultima = '';
  function seccion() {
    var s = decodeURIComponent((location.hash || '').replace(/^#\/?/, '')) || 'inicio';
    s = s.split('/')[0];
    if (s === ultima) return; ultima = s;
    posthog.capture('vio_seccion', { seccion: s, pagina: location.pathname });
  }
  window.addEventListener('hashchange', seccion);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seccion); else seccion();
})();
