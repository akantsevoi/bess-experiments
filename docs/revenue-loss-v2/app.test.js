const assert = require('assert');
const {
  DISCRETIZATION_INTERVAL_MIN,
  readFile,
  parseFileContent,
  parseCSV,
  generateDiscretizationIntervals,
  standardizePriceData,
  standardizePredictedSchedule,
  standardizeActualEvents,
  determineAnalysisTimeRange,
  standardizeInputData
} = require('./app.js');
const fs = require('fs');
const path = require('path');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err.message);
  }
}

(async () => {
  await test('readFile resolves with provided content', async () => {
    class MockReader {
      readAsText(file) {
        setTimeout(() => this.onload({ target: { result: file } }), 0);
      }
    }
    const content = await readFile(new MockReader(), 'hello world');
    assert.strictEqual(content, 'hello world');
  });

  await test('readFile reads content from sample file', async () => {
    class MockReader {
      readAsText(filePath) {
        fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) {
            this.onerror(err);
          } else {
            this.onload({ target: { result: data } });
          }
        });
      }
    }
    const filePath = path.join(__dirname, 'files/price_15min.json');
    const content = await readFile(new MockReader(), filePath);
    const expected = fs.readFileSync(filePath, 'utf8');
    assert.strictEqual(content, expected);
  });

  await test('parseFileContent parses JSON correctly', async () => {
    const jsonContent = '{"test": "value", "number": 42}';
    const result = parseFileContent(jsonContent, 'test.json');
    assert.deepStrictEqual(result, { test: 'value', number: 42 });
  });

  await test('parseCSV parses CSV correctly', async () => {
    const csvContent = 'name,age,score\nAlice,25,95.5\nBob,30,87.2';
    const result = parseCSV(csvContent);
    assert.deepStrictEqual(result, [
      { name: 'Alice', age: 25, score: 95.5 },
      { name: 'Bob', age: 30, score: 87.2 }
    ]);
  });

  await test('generateDiscretizationIntervals creates correct intervals', async () => {
    const start = new Date('2024-01-01T10:00:00Z');
    const end = new Date('2024-01-01T10:15:00Z'); // Changed to 15 minutes for exact division
    const intervals = generateDiscretizationIntervals(start, end);

    // 15 minutes / 5 minutes = 3 intervals
    assert.strictEqual(intervals.length, 3);
    assert.strictEqual(intervals[0].toISOString(), '2024-01-01T10:00:00.000Z');
    assert.strictEqual(intervals[1].toISOString(), '2024-01-01T10:05:00.000Z');
    assert.strictEqual(intervals[2].toISOString(), '2024-01-01T10:10:00.000Z');
  });

  await test('standardizePriceData upsamples to discretization intervals', async () => {
    const priceData = [
      { ts: '2024-01-01T10:00:00Z', price_eur_mwh: 50, interval_min: 15 },
      { ts: '2024-01-01T10:15:00Z', price_eur_mwh: 60, interval_min: 15 },
      { ts: '2024-01-01T10:30:00Z', price_eur_mwh: 100, interval_min: 20 },


    ];
    const start = new Date('2024-01-01T10:00:00Z');
    const end = new Date('2024-01-01T10:50:00Z');

    const result = standardizePriceData(priceData, start, end);

    assert.strictEqual(result.length, 10);
    // First 15 minutes should have price 50
    assert.strictEqual(result[0].price_eur_mwh, 50);
    assert.strictEqual(result[1].price_eur_mwh, 50);
    assert.strictEqual(result[2].price_eur_mwh, 50);
    // Next 15 minutes should have price 60
    assert.strictEqual(result[3].price_eur_mwh, 60);
    assert.strictEqual(result[4].price_eur_mwh, 60);
    assert.strictEqual(result[5].price_eur_mwh, 60);
    // next 20 minutes should be split into 4 intervals of 5 minutes each
    assert.strictEqual(result[6].price_eur_mwh, 100);
    assert.strictEqual(result[7].price_eur_mwh, 100);
    assert.strictEqual(result[8].price_eur_mwh, 100);
    assert.strictEqual(result[9].price_eur_mwh, 100);
  });

  await test('standardizePredictedSchedule explodes schedule blocks', async () => {
    const scheduleData = [
      {
        battery_id: 'b-001',
        start_ts: '2024-01-01T10:00:00Z',
        end_ts: '2024-01-01T10:50:00Z',
        mode: 'CHARGE',
        power_kw: -1000
      }
    ];
    const start = new Date('2024-01-01T10:00:00Z');
    const end = new Date('2024-01-01T10:50:00Z');

    const result = standardizePredictedSchedule(scheduleData, start, end);

    assert.strictEqual(result.length, 10);
    result.forEach(interval => {
      assert.strictEqual(interval.battery_id, 'b-001');
      assert.strictEqual(interval.mode, 'CHARGE');
      assert.strictEqual(interval.power_kw, -1000);
      assert.strictEqual(interval.interval_min, 5);
    });
  });

  await test('standardizeActualEvents averages power in intervals', async () => {
    const eventsData = [
      {
        battery_id: 'b-001',
        ts: '2024-01-01T10:01:00Z',
        mode: 'CHARGE',
        power_kw: -900,
        soc_pct: 45
      },
      {
        battery_id: 'b-001',
        ts: '2024-01-01T10:03:00Z',
        mode: 'CHARGE',
        power_kw: -1100,
        soc_pct: 46
      }
    ];
    const start = new Date('2024-01-01T10:00:00Z');
    const end = new Date('2024-01-01T10:10:00Z');

    const result = standardizeActualEvents(eventsData, start, end);

    assert.strictEqual(result.length, 2);
    // First interval should have averaged power
    assert.strictEqual(result[0].power_kw, -1000); // (-900 + -1100) / 2
    assert.strictEqual(result[0].mode, 'CHARGE');
    assert.strictEqual(result[0].soc_pct, 46); // Latest SOC
    // Second interval should be DOWNTIME (no events)
    assert.strictEqual(result[1].mode, 'DOWNTIME');
    assert.strictEqual(result[1].power_kw, 0);
  });

  await test('determineAnalysisTimeRange finds correct time bounds', async () => {
    const rawData = {
      priceData: [
        { ts: '2024-01-01T10:00:00Z', price_eur_mwh: 50, interval_min: 15 },
        { ts: '2024-01-01T11:00:00Z', price_eur_mwh: 60, interval_min: 15 }
      ],
      predictedSchedule: [{
        battery_id: 'b-001',
        start_ts: '2024-01-01T09:30:00Z',
        end_ts: '2024-01-01T10:30:00Z',
        mode: 'CHARGE',
        power_kw: -500
      }],
      actualEvents: [{
        battery_id: 'b-001',
        ts: '2024-01-01T09:45:00Z',
        mode: 'CHARGE',
        power_kw: -450,
        soc_pct: 50
      }]
    };

    const { startDate, endDate } = determineAnalysisTimeRange(rawData);

    // Should start at 09:30 (earliest timestamp, rounded down to 5-min boundary)
    assert.strictEqual(startDate.toISOString(), '2024-01-01T09:30:00.000Z');
    // Should end at 11:15 (latest price interval end: 11:00 + 15min, rounded up to 5-min boundary)
    assert.strictEqual(endDate.toISOString(), '2024-01-01T11:15:00.000Z');
  });

  await test('standardizeInputData validates and processes all data', async () => {
    const rawData = {
      batteryMeta: [{ battery_id: 'b-001', capacity_kwh: 1000, power_kw: 500 }],
      priceData: [{ ts: '2024-01-01T10:00:00Z', price_eur_mwh: 50, interval_min: 15 }],
      predictedSchedule: [{
        battery_id: 'b-001',
        start_ts: '2024-01-01T10:00:00Z',
        end_ts: '2024-01-01T10:05:00Z',
        mode: 'CHARGE',
        power_kw: -500
      }],
      actualEvents: [{
        battery_id: 'b-001',
        ts: '2024-01-01T10:01:00Z',
        mode: 'CHARGE',
        power_kw: -450,
        soc_pct: 50
      }]
    };
    const start = new Date('2024-01-01T10:00:00Z');
    const end = new Date('2024-01-01T10:05:00Z');

    const result = standardizeInputData(rawData, start, end);

    assert.ok(result.batteryMeta);
    assert.ok(result.priceData);
    assert.ok(result.predictedSchedule);
    assert.ok(result.actualEvents);
    assert.strictEqual(result.analysisStartDate, start);
    assert.strictEqual(result.analysisEndDate, end);
  });
})();
