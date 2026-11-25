/* Consilium public appointment calendar.
 * The server is authoritative for all appointment slots and limits.
 */
(function () {
  'use strict';

  const API_BASE = '/api';
  const TIME_ZONE = 'Africa/Casablanca';
  const APPOINTMENT_MINUTES = 45;
  const elements = {
    month: document.getElementById('cal-month'),
    days: document.getElementById('cal-days'),
    slots: document.getElementById('cal-slots'),
    status: document.getElementById('cal-status'),
    prompt: document.getElementById('cal-prompt'),
    selected: document.getElementById('cal-selected'),
    prev: document.getElementById('cal-prev'),
    next: document.getElementById('cal-next'),
    dateInput: document.getElementById('appointment-date'),
    timeInput: document.getElementById('appointment-time'),
    calendar: document.getElementById('booking-calendar')
  };

  if (Object.values(elements).some((element) => !element)) return;

  const pad = (value) => String(value).padStart(2, '0');
  const dateParts = (date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const result = {};
    for (const part of parts) result[part.type] = part.value;
    return result;
  };
  const todayKey = () => {
    const p = dateParts(new Date());
    return `${p.year}-${p.month}-${p.day}`;
  };
  const monthKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  const monthTitle = (date) => new Intl.DateTimeFormat('en', {
    month: 'long', year: 'numeric', timeZone: TIME_ZONE
  }).format(new Date(date.getFullYear(), date.getMonth(), 15, 12));
  const localDateLabel = (key) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('en', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: TIME_ZONE
    }).format(new Date(year, month - 1, day, 12));
  };

  let shownMonth = new Date();
  shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth(), 1, 12);
  let monthAvailability = null;
  let selectedDate = '';
  let selectedTime = '';
  let monthRequestNumber = 0;
  let dateRequestNumber = 0;

  function clearSelection() {
    selectedDate = '';
    selectedTime = '';
    elements.dateInput.value = '';
    elements.timeInput.value = '';
    elements.selected.hidden = true;
    elements.selected.textContent = '';
    elements.slots.replaceChildren();
  }

  function setStatus(message, isError) {
    elements.status.textContent = message;
    elements.status.classList.toggle('cal-error', Boolean(isError));
  }

  async function getJson(path) {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin'
      });
    } catch (_error) {
      throw new Error('We could not reach the appointment service. Please try again.');
    }

    let data;
    try {
      data = await response.json();
    } catch (_error) {
      throw new Error('The appointment service returned an unreadable response. Please try again.');
    }
    if (!response.ok || !data || data.ok !== true) {
      throw new Error((data && data.message) || 'Could not retrieve appointment availability.');
    }
    return data;
  }

  function createDayButton(dayNumber, key, isToday, availableCount) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cal-day';
    button.textContent = String(dayNumber);
    button.dataset.date = key;
    if (isToday) button.classList.add('today');
    if (key === selectedDate) button.classList.add('selected');
    if (key < todayKey() || availableCount === 0) {
      button.disabled = true;
      if (availableCount === 0 && key >= todayKey()) {
        button.setAttribute('aria-label', `${dayNumber}, no times available`);
      }
    } else if (typeof availableCount === 'number') {
      button.setAttribute('aria-label', `${dayNumber}, ${availableCount} available times`);
    }
    button.addEventListener('click', () => chooseDate(key, button));
    return button;
  }

  function renderMonth() {
    elements.month.textContent = monthTitle(shownMonth);
    elements.days.replaceChildren();
    clearSelection();

    const year = shownMonth.getFullYear();
    const month = shownMonth.getMonth();
    const firstWeekdayMondayBased = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let index = 0; index < firstWeekdayMondayBased; index += 1) {
      const blank = document.createElement('span');
      blank.className = 'cal-day empty';
      blank.setAttribute('aria-hidden', 'true');
      elements.days.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${pad(month + 1)}-${pad(day)}`;
      const knownCount = monthAvailability && Object.prototype.hasOwnProperty.call(monthAvailability, key)
        ? monthAvailability[key]
        : undefined;
      elements.days.appendChild(createDayButton(day, key, key === todayKey(), knownCount));
    }

    const today = todayKey();
    const [todayYear, todayMonth] = today.split('-').map(Number);
    const thisMonth = new Date(todayYear, todayMonth - 1, 1, 12);
    elements.prev.disabled = shownMonth <= thisMonth;
    elements.next.disabled = false;
    elements.calendar.setAttribute('aria-busy', 'false');
  }

  async function loadMonthAvailability() {
    const requestNumber = ++monthRequestNumber;
    const key = monthKey(shownMonth);
    elements.calendar.setAttribute('aria-busy', 'true');
    setStatus('Loading available dates…', false);
    try {
      const data = await getJson(`/availability?month=${encodeURIComponent(key)}&v=${Date.now()}`);
      if (requestNumber !== monthRequestNumber || key !== monthKey(shownMonth)) return;
      monthAvailability = data.availableDates || {};
      renderMonth();
      setStatus('Choose an available date to view appointment times. Times are in Casablanca time.', false);
    } catch (error) {
      if (requestNumber !== monthRequestNumber) return;
      monthAvailability = null;
      renderMonth();
      setStatus(`${error.message} You can select a date to retry.`, true);
    }
  }

  function renderSlots(slots, dateKey) {
    elements.slots.replaceChildren();
    for (const time of slots) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cal-slot';
      button.textContent = time;
      button.setAttribute('aria-label', `${time}, 45-minute appointment`);
      if (time === selectedTime && dateKey === selectedDate) button.classList.add('selected');
      button.addEventListener('click', () => selectTime(dateKey, time, button));
      elements.slots.appendChild(button);
    }
  }

  function selectTime(dateKey, time, button) {
    elements.slots.querySelectorAll('.cal-slot.selected').forEach((node) => node.classList.remove('selected'));
    button.classList.add('selected');
    selectedDate = dateKey;
    selectedTime = time;
    elements.dateInput.value = dateKey;
    elements.timeInput.value = time;
    elements.selected.textContent = `Selected: ${localDateLabel(dateKey)} · ${time} (Casablanca time, ${APPOINTMENT_MINUTES} minutes)`;
    elements.selected.hidden = false;
    setStatus('This is an appointment request. The time is reserved as pending and is not confirmed until Consilium accepts it.', false);
  }

  async function chooseDate(key, button) {
    elements.days.querySelectorAll('.cal-day.selected').forEach((node) => node.classList.remove('selected'));
    button.classList.add('selected');
    selectedDate = key;
    selectedTime = '';
    elements.dateInput.value = '';
    elements.timeInput.value = '';
    elements.selected.hidden = true;
    elements.slots.replaceChildren();
    elements.prompt.textContent = `Available appointment times for ${localDateLabel(key)}`;
    setStatus('Checking availability…', false);

    const requestNumber = ++dateRequestNumber;
    try {
      const data = await getJson(`/availability?date=${encodeURIComponent(key)}&v=${Date.now()}`);
      if (requestNumber !== dateRequestNumber || selectedDate !== key) return;
      const slots = Array.isArray(data.slots) ? data.slots : [];
      renderSlots(slots, key);
      if (data.dailyLimitReached) {
        setStatus('This date has reached the daily limit of appointment requests. Please choose another date.', false);
      } else if (slots.length === 0) {
        setStatus('No appointment times are available on this date. Please choose another date.', false);
      } else {
        setStatus('Times are displayed in Casablanca time. Select one to attach it to your application.', false);
      }
    } catch (error) {
      if (requestNumber !== dateRequestNumber) return;
      setStatus(error.message, true);
    }
  }

  elements.prev.addEventListener('click', () => {
    if (elements.prev.disabled) return;
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1, 12);
    monthAvailability = null;
    renderMonth();
    loadMonthAvailability();
  });
  elements.next.addEventListener('click', () => {
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1, 12);
    monthAvailability = null;
    renderMonth();
    loadMonthAvailability();
  });

  window.ConsiliumCalendar = {
    refreshAvailability: async function (dateKey) {
      monthAvailability = null;
      await loadMonthAvailability();
      if (dateKey) {
        const button = elements.days.querySelector(`[data-date="${dateKey}"]`);
        if (button && !button.disabled) await chooseDate(dateKey, button);
      }
    },
    refreshSelectedDate: async function () {
      if (!selectedDate) return;
      const key = selectedDate;
      const button = elements.days.querySelector(`[data-date="${key}"]`);
      if (button) await chooseDate(key, button);
    },
    clearSelection
  };

  renderMonth();
  loadMonthAvailability();
})();
