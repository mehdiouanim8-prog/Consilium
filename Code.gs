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
  const sh = getApplicationsSheet_(ss);
  ensureHeaders_(sh);
  const exists = ScriptApp.getProjectTriggers().some(t =>
    t.getHandlerFunction() === 'onOpen' && t.getTriggerSourceId && t.getTriggerSourceId() === ss.getId()
  );
  if (!exists) ScriptApp.newTrigger('onOpen').forSpreadsheet(ss).onOpen().create();
  Logger.log('Admin spreadsheet: ' + ss.getUrl());
  return ss.getUrl();
}


// Run this manually once from the Apps Script editor to grant the project
// the Calendar, Sheets, and email permissions required by the live workflow.
function authorizeConsilium() {
  const ss = getSpreadsheet_();
  const calendar = CalendarApp.getDefaultCalendar();
  if (!calendar) throw new Error('No default Google Calendar is available.');
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  calendar.getEvents(parseSlot_(today, '00:00'), new Date(parseSlot_(today, '00:00').getTime() + 86400000));
  MailApp.getRemainingDailyQuota();
  Logger.log('Consilium authorization successful. Spreadsheet: ' + ss.getUrl());
  return 'Authorization successful';
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
  if (String(p.action || '') === 'health') {
    let result;
    try {
      getSpreadsheet_();
      const cal = CalendarApp.getDefaultCalendar();
      if (!cal) throw new Error('No default Google Calendar is available to the script owner.');
      result = {ok:true, service:'Consilium scheduling endpoint', timezone:TZ, calendarConnected:true, spreadsheetConnected:true};
    } catch (err) {
      result = {ok:false, error:String(err && err.message ? err.message : err)};
    }
    const callback = String(p.callback || '');
    if (/^consiliumCb[0-9a-z]+$/i.test(callback)) return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
    return json_(result);
  }
  if (String(p.action || '') === 'availability') {
    const result = availability_(String(p.date || ''));
    const callback = String(p.callback || '');
    if (/^consiliumCb[0-9a-z]+$/i.test(callback)) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return json_(result);
  }
  return json_({ok:true, service:'Consilium scheduling endpoint', timezone:TZ});
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  const nonce = clean_(p.submission_nonce, 120);
  let pendingEventId = '', savedRow = 0, reference = '';
  const email = clean_(p.email, 200), applicantName = clean_(p.name, 120);
  try {
    if (clean_(p.website, 200)) return responsePage_(false, nonce, 'Invalid submission.');
    const required = ['name','email','phone','country','city','applicant_type','working_toward','ability_to_accept_change','appointment_date','appointment_time'];
    for (const key of required) if (!String(p[key] || '').trim()) return responsePage_(false, nonce, 'Please complete all required fields.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responsePage_(false, nonce, 'Please enter a valid email address.');
    if (String(p.name).length > 120 || String(p.working_toward).length > 5000 || String(p.additional_context || '').length > 3000) return responsePage_(false, nonce, 'One or more fields exceed the permitted length.');
    const dateText = String(p.appointment_date), timeText = String(p.appointment_time);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) return responsePage_(false, nonce, 'Invalid appointment date or time.');

    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const start = parseSlot_(dateText,timeText), end = new Date(start.getTime()+SLOT_MINUTES*60000);
      if (start <= new Date()) return responsePage_(false,nonce,'That appointment time has passed. Please choose another.');
      const mins = Number(timeText.slice(0,2))*60 + Number(timeText.slice(3));
      if (mins < OPEN_HOUR*60 || mins+SLOT_MINUTES > CLOSE_HOUR*60 || (mins-OPEN_HOUR*60)%SLOT_MINUTES !== 0) return responsePage_(false,nonce,'That appointment time is outside Consilium availability.');
      const sh = getApplicationsSheet_(getSpreadsheet_()), rows = getRows_(sh);
      if (nonce) {
        const prior = rows.find(r => String(r[COLS.NONCE] || '') === nonce);
        if (prior) return responsePage_(true,nonce,'',String(prior[COLS.REFERENCE] || ''));
      }
      const duplicate = rows.some(r => String(r[COLS.EMAIL]||'').toLowerCase()===email.toLowerCase() && String(r[COLS.DATE]||'')===dateText && String(r[COLS.TIME]||'')===timeText && ['PENDING','ACCEPTED'].includes(String(r[COLS.STATUS]||'')));
      if (duplicate) return responsePage_(false,nonce,'This application has already requested this appointment time.');
      if (rows.filter(r => String(r[COLS.DATE]||'')===dateText).length >= DAILY_LIMIT) return responsePage_(false,nonce,'This date has reached its daily request limit. Please choose another date.');
      const cal = CalendarApp.getDefaultCalendar(), dayStart = parseSlot_(dateText,'00:00');
      const events = cal.getEvents(dayStart,new Date(dayStart.getTime()+86400000));
      if (events.some(ev => ev.isAllDayEvent() || (ev.getStartTime()<end && ev.getEndTime()>start))) return responsePage_(false,nonce,'That time is no longer available. Please choose another time.');
      reference = makeReference_();
      const objectives = getObjectives_(e);
      const event = cal.createEvent(PENDING_PREFIX+' — '+reference+' — '+applicantName,start,end,{description:buildCalendarDescription_(p,reference,objectives)});
      pendingEventId = event.getId(); event.setColor(CalendarApp.EventColor.GRAY);
      const row = new Array(HEADERS.length).fill('');
      row[COLS.REFERENCE]=reference; row[COLS.SUBMITTED_AT]=Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd HH:mm:ss'); row[COLS.STATUS]='PENDING';
      row[COLS.NAME]=applicantName; row[COLS.EMAIL]=email; row[COLS.PHONE]=clean_(p.phone,80); row[COLS.COUNTRY]=clean_(p.country,120); row[COLS.CITY]=clean_(p.city,120);
      row[COLS.TYPE]=clean_(p.applicant_type,120); row[COLS.INDUSTRY]=clean_(p.industry_market,160); row[COLS.URL]=clean_(p.reference_url,500); row[COLS.OBJECTIVES]=objectives;
      row[COLS.WORKING]=clean_(p.working_toward,5000); row[COLS.ADDITIONAL]=clean_(p.additional_context,3000); row[COLS.ABILITY]=clean_(p.ability_to_accept_change,30);
      row[COLS.DATE]=dateText; row[COLS.TIME]=timeText; row[COLS.PENDING_EVENT_ID]=pendingEventId; row[COLS.NONCE]=nonce;
      savedRow=sh.getLastRow()+1; sh.getRange(savedRow,1,1,HEADERS.length).setValues([row]); sh.getRange(savedRow,1).setNumberFormat('@');
    } finally { lock.releaseLock(); }

    // Persistence is complete before either email is attempted. Email failures are logged, not rolled back.
    const objectives=getObjectives_(e), timestamp=Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd HH:mm:ss');
    const adminBody=['NEW CONSILIUM APPLICATION','','APPLICATION REFERENCE: '+reference,'STATUS: PENDING REVIEW — NOT CONFIRMED','SUBMISSION TIMESTAMP: '+timestamp+' ('+TZ+')','REQUESTED APPOINTMENT: '+p.appointment_date+' at '+p.appointment_time+' ('+TZ+')','',
      'FULL NAME: '+applicantName,'EMAIL: '+email,'PHONE: '+clean_(p.phone,80),'COUNTRY: '+clean_(p.country,120),'CITY: '+clean_(p.city,120),'APPLICANT TYPE: '+clean_(p.applicant_type,120),'WEBSITE / LINKEDIN: '+clean_(p.reference_url,500),'INDUSTRY / MARKET: '+clean_(p.industry_market,160),'OBJECTIVES: '+objectives,'','FULL APPLICATION RESPONSE:',clean_(p.working_toward,5000),'','ADDITIONAL CONTEXT:',clean_(p.additional_context,3000),'','ABILITY TO ACCEPT CHANGE: '+clean_(p.ability_to_accept_change,30),'','The appointment request is pending and is not confirmed until Consilium accepts it.'].join('\n');
    const errors=[];
    try { MailApp.sendEmail({to:DESTINATION_EMAIL,subject:'New Consilium application — '+applicantName+' — '+reference,body:adminBody,replyTo:email,name:'Consilium Applications'}); }
    catch(err) { errors.push('Admin notification: '+String(err)); }
    const applicantBody=['Hello '+applicantName+',','','Thank you for applying to Consilium.','','We have successfully received your application. Your information is currently under review, and our team will get back to you shortly.','','Please note that your requested appointment time is not confirmed until you receive a separate confirmation from Consilium.','','We appreciate your interest.','','Consilium','Strategy · Intelligence · Execution'].join('\n');
    try { MailApp.sendEmail({to:email,subject:'Your Consilium Application — Received',body:applicantBody,name:'Consilium'}); }
    catch(err) { errors.push('Applicant confirmation: '+String(err)); }
    const sh=getApplicationsSheet_(getSpreadsheet_());
    if (errors.length) { sh.getRange(savedRow,COLS.EMAIL_STATUS+1).setValue('PARTIAL / FAILED'); sh.getRange(savedRow,COLS.LAST_ERROR+1).setValue(errors.join(' | ').slice(0,4000)); console.error(errors.join('\n')); }
    else sh.getRange(savedRow,COLS.EMAIL_STATUS+1).setValue('SENT');
    return responsePage_(true,nonce,'',reference);
  } catch(err) {
    console.error(err && err.stack ? err.stack : err);
    if (pendingEventId && !savedRow) { try { CalendarApp.getDefaultCalendar().getEventById(pendingEventId).deleteEvent(); } catch(ignore) {} }
    // Once a row exists, the application is safely received even if later email-status logging fails.
    if (savedRow) return responsePage_(true,nonce,'',reference);
    return responsePage_(false,nonce,'Unable to save your application. Please try again later.');
  }
}

