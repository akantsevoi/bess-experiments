// Configuration constants
const DISCRETIZATION_INTERVAL_MIN = 5; // Discretization interval in minutes

function readFile(reader, file) {
  return new Promise((resolve, reject) => {
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (err) => reject(err);
    reader.readAsText(file);
  });
}

/**
 * Parse JSON or CSV content into JavaScript objects
 * @param {string} content - File content as string
 * @param {string} filename - Original filename to determine format
 * @returns {Array} Parsed data as array of objects
 */
function parseFileContent(content, filename) {
  const isCSV = filename.toLowerCase().endsWith('.csv');

  if (isCSV) {
    return parseCSV(content);
  } else {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Invalid JSON format in ${filename}: ${error.message}`);
    }
  }
}

/**
 * Simple CSV parser
 * @param {string} csvContent - CSV content as string
 * @returns {Array} Array of objects with headers as keys
 */
function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row = {};

    headers.forEach((header, index) => {
      const value = values[index] || '';
      // Try to parse as number if it looks like one
      if (!isNaN(value) && value !== '') {
        row[header] = parseFloat(value);
      } else {
        row[header] = value;
      }
    });

    data.push(row);
  }

  return data;
}

/**
 * Generate discretization interval timestamps between start and end
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Array<Date>} Array of discretization interval timestamps
 */
function generateDiscretizationIntervals(startDate, endDate) {
  const intervals = [];
  const current = new Date(startDate);

  while (current < endDate) {
    intervals.push(new Date(current));
    current.setMinutes(current.getMinutes() + DISCRETIZATION_INTERVAL_MIN);
  }

  return intervals;
}

/**
 * Standardize price data to discretization intervals
 * @param {Array} priceData - Original price data
 * @param {Date} startDate - Analysis start date
 * @param {Date} endDate - Analysis end date
 * @returns {Array} Standardized price data with discretization intervals
 */
// TODO: now this function doesn't have protection if we have gaps in time intervals or time intervals are smaller than discretization interval
// I don't think leaving null is a good approach, but I haven't decided how it should behave yet
function standardizePriceData(priceData, startDate, endDate) {
  const intervals = generateDiscretizationIntervals(startDate, endDate);
  const standardized = [];

  // Sort price data by timestamp
  const sortedPrices = priceData
    .map(p => ({
      ...p,
      ts: new Date(p.ts),
      interval_min: p.interval_min || 15
    }))
    .sort((a, b) => a.ts - b.ts);

  intervals.forEach(intervalStart => {
    // Find the price that applies to this interval
    const applicablePrice = sortedPrices.find(price => {
      const priceEnd = new Date(price.ts.getTime() + price.interval_min * 60000);
      return intervalStart >= price.ts && intervalStart < priceEnd;
    });

    if (applicablePrice) {
      standardized.push({
        ts: intervalStart.toISOString(),
        price_eur_mwh: applicablePrice.price_eur_mwh,
        interval_min: DISCRETIZATION_INTERVAL_MIN
      });
    } else {
      // If no price data available for this interval, use null or skip
      // For now, we'll add it with null price to maintain interval consistency
      standardized.push({
        ts: intervalStart.toISOString(),
        price_eur_mwh: null,
        interval_min: DISCRETIZATION_INTERVAL_MIN
      });
    }
  });

  return standardized;
}

/**
 * Standardize predicted schedule to discretization intervals
 * @param {Array} scheduleData - Original predicted schedule data
 * @param {Date} startDate - Analysis start date
 * @param {Date} endDate - Analysis end date
 * @returns {Array} Standardized schedule data with discretization intervals
 */
// TODO: no protection if we have gaps in time intervals or time intervals are smaller than discretization interval
function standardizePredictedSchedule(scheduleData, startDate, endDate) {
  const intervals = generateDiscretizationIntervals(startDate, endDate);
  const standardized = [];

  // Process schedule data and convert to intervals
  const scheduleBlocks = scheduleData.map(s => ({
    ...s,
    start_ts: new Date(s.start_ts),
    end_ts: new Date(s.end_ts)
  }));

  intervals.forEach(intervalStart => {
    const intervalEnd = new Date(intervalStart.getTime() + DISCRETIZATION_INTERVAL_MIN * 60000);

    // Find schedule blocks that overlap with this interval
    const overlappingBlocks = scheduleBlocks.filter(block => {
      return block.start_ts < intervalEnd && block.end_ts > intervalStart;
    });

    // Group by battery_id
    const batteriesInInterval = {};

    overlappingBlocks.forEach(block => {
      if (!batteriesInInterval[block.battery_id]) {
        batteriesInInterval[block.battery_id] = [];
      }
      batteriesInInterval[block.battery_id].push(block);
    });

    // Create standardized entries for each battery
    Object.keys(batteriesInInterval).forEach(batteryId => {
      const blocks = batteriesInInterval[batteryId];

      // If multiple blocks overlap, use the one with the largest overlap
      let dominantBlock = blocks[0];
      let maxOverlap = 0;

      blocks.forEach(block => {
        const overlapStart = new Date(Math.max(intervalStart, block.start_ts));
        const overlapEnd = new Date(Math.min(intervalEnd, block.end_ts));
        const overlapDuration = overlapEnd - overlapStart;

        if (overlapDuration > maxOverlap) {
          maxOverlap = overlapDuration;
          dominantBlock = block;
        }
      });

      standardized.push({
        battery_id: batteryId,
        ts: intervalStart.toISOString(),
        mode: dominantBlock.mode,
        power_kw: dominantBlock.power_kw,
        interval_min: DISCRETIZATION_INTERVAL_MIN
      });
    });
  });

  return standardized;
}

/**
 * Standardize actual events to discretization intervals
 * @param {Array} eventsData - Original actual events data
 * @param {Date} startDate - Analysis start date
 * @param {Date} endDate - Analysis end date
 * @returns {Array} Standardized events data with discretization intervals
 */
function standardizeActualEvents(eventsData, startDate, endDate) {
  const intervals = generateDiscretizationIntervals(startDate, endDate);
  const standardized = [];

  // Process events data
  const events = eventsData.map(e => ({
    ...e,
    ts: new Date(e.ts)
  }));

  // Get unique battery IDs
  const batteryIds = [...new Set(events.map(e => e.battery_id))];

  intervals.forEach(intervalStart => {
    const intervalEnd = new Date(intervalStart.getTime() + DISCRETIZATION_INTERVAL_MIN * 60000);

    batteryIds.forEach(batteryId => {
      // Find events for this battery within this interval
      const intervalEvents = events.filter(event =>
        event.battery_id === batteryId &&
        event.ts >= intervalStart &&
        event.ts < intervalEnd
      );

      if (intervalEvents.length === 0) {
        // No events in this interval - consider it DOWNTIME
        standardized.push({
          battery_id: batteryId,
          ts: intervalStart.toISOString(),
          mode: 'DOWNTIME',
          power_kw: 0,
          soc_pct: null,
          interval_min: DISCRETIZATION_INTERVAL_MIN
        });
      } else {
        // Average the power values, use the most recent mode and soc
        const avgPower = intervalEvents.reduce((sum, e) => sum + e.power_kw, 0) / intervalEvents.length;
        const latestEvent = intervalEvents.sort((a, b) => b.ts - a.ts)[0];

        standardized.push({
          battery_id: batteryId,
          ts: intervalStart.toISOString(),
          mode: latestEvent.mode,
          power_kw: avgPower,
          soc_pct: latestEvent.soc_pct,
          interval_min: DISCRETIZATION_INTERVAL_MIN
        });
      }
    });
  });

  return standardized;
}

/**
 * Determine analysis time range from input data
 * @param {Object} rawData - Object containing all raw input data
 * @returns {Object} Object with startDate and endDate
 */
function determineAnalysisTimeRange(rawData) {
  const { priceData, predictedSchedule, actualEvents } = rawData;

  const timestamps = [];

  // Collect timestamps from price data
  if (priceData && Array.isArray(priceData)) {
    priceData.forEach(p => {
      if (p.ts) {
        timestamps.push(new Date(p.ts));
        // Add end time for price intervals
        const intervalMin = p.interval_min || 15;
        timestamps.push(new Date(new Date(p.ts).getTime() + intervalMin * 60000));
      }
    });
  }

  // Collect timestamps from predicted schedule
  if (predictedSchedule && Array.isArray(predictedSchedule)) {
    predictedSchedule.forEach(s => {
      if (s.start_ts) timestamps.push(new Date(s.start_ts));
      if (s.end_ts) timestamps.push(new Date(s.end_ts));
    });
  }

  // Collect timestamps from actual events
  if (actualEvents && Array.isArray(actualEvents)) {
    actualEvents.forEach(e => {
      if (e.ts) timestamps.push(new Date(e.ts));
    });
  }

  if (timestamps.length === 0) {
    throw new Error('No valid timestamps found in input data');
  }

  // Find min and max timestamps
  const startDate = new Date(Math.min(...timestamps));
  const endDate = new Date(Math.max(...timestamps));

  // Round start down to nearest discretization interval boundary
  startDate.setMinutes(Math.floor(startDate.getMinutes() / DISCRETIZATION_INTERVAL_MIN) * DISCRETIZATION_INTERVAL_MIN);
  startDate.setSeconds(0);
  startDate.setMilliseconds(0);

  // Round end up to nearest discretization interval boundary
  endDate.setMinutes(Math.ceil(endDate.getMinutes() / DISCRETIZATION_INTERVAL_MIN) * DISCRETIZATION_INTERVAL_MIN);
  endDate.setSeconds(0);
  endDate.setMilliseconds(0);

  return { startDate, endDate };
}

/**
 * Calculate energy from power and time interval
 * @param {number} powerKw - Power in kilowatts
 * @param {number} intervalMin - Time interval in minutes
 * @returns {number} Energy in kilowatt-hours
 */
function calculateEnergy(powerKw, intervalMin = DISCRETIZATION_INTERVAL_MIN) {
  return powerKw * (intervalMin / 60);
}

/**
 * Calculate revenue from energy and price
 * @param {number} energyKwh - Energy in kilowatt-hours
 * @param {number} priceEurMwh - Price in EUR per megawatt-hour
 * @returns {number} Revenue in EUR
 */
function calculateRevenue(energyKwh, priceEurMwh) {
  if (priceEurMwh === null || priceEurMwh === undefined) {
    return null; // Cannot calculate revenue without price data
  }
  // Convert price from EUR/MWh to EUR/kWh (divide by 1000)
  const priceEurKwh = priceEurMwh / 1000;
  return energyKwh * priceEurKwh;
}

/**
 * Calculate predicted revenue for each interval
 * @param {Array} standardizedData - Standardized input data
 * @returns {Array} Array of predicted revenue calculations
 */
function calculatePredictedRevenue(standardizedData) {
  const { priceData, predictedSchedule } = standardizedData;
  const revenueData = [];

  // Create a price lookup map by timestamp
  const priceMap = new Map();
  priceData.forEach(price => {
    priceMap.set(price.ts, price.price_eur_mwh);
  });

  predictedSchedule.forEach(schedule => {
    const price = priceMap.get(schedule.ts);
    const energy = calculateEnergy(schedule.power_kw, schedule.interval_min);
    const revenue = calculateRevenue(energy, price);

    revenueData.push({
      battery_id: schedule.battery_id,
      ts: schedule.ts,
      mode: schedule.mode,
      power_kw: schedule.power_kw,
      energy_kwh: energy,
      price_eur_mwh: price,
      rev_pred_eur: revenue,
      interval_min: schedule.interval_min
    });
  });

  return revenueData;
}

/**
 * Calculate actual revenue for each interval
 * @param {Array} standardizedData - Standardized input data
 * @returns {Array} Array of actual revenue calculations
 */
function calculateActualRevenue(standardizedData) {
  const { priceData, actualEvents } = standardizedData;
  const revenueData = [];

  // Create a price lookup map by timestamp
  const priceMap = new Map();
  priceData.forEach(price => {
    priceMap.set(price.ts, price.price_eur_mwh);
  });

  actualEvents.forEach(event => {
    const price = priceMap.get(event.ts);
    const energy = calculateEnergy(event.power_kw, event.interval_min);
    const revenue = calculateRevenue(energy, price);

    revenueData.push({
      battery_id: event.battery_id,
      ts: event.ts,
      mode: event.mode,
      power_kw: event.power_kw,
      energy_kwh: energy,
      price_eur_mwh: price,
      rev_act_eur: revenue,
      soc_pct: event.soc_pct,
      interval_min: event.interval_min
    });
  });

  return revenueData;
}

/**
 * Calculate both predicted and actual revenue with comparison
 * @param {Object} standardizedData - Standardized input data
 * @returns {Object} Object containing predicted revenue, actual revenue, and comparison data
 */
function calculateRevenueAnalysis(standardizedData) {
  const predictedRevenue = calculatePredictedRevenue(standardizedData);
  const actualRevenue = calculateActualRevenue(standardizedData);

  // Create comparison data by matching timestamps and battery IDs
  const comparisonData = [];
  const actualMap = new Map();

  // Create lookup map for actual revenue data
  actualRevenue.forEach(actual => {
    const key = `${actual.battery_id}_${actual.ts}`;
    actualMap.set(key, actual);
  });

  // Match predicted with actual data
  predictedRevenue.forEach(predicted => {
    const key = `${predicted.battery_id}_${predicted.ts}`;
    const actual = actualMap.get(key);

    const revenueLoss = (predicted.rev_pred_eur !== null && actual?.rev_act_eur !== null)
      ? predicted.rev_pred_eur - actual.rev_act_eur
      : null;

    comparisonData.push({
      battery_id: predicted.battery_id,
      ts: predicted.ts,
      // Predicted data
      pred_mode: predicted.mode,
      pred_power_kw: predicted.power_kw,
      pred_energy_kwh: predicted.energy_kwh,
      rev_pred_eur: predicted.rev_pred_eur,
      // Actual data
      act_mode: actual?.mode || 'NO_DATA',
      act_power_kw: actual?.power_kw || 0,
      act_energy_kwh: actual?.energy_kwh || 0,
      rev_act_eur: actual?.rev_act_eur || null,
      soc_pct: actual?.soc_pct || null,
      // Analysis
      revenue_loss_eur: revenueLoss,
      price_eur_mwh: predicted.price_eur_mwh,
      interval_min: predicted.interval_min
    });
  });

  return {
    predictedRevenue,
    actualRevenue,
    comparisonData,
    summary: {
      totalPredictedRevenue: predictedRevenue
        .filter(p => p.rev_pred_eur !== null)
        .reduce((sum, p) => sum + p.rev_pred_eur, 0),
      totalActualRevenue: actualRevenue
        .filter(a => a.rev_act_eur !== null)
        .reduce((sum, a) => sum + a.rev_act_eur, 0),
      totalRevenueLoss: comparisonData
        .filter(c => c.revenue_loss_eur !== null)
        .reduce((sum, c) => sum + c.revenue_loss_eur, 0)
    }
  };
}

/**
 * Validate and standardize all input data
 * @param {Object} rawData - Object containing all raw input data
 * @param {Date} startDate - Analysis start date
 * @param {Date} endDate - Analysis end date
 * @returns {Object} Standardized data ready for analysis
 */
function standardizeInputData(rawData, startDate, endDate) {
  const { batteryMeta, priceData, predictedSchedule, actualEvents } = rawData;

  // Validate required data
  if (!batteryMeta || !Array.isArray(batteryMeta)) {
    throw new Error('Battery metadata is required and must be an array');
  }
  if (!priceData || !Array.isArray(priceData)) {
    throw new Error('Price data is required and must be an array');
  }
  if (!predictedSchedule || !Array.isArray(predictedSchedule)) {
    throw new Error('Predicted schedule is required and must be an array');
  }
  if (!actualEvents || !Array.isArray(actualEvents)) {
    throw new Error('Actual events data is required and must be an array');
  }

  return {
    batteryMeta: batteryMeta, // Battery metadata doesn't need time standardization
    priceData: standardizePriceData(priceData, startDate, endDate),
    predictedSchedule: standardizePredictedSchedule(predictedSchedule, startDate, endDate),
    actualEvents: standardizeActualEvents(actualEvents, startDate, endDate),
    analysisStartDate: startDate,
    analysisEndDate: endDate
  };
}

async function runCalculation() {
  try {
    const priceFile = document.getElementById('priceFile').files[0];
    const batteryFile = document.getElementById('batteryFile').files[0];
    const predFile = document.getElementById('predFile').files[0];
    const actFile = document.getElementById('actFile').files[0];

    // Validate inputs
    if (!priceFile || !batteryFile || !predFile || !actFile) {
      throw new Error('Please select all required files');
    }

    // Read and parse files
    const priceContent = await readFile(new FileReader(), priceFile);
    const batteryContent = await readFile(new FileReader(), batteryFile);
    const predContent = await readFile(new FileReader(), predFile);
    const actContent = await readFile(new FileReader(), actFile);

    const rawData = {
      batteryMeta: parseFileContent(batteryContent, batteryFile.name),
      priceData: parseFileContent(priceContent, priceFile.name),
      predictedSchedule: parseFileContent(predContent, predFile.name),
      actualEvents: parseFileContent(actContent, actFile.name)
    };

    // Automatically determine analysis time range from data
    const { startDate, endDate } = determineAnalysisTimeRange(rawData);

    // Update the UI inputs to show the detected time range
    const startTs = document.getElementById('startTs');
    const endTs = document.getElementById('endTs');
    if (startTs) {
      startTs.value = startDate.toISOString().slice(0, 16); // Format for datetime-local input
    }
    if (endTs) {
      endTs.value = endDate.toISOString().slice(0, 16); // Format for datetime-local input
    }

    // Standardize data to discretization intervals
    const standardizedData = standardizeInputData(rawData, startDate, endDate);

    // Calculate revenue analysis
    const revenueAnalysis = calculateRevenueAnalysis(standardizedData);

    // Display results
    const output = `=== Revenue Loss Analysis Complete ===
Analysis Period: ${startDate.toISOString()} to ${endDate.toISOString()}
(Time range automatically detected from input files)
Discretization Interval: ${DISCRETIZATION_INTERVAL_MIN} minutes

=== Data Summary ===
Battery Metadata: ${standardizedData.batteryMeta.length} batteries
Price Data: ${standardizedData.priceData.length} ${DISCRETIZATION_INTERVAL_MIN}-minute intervals
Predicted Schedule: ${standardizedData.predictedSchedule.length} ${DISCRETIZATION_INTERVAL_MIN}-minute intervals
Actual Events: ${standardizedData.actualEvents.length} ${DISCRETIZATION_INTERVAL_MIN}-minute intervals

=== Revenue Analysis Summary ===
Total Predicted Revenue: €${revenueAnalysis.summary.totalPredictedRevenue.toFixed(2)}
Total Actual Revenue: €${revenueAnalysis.summary.totalActualRevenue.toFixed(2)}
Total Revenue Loss: €${revenueAnalysis.summary.totalRevenueLoss.toFixed(2)}

=== Sample Revenue Comparison Data (first 5 intervals) ===
${JSON.stringify(revenueAnalysis.comparisonData.slice(0, 5), null, 2)}

=== Sample Predicted Revenue Data (first 3 intervals) ===
${JSON.stringify(revenueAnalysis.predictedRevenue.slice(0, 3), null, 2)}

=== Sample Actual Revenue Data (first 3 intervals) ===
${JSON.stringify(revenueAnalysis.actualRevenue.slice(0, 3), null, 2)}
`;

    document.getElementById('output').textContent = output;

  } catch (error) {
    document.getElementById('output').textContent = `Error: ${error.message}`;
    console.error('Calculation error:', error);
  }
}

function setup() {
  const runBtn = document.getElementById('runBtn');
  if (runBtn) {
    runBtn.addEventListener('click', runCalculation);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', setup);
}

if (typeof module !== 'undefined') {
  module.exports = {
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
    calculateRevenueAnalysis
  };
}
