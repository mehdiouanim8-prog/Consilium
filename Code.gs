/**
 * CONSILIUM APPLICATION RECEIVER
 * Google Apps Script web app. Receives application JSON and emails the Consilium inbox.
 * Setup: paste into script.google.com, save, Deploy > New deployment > Web app.
 * Execute as: Me. Access: Anyone. Keep the deployment URL private to config.js.
 *
 * IMPORTANT: A static website cannot securely verify that an applicant booked a calendar
 * slot just because a calendar iframe is visible. This script receives the application;
 * Google Calendar separately confirms appointment bookings. Do not describe the appointment
 * as booked unless Calendar sends its booking confirmation.
 */
const DESTINATION_EMAIL = 'consilium.consultinghq@gmail.com';
const BRAND = 'CONSILIUM';

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 30000) return json_({ok:false, error:'Invalid submission'});
    const d = JSON.parse(raw);
    if (d.website) return json_({ok:true}); // basic honeypot
    const required = ['fullName','email','country','applicantType','goal'];
    for (const k of required) {
      if (!String(d[k] || '').trim()) return json_({ok:false, error:'Missing required field'});
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email))) return json_({ok:false, error:'Invalid email'});
    if (d.consent !== true && d.consent !== 'true') return json_({ok:false, error:'Consent required'});
    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      const props = PropertiesService.getScriptProperties();
      const now = Date.now();
      const last = Number(props.getProperty('lastSubmission') || 0);
      if (now - last < 8000) return json_({ok:false, error:'Please wait before submitting again'});
      props.setProperty('lastSubmission', String(now));
    } finally { lock.releaseLock(); }

    const objectives = Array.isArray(d.objectives) ? d.objectives.join(', ') : String(d.objectives || '');
    const subject = 'New Consilium application — ' + clean_(d.fullName, 120);
    const body = [
      'A new application has been submitted through the Consilium website.',
      '',
      'FULL NAME: ' + clean_(d.fullName, 120),
      'EMAIL: ' + clean_(d.email, 200),
      'COUNTRY / REGION: ' + clean_(d.country, 120),
      'APPLICANT TYPE: ' + clean_(d.applicantType, 120),
      'INDUSTRY: ' + clean_(d.industry, 160),
      'REFERENCE URL: ' + clean_(d.referenceUrl, 500),
      'OBJECTIVES: ' + clean_(objectives, 1000),
      '',
      'GOAL / REQUEST:',
      clean_(d.goal, 5000),
      '',
      'ADDITIONAL CONTEXT:',
      clean_(d.additionalContext, 3000),
      '',
      'SUBMITTED AT: ' + clean_(d.submittedAt, 100),
      '',
      'Note: appointment scheduling is handled separately by Google Calendar. Verify its booking confirmation before treating a meeting as confirmed.'
    ].join('\n');
    MailApp.sendEmail({to:DESTINATION_EMAIL, subject:subject, body:body, replyTo:clean_(d.email, 200), name:BRAND + ' Applications'});
    return json_({ok:true});
  } catch (err) {
    return json_({ok:false, error:'Unable to process submission'});
  }
}
function doGet() { return json_({ok:true, service:'Consilium application endpoint'}); }
function clean_(value, max) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0,max); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
