/* =============================================================
   jg-events.js  --  Project Shorashim / JewishGen Redesign
   Shared event-fetching and rendering module.
   No template literals -- uses string concatenation throughout.

   USAGE:
     Load before closing </body>:
       <script src="jg-events.js"></script>
     Then call:
       JGEvents.initHomeCal()
       JGEvents.initCalendarPage()
       JGEvents.initTalksPage()

   API: https://mjhnyc.org/wp-json/wp/v2/upcoming_events
        ?event_category=genealogy&per_page=N
   ============================================================= */

(function (global) {
  'use strict';

  var API_BASE = 'https://mjhnyc.org/wp-json/wp/v2/upcoming_events';
  var CATEGORY = 'genealogy';

  /* ----------------------------------------------------------
     HELPERS
  ---------------------------------------------------------- */

  function decodeHTML(str) {
    if (!str) return '';
    var el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York'
    });
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York'
    }) + '\u00a0ET';
  }

  function getFormatLabel(ev) {
    if (ev.is_virtual && ev.is_in_person) return '\uD83D\uDCBB\uD83D\uDCCD Hybrid';
    if (ev.is_virtual)                    return '\uD83D\uDCBB Online';
    if (ev.is_in_person)                  return '\uD83D\uDCCD In Person';
    return '';
  }

  /* ----------------------------------------------------------
     RENDER -- single event card
  ---------------------------------------------------------- */
  function renderCard(ev) {
    var title      = decodeHTML(ev.title);
    var desc       = decodeHTML(ev.short_description || 'No description available.');
    var date       = formatDate(ev.start_datetime);
    var time       = formatTime(ev.start_datetime);
    var format     = getFormatLabel(ev);
    var hasTicket  = ev.event_ticket_url && ev.event_ticket_url.trim() !== '';
    var btnUrl     = hasTicket ? ev.event_ticket_url : ev.event_url;
    var btnLabel   = hasTicket ? 'Register Now' : 'Learn More';

    return '<div class="jg-card" role="article">' +
             '<div class="jg-speaker-bio" role="tooltip" aria-hidden="true">' + desc + '</div>' +
             '<div class="jg-card__date">' + date + '</div>' +
             '<h3><a href="' + ev.event_url + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">' + title + '</a></h3>' +
             '<div class="jg-card__meta">' +
               '<span>' + format + '</span>' +
               '<span>\uD83D\uDD52 ' + time + '</span>' +
             '</div>' +
             '<a href="' + btnUrl + '" class="jg-btn-card" target="_blank" rel="noopener noreferrer" aria-label="' + btnLabel + ': ' + title + '">' + btnLabel + '</a>' +
           '</div>';
  }

  /* ----------------------------------------------------------
     RENDER -- empty / error states
  ---------------------------------------------------------- */
  function renderEmpty() {
    return '<p style="grid-column:1/-1;text-align:center;color:var(--charcoal);opacity:0.7;padding:2rem 0;">' +
             'No upcoming genealogy events at this time. ' +
             '<a href="https://mjhnyc.org/events/" target="_blank" rel="noopener noreferrer" style="color:var(--navy);">View all MJH events &rarr;</a>' +
           '</p>';
  }

  function renderError(msg) {
    return '<p style="grid-column:1/-1;text-align:center;color:var(--charcoal);opacity:0.7;padding:2rem 0;">' +
             'Unable to load upcoming events. ' +
             '<a href="https://mjhnyc.org/events/" target="_blank" rel="noopener noreferrer" style="color:var(--navy);">View events on the MJH website &rarr;</a>' +
           '</p>';
  }

  /* ----------------------------------------------------------
     FETCH
  ---------------------------------------------------------- */
  function fetchEvents(count) {
    var url = API_BASE + '?event_category=' + CATEGORY + '&per_page=' + count;
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('MJH API responded ' + res.status);
      return res.json();
    });
  }

  /* ----------------------------------------------------------
     INIT -- Homepage
  ---------------------------------------------------------- */
  function initHomeCal() {
    var container = document.getElementById('jg-homecal-grid');
    if (!container) return;

    fetchEvents(3).then(function (events) {
      if (!events || events.length === 0) {
        container.innerHTML = renderEmpty();
        return;
      }
      container.innerHTML = events.map(renderCard).join('');
    }).catch(function (err) {
      console.warn('[JGEvents] initHomeCal failed:', err);
      container.innerHTML = renderError();
    });
  }

  /* ----------------------------------------------------------
     INIT -- Calendar page & Talks page (stubs)
  ---------------------------------------------------------- */
  function initCalendarPage() {
    console.info('[JGEvents] initCalendarPage -- not yet implemented.');
  }

  function initTalksPage() {
    console.info('[JGEvents] initTalksPage -- not yet implemented.');
  }

  /* ----------------------------------------------------------
     PUBLIC API
  ---------------------------------------------------------- */
  global.JGEvents = {
    fetchEvents: fetchEvents,
    renderCard: renderCard,
    initHomeCal: initHomeCal,
    initCalendarPage: initCalendarPage,
    initTalksPage: initTalksPage
  };

})(window);
