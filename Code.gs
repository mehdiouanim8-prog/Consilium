/**
 * CONSILIUM APPLICATION + APPOINTMENT REQUEST SYSTEM
 * Timezone: Africa/Casablanca
 * Deploy as Web App: Execute as you, Who has access: Anyone.
 */
const DESTINATION_EMAIL = 'consilium.consultinghq@gmail.com';
const TZ = 'Africa/Casablanca';
const DAILY_LIMIT = 9;
const SLOT_MINUTES = 45;
const OPEN_HOUR = 9;
const CLOSE_HOUR = 19;
const PENDING_PREFIX = 'CONSILIUM REQUEST — PENDING';
const CONFIRMED_PREFIX = 'CONSILIUM APPOINTMENT — CONFIRMED';
const SHEET_NAME = 'Applications';
const SPREADSHEET_PROPERTY = 'CONSILIUM_SPREADSHEET_ID';

function setupConsilium() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(SPREADSHEET_PROPERTY);
  let ss = id ? SpreadsheetApp.openById(id) : null;
  if (!ss) {
    ss = SpreadsheetApp.create('Consilium Applications & Appointment Requests');
    props.setProperty(SPREADSHEET_PROPERTY, ss.getId());
  }
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  ensureHeaders_(sh);
  SpreadsheetApp.getUi().createMenu('Consilium Admin')
    .addItem('Accept selected application', 'acceptSelectedApplication')
    .addItem('Decline selected application', 'declineSelectedApplication')
    .addToUi();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onOpen').forEach(() => {});
  Logger.log('Admin spreadsheet: ' + ss.getUrl());
  return ss.getUrl();
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Consilium Admin')
      .addItem('Accept selected application', 'acceptSelectedApplication')
      .addItem('Decline selected application', 'declineSelectedApplication')
      .addToUi();
  } catch (e) {}
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (String(p.action || '') === 'availability') {
    const result = availability_(String(p.date || ''));
    const callback = String(p.callback || '');
    if (/^consiliumCb[0-9]+$/.test(callback)) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return json_(result);
  }
  return json_({ok:true, service:'Consilium scheduling endpoint', timezone:TZ});
}

