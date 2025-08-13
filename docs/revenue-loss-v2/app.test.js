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
  standardizeInputData,
  calculateEnergy,
  calculateRevenue,
  calculatePredictedRevenue,
  calculateActualRevenue,
  calculateRevenueAnalysis,
  calculateDowntimeLoss,
  calculateDeviationLoss,
  calculateUtilization,
  calculateKeyMetrics
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

  await test('calculateEnergy converts power to energy correctly', async () => {
    // Test with default 5-minute interval
    assert.strictEqual(calculateEnergy(1000), 1000 * (5/60)); // 83.33 kWh
    assert.strictEqual(calculateEnergy(-500), -500 * (5/60)); // -41.67 kWh

    // Test with custom interval
    assert.strictEqual(calculateEnergy(1000, 15), 1000 * (15/60)); // 250 kWh
    assert.strictEqual(calculateEnergy(600, 10), 600 * (10/60)); // 100 kWh
  });

  await test('calculateRevenue converts energy and price to revenue', async () => {
    // Test normal calculation: 100 kWh * 50 EUR/MWh = 100 * 0.05 = 5 EUR
    assert.strictEqual(calculateRevenue(100, 50), 5);

    // Test with negative energy (charging): -50 kWh * 30 EUR/MWh = -50 * 0.03 = -1.5 EUR
    assert.strictEqual(calculateRevenue(-50, 30), -1.5);

    // Test with null price
    assert.strictEqual(calculateRevenue(100, null), null);
    assert.strictEqual(calculateRevenue(100, undefined), null);
  });

  await test('calculatePredictedRevenue processes schedule data correctly', async () => {
    const standardizedData = {
      priceData: [
        { ts: '2024-01-01T10:00:00Z', price_eur_mwh: 60, interval_min: 5 },
        { ts: '2024-01-01T10:05:00Z', price_eur_mwh: 80, interval_min: 5 }
      ],
      predictedSchedule: [
        {
          battery_id: 'b-001',
          ts: '2024-01-01T10:00:00Z',
          mode: 'DISCHARGE',
          power_kw: 1000,
          interval_min: 5
        },
        {
          battery_id: 'b-001',
          ts: '2024-01-01T10:05:00Z',
          mode: 'CHARGE',
          power_kw: -800,
          interval_min: 5
        }
      ]
    };

    const result = calculatePredictedRevenue(standardizedData);

    assert.strictEqual(result.length, 2);

    // First interval: 1000 kW * (5/60) h * 60 EUR/MWh = 83.33 kWh * 0.06 EUR/kWh = 5 EUR
    assert.strictEqual(result[0].battery_id, 'b-001');
    assert.strictEqual(result[0].power_kw, 1000);
    assert.strictEqual(result[0].energy_kwh, 1000 * (5/60));
    assert.strictEqual(Math.round(result[0].rev_pred_eur * 100) / 100, 5);

    // Second interval: -800 kW * (5/60) h * 80 EUR/MWh = -66.67 kWh * 0.08 EUR/kWh = -5.33 EUR
    assert.strictEqual(result[1].battery_id, 'b-001');
    assert.strictEqual(result[1].power_kw, -800);
    assert.strictEqual(result[1].energy_kwh, -800 * (5/60));
    assert.strictEqual(Math.round(result[1].rev_pred_eur * 100) / 100, -5.33);
  });

  await test('calculateActualRevenue processes events data correctly', async () => {
    const standardizedData = {
      priceData: [
        { ts: '2024-01-01T10:00:00Z', price_eur_mwh: 60, interval_min: 5 }
      ],
      actualEvents: [
        {
          battery_id: 'b-001',
          ts: '2024-01-01T10:00:00Z',
          mode: 'DISCHARGE',
          power_kw: 950,
          soc_pct: 75,
          interval_min: 5
        }
      ]
    };

    const result = calculateActualRevenue(standardizedData);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].battery_id, 'b-001');
    assert.strictEqual(result[0].power_kw, 950);
    assert.strictEqual(result[0].energy_kwh, 950 * (5/60));
    assert.strictEqual(result[0].rev_act_eur, 950 * (5/60) * 0.06); // 4.75 EUR
    assert.strictEqual(result[0].soc_pct, 75);
  });

  await test('calculateRevenueAnalysis provides complete comparison', async () => {
    const standardizedData = {
      priceData: [
        { ts: '2024-01-01T10:00:00Z', price_eur_mwh: 100, interval_min: 5 }
      ],
      predictedSchedule: [
        {
          battery_id: 'b-001',
          ts: '2024-01-01T10:00:00Z',
          mode: 'DISCHARGE',
          power_kw: 1000,
          interval_min: 5
        }
      ],
      actualEvents: [
        {
          battery_id: 'b-001',
          ts: '2024-01-01T10:00:00Z',
          mode: 'DISCHARGE',
          power_kw: 900,
          soc_pct: 80,
          interval_min: 5
        }
      ]
    };

    const result = calculateRevenueAnalysis(standardizedData);

    assert.ok(result.predictedRevenue);
    assert.ok(result.actualRevenue);
    assert.ok(result.comparisonData);
    assert.ok(result.summary);

    // Check comparison data
    assert.strictEqual(result.comparisonData.length, 1);
    const comparison = result.comparisonData[0];

    assert.strictEqual(comparison.battery_id, 'b-001');
    assert.strictEqual(comparison.pred_power_kw, 1000);
    assert.strictEqual(comparison.act_power_kw, 900);

    // Predicted: 1000 * (5/60) * 0.1 = 8.33 EUR
    // Actual: 900 * (5/60) * 0.1 = 7.5 EUR
    // Loss: 8.33 - 7.5 = 0.83 EUR
    assert.strictEqual(Math.round(comparison.rev_pred_eur * 100) / 100, 8.33);
    assert.strictEqual(comparison.rev_act_eur, 7.5);
    assert.strictEqual(Math.round(comparison.revenue_loss_eur * 100) / 100, 0.83);

    // Check summary
    assert.strictEqual(Math.round(result.summary.totalPredictedRevenue * 100) / 100, 8.33);
    assert.strictEqual(result.summary.totalActualRevenue, 7.5);
    assert.strictEqual(Math.round(result.summary.totalRevenueLoss * 100) / 100, 0.83);
  });

  await test('calculateDowntimeLoss identifies downtime periods correctly', async () => {
    const comparisonData = [
      {
        battery_id: 'b-001',
        ts: '2024-01-01T10:00:00Z',
        act_mode: 'DISCHARGE',
        rev_pred_eur: 10,
        rev_act_eur: 8
      },
      {
        battery_id: 'b-001',
        ts: '2024-01-01T10:05:00Z',
        act_mode: 'DOWNTIME',
        rev_pred_eur: 5,
        rev_act_eur: 0
      },
      {
        battery_id: 'b-001',
        ts: '2024-01-01T10:10:00Z',
        act_mode: 'DOWNTIME',
        rev_pred_eur: 3,
        rev_act_eur: 0
      }
    ];

    const downtimeLoss = calculateDowntimeLoss(comparisonData);
    assert.strictEqual(downtimeLoss, 8); // 5 + 3 from downtime periods
  });

  await test('calculateDeviationLoss calculates non-downtime loss', async () => {
    const totalLoss = 10;
    const downtimeLoss = 6;
    const deviationLoss = calculateDeviationLoss(totalLoss, downtimeLoss);
    assert.strictEqual(deviationLoss, 4);
  });

  await test('calculateUtilization computes battery utilization correctly', async () => {
    const comparisonData = [
      {
        battery_id: 'b-001',
        act_energy_kwh: 50, // 5 minutes at 600 kW
        interval_min: 5
      },
      {
        battery_id: 'b-001',
        act_energy_kwh: -25, // 5 minutes at -300 kW (charging)
        interval_min: 5
      },
      {
        battery_id: 'b-002',
        act_energy_kwh: 100, // 5 minutes at 1200 kW
        interval_min: 5
      }
    ];

    const batteryMeta = [
      { battery_id: 'b-001', power_kw: 1000, capacity_kwh: 2000 },
      { battery_id: 'b-002', power_kw: 1500, capacity_kwh: 3000 }
    ];

    const totalTimeHours = 1; // 1 hour analysis
    const utilization = calculateUtilization(comparisonData, batteryMeta, totalTimeHours);

    // b-001: Total actual energy = |50| + |-25| = 75 kWh
    // Potential throughput = 1000 kW * 1 hour = 1000 kWh
    // Utilization = 75/1000 = 7.5%
    assert.strictEqual(utilization['b-001'].total_actual_energy_dispatched_kwh, 75);
    assert.strictEqual(utilization['b-001'].potential_energy_throughput_kwh, 1000);
    assert.strictEqual(utilization['b-001'].utilization_percent, 7.5);

    // b-002: Total actual energy = |100| = 100 kWh
    // Potential throughput = 1500 kW * 1 hour = 1500 kWh
    // Utilization = 100/1500 = 6.67%
    assert.strictEqual(utilization['b-002'].total_actual_energy_dispatched_kwh, 100);
    assert.strictEqual(utilization['b-002'].potential_energy_throughput_kwh, 1500);
    assert.strictEqual(Math.round(utilization['b-002'].utilization_percent * 100) / 100, 6.67);
  });

  await test('calculateKeyMetrics provides comprehensive analysis', async () => {
    const revenueAnalysis = {
      comparisonData: [
        {
          battery_id: 'b-001',
          ts: '2024-01-01T10:00:00Z',
          act_mode: 'DISCHARGE',
          act_energy_kwh: 50,
          rev_pred_eur: 10,
          rev_act_eur: 8,
          revenue_loss_eur: 2
        },
        {
          battery_id: 'b-001',
          ts: '2024-01-01T10:05:00Z',
          act_mode: 'DOWNTIME',
          act_energy_kwh: 0,
          rev_pred_eur: 5,
          rev_act_eur: 0,
          revenue_loss_eur: 5
        }
      ],
      summary: {
        totalRevenueLoss: 7
      }
    };

    const batteryMeta = [
      { battery_id: 'b-001', power_kw: 1000, capacity_kwh: 2000 }
    ];

    const startDate = new Date('2024-01-01T10:00:00Z');
    const endDate = new Date('2024-01-01T10:10:00Z'); // 10 minutes = 1/6 hour

    const keyMetrics = calculateKeyMetrics(revenueAnalysis, batteryMeta, startDate, endDate);

    // Check revenue loss breakdown
    assert.strictEqual(keyMetrics.revenueLoss.total_loss_eur, 7);
    assert.strictEqual(keyMetrics.revenueLoss.downtime_loss_eur, 5);
    assert.strictEqual(keyMetrics.revenueLoss.deviation_loss_eur, 2);
    assert.strictEqual(Math.round(keyMetrics.revenueLoss.downtime_loss_percent * 10) / 10, 71.4); // 5/7 * 100

    // Check utilization
    assert.ok(keyMetrics.utilization.by_battery['b-001']);
    assert.strictEqual(keyMetrics.utilization.by_battery['b-001'].total_actual_energy_dispatched_kwh, 50);

    // Check analysis metadata
    assert.strictEqual(Math.round(keyMetrics.analysisMetadata.analysis_duration_hours * 100) / 100, 0.17); // 10 minutes
    assert.strictEqual(keyMetrics.analysisMetadata.total_intervals, 2);
    assert.strictEqual(keyMetrics.analysisMetadata.batteries_analyzed, 1);
  });
})();
