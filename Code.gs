/**
 * CONSILIUM APPLICATION + APPOINTMENT REQUEST RECEIVER
 * Deploy as a Google Apps Script Web App: Execute as Me; access Anyone.
 * Set the Apps Script project timezone to Africa/Casablanca.
 * Calendar requests are created as PENDING events and are not confirmations.
 */
const DESTINATION_EMAIL = 'consilium.consultinghq@gmail.com';
const BRAND = 'CONSILIUM';
const TZ = 'Africa/Casablanca';
const DAILY_LIMIT = 9;
const SLOT_MINUTES = 45;
const OPEN_HOUR = 9;
const CLOSE_HOUR = 19;
const EVENT_PREFIX = 'CONSILIUM REQUEST — PENDING';

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'availability') {
    const result = availability_(String(p.date || ''));
    const callback = String(p.callback || '');
    if (!/^consiliumCb[0-9]+$/.test(callback)) return json_(result);
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_({ok:true, service:'Consilium scheduling endpoint'});
}

function doPost(e) {
  let nonce = '';
  try {
    const p = (e && e.parameter) || {};
    nonce = clean_(p.submission_nonce, 120);
    if (p.website) return responsePage_(true, '');
    const required = ['name','email','phone','country','city','applicant_type','working_toward','ability_to_accept_change','appointment_date','appointment_time'];
    for (const k of required) if (!String(p[k] || '').trim()) return responsePage_(false, nonce, 'Please complete all required fields.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.email))) return responsePage_(false, nonce, 'Please enter a valid email address.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.appointment_date)) return responsePage_(false, nonce, 'Invalid appointment date.');
    if (!/^\d{2}:\d{2}$/.test(p.appointment_time)) return responsePage_(false, nonce, 'Invalid appointment time.');

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    let event;
    try {
      const start = parseSlot_(p.appointment_date, p.appointment_time);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
      const now = new Date();
      if (start <= now) return responsePage_(false, nonce, 'That appointment time has passed. Please choose another.');
      const dayStart = parseSlot_(p.appointment_date, '00:00');
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60000);
      const cal = CalendarApp.getDefaultCalendar();
      const events = cal.getEvents(dayStart, dayEnd);
      const requestEvents = events.filter(ev => ev.getTitle().indexOf(EVENT_PREFIX) === 0);
      if (requestEvents.length >= DAILY_LIMIT) return responsePage_(false, nonce, 'This date has reached the daily request limit. Please choose another date.');
      const conflict = events.some(ev => ev.isAllDayEvent() || (ev.getStartTime() < end && ev.getEndTime() > start));
      if (conflict) return responsePage_(false, nonce, 'That time is no longer available. Please choose another time.');
      const objectives = Array.isArray(p['objectives[]']) ? p['objectives[]'].join(', ') : clean_(p['objectives[]'], 1000);
      const title = EVENT_PREFIX + ' — ' + clean_(p.name, 100);
      const description = [
        'APPLICATION STATUS: PENDING REVIEW',
        'This event is a request, not a confirmed appointment.', '',
        'Name: ' + clean_(p.name, 120), 'Email: ' + clean_(p.email, 200),
        'Phone: ' + clean_(p.phone, 80), 'Country: ' + clean_(p.country, 120),
        'City: ' + clean_(p.city, 120), 'Applicant type: ' + clean_(p.applicant_type, 120),
        'Industry / market: ' + clean_(p.industry_market, 160),
        'Reference URL: ' + clean_(p.reference_url, 500),
        'Objectives: ' + objectives, '', 'Working towards:', clean_(p.working_toward, 5000),
        '', 'Additional context:', clean_(p.additional_context, 3000),
        '', 'Ability to accept change: ' + clean_(p.ability_to_accept_change, 30)
      ].join('\n');
      event = cal.createEvent(title, start, end, {description:description});
      event.setColor(CalendarApp.EventColor.GRAY);
    } finally { lock.releaseLock(); }

    const subject = 'New Consilium application — ' + clean_(p.name, 120);
    const body = [
      'A new application and appointment request has been received.', '',
      'STATUS: PENDING REVIEW — NOT CONFIRMED',
      'REQUESTED APPOINTMENT: ' + p.appointment_date + ' at ' + p.appointment_time + ' (' + TZ + ')',
      'CALENDAR EVENT ID: ' + (event ? event.getId() : ''), '',
      'FULL NAME: ' + clean_(p.name, 120), 'EMAIL: ' + clean_(p.email, 200),
      'PHONE: ' + clean_(p.phone, 80), 'COUNTRY: ' + clean_(p.country, 120),
      'CITY: ' + clean_(p.city, 120), 'APPLICANT TYPE: ' + clean_(p.applicant_type, 120),
      'INDUSTRY: ' + clean_(p.industry_market, 160), 'REFERENCE URL: ' + clean_(p.reference_url, 500),
      'OBJECTIVES: ' + clean_(p['objectives[]'], 1000), '',
      'WORKING TOWARDS:', clean_(p.working_toward, 5000), '',
      'ADDITIONAL CONTEXT:', clean_(p.additional_context, 3000), '',
      'ABILITY TO ACCEPT CHANGE: ' + clean_(p.ability_to_accept_change, 30),
      '', 'Review the application and manually accept or decline the request in Google Calendar.'
    ].join('\n');
    MailApp.sendEmail({to:DESTINATION_EMAIL, subject:subject, body:body, replyTo:clean_(p.email, 200), name:BRAND + ' Applications'});
    return responsePage_(true, nonce);
  } catch (err) {
    console.error(err);
    return responsePage_(false, nonce, 'Unable to process the request. Please try again later.');
  }
}

