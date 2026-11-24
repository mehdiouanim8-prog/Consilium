/* Consilium application form submission and validation. */
(function () {
  'use strict';

  const form = document.getElementById('application-form');
  if (!form) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const errorElement = document.getElementById('form-error');
  const successElement = document.getElementById('success');
  const referenceElement = document.getElementById('success-reference');
  const nonceInput = document.getElementById('submission-nonce');
  const timezoneInput = document.getElementById('applicant-timezone');
  const dateInput = document.getElementById('appointment-date');
  const timeInput = document.getElementById('appointment-time');
  const honeypot = document.getElementById('website-honeypot');

  let isSubmitting = false;
  let submitted = false;

  function createNonce() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function showError(message) {
    errorElement.textContent = message;
    errorElement.hidden = false;
  }

  function clearError() {
    errorElement.textContent = '';
    errorElement.hidden = true;
  }

  function buildPayload() {
    const payload = {};
    const objectives = [];
    for (const [key, value] of new FormData(form).entries()) {
      if (key === 'objectives[]') {
        objectives.push(value);
      } else {
        payload[key] = value;
      }
    }
    payload.objectives = objectives;
    payload.submission_nonce = nonceInput.value || createNonce();
    payload.applicant_timezone = timezoneInput.value || 'UTC';
    return payload;
  }

  function setSubmitting(value) {
    isSubmitting = value;
    submitButton.disabled = value;
    submitButton.textContent = value ? 'Submitting…' : 'Submit application ↗';
  }

  function serverMessage(data, status) {
    if (data && typeof data.message === 'string' && data.message.trim()) return data.message;
    if (status === 409) return 'That appointment time is no longer available. Please choose another time.';
    if (status === 429) return 'Too many attempts were received. Please wait a moment and try again.';
    return 'Your application could not be submitted. Please try again.';
  }

  function populateCountries() {
    const select = document.getElementById('country');
    if (!select || select.options.length > 1 || typeof Intl.DisplayNames !== 'function') return;
    const codes = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const countryOptions = codes.map((code) => ({ code, name: names.of(code) }))
      .filter((item) => item.name && item.name !== item.code)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const item of countryOptions) {
      const option = document.createElement('option');
      option.value = item.name;
      option.textContent = item.name;
      select.appendChild(option);
    }
  }

  populateCountries();
  if (timezoneInput) {
    timezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
  if (nonceInput && !nonceInput.value) nonceInput.value = createNonce();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting || submitted) return;
    clearError();

    if (!form.reportValidity()) return;
    if (!dateInput.value || !timeInput.value) {
      showError('Please select an available appointment date and time.');
      document.getElementById('booking-calendar').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (honeypot && honeypot.value.trim()) {
      showError('We could not process this application. Please refresh the page and try again.');
      return;
    }

    const payload = buildPayload();
    nonceInput.value = payload.submission_nonce;
    setSubmitting(true);

    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload)
      });

      let result;
      try {
        result = await response.json();
      } catch (_error) {
        throw new Error('The application service returned an unreadable response. Your application has not been confirmed.');
      }

      if (!response.ok || !result || result.ok !== true || !result.reference) {
        if (response.status === 409 && window.ConsiliumCalendar) {
          window.ConsiliumCalendar.clearSelection();
          await window.ConsiliumCalendar.refreshAvailability(payload.appointment_date);
        }
        throw new Error(serverMessage(result, response.status));
      }

      submitted = true;
      if (window.ConsiliumCalendar) {
        // Refresh the date in case the pending request has just occupied its slot.
        window.ConsiliumCalendar.refreshAvailability(payload.appointment_date).catch(() => {});
      }
      form.style.display = 'none';
      referenceElement.textContent = `Application reference: ${result.reference}`;
      successElement.style.display = 'block';
      successElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Your application could not be submitted. Please try again.');
      setSubmitting(false);
    }
  });
})();
