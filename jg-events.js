/* =============================================================
jg-events.js  —  Project Shorashim / JewishGen Redesign
Shared event-fetching and rendering module.
Fetches from MJH REST API and renders .jg-card elements.

USAGE:
1. Add to any page that needs events (before closing </body>):
<script src="/JG40-Build/jg-events.js"></script>

```
 2. After injecting component HTML, call the relevant init:
    JGEvents.initHomeCal()       -- homepage (3 cards)
    JGEvents.initCalendarPage()  -- full calendar page (coming soon)
    JGEvents.initTalksPage()     -- videos page (coming soon)
```

API:  https://mjhnyc.org/wp-json/wp/v2/upcoming_events
?event_category=genealogy&per_page=N
============================================================= */

(function (global) {
'use strict';

/* –––––––––––––––––––––––––––––
CONFIG
––––––––––––––––––––––––––––– */
const API_BASE = 'https://mjhnyc.org/wp-json/wp/v2/upcoming_events';
const CATEGORY = 'genealogy';

/* –––––––––––––––––––––––––––––
HELPERS
––––––––––––––––––––––––––––– */

/**

- Decode HTML entities (e.g. – “ &)
- Uses a temporary textarea — safe, no innerHTML risk.
  */
  function decodeHTML(str) {
  if (!str) return '';
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
  }

/**

- Format ISO 8601 datetime → “April 19, 2026”
- Always displayed in Eastern Time.
  */
  function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/New_York'
  });
  }

/**

- Format ISO 8601 datetime → “2:00 PM ET”
  */
  function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York'
  }) + '\u00a0ET'; // non-breaking space before ET
  }

/**

- Derive the format label from is_virtual / is_in_person booleans.
- Handles hybrid events where both are true.
  */
  function getFormatLabel(event) {
  if (event.is_virtual && event.is_in_person) return '\uD83D\uDCBB\uD83D\uDCCD Hybrid';
  if (event.is_virtual)                       return '\uD83D\uDCBB Online';
  if (event.is_in_person)                     return '\uD83D\uDCCD In Person';
  return '';
  }

/* –––––––––––––––––––––––––––––
RENDER — single event card
Matches the .jg-card structure in HomeCal.html.
Drops .jg-card__type and .jg-card__speaker (not in API).
––––––––––––––––––––––––––––– */
function renderCard(event) {
const title   = decodeHTML(event.title);
const desc    = decodeHTML(event.short_description || 'No description available.');
const date    = formatDate(event.start_datetime);
const time    = formatTime(event.start_datetime);
const format  = getFormatLabel(event);

```
// Button: prefer ticket URL if present, fall back to event detail page
const hasTicket = event.event_ticket_url && event.event_ticket_url.trim() !== '';
const btnUrl    = hasTicket ? event.event_ticket_url : event.event_url;
const btnLabel  = hasTicket ? 'Register Now' : 'Learn More';

return `
  <div class="jg-card" role="article">
    <div class="jg-speaker-bio" role="tooltip" aria-hidden="true">${desc}</div>
    <div class="jg-card__date">${date}</div>
    <h3>
      <a href="${event.event_url}"
         target="_blank"
         rel="noopener noreferrer"
         style="color: inherit; text-decoration: none;">
        ${title}
      </a>
    </h3>
    <div class="jg-card__meta">
      <span>${format}</span>
      <span>\uD83D\uDD52 ${time}</span>
    </div>
    <a href="${btnUrl}"
       class="jg-btn-card"
       target="_blank"
       rel="noopener noreferrer"
       aria-label="${btnLabel}: ${title}">
      ${btnLabel}
    </a>
  </div>`.trim();
```

}

/* –––––––––––––––––––––––––––––
RENDER — empty / error states
––––––––––––––––––––––––––––– */
function renderEmpty() {
return ` <p class="jg-events-empty" style="grid-column: 1 / -1; text-align: center; color: var(--charcoal); opacity: 0.7; padding: 2rem 0;"> No upcoming events at this time. <a href="https://mjhnyc.org/events/" target="_blank" rel="noopener noreferrer" style="color: var(--navy);"> View all MJH events &rarr; </a> </p>`.trim();
}

function renderError() {
return ` <p class="jg-events-empty" style="grid-column: 1 / -1; text-align: center; color: var(--charcoal); opacity: 0.7; padding: 2rem 0;"> Unable to load upcoming events. <a href="https://mjhnyc.org/events/" target="_blank" rel="noopener noreferrer" style="color: var(--navy);"> View events on the MJH website &rarr; </a> </p>`.trim();
}

/* –––––––––––––––––––––––––––––
FETCH
––––––––––––––––––––––––––––– */

/**

- Fetch events from MJH REST API.
- @param {number} count  Number of events to request (per_page).
- @returns {Promise<Array>}
  */
  async function fetchEvents(count) {
  const url = `${API_BASE}?event_category=${CATEGORY}&per_page=${count}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MJH API responded ${res.status}`);
  return res.json();
  }

/* –––––––––––––––––––––––––––––
INIT — Homepage (HomeCal)
Container: <div class="jg-grid-3" id="jg-homecal-grid">
––––––––––––––––––––––––––––– */
async function initHomeCal() {
const container = document.getElementById('jg-homecal-grid');
if (!container) {
document.body.insertAdjacentHTML('afterbegin',
'<div style="background:red;color:white;padding:1rem;font-size:1rem;">JGEvents DEBUG: #jg-homecal-grid not found in DOM</div>');
return;
}

```
try {
  container.innerHTML = '<p style="grid-column:1/-1;">DEBUG: fetching from MJH API...</p>';
  const events = await fetchEvents(3);
  container.innerHTML = '<p style="grid-column:1/-1;">DEBUG: got ' + (events ? events.length : 0) + ' events</p>';

  if (!events || events.length === 0) {
    container.innerHTML = renderEmpty();
    return;
  }

  container.innerHTML = events.map(renderCard).join('\n');

} catch (err) {
  container.innerHTML = '<p style="grid-column:1/-1;color:red;">DEBUG ERROR: ' + err.message + '</p>';
}
```

}

/* –––––––––––––––––––––––––––––
INIT — Calendar page & Talks page
(Stubs — will be built out when those pages are wired)
––––––––––––––––––––––––––––– */
async function initCalendarPage() {
console.info('[JGEvents] initCalendarPage — not yet implemented.');
}

async function initTalksPage() {
console.info('[JGEvents] initTalksPage — not yet implemented.');
}

/* –––––––––––––––––––––––––––––
PUBLIC API
––––––––––––––––––––––––––––– */
global.JGEvents = {
fetchEvents,
renderCard,
initHomeCal,
initCalendarPage,
initTalksPage
};

})(window);