function availability_(dateText) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return {ok:false,error:'Invalid date.'};
    const dayStart = parseSlot_(dateText, '00:00');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60000);
    if (dayStart < parseSlot_(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), '00:00')) return {ok:true,slots:[],dailyLimitReached:false};
    const cal = CalendarApp.getDefaultCalendar();
    const events = cal.getEvents(dayStart, dayEnd);
    const requests = events.filter(ev => ev.getTitle().indexOf(EVENT_PREFIX) === 0);
    if (requests.length >= DAILY_LIMIT) return {ok:true,slots:[],dailyLimitReached:true};
    const busy = events;
    const slots = [];
    for (let minutes = OPEN_HOUR * 60; minutes + SLOT_MINUTES <= CLOSE_HOUR * 60; minutes += SLOT_MINUTES) {
      const hh = Math.floor(minutes / 60), mm = minutes % 60;
      const start = parseSlot_(dateText, pad2_(hh) + ':' + pad2_(mm));
      const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
      if (start <= new Date()) continue;
      if (!busy.some(ev => ev.isAllDayEvent() || (ev.getStartTime() < end && ev.getEndTime() > start))) slots.push(pad2_(hh) + ':' + pad2_(mm));
    }
    return {ok:true,slots:slots,dailyLimitReached:false};
  } catch (err) {
    console.error(err);
    return {ok:false,error:'Could not check availability.'};
  }
}

function parseSlot_(dateText, timeText) {
  const d = Utilities.parseDate(dateText + ' ' + timeText, TZ, 'yyyy-MM-dd HH:mm');
  if (Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm') !== dateText + ' ' + timeText) throw new Error('Invalid Casablanca date or time.');
  return d;
}
function pad2_(n) { return String(n).padStart(2, '0'); }
function clean_(value, max) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function responsePage_(ok, nonce, error) {
  const data = JSON.stringify({type:'consilium-submit-result',ok:!!ok,nonce:String(nonce || ''),error:String(error || '')}).replace(/</g,'\\u003c');
  const html = '<!doctype html><html><body><script>parent.postMessage(' + data + ', "*");</script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
