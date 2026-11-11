#!/usr/bin/env node
/**
 * ShiftMate UK — small Node checks for pay.js and the pattern / week-copy helpers.
 * Run: node test.js
 */
'use strict';

require('./config.js');
require('./pay.js');
require('./rota.js');
require('./unlock.js');

const Pay = globalThis.ShiftMatePay;
const Rota = globalThis.ShiftMateRota;
const Unlock = globalThis.ShiftMateUnlock;
const Config = globalThis.ShiftMateConfig;

let passed = 0;
let failed = 0;

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || 'values differ') + ' (expected ' + JSON.stringify(expected) +
        ', got ' + JSON.stringify(actual) + ')'
    );
  }
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('ok  - ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('      ' + (err && err.stack ? err.stack : err));
  }
}

function uidFactory() {
  let n = 0;
  return function uid() {
    n += 1;
    return 'id-' + n;
  };
}

const dayType = {
  id: 'type-day',
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
};

const lateType = Object.assign({}, dayType, {
  id: 'type-late',
  name: 'Late',
  defaultStart: '14:00',
  defaultEnd: '22:00',
});

const job = { basicHourlyRate: 12.21, payPeriodType: 'MONTHLY' };

(async function main() {
  await test('desk check: Day 07:00–15:00 @ £12.21 with 30m break = £91.58 gross', () => {
    const result = Pay.calculate(
      { start: '2026-11-11T07:00', end: '2026-11-11T15:00', unpaidBreakMinutes: 30 },
      Pay.rulesFromType(dayType),
      job
    );
    assertEq(result.paidHours, 7.5, 'paid hours');
    assertEq(result.grossTotal, 91.58, 'gross total');
  });

  await test('calculateShift uses the same desk-check figures', () => {
    const shift = {
      title: 'Day',
      calendarDate: '2026-11-11',
      scheduledStart: '2026-11-11T07:00',
      scheduledEnd: '2026-11-11T15:00',
      unpaidBreakMinutes: 30,
      leaveType: 'NONE',
      isSleepIn: false,
      bankHolidayOverride: null,
    };
    const result = Pay.calculateShift(shift, dayType, job);
    assertEq(result.grossTotal, 91.58, 'gross total');
  });

  await test('leave shifts pay nothing', () => {
    const shift = {
      title: 'Day',
      calendarDate: '2026-11-11',
      scheduledStart: '2026-11-11T07:00',
      scheduledEnd: '2026-11-11T15:00',
      unpaidBreakMinutes: 30,
      leaveType: 'ANNUAL_LEAVE',
    };
    const result = Pay.calculateShift(shift, dayType, job);
    assert(result.isLeave, 'expected leave');
    assertEq(result.grossTotal, 0, 'leave gross');
  });

  await test('week start/end for Monday weeks', () => {
    // 11 Nov 2026 is a Wednesday
    assertEq(Rota.startOfWeek('2026-11-11', 'MONDAY'), '2026-11-09');
    assertEq(Rota.endOfWeek('2026-11-11', 'MONDAY'), '2026-11-15');
  });

  await test('copy week forward by 2 weeks, skipping a filled target date', () => {
    const uid = uidFactory();
    const mon = Rota.shiftFromType('2026-11-09', dayType, uid);
    const tue = Rota.shiftFromType('2026-11-10', lateType, uid);
    const already = Rota.shiftFromType('2026-11-16', dayType, uid); // next Monday
    const result = Rota.copyWeekForward({
      shifts: [mon, tue, already],
      fromDateIso: '2026-11-11',
      weekStartDay: 'MONDAY',
      weeks: 2,
      skipExisting: true,
      uid: uid,
    });
    assertEq(result.sourceCount, 2, 'source count');
    // Week+1: Mon 16 already filled (skip Day), Tue 17 copied Late
    // Week+2: Mon 23 Day, Tue 24 Late
    assertEq(result.copied.length, 3, 'copied length');
    assertEq(result.skipped, 1, 'skipped');
    const dates = result.copied.map((s) => s.calendarDate + '|' + s.title).sort();
    assertEq(dates.join(','), '2026-11-17|Late,2026-11-23|Day,2026-11-24|Late');
    const lateCopy = result.copied.find((s) => s.calendarDate === '2026-11-17');
    assertEq(lateCopy.scheduledStart, '2026-11-17T14:00');
    assertEq(lateCopy.scheduledEnd, '2026-11-17T22:00');
  });

  await test('overnight night shift rolls the end date when copied', () => {
    const nightType = Object.assign({}, dayType, {
      id: 'type-night',
      name: 'Night',
      defaultStart: '20:00',
      defaultEnd: '08:00',
      unpaidBreakMinutes: 60,
    });
    const uid = uidFactory();
    const src = Rota.shiftFromType('2026-11-09', nightType, uid);
    assertEq(src.scheduledEnd, '2026-11-10T08:00', 'overnight end on source');
    const result = Rota.copyWeekForward({
      shifts: [src],
      fromDateIso: '2026-11-09',
      weekStartDay: 'MONDAY',
      weeks: 1,
      skipExisting: true,
      uid: uid,
    });
    assertEq(result.copied.length, 1);
    assertEq(result.copied[0].calendarDate, '2026-11-16');
    assertEq(result.copied[0].scheduledStart, '2026-11-16T20:00');
    assertEq(result.copied[0].scheduledEnd, '2026-11-17T08:00');
  });

  await test('4-on-4-off over 16 days creates 8 Day shifts on the on days', () => {
    const uid = uidFactory();
    const cycle = Rota.cycleFromPreset('4-on-4-off', 'type-day');
    assertEq(cycle.length, 8);
    const result = Rota.generatePatternShifts({
      startIso: '2026-11-02',
      endIso: '2026-11-17',
      cycle,
      shiftTypes: [dayType],
      existingShifts: [],
      skipExisting: true,
      uid: uid,
    });
    assertEq(result.days, 16);
    assertEq(result.created.length, 8);
    assertEq(result.offDays, 8);
    const dates = result.created.map((s) => s.calendarDate);
    assertEq(
      dates.join(','),
      '2026-11-02,2026-11-03,2026-11-04,2026-11-05,2026-11-10,2026-11-11,2026-11-12,2026-11-13'
    );
    assertEq(result.created[0].scheduledStart, '2026-11-02T07:00');
    assertEq(result.created[0].scheduledEnd, '2026-11-02T15:00');
    assertEq(result.created[0].unpaidBreakMinutes, 30);
  });

  await test('pattern skips dates that already have a shift', () => {
    const uid = uidFactory();
    const existing = [Rota.shiftFromType('2026-11-03', dayType, uid)];
    const result = Rota.generatePatternShifts({
      startIso: '2026-11-02',
      endIso: '2026-11-05',
      cycle: Rota.cycleFromPreset('4-on-4-off', 'type-day'),
      shiftTypes: [dayType],
      existingShifts: existing,
      skipExisting: true,
      uid: uid,
    });
    assertEq(result.created.length, 3);
    assertEq(result.skipped, 1);
    assert(!result.created.some((s) => s.calendarDate === '2026-11-03'));
  });

  await test('custom cycle can mix types and off days', () => {
    const uid = uidFactory();
    const result = Rota.generatePatternShifts({
      startIso: '2026-11-02',
      endIso: '2026-11-07',
      cycle: [
        { shiftTypeId: 'type-day' },
        { off: true },
        { shiftTypeId: 'type-late' },
      ],
      shiftTypes: [dayType, lateType],
      existingShifts: [],
      uid: uid,
    });
    // 2 Nov Day, 3 Off, 4 Late, 5 Day, 6 Off, 7 Late
    assertEq(result.created.length, 4);
    assertEq(result.offDays, 2);
    assertEq(result.created[0].title, 'Day');
    assertEq(result.created[1].title, 'Late');
    assertEq(result.created[1].calendarDate, '2026-11-04');
  });

  await test('export payload + import validation + confirm-required overwrite shape', () => {
    const payload = Rota.buildExportPayload(
      {
        job: {
          employerName: 'Sunrise Care',
          basicHourlyRate: 12.21,
          payPeriodType: 'MONTHLY',
          referencePayday: '2026-11-28',
          weekStartDay: 'MONDAY',
        },
        shiftTypes: [dayType],
        shifts: [Rota.shiftFromType('2026-11-11', dayType, uidFactory())],
      },
      Config
    );
    assertEq(payload.app, 'shiftmate-uk-web');
    const ok = Rota.validateImport(payload);
    assert(ok.ok, 'expected valid import');
    assertEq(ok.summary.employer, 'Sunrise Care');
    assertEq(ok.summary.shiftCount, 1);

    const bad = Rota.validateImport({ app: 'nope', job: {}, shiftTypes: [], shifts: 'nope' });
    assert(!bad.ok, 'should reject bad shifts array');

    const missingRate = Rota.validateImport({
      job: { employerName: 'X', referencePayday: '2026-11-28' },
      shiftTypes: [],
      shifts: [],
    });
    assert(!missingRate.ok, 'should reject missing rate');
  });

  await test('CSV export includes the desk-check gross', () => {
    const shift = Rota.shiftFromType('2026-11-11', dayType, uidFactory());
    const csv = Rota.shiftsToCsv([shift], [dayType], job, Pay.calculateShift);
    assert(csv.charCodeAt(0) === 0xfeff, 'BOM for Excel');
    assert(csv.indexOf('Est. gross GBP') >= 0, 'header');
    assert(csv.indexOf('91.58') >= 0, 'desk-check gross in CSV');
    assert(csv.indexOf('2026-11-11') >= 0, 'date');
  });

  await test('UNLOCK_ENABLED is false so nothing is gated by default', () => {
    assertEq(Config.UNLOCK_ENABLED, false);
    assert(Unlock.isLicensed(Config, { unlocked: false }), 'flag off => licensed');
    const gated = Object.assign({}, Config, { UNLOCK_ENABLED: true });
    assert(!Unlock.isLicensed(gated, { unlocked: false }), 'flag on, no licence');
    assert(Unlock.isLicensed(gated, { unlocked: true }), 'flag on, licensed');
  });

  await test('unlock code query param + sha256 verify', async () => {
    const code = 'sm-uk-test-unlock';
    const hash = await Unlock.sha256Hex(code);
    assertEq(hash.length, 64);
    const good = await Unlock.verifyUnlockCode(code, hash);
    assert(good.ok, 'matching code');
    const bad = await Unlock.verifyUnlockCode('wrong', hash);
    assert(!bad.ok && bad.reason === 'mismatch', 'mismatch');
    const empty = await Unlock.verifyUnlockCode(code, '');
    assert(!empty.ok && empty.reason === 'not-configured', 'empty hash');
    assertEq(Unlock.extractUnlockCodeFromSearch('?foo=1&unlocked=sm-uk-test-unlock'), code);
    assertEq(Unlock.stripUnlockParam('https://example.github.io/shiftmate-web/?unlocked=abc&x=1'), '/shiftmate-web/?x=1');
  });

  await test('free rota horizon is 4 weeks ahead', () => {
    // 11 Nov 2026 + 28 days = 9 Dec 2026
    assertEq(Unlock.horizonIso('2026-11-11', 4, Pay), '2026-12-09');
    assert(!Unlock.isDateBeyondHorizon('2026-12-09', '2026-11-11', 4, Pay));
    assert(Unlock.isDateBeyondHorizon('2026-12-10', '2026-11-11', 4, Pay));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