function doPost(e) {
  let nonce = '';
  let pendingEventId = '';
  try {
    const p = (e && e.parameter) || {};
    nonce = clean_(p.submission_nonce, 120);
    if (clean_(p.website, 20)) return responsePage_(true, nonce);

    const required = ['name','email','phone','country','city','applicant_type','working_toward','ability_to_accept_change','appointment_date','appointment_time'];
    for (const k of required) {
      if (!String(p[k] || '').trim()) return responsePage_(false, nonce, 'Please complete all required fields.');
    }
    const email = clean_(p.email, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responsePage_(false, nonce, 'Please enter a valid email address.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.appointment_date))) return responsePage_(false, nonce, 'Invalid appointment date.');
    if (!/^\d{2}:\d{2}$/.test(String(p.appointment_time))) return responsePage_(false, nonce, 'Invalid appointment time.');
    if (!/^(?:0[1-9]|1[0-9]):(?:00|45)$/.test(String(p.appointment_time)) && String(p.appointment_time) !== '09:00') {
      return responsePage_(false, nonce, 'Invalid appointment time.');
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    let rowNumber = 0;
    let reference = '';
    try {
      const start = parseSlot_(String(p.appointment_date), String(p.appointment_time));
      const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
      const now = new Date();
      if (start <= now) return responsePage_(false, nonce, 'That appointment time has passed. Please choose another.');
      const minutes = Number(String(p.appointment_time).slice(0,2)) * 60 + Number(String(p.appointment_time).slice(3));
      if (minutes < OPEN_HOUR * 60 || minutes + SLOT_MINUTES > CLOSE_HOUR * 60 || minutes % SLOT_MINUTES !== 0) {
        return responsePage_(false, nonce, 'That appointment time is outside Consilium availability.');
      }

      const ss = getSpreadsheet_();
      const sh = getApplicationsSheet_(ss);
      ensureHeaders_(sh);
      const dateText = String(p.appointment_date);
      const existingRows = getRows_(sh);
      const duplicate = existingRows.some(r => String(r[COLS.EMAIL] || '').toLowerCase() === email.toLowerCase() && String(r[COLS.DATE] || '') === dateText && String(r[COLS.TIME] || '') === String(p.appointment_time) && ['PENDING','ACCEPTED'].indexOf(String(r[COLS.STATUS] || '')) >= 0);
      if (duplicate) return responsePage_(false, nonce, 'This application has already requested this appointment time.');

      const cal = CalendarApp.getDefaultCalendar();
      const dayStart = parseSlot_(dateText, '00:00');
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60000);
      const events = cal.getEvents(dayStart, dayEnd);
      const activeRequests = events.filter(ev => {
        const title = ev.getTitle();
        return title.indexOf(PENDING_PREFIX) === 0 || title.indexOf(CONFIRMED_PREFIX) === 0;
      });
      if (activeRequests.length >= DAILY_LIMIT) return responsePage_(false, nonce, 'This date has reached the daily request limit. Please choose another date.');
      const conflict = events.some(ev => ev.isAllDayEvent() || (ev.getStartTime() < end && ev.getEndTime() > start));
      if (conflict) return responsePage_(false, nonce, 'That time is no longer available. Please choose another time.');

      reference = makeReference_();
      const objectives = getObjectives_(p);
      const description = buildCalendarDescription_(p, reference, objectives);
      const event = cal.createEvent(PENDING_PREFIX + ' — ' + reference + ' — ' + clean_(p.name, 80), start, end, {description:description});
      pendingEventId = event.getId();
      event.setColor(CalendarApp.EventColor.GRAY);

      const timestamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
      rowNumber = sh.getLastRow() + 1;
      sh.getRange(rowNumber, 1, 1, HEADERS.length).setValues([[
        reference, timestamp, 'PENDING', clean_(p.name,120), email, clean_(p.phone,80), clean_(p.country,120), clean_(p.city,120), clean_(p.applicant_type,120), clean_(p.industry_market,160), clean_(p.reference_url,500), objectives, clean_(p.working_toward,5000), clean_(p.additional_context,3000), clean_(p.ability_to_accept_change,30), dateText, String(p.appointment_time), pendingEventId, '', '', '', '', ''
      ]]);
      sh.getRange(rowNumber, 1).setNumberFormat('@');
    } finally {
      lock.releaseLock();
    }

    const applicantName = clean_(p.name, 120);
    const timestamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    const objectives = getObjectives_(p);
    const adminBody = [
      'NEW CONSILIUM APPLICATION', '',
      'APPLICATION REFERENCE: ' + reference,
      'STATUS: PENDING REVIEW — NOT CONFIRMED',
      'SUBMISSION TIMESTAMP: ' + timestamp + ' (' + TZ + ')',
      'REQUESTED APPOINTMENT: ' + p.appointment_date + ' at ' + p.appointment_time + ' (' + TZ + ')', '',
      'FULL NAME: ' + applicantName,
      'EMAIL: ' + email,
      'PHONE: ' + clean_(p.phone,80),
      'COUNTRY: ' + clean_(p.country,120),
      'CITY: ' + clean_(p.city,120),
      'APPLICANT TYPE: ' + clean_(p.applicant_type,120),
      'WEBSITE / LINKEDIN: ' + clean_(p.reference_url,500),
      'INDUSTRY / MARKET: ' + clean_(p.industry_market,160),
      'OBJECTIVES: ' + objectives, '',
      'FULL APPLICATION RESPONSE:', clean_(p.working_toward,5000), '',
      'ADDITIONAL CONTEXT:', clean_(p.additional_context,3000), '',
      'ABILITY TO ACCEPT CHANGE: ' + clean_(p.ability_to_accept_change,30), '',
      'The appointment request is pending and is not confirmed until Consilium accepts it.'
    ].join('\n');
    MailApp.sendEmail({to:DESTINATION_EMAIL, subject:'New Consilium application — ' + applicantName + ' — ' + reference, body:adminBody, replyTo:email, name:'Consilium Applications'});

    const applicantBody = [
      'Hello ' + applicantName + ',', '',
      'Thank you for applying to Consilium.', '',
      'We have successfully received your application. Your information is currently under review, and our team will get back to you shortly.', '',
      'Please note that your requested appointment time is not confirmed until you receive a separate confirmation from Consilium.', '',
      'We appreciate your interest.', '',
      'Consilium',
      'Strategy · Intelligence · Execution'
    ].join('\n');
    MailApp.sendEmail({to:email, subject:'Your Consilium Application — Received', body:applicantBody, name:'Consilium'});

    return responsePage_(true, nonce, '', reference);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    if (pendingEventId) {
      try { CalendarApp.getDefaultCalendar().getEventById(pendingEventId).deleteEvent(); } catch (ignore) {}
    }
    return responsePage_(false, nonce, 'Unable to process the application. Please try again later.');
  }
}

function availability_(dateText) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return {ok:false,error:'Invalid date.'};
    const dayStart = parseSlot_(dateText, '00:00');
    const todayStart = parseSlot_(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), '00:00');
    if (dayStart < todayStart) return {ok:true,slots:[],dailyLimitReached:false};
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60000);
    const cal = CalendarApp.getDefaultCalendar();
    const events = cal.getEvents(dayStart, dayEnd);
    const activeRequests = events.filter(ev => {
      const title = ev.getTitle();
      return title.indexOf(PENDING_PREFIX) === 0 || title.indexOf(CONFIRMED_PREFIX) === 0;
    });
    if (activeRequests.length >= DAILY_LIMIT) return {ok:true,slots:[],dailyLimitReached:true};

    const slots = [];
    const now = new Date();
    for (let minutes = OPEN_HOUR * 60; minutes + SLOT_MINUTES <= CLOSE_HOUR * 60; minutes += SLOT_MINUTES) {
      const hh = Math.floor(minutes / 60), mm = minutes % 60;
      const timeText = pad2_(hh) + ':' + pad2_(mm);
      const start = parseSlot_(dateText, timeText);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
      if (start <= now) continue;
      const busy = events.some(ev => ev.isAllDayEvent() || (ev.getStartTime() < end && ev.getEndTime() > start));
      if (!busy) slots.push(timeText);
    }
    return {ok:true,slots:slots,dailyLimitReached:false,timezone:TZ,date:dateText};
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return {ok:false,error:'Could not check availability.'};
  }
}