function availability_(dateText) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return {ok:false,error:'Invalid date.'};
    const dayStart=parseSlot_(dateText,'00:00');
    if (Utilities.formatDate(dayStart,TZ,'yyyy-MM-dd')!==dateText) return {ok:false,error:'Invalid date.'};
    const todayStart=parseSlot_(Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd'),'00:00');
    if (dayStart<todayStart) return {ok:true,slots:[],dailyLimitReached:false,timezone:TZ};
    const dayEnd=new Date(dayStart.getTime()+86400000), cal=CalendarApp.getDefaultCalendar(), events=cal.getEvents(dayStart,dayEnd);
    const sh=getApplicationsSheet_(getSpreadsheet_()), count=getRows_(sh).filter(r=>String(r[COLS.DATE]||'')===dateText).length;
    if (count>=DAILY_LIMIT) return {ok:true,slots:[],dailyLimitReached:true,timezone:TZ,date:dateText};
    const slots=[], now=new Date();
    for(let mins=OPEN_HOUR*60;mins+SLOT_MINUTES<=CLOSE_HOUR*60;mins+=SLOT_MINUTES){
      const time=pad2_(Math.floor(mins/60))+':'+pad2_(mins%60), start=parseSlot_(dateText,time), end=new Date(start.getTime()+SLOT_MINUTES*60000);
      if(start<=now) continue;
      if(!events.some(ev=>ev.isAllDayEvent()||(ev.getStartTime()<end&&ev.getEndTime()>start))) slots.push(time);
    }
    return {ok:true,slots:slots,dailyLimitReached:false,timezone:TZ,date:dateText};
  } catch(err) { console.error(err && err.stack ? err.stack : err); return {ok:false,error:'Could not check availability.'}; }
}

