(() => {
  const cfg = window.CONSILIUM_CONFIG || {};
  const form = document.getElementById('applicationForm');
  const submit = document.getElementById('submitButton');
  const status = document.getElementById('formStatus');
  const notice = document.getElementById('calendarNotice');
  const embed = document.getElementById('calendarEmbed');

  function setStatus(message, kind) {
    status.textContent = message;
    status.className = 'form-status ' + (kind || '');
  }
  function setupCalendar() {
    const url = (cfg.GOOGLE_BOOKING_URL || '').trim();
    if (!url) {
      notice.hidden = false;
      notice.textContent = 'Calendar setup required: paste your Google Calendar appointment-schedule booking link into config.js. Until configured, this form will not submit.';
      return false;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !/(calendar\.google\.com|calendar\.app\.google)/i.test(parsed.hostname)) throw new Error('Invalid calendar URL');
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.title = 'Consilium appointment calendar';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      embed.replaceChildren(iframe);
      embed.hidden = false;
      notice.hidden = true;
      return true;
    } catch (_) {
      notice.hidden = false;
      notice.textContent = 'The calendar link in config.js does not look like a valid Google Calendar booking link.';
      return false;
    }
  }
  setupCalendar();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('', '');
    if (!form.reportValidity()) return;
    if (!cfg.GOOGLE_BOOKING_URL || !cfg.APPS_SCRIPT_URL) {
      setStatus('This application form is not live yet. The site owner must finish the calendar and secure submission setup before accepting applications.', 'error');
      return;
    }
    if (!/(calendar\.google\.com|calendar\.app\.google)/i.test(new URL(cfg.GOOGLE_BOOKING_URL).hostname)) {
      setStatus('The calendar link is invalid. Please contact Consilium.', 'error'); return;
    }
    const checkedObjectives = [...form.querySelectorAll('input[name="objectives"]:checked')].map(el => el.value);
    if (!checkedObjectives.length) {
      setStatus('Please select at least one objective.', 'error');
      form.querySelector('fieldset').scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    data.objectives = checkedObjectives;
    data.consent = form.elements.consent.checked;
    data.submittedAt = new Date().toISOString();
    delete data.website;
    submit.disabled = true;
    submit.textContent = 'Submitting…';
    try {
      const response = await fetch(cfg.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: {'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify(data),
        redirect: 'follow'
      });
      const result = await response.json();
      if (!response.ok || !result || result.ok !== true) throw new Error((result && result.error) || 'Submission failed');
      form.reset();
      setStatus('Thank you for your interest in Consilium. Your application has been received. If you booked a calendar appointment, its confirmation will be sent separately by Google Calendar.', 'success');
    } catch (error) {
      setStatus('We could not submit your application. Please try again in a moment or email consilium.consultinghq@gmail.com. Your details have not been confirmed as received.', 'error');
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Submit application <span aria-hidden="true">↗</span>';
    }
  });
})();