function acceptSelectedApplication() { updateSelectedApplication_('ACCEPTED'); }
function declineSelectedApplication() { updateSelectedApplication_('DECLINED'); }

function updateSelectedApplication_(newStatus) {
  const ss = getSpreadsheet_();
  const sh = getApplicationsSheet_(ss);
  const row = sh.getActiveRange().getRow();
  if (row <= 1) throw new Error('Select an application row first.');
  const values = sh.getRange(row,1,1,HEADERS.length).getValues()[0];
  const status = String(values[COLS.STATUS] || '');
  if (status !== 'PENDING') throw new Error('Only PENDING applications can be accepted or declined.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const reference = String(values[COLS.REFERENCE] || '');
    const applicantEmail = String(values[COLS.EMAIL] || '');
    const applicantName = String(values[COLS.NAME] || '');
    const dateText = String(values[COLS.DATE] || '');
    const timeText = String(values[COLS.TIME] || '');
    const eventId = String(values[COLS.PENDING_EVENT_ID] || '');
    const cal = CalendarApp.getDefaultCalendar();
    const pendingEvent = eventId ? cal.getEventById(eventId) : null;

    if (newStatus === 'ACCEPTED') {
      const start = parseSlot_(dateText, timeText);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
      const dayStart = parseSlot_(dateText, '00:00');
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60000);
      const events = cal.getEvents(dayStart, dayEnd);
      const conflict = events.some(ev => ev.getId() !== eventId && (ev.isAllDayEvent() || (ev.getStartTime() < end && ev.getEndTime() > start)));
      if (conflict) throw new Error('The requested appointment time is now occupied by another calendar event. Decline this request or resolve the conflict first.');

      if (pendingEvent) {
        pendingEvent.setTitle(CONFIRMED_PREFIX + ' — ' + reference + ' — ' + applicantName);
        pendingEvent.setColor(CalendarApp.EventColor.BLUE);
        pendingEvent.setDescription(pendingEvent.getDescription() + '\n\nSTATUS: CONFIRMED BY CONSILIUM');
      } else {
        const ev = cal.createEvent(CONFIRMED_PREFIX + ' — ' + reference + ' — ' + applicantName, start, end, {description:'Application reference: ' + reference + '\nSTATUS: CONFIRMED BY CONSILIUM'});
        sh.getRange(row, COLS.PENDING_EVENT_ID + 1).setValue(ev.getId());
      }
      sh.getRange(row, COLS.STATUS + 1).setValue('ACCEPTED');
      sh.getRange(row, COLS.REVIEWED_AT + 1).setValue(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'));
      MailApp.sendEmail({to:applicantEmail, subject:'Your Consilium Appointment — Confirmed', body:['Hello ' + applicantName + ',', '', 'Your application has been reviewed and your appointment request has been accepted.', '', 'Appointment: ' + dateText + ' at ' + timeText + ' (' + TZ + ')', 'Application reference: ' + reference, '', 'We look forward to speaking with you.', '', 'Consilium','Strategy · Intelligence · Execution'].join('\n'), name:'Consilium'});
    } else {
      if (pendingEvent) pendingEvent.deleteEvent();
      sh.getRange(row, COLS.STATUS + 1).setValue('DECLINED');
      sh.getRange(row, COLS.REVIEWED_AT + 1).setValue(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'));
      MailApp.sendEmail({to:applicantEmail, subject:'Your Consilium Application — Appointment Request Update', body:['Hello ' + applicantName + ',', '', 'Thank you for your application to Consilium.', '', 'After review, we are unable to accept the requested appointment time at this stage.', '', 'Application reference: ' + reference, '', 'We appreciate your interest in Consilium.', '', 'Consilium','Strategy · Intelligence · Execution'].join('\n'), name:'Consilium'});
    }
  } finally { lock.releaseLock(); }
}

const HEADERS = ['Application Reference','Submitted At','Status','Full Name','Email','Phone','Country','City','Applicant Type','Industry / Market','Website / LinkedIn','Objectives','Working Towards','Additional Context','Ability To Accept Change','Appointment Date','Appointment Time','Calendar Event ID','Reviewed At','Notes','Email Status','Admin Action','Last Error'];
const COLS = {REFERENCE:0,SUBMITTED_AT:1,STATUS:2,NAME:3,EMAIL:4,PHONE:5,COUNTRY:6,CITY:7,TYPE:8,INDUSTRY:9,URL:10,OBJECTIVES:11,WORKING:12,ADDITIONAL:13,ABILITY:14,DATE:15,TIME:16,PENDING_EVENT_ID:17,REVIEWED_AT:18,NOTES:19,EMAIL_STATUS:20,ADMIN_ACTION:21,LAST_ERROR:22};

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_PROPERTY);
  if (!id) throw new Error('Consilium has not been initialized. Run setupConsilium once.');
  return SpreadsheetApp.openById(id);
}
function getApplicationsSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  ensureHeaders_(sh);
  return sh;
}
function ensureHeaders_(sh) {
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  else {
    const current = sh.getRange(1,1,1,Math.min(sh.getLastColumn(),HEADERS.length)).getValues()[0];
    let changed = false;
    for (let i=0;i<HEADERS.length;i++) if (current[i] !== HEADERS[i]) { changed=true; break; }
    if (changed) sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  }
  sh.setFrozenRows(1);
  if (sh.getLastColumn() >= HEADERS.length) sh.getRange(1,1,1,HEADERS.length).setFontWeight('bold');
}
function getRows_(sh) { return sh.getLastRow() < 2 ? [] : sh.getRange(2,1,sh.getLastRow()-1,HEADERS.length).getValues(); }
function getObjectives_(p) {
  const v = p['objectives[]'];
  if (Array.isArray(v)) return v.map(x=>clean_(x,150)).filter(Boolean).join(', ');
  return clean_(v,1500);
}
function buildCalendarDescription_(p, reference, objectives) {
  return ['APPLICATION REFERENCE: ' + reference,'STATUS: PENDING REVIEW — NOT CONFIRMED','Name: ' + clean_(p.name,120),'Email: ' + clean_(p.email,200),'Phone: ' + clean_(p.phone,80),'Country: ' + clean_(p.country,120),'City: ' + clean_(p.city,120),'Applicant type: ' + clean_(p.applicant_type,120),'Website / LinkedIn: ' + clean_(p.reference_url,500),'Industry / market: ' + clean_(p.industry_market,160),'Objectives: ' + objectives,'','Working towards:',clean_(p.working_toward,5000),'','Additional context:',clean_(p.additional_context,3000),'','Ability to accept change: ' + clean_(p.ability_to_accept_change,30)].join('\n');
}
function makeReference_() { return 'CONS-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0,8).toUpperCase(); }
function parseSlot_(dateText,timeText) {
  const d = Utilities.parseDate(dateText + ' ' + timeText, TZ, 'yyyy-MM-dd HH:mm');
  if (Utilities.formatDate(d,TZ,'yyyy-MM-dd HH:mm') !== dateText + ' ' + timeText) throw new Error('Invalid Casablanca date or time.');
  return d;
}
function pad2_(n) { return String(n).padStart(2,'0'); }
function clean_(value,max) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function responsePage_(ok, nonce, error, reference) {
  const data = JSON.stringify({type:'consilium-submit-result',ok:!!ok,nonce:String(nonce || ''),error:String(error || ''),reference:String(reference || '')}).replace(/</g,'\\u003c');
  return HtmlService.createHtmlOutput('<!doctype html><html><body><script>parent.postMessage(' + data + ', "*");</script></body></html>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
