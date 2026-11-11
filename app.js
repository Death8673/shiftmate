/**
 * ShiftMate UK — local-first UI + localStorage
 */
(function () {
  'use strict';

  const Pay = window.ShiftMatePay;
  const Config = window.ShiftMateConfig;
  const Rota = window.ShiftMateRota;
  const Unlock = window.ShiftMateUnlock;
  const STORAGE_KEY = (Config && Config.STORAGE_KEY) || 'shiftmate-uk-v1';
  const gbp = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  });
  const num1 = new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: 2,
  });

  function uid() {
    return (
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function todayIso() {
    return Pay.toDateIso(new Date());
  }

  function defaultPayday() {
    const d = new Date();
    d.setDate(28);
    return Pay.toDateIso(d);
  }

  function seedShiftTypes() {
    return [
      {
        id: uid(),
        name: 'Day',
        defaultStart: '07:00',
        defaultEnd: '15:00',
        unpaidBreakMinutes: 30,
        hourlyRateOverride: null,
        nightEnhancementEnabled: false,
        nightStart: '20:00',
        nightEnd: '06:00',
        nightEnhancementPerHour: 0,
        sleepInEnabled: false,
        sleepInFixedAmount: 0,
        bankHolidayMultiplier: 1,
        overtimeThresholdHours: null,
        overtimeMultiplier: 1.5,
      },
      {
        id: uid(),
        name: 'Late',
        defaultStart: '14:00',
        defaultEnd: '22:00',
        unpaidBreakMinutes: 30,
        hourlyRateOverride: null,
        nightEnhancementEnabled: true,
        nightStart: '20:00',
        nightEnd: '06:00',
        nightEnhancementPerHour: 1.5,
        sleepInEnabled: false,
        sleepInFixedAmount: 0,
        bankHolidayMultiplier: 1,
        overtimeThresholdHours: null,
        overtimeMultiplier: 1.5,
      },
      {
        id: uid(),
        name: 'Night',
        defaultStart: '20:00',
        defaultEnd: '08:00',
        unpaidBreakMinutes: 60,
        hourlyRateOverride: null,
        nightEnhancementEnabled: true,
        nightStart: '20:00',
        nightEnd: '06:00',
        nightEnhancementPerHour: 2.5,
        sleepInEnabled: false,
        sleepInFixedAmount: 0,
        bankHolidayMultiplier: 1,
        overtimeThresholdHours: 11,
        overtimeMultiplier: 1.5,
      },
      {
        id: uid(),
        name: 'Sleep-in',
        defaultStart: '21:00',
        defaultEnd: '07:00',
        unpaidBreakMinutes: 0,
        hourlyRateOverride: null,
        nightEnhancementEnabled: false,
        nightStart: '20:00',
        nightEnd: '06:00',
        nightEnhancementPerHour: 0,
        sleepInEnabled: true,
        sleepInFixedAmount: 40,
        bankHolidayMultiplier: 1,
        overtimeThresholdHours: null,
        overtimeMultiplier: 1.5,
      },
    ];
  }

  function defaultState() {
    return {
      job: {
        employerName: '',
        basicHourlyRate: 12.21,
        contractedHoursPerWeek: 37.5,
        payPeriodType: 'MONTHLY',
        referencePayday: defaultPayday(),
        weekStartDay: 'MONDAY',
        taxPersonalAllowance: 12570,
        taxBasicRatePercent: 20,
        niEmployeePercent: 8,
        niPrimaryThresholdAnnual: 12570,
        pensionPercent: 5,
        onboardingComplete: false,
      },
      shiftTypes: [],
      shifts: [],
    };
  }

  let state = defaultState();
  let calYear, calMonth; // 0-based month
  let selectedDate = todayIso();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = defaultState();
        state.shiftTypes = seedShiftTypes();
        save();
        return;
      }
      state = JSON.parse(raw);
      if (!state.job) state.job = defaultState().job;
      if (!Array.isArray(state.shiftTypes)) state.shiftTypes = [];
      if (!Array.isArray(state.shifts)) state.shifts = [];
      if (state.shiftTypes.length === 0) {
        state.shiftTypes = seedShiftTypes();
        save();
      }
    } catch (e) {
      console.warn('Load failed, resetting', e);
      state = defaultState();
      state.shiftTypes = seedShiftTypes();
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function typeById(id) {
    return state.shiftTypes.find((t) => t.id === id) || null;
  }

  function shiftsOnDate(iso) {
    return state.shifts
      .filter((s) => s.calendarDate === iso)
      .sort((a, b) =>
        String(a.scheduledStart).localeCompare(String(b.scheduledStart))
      );
  }

  function combineDateTime(dateIso, timeHHMM) {
    return dateIso + 'T' + timeHHMM;
  }

  /** If end time is before/equal start on same calendar day, roll to next day */
  function scheduledEndFromType(dateIso, type) {
    const start = combineDateTime(dateIso, type.defaultStart);
    let endDate = dateIso;
    const [sh, sm] = type.defaultStart.split(':').map(Number);
    const [eh, em] = type.defaultEnd.split(':').map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
      endDate = Pay.toDateIso(Pay.addDays(Pay.parseLocalDateTime(dateIso + 'T00:00'), 1));
    }
    return combineDateTime(endDate, type.defaultEnd);
  }

  function toDatetimeLocalValue(iso) {
    if (!iso) return '';
    return String(iso).slice(0, 16);
  }

  function fromDatetimeLocalValue(v) {
    if (!v) return null;
    return v.length === 16 ? v : v.slice(0, 16);
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = Pay.parseLocalDateTime(iso);
    return (
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0')
    );
  }

  function fmtDateShort(iso) {
    const d = Pay.parseLocalDateTime(iso + 'T00:00');
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  function weekStartOffset(dayName) {
    // JS getDay: 0=Sun … 6=Sat. We want first column.
    switch (String(dayName).toUpperCase()) {
      case 'SUNDAY':
        return 0;
      case 'SATURDAY':
        return 6;
      case 'MONDAY':
      default:
        return 1;
    }
  }

  function isUnlocked() {
    return Unlock.isLicensed(Config, Unlock.readState(Config));
  }

  function freeHorizonIso() {
    return Unlock.horizonIso(todayIso(), Config.FREE_ROTA_WEEKS_AHEAD, Pay);
  }

  function isBeyondFreeHorizon(iso) {
    return !isUnlocked() && Unlock.isDateBeyondHorizon(
      iso,
      todayIso(),
      Config.FREE_ROTA_WEEKS_AHEAD,
      Pay
    );
  }

  function filterByHorizon(shifts) {
    if (isUnlocked()) return { kept: shifts, blocked: [] };
    const kept = [];
    const blocked = [];
    for (const s of shifts) {
      if (isBeyondFreeHorizon(s.calendarDate)) blocked.push(s);
      else kept.push(s);
    }
    return { kept, blocked };
  }

  function unlockCtaMessage() {
    return (
      'Free plan: rota is limited to ' +
      Config.FREE_ROTA_WEEKS_AHEAD +
      ' weeks ahead, and the full pay breakdown is locked. Unlock ShiftMate (' +
      Config.UNLOCK_PRICE +
      ' ' +
      Config.UNLOCK_PRICE_LABEL +
      ') for the full app.'
    );
  }

  function renderUnlockBanners() {
    const show = Config.UNLOCK_ENABLED && !isUnlocked();
    ['home-unlock-banner', 'rota-unlock-banner'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!show) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
      }
      el.classList.remove('hidden');
      el.innerHTML =
        '<p style="margin:0 0 8px">' +
        escapeHtml(unlockCtaMessage()) +
        '</p><button type="button" class="btn accent sm js-open-unlock">Unlock ShiftMate</button>';
      el.querySelectorAll('.js-open-unlock').forEach((btn) => {
        btn.addEventListener('click', () => switchTab('unlock'));
      });
    });
    const unlockBtn = document.querySelector('#bottom-nav button[data-tab="unlock"]');
    if (unlockBtn) {
      unlockBtn.classList.toggle('hidden', !Config.UNLOCK_ENABLED);
    }
  }

  function moneyOrLocked(el, valueText) {
    if (!el) return;
    if (isUnlocked()) {
      el.classList.remove('locked-value');
      el.textContent = valueText;
    } else {
      el.classList.add('locked-value');
      el.textContent = 'Unlock';
    }
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  // —— Navigation ——
  function showOnboarding() {
    document.getElementById('onboarding-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    const j = state.job;
    document.getElementById('ob-employer').value = j.employerName || '';
    document.getElementById('ob-rate').value = j.basicHourlyRate ?? 12.21;
    document.getElementById('ob-hours').value = j.contractedHoursPerWeek ?? 37.5;
    document.getElementById('ob-period').value = j.payPeriodType || 'MONTHLY';
    document.getElementById('ob-payday').value = j.referencePayday || defaultPayday();
    document.getElementById('ob-weekstart').value = j.weekStartDay || 'MONDAY';
  }

  function showApp() {
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('header-sub').textContent =
      (state.job.employerName || 'Job') + ' · local-only';
    renderUnlockBanners();
    switchTab('home');
  }

  function switchTab(tab) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('#bottom-nav button').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    const screen = document.getElementById('screen-' + tab);
    if (screen) screen.classList.add('active');
    if (tab === 'home') renderDashboard();
    if (tab === 'rota') renderCalendar();
    if (tab === 'types') renderTypes();
    if (tab === 'job') renderJobForm();
    if (tab === 'unlock') renderUnlockScreen();
    renderUnlockBanners();
  }

  // —— Dashboard ——
  function renderDashboard() {
    const job = state.job;
    const today = todayIso();
    const period = Pay.periodContaining(today, job.referencePayday, job.payPeriodType);
    const payday = Pay.nextPayday(today, job.referencePayday, job.payPeriodType);
    const paydayDate = Pay.parseLocalDateTime(payday + 'T00:00');
    const todayDate = Pay.parseLocalDateTime(today + 'T00:00');
    const daysToPayday = Pay.daysBetween(todayDate, paydayDate);

    document.getElementById('dash-period-range').textContent =
      fmtDateShort(period.start) + ' → ' + fmtDateShort(period.end);
    document.getElementById('dash-payday').textContent =
      daysToPayday === 0
        ? 'Payday today (' + fmtDateShort(payday) + ')'
        : 'Payday in ' + daysToPayday + ' day' + (daysToPayday === 1 ? '' : 's') +
          ' (' + fmtDateShort(payday) + ')';
    document.getElementById('dash-employer').textContent =
      job.employerName || '—';

    // Next upcoming shift
    const now = new Date();
    const upcoming = state.shifts
      .filter((s) => {
        if (s.leaveType && s.leaveType !== 'NONE') return false;
        try {
          return Pay.parseLocalDateTime(s.scheduledStart) >= now;
        } catch (_) {
          return false;
        }
      })
      .sort((a, b) =>
        String(a.scheduledStart).localeCompare(String(b.scheduledStart))
      );
    const nextEl = document.getElementById('dash-next-body');
    if (upcoming.length === 0) {
      nextEl.textContent = 'No upcoming shifts — add one on Rota.';
    } else {
      const s = upcoming[0];
      nextEl.innerHTML =
        '<strong>' +
        escapeHtml(s.title) +
        '</strong><br>' +
        fmtDateShort(s.calendarDate) +
        ' · ' +
        fmtTime(s.scheduledStart) +
        '–' +
        fmtTime(s.scheduledEnd);
    }

    // Period totals
    let schedMins = 0;
    let workedMins = 0;
    let otMins = 0;
    let sleepIns = 0;
    let gross = 0;

    const inPeriod = state.shifts.filter(
      (s) => s.calendarDate >= period.start && s.calendarDate <= period.end
    );

    for (const s of inPeriod) {
      const type = typeById(s.shiftTypeId);
      const result = Pay.calculateShift(s, type, job);
      gross += result.grossTotal;
      otMins += result.overtimeMinutes;
      if (result.sleepInAmount > 0 || s.isSleepIn || (type && type.sleepInEnabled)) {
        sleepIns += 1;
      }
      // scheduled hours (always from scheduled window minus break, ignore leave for display of "scheduled")
      try {
        const schedWin = {
          start: s.scheduledStart,
          end: s.scheduledEnd,
          unpaidBreakMinutes: s.unpaidBreakMinutes || 0,
          isBankHolidayOverride: null,
          isSleepIn: false,
        };
        const portions = Pay.splitByCalendarDay(
          schedWin,
          Pay.rulesFromType(type),
          { basicHourlyRate: job.basicHourlyRate }
        );
        const sm = portions.reduce((a, p) => a + p.paidMinutes, 0);
        schedMins += sm;
      } catch (_) {}

      if (!result.isLeave) {
        workedMins += result.paidMinutes;
      }
    }

    const takeHome = Pay.estimateTakeHome(
      gross,
      Pay.periodsPerYear(job.payPeriodType),
      job
    );

    document.getElementById('dash-sched-hrs').textContent = num1.format(schedMins / 60);
    document.getElementById('dash-worked-hrs').textContent = num1.format(workedMins / 60);
    document.getElementById('dash-ot-hrs').textContent = num1.format(otMins / 60);
    document.getElementById('dash-sleepins').textContent = String(sleepIns);
    moneyOrLocked(document.getElementById('dash-gross'), gbp.format(gross));
    moneyOrLocked(document.getElementById('dash-net'), gbp.format(takeHome.estimatedNet));
    moneyOrLocked(document.getElementById('dash-tax'), gbp.format(takeHome.estimatedTax));
    moneyOrLocked(document.getElementById('dash-ni'), gbp.format(takeHome.estimatedNi));
    moneyOrLocked(
      document.getElementById('dash-pension'),
      gbp.format(takeHome.estimatedPension)
    );
    renderUnlockBanners();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // —— Calendar ——
  function renderCalendar() {
    const job = state.job;
    const offset = weekStartOffset(job.weekStartDay);
    const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const ordered = [];
    for (let i = 0; i < 7; i++) ordered.push(dowNames[(offset + i) % 7]);

    const dows = document.getElementById('cal-dows');
    dows.innerHTML = ordered
      .map((d) => '<div class="cal-dow">' + d + '</div>')
      .join('');

    const title = document.getElementById('cal-title');
    const labelDate = new Date(calYear, calMonth, 1);
    title.textContent = labelDate.toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
    });

    const first = new Date(calYear, calMonth, 1);
    const startPad = (first.getDay() - offset + 7) % 7;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';

    const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startPad + 1;
      const cellDate = new Date(calYear, calMonth, dayNum);
      const iso = Pay.toDateIso(cellDate);
      const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      if (!inMonth) btn.classList.add('other');
      if (iso === todayIso()) btn.classList.add('today');
      if (iso === selectedDate) btn.classList.add('selected');
      if (Pay.isBankHoliday(iso)) btn.classList.add('bh');
      if (shiftsOnDate(iso).length) btn.classList.add('has-shift');
      if (isBeyondFreeHorizon(iso)) btn.classList.add('locked');
      btn.textContent = String(cellDate.getDate());
      btn.dataset.date = iso;
      btn.addEventListener('click', () => {
        selectedDate = iso;
        renderCalendar();
      });
      grid.appendChild(btn);
    }

    renderDayPanel();
    refreshRotaTools();
    renderUnlockBanners();
  }

  function renderDayPanel() {
    document.getElementById('day-title').textContent = fmtDateShort(selectedDate);
    const list = document.getElementById('day-shifts');
    const items = shiftsOnDate(selectedDate);
    if (!items.length) {
      list.innerHTML = '<p class="empty">No shifts on this day.</p>';
      return;
    }
    list.innerHTML = items
      .map((s) => {
        const type = typeById(s.shiftTypeId);
        let payLabel = '';
        if (!isUnlocked()) {
          payLabel = 'Unlock';
        } else {
          try {
            const r = Pay.calculateShift(s, type, state.job);
            payLabel = r.isLeave ? 'Leave · £0' : gbp.format(r.grossTotal);
          } catch (_) {
            payLabel = '—';
          }
        }
        const badges = [];
        if (s.leaveType && s.leaveType !== 'NONE') {
          badges.push('<span class="badge leave">' + escapeHtml(s.leaveType.replace(/_/g, ' ')) + '</span>');
        }
        if (s.isSleepIn || (type && type.sleepInEnabled)) {
          badges.push('<span class="badge sleep">Sleep-in</span>');
        }
        return (
          '<div class="list-item" data-edit-shift="' +
          escapeHtml(s.id) +
          '">' +
          '<div><div class="title">' +
          escapeHtml(s.title) +
          ' ' +
          badges.join(' ') +
          '</div>' +
          '<div class="meta">' +
          fmtTime(s.scheduledStart) +
          '–' +
          fmtTime(s.scheduledEnd) +
          (s.workedStart
            ? ' · worked ' + fmtTime(s.workedStart) + '–' + fmtTime(s.workedEnd)
            : '') +
          '</div></div>' +
          '<div style="text-align:right"><div class="badge">' +
          payLabel +
          '</div></div></div>'
        );
      })
      .join('');

    list.querySelectorAll('[data-edit-shift]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => openShiftModal(el.dataset.editShift));
    });
  }

  // —— Types ——
  function renderTypes() {
    const list = document.getElementById('types-list');
    if (!state.shiftTypes.length) {
      list.innerHTML = '<p class="empty">No shift types yet.</p>';
      return;
    }
    list.innerHTML = state.shiftTypes
      .map((t) => {
        const bits = [
          t.defaultStart + '–' + t.defaultEnd,
          t.unpaidBreakMinutes + 'm break',
        ];
        if (t.nightEnhancementEnabled) bits.push('night +' + gbp.format(t.nightEnhancementPerHour) + '/hr');
        if (t.sleepInEnabled) bits.push('sleep-in ' + gbp.format(t.sleepInFixedAmount));
        if (t.overtimeThresholdHours != null) bits.push('OT>' + t.overtimeThresholdHours + 'h');
        return (
          '<div class="list-item" data-edit-type="' +
          escapeHtml(t.id) +
          '" style="cursor:pointer">' +
          '<div><div class="title">' +
          escapeHtml(t.name) +
          '</div><div class="meta">' +
          escapeHtml(bits.join(' · ')) +
          '</div></div><span class="badge">Edit</span></div>'
        );
      })
      .join('');
    list.querySelectorAll('[data-edit-type]').forEach((el) => {
      el.addEventListener('click', () => openTypeModal(el.dataset.editType));
    });
  }

  // —— Job form ——
  function renderJobForm() {
    const j = state.job;
    document.getElementById('job-employer').value = j.employerName || '';
    document.getElementById('job-rate').value = j.basicHourlyRate ?? '';
    document.getElementById('job-hours').value = j.contractedHoursPerWeek ?? '';
    document.getElementById('job-period').value = j.payPeriodType || 'MONTHLY';
    document.getElementById('job-payday').value = j.referencePayday || '';
    document.getElementById('job-weekstart').value = j.weekStartDay || 'MONDAY';
    document.getElementById('job-allowance').value = j.taxPersonalAllowance ?? 12570;
    document.getElementById('job-taxrate').value = j.taxBasicRatePercent ?? 20;
    document.getElementById('job-ni').value = j.niEmployeePercent ?? 8;
    document.getElementById('job-nithresh').value = j.niPrimaryThresholdAnnual ?? 12570;
    document.getElementById('job-pension').value = j.pensionPercent ?? 5;
  }

  function saveJobFromForm(fromOnboarding) {
    const prefix = fromOnboarding ? 'ob' : 'job';
    const employer = document.getElementById(prefix + '-employer').value.trim();
    const rate = parseFloat(document.getElementById(prefix + '-rate').value);
    const hours = parseFloat(document.getElementById(prefix + '-hours').value);
    const period = document.getElementById(prefix + '-period').value;
    const payday = document.getElementById(prefix + '-payday').value;
    const weekstart = document.getElementById(prefix + '-weekstart').value;

    if (!employer) {
      alert('Please enter an employer name.');
      return false;
    }
    if (!(rate >= 0) || isNaN(rate)) {
      alert('Please enter a valid hourly rate.');
      return false;
    }
    if (!payday) {
      alert('Please pick a reference payday.');
      return false;
    }

    state.job.employerName = employer;
    state.job.basicHourlyRate = rate;
    state.job.contractedHoursPerWeek = isNaN(hours) ? null : hours;
    state.job.payPeriodType = period;
    state.job.referencePayday = payday;
    state.job.weekStartDay = weekstart;

    if (!fromOnboarding) {
      state.job.taxPersonalAllowance = parseFloat(
        document.getElementById('job-allowance').value
      ) || 12570;
      state.job.taxBasicRatePercent = parseFloat(
        document.getElementById('job-taxrate').value
      ) || 20;
      state.job.niEmployeePercent = parseFloat(
        document.getElementById('job-ni').value
      ) || 8;
      state.job.niPrimaryThresholdAnnual = parseFloat(
        document.getElementById('job-nithresh').value
      ) || 12570;
      state.job.pensionPercent = parseFloat(
        document.getElementById('job-pension').value
      ) || 5;
    }

    state.job.onboardingComplete = true;
    save();
    return true;
  }

  // —— Shift modal ——
  function populateTypeSelect(selectedId) {
    const sel = document.getElementById('shift-type');
    sel.innerHTML =
      '<option value="">Custom</option>' +
      state.shiftTypes
        .map(
          (t) =>
            '<option value="' +
            escapeHtml(t.id) +
            '"' +
            (t.id === selectedId ? ' selected' : '') +
            '>' +
            escapeHtml(t.name) +
            '</option>'
        )
        .join('');
  }

  function applyTypeDefaultsToForm() {
    const typeId = document.getElementById('shift-type').value;
    const type = typeById(typeId);
    const date = document.getElementById('shift-date').value || selectedDate;
    if (!type) return;
    document.getElementById('shift-title').value = type.name;
    document.getElementById('shift-start').value = toDatetimeLocalValue(
      combineDateTime(date, type.defaultStart)
    );
    document.getElementById('shift-end').value = toDatetimeLocalValue(
      scheduledEndFromType(date, type)
    );
    document.getElementById('shift-break').value = type.unpaidBreakMinutes || 0;
    document.getElementById('shift-sleepin').checked = !!type.sleepInEnabled;
    updateShiftPayPreview();
  }

  function openShiftModal(id) {
    if (!id && isBeyondFreeHorizon(selectedDate)) {
      alert(
        'Free plan limits the rota to ' +
          Config.FREE_ROTA_WEEKS_AHEAD +
          ' weeks ahead. Unlock ShiftMate to add later shifts.'
      );
      switchTab('unlock');
      return;
    }
    const modal = document.getElementById('shift-modal');
    const delBtn = document.getElementById('shift-delete');
    if (id) {
      const s = state.shifts.find((x) => x.id === id);
      if (!s) return;
      document.getElementById('shift-modal-title').textContent = 'Edit shift';
      document.getElementById('shift-id').value = s.id;
      populateTypeSelect(s.shiftTypeId || '');
      document.getElementById('shift-title').value = s.title;
      document.getElementById('shift-date').value = s.calendarDate;
      document.getElementById('shift-start').value = toDatetimeLocalValue(s.scheduledStart);
      document.getElementById('shift-end').value = toDatetimeLocalValue(s.scheduledEnd);
      document.getElementById('shift-worked-start').value = toDatetimeLocalValue(s.workedStart);
      document.getElementById('shift-worked-end').value = toDatetimeLocalValue(s.workedEnd);
      document.getElementById('shift-break').value = s.unpaidBreakMinutes || 0;
      document.getElementById('shift-leave').value = s.leaveType || 'NONE';
      document.getElementById('shift-sleepin').checked = !!s.isSleepIn;
      document.getElementById('shift-bh').value =
        s.bankHolidayOverride == null ? '' : String(s.bankHolidayOverride);
      document.getElementById('shift-notes').value = s.notes || '';
      delBtn.classList.remove('hidden');
    } else {
      document.getElementById('shift-modal-title').textContent = 'Add shift';
      document.getElementById('shift-id').value = '';
      const dayType = state.shiftTypes.find((t) => t.name === 'Day') || state.shiftTypes[0];
      populateTypeSelect(dayType ? dayType.id : '');
      document.getElementById('shift-date').value = selectedDate;
      document.getElementById('shift-worked-start').value = '';
      document.getElementById('shift-worked-end').value = '';
      document.getElementById('shift-leave').value = 'NONE';
      document.getElementById('shift-bh').value = '';
      document.getElementById('shift-notes').value = '';
      if (dayType) applyTypeDefaultsToForm();
      else {
        document.getElementById('shift-title').value = 'Shift';
        document.getElementById('shift-start').value = selectedDate + 'T09:00';
        document.getElementById('shift-end').value = selectedDate + 'T17:00';
        document.getElementById('shift-break').value = 30;
        document.getElementById('shift-sleepin').checked = false;
      }
      delBtn.classList.add('hidden');
    }
    updateShiftPayPreview();
    modal.classList.add('open');
  }

  function closeShiftModal() {
    document.getElementById('shift-modal').classList.remove('open');
  }

  function readShiftForm() {
    const bhVal = document.getElementById('shift-bh').value;
    return {
      id: document.getElementById('shift-id').value || uid(),
      shiftTypeId: document.getElementById('shift-type').value || null,
      title: document.getElementById('shift-title').value.trim() || 'Shift',
      calendarDate: document.getElementById('shift-date').value,
      scheduledStart: fromDatetimeLocalValue(document.getElementById('shift-start').value),
      scheduledEnd: fromDatetimeLocalValue(document.getElementById('shift-end').value),
      workedStart: fromDatetimeLocalValue(document.getElementById('shift-worked-start').value),
      workedEnd: fromDatetimeLocalValue(document.getElementById('shift-worked-end').value),
      unpaidBreakMinutes: parseInt(document.getElementById('shift-break').value, 10) || 0,
      leaveType: document.getElementById('shift-leave').value || 'NONE',
      isSleepIn: document.getElementById('shift-sleepin').checked,
      bankHolidayOverride: bhVal === '' ? null : bhVal === 'true',
      notes: document.getElementById('shift-notes').value.trim() || null,
    };
  }

  function updateShiftPayPreview() {
    const el = document.getElementById('shift-pay-preview');
    try {
      const draft = readShiftForm();
      if (!draft.scheduledStart || !draft.scheduledEnd) {
        el.textContent = '';
        return;
      }
      const type = typeById(draft.shiftTypeId);
      const r = Pay.calculateShift(draft, type, state.job);
      if (!isUnlocked()) {
        el.textContent =
          num1.format(r.paidHours) +
          ' paid hrs — unlock to see the full pay breakdown.';
        return;
      }
      if (r.isLeave) {
        el.textContent = 'Leave — pay £0.00';
        return;
      }
      el.textContent =
        'Est. gross ' +
        gbp.format(r.grossTotal) +
        ' · ' +
        num1.format(r.paidHours) +
        ' paid hrs' +
        (r.overtimeMinutes ? ' · OT ' + num1.format(r.overtimeHours) + 'h' : '') +
        (r.nightMinutes ? ' · night ' + num1.format(r.nightHours) + 'h' : '');
    } catch (e) {
      el.textContent = 'Check times: ' + (e.message || e);
    }
  }

  function saveShift() {
    const draft = readShiftForm();
    if (!draft.calendarDate || !draft.scheduledStart || !draft.scheduledEnd) {
      alert('Date and scheduled start/end are required.');
      return;
    }
    try {
      Pay.parseLocalDateTime(draft.scheduledStart);
      Pay.parseLocalDateTime(draft.scheduledEnd);
    } catch (e) {
      alert('Invalid times.');
      return;
    }
    if (isBeyondFreeHorizon(draft.calendarDate)) {
      alert(
        'Free plan limits the rota to ' +
          Config.FREE_ROTA_WEEKS_AHEAD +
          ' weeks ahead. Unlock ShiftMate to save this shift.'
      );
      switchTab('unlock');
      return;
    }
    const idx = state.shifts.findIndex((s) => s.id === draft.id);
    if (idx >= 0) state.shifts[idx] = draft;
    else state.shifts.push(draft);
    selectedDate = draft.calendarDate;
    save();
    closeShiftModal();
    renderCalendar();
    renderDashboard();
  }

  function deleteShift() {
    const id = document.getElementById('shift-id').value;
    if (!id || !confirm('Delete this shift?')) return;
    state.shifts = state.shifts.filter((s) => s.id !== id);
    save();
    closeShiftModal();
    renderCalendar();
  }

  // —— Type modal ——
  function openTypeModal(id) {
    const modal = document.getElementById('type-modal');
    const delBtn = document.getElementById('type-delete');
    if (id) {
      const t = typeById(id);
      if (!t) return;
      document.getElementById('type-modal-title').textContent = 'Edit type';
      document.getElementById('type-id').value = t.id;
      document.getElementById('type-name').value = t.name;
      document.getElementById('type-start').value = t.defaultStart;
      document.getElementById('type-end').value = t.defaultEnd;
      document.getElementById('type-break').value = t.unpaidBreakMinutes || 0;
      document.getElementById('type-rate').value =
        t.hourlyRateOverride != null ? t.hourlyRateOverride : '';
      document.getElementById('type-night').checked = !!t.nightEnhancementEnabled;
      document.getElementById('type-night-start').value = t.nightStart || '20:00';
      document.getElementById('type-night-end').value = t.nightEnd || '06:00';
      document.getElementById('type-night-rate').value = t.nightEnhancementPerHour || 0;
      document.getElementById('type-sleep').checked = !!t.sleepInEnabled;
      document.getElementById('type-sleep-amt').value = t.sleepInFixedAmount || 0;
      document.getElementById('type-bh-mult').value = t.bankHolidayMultiplier ?? 1;
      document.getElementById('type-ot-thresh').value =
        t.overtimeThresholdHours != null ? t.overtimeThresholdHours : '';
      document.getElementById('type-ot-mult').value = t.overtimeMultiplier ?? 1.5;
      delBtn.classList.remove('hidden');
    } else {
      document.getElementById('type-modal-title').textContent = 'Add type';
      document.getElementById('type-id').value = '';
      document.getElementById('type-name').value = '';
      document.getElementById('type-start').value = '09:00';
      document.getElementById('type-end').value = '17:00';
      document.getElementById('type-break').value = 30;
      document.getElementById('type-rate').value = '';
      document.getElementById('type-night').checked = false;
      document.getElementById('type-night-start').value = '20:00';
      document.getElementById('type-night-end').value = '06:00';
      document.getElementById('type-night-rate').value = 0;
      document.getElementById('type-sleep').checked = false;
      document.getElementById('type-sleep-amt').value = 0;
      document.getElementById('type-bh-mult').value = 1;
      document.getElementById('type-ot-thresh').value = '';
      document.getElementById('type-ot-mult').value = 1.5;
      delBtn.classList.add('hidden');
    }
    modal.classList.add('open');
  }

  function closeTypeModal() {
    document.getElementById('type-modal').classList.remove('open');
  }

  function saveType() {
    const id = document.getElementById('type-id').value || uid();
    const name = document.getElementById('type-name').value.trim();
    if (!name) {
      alert('Name is required.');
      return;
    }
    const rateRaw = document.getElementById('type-rate').value;
    const otRaw = document.getElementById('type-ot-thresh').value;
    const t = {
      id,
      name,
      defaultStart: document.getElementById('type-start').value || '09:00',
      defaultEnd: document.getElementById('type-end').value || '17:00',
      unpaidBreakMinutes: parseInt(document.getElementById('type-break').value, 10) || 0,
      hourlyRateOverride: rateRaw === '' ? null : parseFloat(rateRaw),
      nightEnhancementEnabled: document.getElementById('type-night').checked,
      nightStart: document.getElementById('type-night-start').value || '20:00',
      nightEnd: document.getElementById('type-night-end').value || '06:00',
      nightEnhancementPerHour:
        parseFloat(document.getElementById('type-night-rate').value) || 0,
      sleepInEnabled: document.getElementById('type-sleep').checked,
      sleepInFixedAmount:
        parseFloat(document.getElementById('type-sleep-amt').value) || 0,
      bankHolidayMultiplier:
        parseFloat(document.getElementById('type-bh-mult').value) || 1,
      overtimeThresholdHours: otRaw === '' ? null : parseFloat(otRaw),
      overtimeMultiplier:
        parseFloat(document.getElementById('type-ot-mult').value) || 1.5,
    };
    const idx = state.shiftTypes.findIndex((x) => x.id === id);
    if (idx >= 0) state.shiftTypes[idx] = t;
    else state.shiftTypes.push(t);
    save();
    closeTypeModal();
    renderTypes();
  }

  function deleteType() {
    const id = document.getElementById('type-id').value;
    if (!id || !confirm('Delete this shift type?')) return;
    state.shiftTypes = state.shiftTypes.filter((t) => t.id !== id);
    save();
    closeTypeModal();
    renderTypes();
  }

  // —— Rota tools (copy week / repeating pattern) ——
  let customCycle = [];

  function typeOptionsHtml(selectedId, includeOff) {
    let html = includeOff
      ? '<option value="">Off</option>'
      : '';
    html += state.shiftTypes
      .map(
        (t) =>
          '<option value="' +
          escapeHtml(t.id) +
          '"' +
          (t.id === selectedId ? ' selected' : '') +
          '>' +
          escapeHtml(t.name) +
          '</option>'
      )
      .join('');
    return html;
  }

  function defaultOnTypeId() {
    const day = state.shiftTypes.find((t) => t.name === 'Day');
    return (day || state.shiftTypes[0] || {}).id || '';
  }

  function ensureCustomCycle() {
    if (customCycle.length) return;
    const typeId = defaultOnTypeId();
    customCycle = [
      { shiftTypeId: typeId },
      { shiftTypeId: typeId },
      { shiftTypeId: typeId },
      { shiftTypeId: typeId },
      { off: true },
      { off: true },
      { off: true },
      { off: true },
    ];
  }

  function renderCustomCycleRows() {
    ensureCustomCycle();
    const wrap = document.getElementById('pattern-custom-rows');
    wrap.innerHTML = customCycle
      .map((step, i) => {
        const selected = step.off ? '' : step.shiftTypeId || '';
        return (
          '<div class="cycle-row" data-cycle-index="' +
          i +
          '">' +
          '<div class="cycle-day">D' +
          (i + 1) +
          '</div>' +
          '<select data-cycle-type>' +
          typeOptionsHtml(selected, true) +
          '</select>' +
          '<button type="button" class="btn ghost sm" data-cycle-remove aria-label="Remove day">×</button>' +
          '</div>'
        );
      })
      .join('');
    wrap.querySelectorAll('[data-cycle-type]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.closest('.cycle-row').dataset.cycleIndex);
        const val = sel.value;
        customCycle[i] = val ? { shiftTypeId: val } : { off: true };
        updatePatternPreview();
      });
    });
    wrap.querySelectorAll('[data-cycle-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (customCycle.length <= 1) return;
        const i = Number(btn.closest('.cycle-row').dataset.cycleIndex);
        customCycle.splice(i, 1);
        renderCustomCycleRows();
        updatePatternPreview();
      });
    });
  }

  function syncPatternPresetUi() {
    const preset = document.getElementById('pattern-preset').value;
    const custom = preset === 'custom';
    document.getElementById('pattern-on-type-wrap').classList.toggle('hidden', custom);
    document.getElementById('pattern-custom-wrap').classList.toggle('hidden', !custom);
    if (custom) renderCustomCycleRows();
    updatePatternPreview();
  }

  function readPatternCycle() {
    const preset = document.getElementById('pattern-preset').value;
    if (preset === 'custom') {
      ensureCustomCycle();
      return Rota.normalizeCycle(customCycle);
    }
    const typeId = document.getElementById('pattern-on-type').value;
    if (!typeId) throw new Error('Choose a shift type for working days.');
    return Rota.cycleFromPreset(preset, typeId);
  }

  function updatePatternPreview() {
    const el = document.getElementById('pattern-preview');
    try {
      const start = document.getElementById('pattern-start').value;
      const end = document.getElementById('pattern-end').value;
      if (!start || !end) {
        el.textContent = '';
        return;
      }
      const cycle = readPatternCycle();
      const names = cycle.map((s) => {
        if (s.off) return 'Off';
        const t = typeById(s.shiftTypeId);
        return t ? t.name : '?';
      });
      const draft = Rota.generatePatternShifts({
        startIso: start,
        endIso: end,
        cycle,
        shiftTypes: state.shiftTypes,
        existingShifts: state.shifts,
        skipExisting: document.getElementById('pattern-skip').checked,
        uid: uid,
      });
      el.textContent =
        cycle.length +
        '-day cycle: ' +
        names.join(' · ') +
        '. ' +
        draft.days +
        ' days → ' +
        draft.created.length +
        ' new shift' +
        (draft.created.length === 1 ? '' : 's') +
        (draft.skipped ? ', ' + draft.skipped + ' skipped' : '') +
        (draft.offDays ? ', ' + draft.offDays + ' off' : '') +
        '.';
    } catch (e) {
      el.textContent = e.message || String(e);
    }
  }

  function refreshRotaTools() {
    const weekStart = Rota.startOfWeek(selectedDate, state.job.weekStartDay);
    const weekEnd = Rota.endOfWeek(selectedDate, state.job.weekStartDay);
    const count = state.shifts.filter(
      (s) => s.calendarDate >= weekStart && s.calendarDate <= weekEnd
    ).length;
    document.getElementById('copy-week-summary').textContent =
      'Week of ' +
      fmtDateShort(weekStart) +
      ' – ' +
      fmtDateShort(weekEnd) +
      ' · ' +
      count +
      ' shift' +
      (count === 1 ? '' : 's');

    const typeSel = document.getElementById('pattern-on-type');
    const prev = typeSel.value || defaultOnTypeId();
    typeSel.innerHTML = typeOptionsHtml(prev, false);
    if (!document.getElementById('pattern-start').value) {
      document.getElementById('pattern-start').value = selectedDate;
    }
    if (!document.getElementById('pattern-end').value) {
      document.getElementById('pattern-end').value = Rota.addDaysIso(selectedDate, 27);
    }
    syncPatternPresetUi();
  }

  function handleCopyWeek() {
    const n = parseInt(document.getElementById('copy-week-n').value, 10);
    if (!(n >= 1)) {
      alert('Enter how many weeks to copy into (at least 1).');
      return;
    }
    const result = Rota.copyWeekForward({
      shifts: state.shifts,
      fromDateIso: selectedDate,
      weekStartDay: state.job.weekStartDay,
      weeks: n,
      skipExisting: document.getElementById('copy-week-skip').checked,
      uid: uid,
    });
    if (result.sourceCount === 0) {
      alert('No shifts in this week to copy.');
      return;
    }
    const split = filterByHorizon(result.copied);
    const msg =
      'Copy ' +
      result.sourceCount +
      ' shift' +
      (result.sourceCount === 1 ? '' : 's') +
      ' from ' +
      fmtDateShort(result.sourceWeek.start) +
      ' – ' +
      fmtDateShort(result.sourceWeek.end) +
      ' into the next ' +
      n +
      ' week' +
      (n === 1 ? '' : 's') +
      '? ' +
      split.kept.length +
      ' new shift' +
      (split.kept.length === 1 ? '' : 's') +
      ' will be added' +
      (result.skipped ? ' (' + result.skipped + ' skipped as already filled)' : '') +
      (split.blocked.length
        ? '. ' +
          split.blocked.length +
          ' fall after the free ' +
          Config.FREE_ROTA_WEEKS_AHEAD +
          '-week limit and will not be added.'
        : '') +
      '.';
    if (!confirm(msg)) return;
    if (!split.kept.length) {
      if (split.blocked.length) {
        alert('All of those dates are past the free rota limit. Unlock ShiftMate to add them.');
        switchTab('unlock');
      } else {
        alert('Nothing new to add (those dates already have shifts).');
      }
      return;
    }
    state.shifts = state.shifts.concat(split.kept);
    save();
    renderCalendar();
    if (split.blocked.length) {
      alert(
        'Added ' +
          split.kept.length +
          ' shift(s). ' +
          split.blocked.length +
          ' were past the free rota limit.'
      );
    }
  }

  function handleApplyPattern() {
    const start = document.getElementById('pattern-start').value;
    const end = document.getElementById('pattern-end').value;
    if (!start || !end) {
      alert('Choose a start and end date for the pattern.');
      return;
    }
    let cycle;
    try {
      cycle = readPatternCycle();
    } catch (e) {
      alert(e.message || String(e));
      return;
    }
    let result;
    try {
      result = Rota.generatePatternShifts({
        startIso: start,
        endIso: end,
        cycle,
        shiftTypes: state.shiftTypes,
        existingShifts: state.shifts,
        skipExisting: document.getElementById('pattern-skip').checked,
        uid: uid,
      });
    } catch (e) {
      alert(e.message || String(e));
      return;
    }
    const split = filterByHorizon(result.created);
    const msg =
      'Apply this pattern from ' +
      fmtDateShort(start) +
      ' to ' +
      fmtDateShort(end) +
      '? ' +
      split.kept.length +
      ' new shift' +
      (split.kept.length === 1 ? '' : 's') +
      ' will be added' +
      (result.skipped ? ' (' + result.skipped + ' existing dates skipped)' : '') +
      (split.blocked.length
        ? '. ' +
          split.blocked.length +
          ' fall after the free ' +
          Config.FREE_ROTA_WEEKS_AHEAD +
          '-week limit and will not be added.'
        : '') +
      '.';
    if (!confirm(msg)) return;
    if (!split.kept.length) {
      if (split.blocked.length) {
        alert('All of those dates are past the free rota limit. Unlock ShiftMate to add them.');
        switchTab('unlock');
      } else {
        alert('Nothing new to add.');
      }
      return;
    }
    state.shifts = state.shifts.concat(split.kept);
    save();
    selectedDate = start;
    renderCalendar();
    if (split.blocked.length) {
      alert(
        'Added ' +
          split.kept.length +
          ' shift(s). ' +
          split.blocked.length +
          ' were past the free rota limit.'
      );
    }
  }

  // —— Export / import ——
  function setDataStatus(text, isError) {
    const el = document.getElementById('data-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'muted' + (text ? (isError ? ' status-err' : ' status-ok') : '');
  }

  function exportJson() {
    const payload = Rota.buildExportPayload(state, Config);
    const stamp = todayIso();
    downloadText(
      'shiftmate-uk-' + stamp + '.json',
      JSON.stringify(payload, null, 2),
      'application/json'
    );
    setDataStatus('Downloaded JSON backup.');
  }

  function exportCsv() {
    const csv = Rota.shiftsToCsv(
      state.shifts,
      state.shiftTypes,
      state.job,
      Pay.calculateShift
    );
    downloadText('shiftmate-uk-shifts-' + todayIso() + '.csv', csv, 'text/csv');
    setDataStatus('Downloaded CSV of shifts with pay estimates.');
  }

  function importJsonText(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      setDataStatus('That file is not valid JSON.', true);
      alert('That file is not valid JSON.');
      return;
    }
    const checked = Rota.validateImport(data);
    if (!checked.ok) {
      const msg = 'Could not import:\n' + checked.errors.join('\n');
      setDataStatus(checked.errors[0], true);
      alert(msg);
      return;
    }
    const s = checked.summary;
    let confirmMsg =
      'Replace all ShiftMate data in this browser with this backup?\n\n' +
      s.employer +
      ' · ' +
      s.typeCount +
      ' shift types · ' +
      s.shiftCount +
      ' shifts';
    if (s.exportedAt) confirmMsg += '\nExported: ' + s.exportedAt;
    if (checked.warnings.length) {
      confirmMsg += '\n\nWarnings:\n- ' + checked.warnings.join('\n- ');
    }
    if (!confirm(confirmMsg)) return;
    const next = Rota.applyImport(checked.data, uid);
    state.job = next.job;
    state.shiftTypes = next.shiftTypes;
    state.shifts = next.shifts;
    if (!state.job.onboardingComplete && state.job.employerName) {
      state.job.onboardingComplete = true;
    }
    save();
    setDataStatus('Imported ' + s.shiftCount + ' shifts for ' + s.employer + '.');
    if (state.job.onboardingComplete) {
      document.getElementById('header-sub').textContent =
        (state.job.employerName || 'Job') + ' · local-only';
      showApp();
      renderJobForm();
    } else {
      showOnboarding();
    }
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importJsonText(String(reader.result || ''));
    reader.onerror = () => {
      setDataStatus('Could not read that file.', true);
      alert('Could not read that file.');
    };
    reader.readAsText(file);
  }

  // —— Unlock screen ——
  function setUnlockStatus(text, isError) {
    const el = document.getElementById('unlock-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = text ? (isError ? 'status-err' : 'status-ok') : 'muted';
  }

  function renderUnlockScreen() {
    if (!Config.UNLOCK_ENABLED) return;
    document.getElementById('unlock-price').textContent = Config.UNLOCK_PRICE;
    document.getElementById('unlock-price-label').textContent = Config.UNLOCK_PRICE_LABEL;
    const pay = document.getElementById('unlock-pay');
    const link = (Config.STRIPE_PAYMENT_LINK || '').trim();
    const note = document.getElementById('unlock-pay-note');
    if (isUnlocked()) {
      pay.classList.add('is-disabled');
      pay.setAttribute('aria-disabled', 'true');
      pay.setAttribute('href', '#');
      pay.textContent = 'Unlocked';
      setUnlockStatus('ShiftMate is unlocked on this device.');
      note.textContent = 'You already have the full rota and pay breakdown on this browser.';
      return;
    }
    if (link) {
      pay.classList.remove('is-disabled');
      pay.removeAttribute('aria-disabled');
      pay.setAttribute('href', link);
      pay.setAttribute('target', '_blank');
      pay.textContent = 'Pay with Stripe — ' + Config.UNLOCK_PRICE;
      note.textContent =
        'After payment, Stripe sends you back here with ?unlocked= in the address, and the app unlocks automatically. If it does not, paste the unlock code below.';
    } else {
      pay.classList.add('is-disabled');
      pay.setAttribute('aria-disabled', 'true');
      pay.setAttribute('href', '#');
      pay.textContent = 'Pay with Stripe';
      note.textContent =
        'Payment link is not configured yet (STRIPE_PAYMENT_LINK). You can still enter an unlock code if one has been set.';
    }
    if (!Config.UNLOCK_CODE_SHA256) {
      setUnlockStatus('Unlock code is not configured yet (UNLOCK_CODE_SHA256).', true);
    } else if (!document.getElementById('unlock-status').textContent) {
      setUnlockStatus('');
    }
  }

  async function applyUnlockCode(code) {
    const result = await Unlock.verifyUnlockCode(code, Config.UNLOCK_CODE_SHA256);
    if (!result.ok) {
      const msg =
        result.reason === 'not-configured'
          ? 'Unlock code is not configured yet.'
          : result.reason === 'empty'
            ? 'Enter an unlock code.'
            : 'That unlock code was not recognised.';
      setUnlockStatus(msg, true);
      return false;
    }
    Unlock.writeState(Config, {
      unlocked: true,
      unlockedAt: new Date().toISOString(),
    });
    setUnlockStatus('ShiftMate is unlocked on this device.');
    renderUnlockScreen();
    renderUnlockBanners();
    renderDashboard();
    return true;
  }

  async function handleUnlockRedirect() {
    const code = Unlock.extractUnlockCodeFromSearch(location.search);
    if (!code) return;
    const result = await Unlock.consumeRedirect(location.search, Config);
    try {
      history.replaceState({}, '', Unlock.stripUnlockParam(location.href));
    } catch (_) {}
    if (result.ok) {
      if (Config.UNLOCK_ENABLED) {
        setUnlockStatus('ShiftMate is unlocked on this device.');
        alert('ShiftMate is unlocked on this device.');
      }
      renderUnlockBanners();
      if (state.job.onboardingComplete) {
        renderDashboard();
        renderCalendar();
      }
      return;
    }
    if (Config.UNLOCK_ENABLED) {
      const input = document.getElementById('unlock-code');
      if (input) input.value = code;
      switchTab('unlock');
      setUnlockStatus(
        result.reason === 'not-configured'
          ? 'Unlock code is not configured yet.'
          : 'That unlock code was not recognised.',
        true
      );
    }
  }

  // —— Wire events ——
  function wire() {
    document.getElementById('ob-save').addEventListener('click', () => {
      if (saveJobFromForm(true)) showApp();
    });

    document.getElementById('job-save').addEventListener('click', () => {
      if (saveJobFromForm(false)) {
        document.getElementById('header-sub').textContent =
          (state.job.employerName || 'Job') + ' · local-only';
        alert('Job saved.');
      }
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
      if (!confirm('Erase all local ShiftMate data on this device?')) return;
      localStorage.removeItem(STORAGE_KEY);
      state = defaultState();
      state.shiftTypes = seedShiftTypes();
      save();
      showOnboarding();
    });

    document.querySelectorAll('#bottom-nav button').forEach((b) => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });

    document.getElementById('cal-prev').addEventListener('click', () => {
      calMonth -= 1;
      if (calMonth < 0) {
        calMonth = 11;
        calYear -= 1;
      }
      renderCalendar();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      calMonth += 1;
      if (calMonth > 11) {
        calMonth = 0;
        calYear += 1;
      }
      renderCalendar();
    });

    document.getElementById('btn-add-shift').addEventListener('click', () => openShiftModal(null));
    document.getElementById('shift-modal-close').addEventListener('click', closeShiftModal);
    document.getElementById('shift-cancel').addEventListener('click', closeShiftModal);
    document.getElementById('shift-save').addEventListener('click', saveShift);
    document.getElementById('shift-delete').addEventListener('click', deleteShift);
    document.getElementById('shift-type').addEventListener('change', applyTypeDefaultsToForm);
    document.getElementById('shift-date').addEventListener('change', () => {
      if (document.getElementById('shift-type').value) applyTypeDefaultsToForm();
    });
    ['shift-start', 'shift-end', 'shift-worked-start', 'shift-worked-end', 'shift-break', 'shift-leave', 'shift-sleepin', 'shift-bh'].forEach(
      (id) => {
        document.getElementById(id).addEventListener('change', updateShiftPayPreview);
        document.getElementById(id).addEventListener('input', updateShiftPayPreview);
      }
    );

    document.getElementById('btn-add-type').addEventListener('click', () => openTypeModal(null));
    document.getElementById('type-modal-close').addEventListener('click', closeTypeModal);
    document.getElementById('type-cancel').addEventListener('click', closeTypeModal);
    document.getElementById('type-save').addEventListener('click', saveType);
    document.getElementById('type-delete').addEventListener('click', deleteType);

    document.getElementById('shift-modal').addEventListener('click', (e) => {
      if (e.target.id === 'shift-modal') closeShiftModal();
    });
    document.getElementById('type-modal').addEventListener('click', (e) => {
      if (e.target.id === 'type-modal') closeTypeModal();
    });

    document.getElementById('btn-copy-week').addEventListener('click', handleCopyWeek);
    document.getElementById('btn-apply-pattern').addEventListener('click', handleApplyPattern);
    document.getElementById('pattern-preset').addEventListener('change', syncPatternPresetUi);
    document.getElementById('btn-pattern-add-slot').addEventListener('click', () => {
      ensureCustomCycle();
      customCycle.push({ off: true });
      renderCustomCycleRows();
      updatePatternPreview();
    });
    ['pattern-start', 'pattern-end', 'pattern-on-type', 'pattern-skip'].forEach((id) => {
      document.getElementById(id).addEventListener('change', updatePatternPreview);
    });

    document.getElementById('btn-export-json').addEventListener('click', exportJson);
    document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
    document.getElementById('btn-import-json').addEventListener('click', () => {
      document.getElementById('import-json-file').click();
    });
    document.getElementById('import-json-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      handleImportFile(file);
    });

    document.getElementById('unlock-apply').addEventListener('click', () => {
      applyUnlockCode(document.getElementById('unlock-code').value);
    });
    document.getElementById('unlock-pay').addEventListener('click', (e) => {
      const link = (Config.STRIPE_PAYMENT_LINK || '').trim();
      if (!link || isUnlocked()) {
        e.preventDefault();
      }
    });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // Only register when served over http(s)
    if (location.protocol === 'file:') return;
    // Relative URL + scope so this works under a GitHub Pages subpath
    // such as /shiftmate-web/.
    const swUrl = new URL('sw.js', document.baseURI || location.href);
    navigator.serviceWorker
      .register(swUrl.href, { scope: './' })
      .catch((err) => {
        console.warn('SW register failed', err);
      });
  }

  // —— Boot ——
  load();
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  selectedDate = todayIso();
  wire();
  renderUnlockBanners();
  if (state.job.onboardingComplete) showApp();
  else showOnboarding();
  handleUnlockRedirect();
  registerSW();
})();
