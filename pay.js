/**
 * ShiftMate UK — pay engine (ported from Android Kotlin domain/pay)
 * Offline-only; estimate only — not a payslip / HMRC-accurate PAYE.
 */
(function (global) {
  'use strict';

  const DISCLAIMER =
    'Estimate only — not a payslip and not HMRC-accurate PAYE.';

  /** England & Wales bank holidays (sample list matching Android UkBankHolidays) */
  const ENGLAND_WALES_BH = new Set([
    // 2025
    '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26',
    '2025-08-25', '2025-12-25', '2025-12-26',
    // 2026
    '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
    '2026-08-31', '2026-12-25', '2026-12-28',
    // 2027
    '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31',
    '2027-08-30', '2027-12-27', '2027-12-28',
  ]);

  function money(value) {
    return Math.round(value * 100) / 100;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** Parse 'YYYY-MM-DD' or Date → date-only ISO */
  function toDateIso(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    return (
      d.getFullYear() +
      '-' +
      pad2(d.getMonth() + 1) +
      '-' +
      pad2(d.getDate())
    );
  }

  /** Parse local ISO datetime 'YYYY-MM-DDTHH:MM' or with seconds */
  function parseLocalDateTime(iso) {
    const s = String(iso).replace(' ', 'T');
    const m = s.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
    );
    if (!m) throw new Error('Bad datetime: ' + iso);
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] || 0),
      0
    );
  }

  function formatLocalDateTime(d) {
    return (
      d.getFullYear() +
      '-' +
      pad2(d.getMonth() + 1) +
      '-' +
      pad2(d.getDate()) +
      'T' +
      pad2(d.getHours()) +
      ':' +
      pad2(d.getMinutes())
    );
  }

  function dateOnly(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }

  function daysBetween(a, b) {
    const ms = dateOnly(b) - dateOnly(a);
    return Math.floor(ms / 86400000);
  }

  function parseTime(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return { h: h || 0, m: m || 0 };
  }

  function atTime(date, hhmm) {
    const t = typeof hhmm === 'string' ? parseTime(hhmm) : hhmm;
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      t.h,
      t.m,
      0,
      0
    );
  }

  function minutesBetween(a, b) {
    return Math.max(0, Math.round((b - a) / 60000));
  }

  function isBankHoliday(dateIso) {
    return ENGLAND_WALES_BH.has(toDateIso(dateIso));
  }

  function maxDt(a, b) {
    return a > b ? a : b;
  }
  function minDt(a, b) {
    return a < b ? a : b;
  }

  /**
   * One night window starting on `date` (evening → next morning if wrapping).
   * Scanning consecutive days with a single window per day avoids double-count.
   */
  function nightWindowStartingOn(date, nightStart, nightEnd) {
    const ns = parseTime(nightStart);
    const ne = parseTime(nightEnd);
    const startMins = ns.h * 60 + ns.m;
    const endMins = ne.h * 60 + ne.m;
    if (startMins < endMins) {
      return [atTime(date, ns), atTime(date, ne)];
    }
    return [atTime(date, ns), atTime(addDays(date, 1), ne)];
  }

  function nightOverlapMinutes(start, end, nightStart, nightEnd) {
    if (!(end > start)) return 0;
    let total = 0;
    // Day before start catches a wrap that covers early morning of the start day
    let day = addDays(dateOnly(start), -1);
    let lastDay = dateOnly(end);
    if (
      end.getHours() === 0 &&
      end.getMinutes() === 0 &&
      end.getSeconds() === 0 &&
      end > start
    ) {
      lastDay = addDays(lastDay, -1);
    }
    while (day <= lastDay) {
      const [ws, we] = nightWindowStartingOn(day, nightStart, nightEnd);
      const os = maxDt(start, ws);
      const oe = minDt(end, we);
      if (oe > os) total += minutesBetween(os, oe);
      day = addDays(day, 1);
    }
    return Math.max(0, total);
  }

  function isBhForPortion(date, window, bankHolidayDates) {
    if (window.isBankHolidayOverride != null) return !!window.isBankHolidayOverride;
    const iso = toDateIso(date);
    if (bankHolidayDates && bankHolidayDates.has
      ? bankHolidayDates.has(iso)
      : bankHolidayDates && bankHolidayDates.includes
        ? bankHolidayDates.includes(iso)
        : false) {
      return true;
    }
    return isBankHoliday(iso);
  }

  /**
   * Split shift across calendar midnights; allocate unpaid break proportionally.
   */
  function splitByCalendarDay(window, rules, job) {
    const start = window.start instanceof Date ? window.start : parseLocalDateTime(window.start);
    const end = window.end instanceof Date ? window.end : parseLocalDateTime(window.end);
    const segments = [];
    let cursor = start;
    while (dateOnly(cursor) < dateOnly(end)) {
      const midnight = addDays(dateOnly(cursor), 1);
      segments.push([cursor, midnight]);
      cursor = midnight;
    }
    if (cursor < end) {
      segments.push([cursor, end]);
    }

    const bhSet = job.bankHolidayDates
      ? job.bankHolidayDates instanceof Set
        ? job.bankHolidayDates
        : new Set(job.bankHolidayDates)
      : ENGLAND_WALES_BH;

    if (segments.length === 0 && +start === +end) {
      return [
        {
          date: toDateIso(start),
          paidMinutes: 0,
          nightMinutes: 0,
          isBankHoliday: isBhForPortion(start, window, bhSet),
        },
      ];
    }

    const grossMinutes = segments.reduce(
      (s, [a, b]) => s + minutesBetween(a, b),
      0
    );
    const breakMinutes = Math.min(
      Math.max(0, window.unpaidBreakMinutes || 0),
      grossMinutes
    );
    const paidPool = Math.max(0, grossMinutes - breakMinutes);

    const portions = [];
    let allocated = 0;
    segments.forEach(([a, b], index) => {
      const segMinutes = minutesBetween(a, b);
      let paid;
      if (grossMinutes === 0) paid = 0;
      else if (index === segments.length - 1) paid = paidPool - allocated;
      else {
        const share = Math.round((paidPool * segMinutes) / grossMinutes);
        allocated += share;
        paid = share;
      }
      let nightMins = 0;
      if (rules.nightEnhancementEnabled) {
        const nightSeg = nightOverlapMinutes(
          a,
          b,
          rules.nightStart || '20:00',
          rules.nightEnd || '06:00'
        );
        if (segMinutes === 0) nightMins = 0;
        else {
          nightMins = Math.round((nightSeg * paid) / segMinutes);
          nightMins = Math.min(Math.max(0, nightMins), paid);
        }
      }
      portions.push({
        date: toDateIso(a),
        paidMinutes: paid,
        nightMinutes: nightMins,
        isBankHoliday: isBhForPortion(a, window, bhSet),
      });
    });
    return portions;
  }

  /**
   * Calculate pay for one shift window + type rules + job context.
   */
  function calculate(windowIn, rules, job, leavePayZero) {
    if (leavePayZero) {
      return {
        paidMinutes: 0,
        basicMinutes: 0,
        nightMinutes: 0,
        overtimeMinutes: 0,
        dayPortions: [],
        lines: [],
        sleepInAmount: 0,
        grossTotal: 0,
        isLeave: true,
      };
    }

    const start =
      windowIn.start instanceof Date
        ? windowIn.start
        : parseLocalDateTime(windowIn.start);
    const end =
      windowIn.end instanceof Date
        ? windowIn.end
        : parseLocalDateTime(windowIn.end);
    if (end < start) throw new Error('Shift end must be on/after start');

    const window = {
      start,
      end,
      unpaidBreakMinutes: windowIn.unpaidBreakMinutes || 0,
      isBankHolidayOverride: windowIn.isBankHolidayOverride,
      isSleepIn: !!windowIn.isSleepIn,
    };

    const baseRate =
      rules.hourlyRateOverride != null && rules.hourlyRateOverride !== ''
        ? Number(rules.hourlyRateOverride)
        : Number(job.basicHourlyRate);

    const portions = splitByCalendarDay(window, rules, job);
    const totalPaidMinutes = portions.reduce((s, p) => s + p.paidMinutes, 0);
    const totalNightMinutes = portions.reduce((s, p) => s + p.nightMinutes, 0);

    const otThresholdMinutes =
      rules.overtimeThresholdHours != null && rules.overtimeThresholdHours !== ''
        ? Math.round(Number(rules.overtimeThresholdHours) * 60)
        : null;
    const overtimeMinutes =
      otThresholdMinutes != null && totalPaidMinutes > otThresholdMinutes
        ? totalPaidMinutes - otThresholdMinutes
        : 0;
    const basicMinutes = totalPaidMinutes - overtimeMinutes;

    const lines = [];
    let gross = 0;
    let remainingBasic = basicMinutes;

    for (const portion of portions) {
      if (portion.paidMinutes <= 0) continue;
      const take = Math.min(portion.paidMinutes, remainingBasic);
      remainingBasic -= take;
      if (take <= 0) continue;

      const bhMult = portion.isBankHoliday
        ? Number(rules.bankHolidayMultiplier) || 1
        : 1;
      const dayRate = baseRate * bhMult;
      const hours = take / 60;
      const amount = money(hours * dayRate);
      const label =
        portion.isBankHoliday && bhMult !== 1
          ? 'Bank holiday basic (' + portion.date + ')'
          : 'Basic (' + portion.date + ')';
      lines.push({ label, hours, rate: dayRate, amount });
      gross += amount;

      if (
        rules.nightEnhancementEnabled &&
        Number(rules.nightEnhancementPerHour) > 0 &&
        portion.nightMinutes > 0
      ) {
        const nightShare =
          (portion.nightMinutes / portion.paidMinutes) * take;
        const nightHours = nightShare / 60;
        const nightAmount = money(
          nightHours * Number(rules.nightEnhancementPerHour)
        );
        if (nightAmount > 0) {
          lines.push({
            label: 'Night enhancement (' + portion.date + ')',
            hours: nightHours,
            rate: Number(rules.nightEnhancementPerHour),
            amount: nightAmount,
          });
          gross += nightAmount;
        }
      }
    }

    if (overtimeMinutes > 0) {
      const otHours = overtimeMinutes / 60;
      const lastBh = portions.length
        ? portions[portions.length - 1].isBankHoliday
        : false;
      const bhMult = lastBh ? Number(rules.bankHolidayMultiplier) || 1 : 1;
      const otRate =
        baseRate * bhMult * (Number(rules.overtimeMultiplier) || 1.5);
      const otAmount = money(otHours * otRate);
      lines.push({ label: 'Overtime', hours: otHours, rate: otRate, amount: otAmount });
      gross += otAmount;
    }

    let sleepAmount = 0;
    if (rules.sleepInEnabled && Number(rules.sleepInFixedAmount) > 0) {
      sleepAmount = Number(rules.sleepInFixedAmount);
    } else if (window.isSleepIn && Number(rules.sleepInFixedAmount) > 0) {
      sleepAmount = Number(rules.sleepInFixedAmount);
    }
    if (sleepAmount > 0) {
      lines.push({
        label: 'Sleep-in',
        hours: 0,
        rate: 0,
        amount: money(sleepAmount),
      });
      gross += sleepAmount;
    }

    return {
      paidMinutes: totalPaidMinutes,
      basicMinutes,
      nightMinutes: totalNightMinutes,
      overtimeMinutes,
      dayPortions: portions,
      lines,
      sleepInAmount: sleepAmount,
      grossTotal: money(gross),
      isLeave: false,
      paidHours: totalPaidMinutes / 60,
      basicHours: basicMinutes / 60,
      nightHours: totalNightMinutes / 60,
      overtimeHours: overtimeMinutes / 60,
    };
  }

  function periodsPerYear(typeName) {
    switch (String(typeName || '').toUpperCase()) {
      case 'WEEKLY':
        return 52;
      case 'FORTNIGHTLY':
        return 26;
      case 'FOUR_WEEKLY':
        return 13;
      case 'MONTHLY':
        return 12;
      default:
        return 12;
    }
  }

  function estimateTakeHome(periodGross, periodsPerYearVal, inputs) {
    const inp = inputs || {};
    const allowance = Number(inp.taxPersonalAllowance ?? inp.taxCodePersonalAllowance ?? 12570);
    const basicRate = Number(inp.taxBasicRatePercent ?? inp.basicRatePercent ?? 20);
    const niPct = Number(inp.niEmployeePercent ?? 8);
    const niThresh = Number(inp.niPrimaryThresholdAnnual ?? 12570);
    const pensionPct = Number(inp.pensionPercent ?? 5);
    const pensionOnGross = inp.pensionOnGross !== false;
    const ppy = periodsPerYearVal || 12;

    const annualisedGross = periodGross * ppy;
    const taxableAnnual = Math.max(0, annualisedGross - allowance);
    const annualTax = taxableAnnual * (basicRate / 100);
    const niBaseAnnual = Math.max(0, annualisedGross - niThresh);
    const annualNi = niBaseAnnual * (niPct / 100);
    const pensionBase = pensionOnGross
      ? annualisedGross
      : Math.max(0, annualisedGross - allowance);
    const annualPension = pensionBase * (pensionPct / 100);

    const periodTax = money(annualTax / ppy);
    const periodNi = money(annualNi / ppy);
    const periodPension = money(annualPension / ppy);
    const net = money(periodGross - periodTax - periodNi - periodPension);

    return {
      gross: money(periodGross),
      estimatedTax: periodTax,
      estimatedNi: periodNi,
      estimatedPension: periodPension,
      estimatedNet: net,
      disclaimer: DISCLAIMER,
    };
  }

  function findFixedLength(onDate, referencePayday, lengthDays) {
    const on = dateOnly(onDate instanceof Date ? onDate : parseLocalDateTime(onDate + 'T00:00'));
    let payday = dateOnly(
      referencePayday instanceof Date
        ? referencePayday
        : parseLocalDateTime(toDateIso(referencePayday) + 'T00:00')
    );
    if (on > payday) {
      const days = daysBetween(payday, on);
      const steps = Math.floor(days / lengthDays);
      payday = addDays(payday, steps * lengthDays);
      while (on > payday) payday = addDays(payday, lengthDays);
    } else if (on < addDays(payday, -(lengthDays - 1))) {
      while (on < addDays(payday, -(lengthDays - 1))) {
        payday = addDays(payday, -lengthDays);
      }
    }
    const start = addDays(payday, -(lengthDays - 1));
    return {
      start: toDateIso(start),
      end: toDateIso(payday),
      payday: toDateIso(payday),
    };
  }

  function findMonthly(onDate, referencePayday) {
    const on = dateOnly(onDate instanceof Date ? onDate : parseLocalDateTime(onDate + 'T00:00'));
    const ref = dateOnly(
      referencePayday instanceof Date
        ? referencePayday
        : parseLocalDateTime(toDateIso(referencePayday) + 'T00:00')
    );
    const day = Math.min(ref.getDate(), 28);
    let year = on.getFullYear();
    let month = on.getMonth();
    const dim = (y, m) => new Date(y, m + 1, 0).getDate();
    let payday = new Date(year, month, Math.min(day, dim(year, month)));
    if (on > payday) {
      const next = new Date(year, month + 1, 1);
      year = next.getFullYear();
      month = next.getMonth();
      payday = new Date(year, month, Math.min(day, dim(year, month)));
    }
    const prevMonth = new Date(payday.getFullYear(), payday.getMonth() - 1, 1);
    const prevPayday = new Date(
      prevMonth.getFullYear(),
      prevMonth.getMonth(),
      Math.min(day, dim(prevMonth.getFullYear(), prevMonth.getMonth()))
    );
    const start = addDays(prevPayday, 1);
    return {
      start: toDateIso(start),
      end: toDateIso(payday),
      payday: toDateIso(payday),
    };
  }

  function periodContaining(onDate, referencePayday, type) {
    const t = String(type || 'MONTHLY').toUpperCase();
    if (t === 'WEEKLY') return findFixedLength(onDate, referencePayday, 7);
    if (t === 'FORTNIGHTLY') return findFixedLength(onDate, referencePayday, 14);
    if (t === 'FOUR_WEEKLY') return findFixedLength(onDate, referencePayday, 28);
    return findMonthly(onDate, referencePayday);
  }

  function nextPayday(from, referencePayday, type) {
    const fromD =
      from instanceof Date ? from : parseLocalDateTime(toDateIso(from) + 'T00:00');
    const containing = periodContaining(fromD, referencePayday, type);
    const payday = parseLocalDateTime(containing.payday + 'T00:00');
    if (payday >= dateOnly(fromD)) return containing.payday;
    const next = periodContaining(addDays(payday, 1), referencePayday, type);
    return next.payday;
  }

  /**
   * Build effective time window from a shift (worked falls back to scheduled).
   */
  function windowFromShift(shift) {
    const startIso = shift.workedStart || shift.scheduledStart;
    const endIso = shift.workedEnd || shift.scheduledEnd;
    return {
      start: startIso,
      end: endIso,
      unpaidBreakMinutes: shift.unpaidBreakMinutes || 0,
      isBankHolidayOverride:
        shift.bankHolidayOverride === null || shift.bankHolidayOverride === undefined
          ? null
          : !!shift.bankHolidayOverride,
      isSleepIn: !!shift.isSleepIn,
    };
  }

  function rulesFromType(type) {
    if (!type) {
      return {
        name: 'Shift',
        unpaidBreakMinutes: 0,
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
      };
    }
    return {
      name: type.name || 'Shift',
      unpaidBreakMinutes: type.unpaidBreakMinutes || 0,
      hourlyRateOverride: type.hourlyRateOverride,
      nightEnhancementEnabled: !!type.nightEnhancementEnabled,
      nightStart: type.nightStart || '20:00',
      nightEnd: type.nightEnd || '06:00',
      nightEnhancementPerHour: Number(type.nightEnhancementPerHour) || 0,
      sleepInEnabled: !!type.sleepInEnabled,
      sleepInFixedAmount: Number(type.sleepInFixedAmount) || 0,
      bankHolidayMultiplier: Number(type.bankHolidayMultiplier) || 1,
      overtimeThresholdHours:
        type.overtimeThresholdHours == null || type.overtimeThresholdHours === ''
          ? null
          : Number(type.overtimeThresholdHours),
      overtimeMultiplier: Number(type.overtimeMultiplier) || 1.5,
    };
  }

  function calculateShift(shift, type, job) {
    const leave = shift.leaveType && shift.leaveType !== 'NONE';
    const rules = rulesFromType(type);
    // Prefer shift unpaid break; else type default
    const window = windowFromShift(shift);
    if (shift.unpaidBreakMinutes == null && type) {
      window.unpaidBreakMinutes = type.unpaidBreakMinutes || 0;
    }
    if (type && type.sleepInEnabled) window.isSleepIn = true;
    else if (shift.isSleepIn) window.isSleepIn = true;
    return calculate(window, rules, {
      basicHourlyRate: job.basicHourlyRate,
      bankHolidayDates: ENGLAND_WALES_BH,
    }, leave);
  }

  global.ShiftMatePay = {
    DISCLAIMER,
    ENGLAND_WALES_BH,
    money,
    toDateIso,
    parseLocalDateTime,
    formatLocalDateTime,
    isBankHoliday,
    nightOverlapMinutes,
    splitByCalendarDay,
    calculate,
    calculateShift,
    windowFromShift,
    rulesFromType,
    periodsPerYear,
    estimateTakeHome,
    periodContaining,
    nextPayday,
    addDays,
    dateOnly,
    daysBetween,
  };
})(typeof window !== 'undefined' ? window : globalThis);
