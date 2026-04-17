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
    var rawTitle   = decodeHTML(ev.title);
    var desc       = decodeHTML(ev.short_description || 'No description available.');
    var date       = formatDate(ev.start_datetime);
    var time       = formatTime(ev.start_datetime);
    var format     = getFormatLabel(ev);
    var hasTicket  = ev.event_ticket_url && ev.event_ticket_url.trim() !== '';
    var btnUrl     = hasTicket ? ev.event_ticket_url : ev.event_url;

    // If title contains "JewishGen Talks", strip the prefix and show it as type label
    var typeLabel    = '';
    var normalTitle  = rawTitle.replace(/\u00a0/g, ' ').trim();
    var title        = normalTitle;
    var jgtPos       = normalTitle.toLowerCase().indexOf('jewishgen talks');
    if (jgtPos !== -1) {
      typeLabel = 'JewishGen Talks';
      // Find the first colon or dash after the prefix and cut there
      var rest = normalTitle.substring(jgtPos + 15);
      var sepPos = rest.search(/[:\u2013\u2014-]/); // colon, en-dash, em-dash, hyphen
      if (sepPos !== -1) {
        title = rest.substring(sepPos + 1).trim();
      } else {
        title = rest.trim();
      }
    }

    var btnLabel   = hasTicket ? 'Register Now' : 'Learn More';
    var typeHtml   = typeLabel ? '<div class="jg-card__type">' + typeLabel + '</div>' : '';

    return '<div class="jg-card" role="article">' +
             '<div class="jg-speaker-bio" role="tooltip" aria-hidden="true">' + desc + '</div>' +
             '<div class="jg-card__date">' + date + '</div>' +
             typeHtml +
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

  function renderTalkCard(ev) {
    var rawTitle  = decodeHTML(ev.title);
    var desc      = decodeHTML(ev.short_description || '');
    var hasTicket = ev.event_ticket_url && ev.event_ticket_url.trim() !== '';
    var btnUrl    = hasTicket ? ev.event_ticket_url : ev.event_url;

    // Normalize non-breaking spaces then strip JewishGen Talks prefix
    var normalTitle = rawTitle.replace(/\u00a0/g, ' ').trim();
    var jgtPos = normalTitle.toLowerCase().indexOf('jewishgen talks');
    var title = normalTitle;
    if (jgtPos !== -1) {
      var rest = normalTitle.substring(jgtPos + 15);
      var sepPos = rest.search(/[:\u2013\u2014-]/);
      title = sepPos !== -1 ? rest.substring(sepPos + 1).trim() : rest.trim();
    }

    // Date: "Apr 22, 2026" format
    var dateStr = new Date(ev.start_datetime).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'
    });
    // Time: "2PM ET" format
    var timeStr = new Date(ev.start_datetime).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
    }).replace(':00', '').replace('\u00a0', '') + ' ET';

    return '<a href="' + btnUrl + '" target="_blank" rel="noopener noreferrer" class="talk-card" aria-label="' + title + '">' +
             '<span class="talk-date">' + dateStr + ' | ' + timeStr + '</span>' +
             '<p class="talk-title">' + title + '</p>' +
             '<p class="talk-desc">' + desc + '</p>' +
             '<span class="talk-register">Register now! \u203a</span>' +
           '</a>';
  }

  function initTalksPage() {
    var container = document.getElementById('jg-talks-grid');
    if (!container) return;

    fetchEvents(3).then(function (events) {
      if (!events || events.length === 0) {
        container.innerHTML = renderEmpty();
        return;
      }
      container.innerHTML = events.map(renderTalkCard).join('');
    }).catch(function (err) {
      console.warn('[JGEvents] initTalksPage failed:', err);
      container.innerHTML = renderError();
    });
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