function acceptSelectedApplication() { updateSelectedApplication_('ACCEPTED'); }
function declineSelectedApplication() { updateSelectedApplication_('DECLINED'); }

function updateSelectedApplication_(newStatus) {
  const ss=getSpreadsheet_(), sh=getApplicationsSheet_(ss), active=sh.getActiveRange();
  if(!active||active.getRow()<=1) throw new Error('Select an application row first.');
  const row=active.getRow(), lock=LockService.getScriptLock(); lock.waitLock(20000);
  let applicantEmail,applicantName,reference,dateText,timeText;
  try {
    const values=sh.getRange(row,1,1,HEADERS.length).getValues()[0];
    if(String(values[COLS.STATUS]||'')!=='PENDING') throw new Error('Only PENDING applications can be accepted or declined.');
    reference=String(values[COLS.REFERENCE]||''); applicantEmail=String(values[COLS.EMAIL]||''); applicantName=String(values[COLS.NAME]||'');
    dateText=String(values[COLS.DATE]||''); timeText=String(values[COLS.TIME]||'');
    const eventId=String(values[COLS.PENDING_EVENT_ID]||''), cal=CalendarApp.getDefaultCalendar(), pending=eventId?cal.getEventById(eventId):null;
    if(newStatus==='ACCEPTED') {
      const start=parseSlot_(dateText,timeText), end=new Date(start.getTime()+SLOT_MINUTES*60000);
      if(start<=new Date()) throw new Error('This appointment time has already passed.');
      const dayStart=parseSlot_(dateText,'00:00'), events=cal.getEvents(dayStart,new Date(dayStart.getTime()+86400000));
      if(events.some(ev=>ev.getId()!==eventId&&(ev.isAllDayEvent()||(ev.getStartTime()<end&&ev.getEndTime()>start)))) throw new Error('The requested appointment time is now occupied by another calendar event. Resolve the conflict before accepting.');
      if(pending){pending.setTitle(CONFIRMED_PREFIX+' — '+reference+' — '+applicantName);pending.setColor(CalendarApp.EventColor.BLUE);pending.setDescription(pending.getDescription()+'\n\nSTATUS: CONFIRMED BY CONSILIUM');}
      else {const ev=cal.createEvent(CONFIRMED_PREFIX+' — '+reference+' — '+applicantName,start,end,{description:'Application reference: '+reference+'\nSTATUS: CONFIRMED BY CONSILIUM'});sh.getRange(row,COLS.PENDING_EVENT_ID+1).setValue(ev.getId());}
      sh.getRange(row,COLS.STATUS+1).setValue('ACCEPTED');
    } else if(newStatus==='DECLINED') { if(pending) pending.deleteEvent(); sh.getRange(row,COLS.STATUS+1).setValue('DECLINED'); }
    else throw new Error('Unsupported review action.');
    sh.getRange(row,COLS.REVIEWED_AT+1).setValue(Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd HH:mm:ss'));
  } finally {lock.releaseLock();}
  try {
    const accepted=newStatus==='ACCEPTED';
    const body=accepted?['Hello '+applicantName+',','','Your application has been reviewed and your appointment request has been accepted.','','Appointment: '+dateText+' at '+timeText+' ('+TZ+')','Application reference: '+reference,'','We look forward to speaking with you.','','Consilium','Strategy · Intelligence · Execution'].join('\n'):
      ['Hello '+applicantName+',','','Thank you for your application to Consilium.','','After review, we are unable to accept the requested appointment time at this stage.','','Application reference: '+reference,'','We appreciate your interest in Consilium.','','Consilium','Strategy · Intelligence · Execution'].join('\n');
    MailApp.sendEmail({to:applicantEmail,subject:accepted?'Your Consilium Appointment — Confirmed':'Your Consilium Application — Appointment Request Update',body:body,name:'Consilium'});
    sh.getRange(row,COLS.EMAIL_STATUS+1).setValue('REVIEW EMAIL SENT'); sh.getRange(row,COLS.LAST_ERROR+1).clearContent();
  } catch(mailError) {
    sh.getRange(row,COLS.EMAIL_STATUS+1).setValue('REVIEW EMAIL FAILED'); sh.getRange(row,COLS.LAST_ERROR+1).setValue(String(mailError).slice(0,4000));
    throw new Error('The application status was updated, but the applicant notification email failed: '+mailError);
  }
}

const HEADERS = ['Application Reference','Submitted At','Status','Full Name','Email','Phone','Country','City','Applicant Type','Industry / Market','Website / LinkedIn','Objectives','Working Towards','Additional Context','Ability To Accept Change','Appointment Date','Appointment Time','Calendar Event ID','Reviewed At','Notes','Email Status','Admin Action','Last Error','Submission Nonce'];
const COLS = {REFERENCE:0,SUBMITTED_AT:1,STATUS:2,NAME:3,EMAIL:4,PHONE:5,COUNTRY:6,CITY:7,TYPE:8,INDUSTRY:9,URL:10,OBJECTIVES:11,WORKING:12,ADDITIONAL:13,ABILITY:14,DATE:15,TIME:16,PENDING_EVENT_ID:17,REVIEWED_AT:18,NOTES:19,EMAIL_STATUS:20,ADMIN_ACTION:21,LAST_ERROR:22,NONCE:23};

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
function getObjectives_(source) {
  const params = source && source.parameters ? source.parameters : source;
  const v = params && params['objectives[]'];
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
  const data = JSON.stringify({type:'consilium-submit-result',ok:!!ok,nonce:String(nonce || ''),error:String(error || ''),reference:String(reference || '')}).replace(/</g,'\u003c');
  return HtmlService.createHtmlOutput('<!doctype html><html><body><script>parent.postMessage(' + data + ', "*");</script></body></html>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
