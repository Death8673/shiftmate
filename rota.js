/**
 * ShiftMate UK — rota helpers: week copy, repeating patterns, export/import.
 * Works in the browser and in Node (for tests). Depends on ShiftMatePay.
 */
(function (global) {
  'use strict';

  const Pay = () => global.ShiftMatePay;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const PAY_PERIODS = ['WEEKLY', 'FORTNIGHTLY', 'FOUR_WEEKLY', 'MONTHLY'];
  const PRESETS = {
    '4-on-4-off': { on: 4, off: 4 },
    '4-on-3-off': { on: 4, off: 3 },
    '5-on-2-off': { on: 5, off: 2 },
  };

  function weekStartOffset(dayName) {
    switch (String(dayName || '').toUpperCase()) {
      case 'SUNDAY':
        return 0;
      case 'SATURDAY':
        return 6;
      case 'MONDAY':
      default:
        return 1;
    }
  }

  function addDaysIso(dateIso, n) {
    const d = Pay().parseLocalDateTime(Pay().toDateIso(dateIso) + 'T00:00');
    return Pay().toDateIso(Pay().addDays(d, n));
  }

  function startOfWeek(dateIso, weekStartDay) {
    const iso = Pay().toDateIso(dateIso);
    const d = Pay().parseLocalDateTime(iso + 'T00:00');
    const offset = weekStartOffset(weekStartDay);
    const delta = (d.getDay() - offset + 7) % 7;
    return Pay().toDateIso(Pay().addDays(d, -delta));
  }

  function endOfWeek(dateIso, weekStartDay) {
    return addDaysIso(startOfWeek(dateIso, weekStartDay), 6);
  }

  function addDaysToDateTime(iso, days) {
    if (!iso) return null;
    const d = Pay().parseLocalDateTime(iso);
    d.setDate(d.getDate() + days);
    return Pay().formatLocalDateTime(d);
  }

  function combineDateTime(dateIso, timeHHMM) {
    return Pay().toDateIso(dateIso) + 'T' + timeHHMM;
  }

  function scheduledEndFromType(dateIso, type) {
    const [sh, sm] = String(type.defaultStart).split(':').map(Number);
    const [eh, em] = String(type.defaultEnd).split(':').map(Number);
    let endDate = Pay().toDateIso(dateIso);
    if (eh * 60 + em <= sh * 60 + sm) {
      endDate = addDaysIso(endDate, 1);
    }
    return combineDateTime(endDate, type.defaultEnd);
  }

  function shiftFromType(dateIso, type, uidFn) {
    const date = Pay().toDateIso(dateIso);
    return {
      id: uidFn(),
      shiftTypeId: type.id,
      title: type.name,
      calendarDate: date,
      scheduledStart: combineDateTime(date, type.defaultStart),
      scheduledEnd: scheduledEndFromType(date, type),
      workedStart: null,
      workedEnd: null,
      unpaidBreakMinutes: type.unpaidBreakMinutes || 0,
      leaveType: 'NONE',
      isSleepIn: !!type.sleepInEnabled,
      bankHolidayOverride: null,
      notes: null,
    };
  }

  function cloneShiftByDays(shift, days, uidFn) {
    return {
      id: uidFn(),
      shiftTypeId: shift.shiftTypeId || null,
      title: shift.title,
      calendarDate: addDaysIso(shift.calendarDate, days),
      scheduledStart: addDaysToDateTime(shift.scheduledStart, days),
      scheduledEnd: addDaysToDateTime(shift.scheduledEnd, days),
      workedStart: shift.workedStart ? addDaysToDateTime(shift.workedStart, days) : null,
      workedEnd: shift.workedEnd ? addDaysToDateTime(shift.workedEnd, days) : null,
      unpaidBreakMinutes: shift.unpaidBreakMinutes || 0,
      leaveType: shift.leaveType || 'NONE',
      isSleepIn: !!shift.isSleepIn,
      bankHolidayOverride:
        shift.bankHolidayOverride === null || shift.bankHolidayOverride === undefined
          ? null
          : !!shift.bankHolidayOverride,
      notes: shift.notes || null,
    };
  }

  /**
   * Copy every shift in the week containing fromDateIso into the next `weeks` weeks.
   * skipExisting skips a copy when the target calendar date already has a shift
   * in the original set (multiple shifts on one source day still all copy onto
   * an empty target day).
   */
  function copyWeekForward(opts) {
    const weeks = Math.max(0, Math.floor(Number(opts.weeks) || 0));
    const fromDateIso = Pay().toDateIso(opts.fromDateIso);
    const weekStartDay = opts.weekStartDay || 'MONDAY';
    const start = startOfWeek(fromDateIso, weekStartDay);
    const end = endOfWeek(fromDateIso, weekStartDay);
    const shifts = Array.isArray(opts.shifts) ? opts.shifts : [];
    const source = shifts.filter(
      (s) => s.calendarDate >= start && s.calendarDate <= end
    );
    const existingDates = new Set(shifts.map((s) => s.calendarDate));
    const skipExisting = opts.skipExisting !== false;
    const uidFn = opts.uid;
    if (typeof uidFn !== 'function') throw new Error('uid function is required');

    const copied = [];
    let skipped = 0;
    for (let w = 1; w <= weeks; w++) {
      const days = w * 7;
      for (const s of source) {
        const newDate = addDaysIso(s.calendarDate, days);
        if (skipExisting && existingDates.has(newDate)) {
          skipped += 1;
          continue;
        }
        copied.push(cloneShiftByDays(s, days, uidFn));
      }
    }
    return {
      copied,
      skipped,
      sourceCount: source.length,
      sourceWeek: { start, end },
    };
  }

  function cycleFromPreset(name, typeId) {
    const key = String(name || '');
    const spec = PRESETS[key];
    if (!spec) throw new Error('Unknown pattern preset: ' + name);
    if (!typeId) throw new Error('A shift type is required for ' + key);
    const on = { shiftTypeId: typeId };
    const off = { off: true };
    const cycle = [];
    for (let i = 0; i < spec.on; i++) cycle.push(on);
    for (let i = 0; i < spec.off; i++) cycle.push(off);
    return cycle;
  }

  function normalizeCycle(cycle) {
    if (!Array.isArray(cycle) || cycle.length === 0) {
      throw new Error('Pattern cycle must have at least one day');
    }
    return cycle.map((step) => {
      if (step == null || step === 'OFF' || step === 'off' || step.off) {
        return { off: true, shiftTypeId: null };
      }
      const id = step.shiftTypeId || step.typeId || null;
      if (!id) return { off: true, shiftTypeId: null };
      return { off: false, shiftTypeId: id };
    });
  }

  /**
   * Apply a repeating cycle of shift types (or OFF) over an inclusive date range.
   */
  function generatePatternShifts(opts) {
    const startIso = Pay().toDateIso(opts.startIso);
    const endIso = Pay().toDateIso(opts.endIso);
    if (endIso < startIso) throw new Error('Pattern end date must be on/after the start date');
    const cycle = normalizeCycle(opts.cycle);
    const types = Array.isArray(opts.shiftTypes) ? opts.shiftTypes : [];
    const typesById = new Map(types.map((t) => [t.id, t]));
    const existing = Array.isArray(opts.existingShifts) ? opts.existingShifts : [];
    const existingDates = new Set(existing.map((s) => s.calendarDate));
    const skipExisting = opts.skipExisting !== false;
    const uidFn = opts.uid;
    if (typeof uidFn !== 'function') throw new Error('uid function is required');

    const created = [];
    let skipped = 0;
    let offDays = 0;
    let missingType = 0;
    let days = 0;
    let i = 0;
    for (let date = startIso; date <= endIso; date = addDaysIso(date, 1), i++) {
      days += 1;
      const step = cycle[i % cycle.length];
      if (step.off || !step.shiftTypeId) {
        offDays += 1;
        continue;
      }
      if (skipExisting && existingDates.has(date)) {
        skipped += 1;
        continue;
      }
      const type = typesById.get(step.shiftTypeId);
      if (!type) {
        missingType += 1;
        continue;
      }
      created.push(shiftFromType(date, type, uidFn));
    }
    return { created, skipped, offDays, missingType, days };
  }

  function csvEscape(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function fmtCsvTime(iso) {
    if (!iso) return '';
    return String(iso).replace('T', ' ').slice(0, 16);
  }

  /**
   * CSV of shifts with pay estimates. `calculateShift(shift, type, job)` is injected
   * so this stays independent of the UI.
   */
  function shiftsToCsv(shifts, shiftTypes, job, calculateShift) {
    const typesById = new Map((shiftTypes || []).map((t) => [t.id, t]));
    const rows = (shifts || [])
      .slice()
      .sort((a, b) => {
        const d = String(a.calendarDate).localeCompare(String(b.calendarDate));
        if (d) return d;
        return String(a.scheduledStart).localeCompare(String(b.scheduledStart));
      });
    const header = [
      'Date',
      'Title',
      'Type',
      'Scheduled start',
      'Scheduled end',
      'Worked start',
      'Worked end',
      'Break minutes',
      'Leave',
      'Sleep-in',
      'Paid hours',
      'Overtime hours',
      'Night hours',
      'Est. gross GBP',
      'Notes',
    ];
    const lines = [header.map(csvEscape).join(',')];
    for (const s of rows) {
      const type = typesById.get(s.shiftTypeId) || null;
      let paid = '';
      let ot = '';
      let night = '';
      let gross = '';
      try {
        const r = calculateShift(s, type, job);
        paid = r.isLeave ? '0' : String(r.paidHours);
        ot = r.isLeave ? '0' : String(r.overtimeHours);
        night = r.isLeave ? '0' : String(r.nightHours);
        gross = r.isLeave ? '0.00' : (Math.round(r.grossTotal * 100) / 100).toFixed(2);
      } catch (_) {
        paid = '';
        ot = '';
        night = '';
        gross = '';
      }
      lines.push(
        [
          s.calendarDate || '',
          s.title || '',
          type ? type.name : '',
          fmtCsvTime(s.scheduledStart),
          fmtCsvTime(s.scheduledEnd),
          fmtCsvTime(s.workedStart),
          fmtCsvTime(s.workedEnd),
          s.unpaidBreakMinutes == null ? '' : s.unpaidBreakMinutes,
          s.leaveType && s.leaveType !== 'NONE' ? s.leaveType : '',
          s.isSleepIn || (type && type.sleepInEnabled) ? 'yes' : '',
          paid,
          ot,
          night,
          gross,
          s.notes || '',
        ]
          .map(csvEscape)
          .join(',')
      );
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function buildExportPayload(state, config) {
    const cfg = config || global.ShiftMateConfig || {};
    return {
      app: cfg.EXPORT_APP || 'shiftmate-uk-web',
      version: cfg.EXPORT_VERSION || 1,
      exportedAt: new Date().toISOString(),
      job: state.job,
      shiftTypes: state.shiftTypes,
      shifts: state.shifts,
    };
  }

  function isPlainObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
  }

  /**
   * Validate an imported JSON backup. Does not mutate. Callers must confirm
   * before overwriting local data.
   */
  function validateImport(data) {
    const errors = [];
    const warnings = [];
    if (!isPlainObject(data)) {
      return { ok: false, errors: ['File is not a JSON object'], warnings, summary: null };
    }
    if (data.app && data.app !== 'shiftmate-uk-web' && data.app !== 'shiftmate-uk') {
      warnings.push('This file was labelled as "' + data.app + '", not ShiftMate UK web.');
    }
    if (!isPlainObject(data.job)) errors.push('Missing job profile.');
    if (!Array.isArray(data.shiftTypes)) errors.push('Missing shiftTypes array.');
    if (!Array.isArray(data.shifts)) errors.push('Missing shifts array.');
    if (errors.length) return { ok: false, errors, warnings, summary: null };

    const job = data.job;
    if (job.basicHourlyRate == null || isNaN(Number(job.basicHourlyRate)) || Number(job.basicHourlyRate) < 0) {
      errors.push('Job basic hourly rate is missing or invalid.');
    }
    if (job.referencePayday && !DATE_RE.test(String(job.referencePayday).slice(0, 10))) {
      errors.push('Job reference payday is not a valid date.');
    }
    if (job.payPeriodType && PAY_PERIODS.indexOf(String(job.payPeriodType).toUpperCase()) < 0) {
      warnings.push('Unrecognised pay period type: ' + job.payPeriodType);
    }

    const typeIds = new Set();
    data.shiftTypes.forEach((t, i) => {
      if (!isPlainObject(t)) {
        errors.push('Shift type #' + (i + 1) + ' is not an object.');
        return;
      }
      if (!t.id) errors.push('Shift type #' + (i + 1) + ' is missing an id.');
      if (!t.name) errors.push('Shift type #' + (i + 1) + ' is missing a name.');
      if (t.id) {
        if (typeIds.has(t.id)) warnings.push('Duplicate shift type id: ' + t.id);
        typeIds.add(t.id);
      }
    });

    const shiftIds = new Set();
    data.shifts.forEach((s, i) => {
      if (!isPlainObject(s)) {
        errors.push('Shift #' + (i + 1) + ' is not an object.');
        return;
      }
      if (!s.id) warnings.push('Shift #' + (i + 1) + ' is missing an id (one will be generated on import).');
      if (s.id) {
        if (shiftIds.has(s.id)) warnings.push('Duplicate shift id: ' + s.id);
        shiftIds.add(s.id);
      }
      if (!s.calendarDate || !DATE_RE.test(String(s.calendarDate).slice(0, 10))) {
        errors.push('Shift #' + (i + 1) + ' has a missing or invalid date.');
      }
      if (!s.scheduledStart || !s.scheduledEnd) {
        errors.push('Shift #' + (i + 1) + ' is missing scheduled start or end.');
      }
      if (s.shiftTypeId && !typeIds.has(s.shiftTypeId)) {
        warnings.push(
          'Shift "' + (s.title || s.id || '#' + (i + 1)) + '" refers to an unknown shift type.'
        );
      }
    });

    if (errors.length) return { ok: false, errors, warnings, summary: null };

    const employer = (job.employerName && String(job.employerName).trim()) || 'Untitled job';
    const summary = {
      employer,
      typeCount: data.shiftTypes.length,
      shiftCount: data.shifts.length,
      exportedAt: data.exportedAt || null,
      version: data.version || null,
    };
    return { ok: true, errors, warnings, summary, data };
  }

  function applyImport(data, uidFn) {
    const checked = validateImport(data);
    if (!checked.ok) throw new Error(checked.errors.join(' '));
    const shifts = checked.data.shifts.map((s) =>
      Object.assign({}, s, { id: s.id || uidFn() })
    );
    return {
      job: Object.assign({}, checked.data.job),
      shiftTypes: checked.data.shiftTypes.map((t) => Object.assign({}, t)),
      shifts,
    };
  }

  const api = {
    PRESETS,
    weekStartOffset,
    addDaysIso,
    startOfWeek,
    endOfWeek,
    addDaysToDateTime,
    scheduledEndFromType,
    shiftFromType,
    cloneShiftByDays,
    copyWeekForward,
    cycleFromPreset,
    normalizeCycle,
    generatePatternShifts,
    shiftsToCsv,
    buildExportPayload,
    validateImport,
    applyImport,
  };

  global.ShiftMateRota = api;
})(typeof window !== 'undefined' ? window : globalThis);
