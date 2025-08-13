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
 * Calculate downtime loss - predicted revenue during DOWNTIME periods
 * @param {Array} comparisonData - Comparison data from revenue analysis
 * @returns {number} Total downtime loss in EUR
 */
function calculateDowntimeLoss(comparisonData) {
  return comparisonData
    .filter(c => c.act_mode === 'DOWNTIME' && c.rev_pred_eur !== null)
    .reduce((sum, c) => sum + c.rev_pred_eur, 0);
}

/**
 * Calculate deviation loss - loss not due to downtime
 * @param {number} totalLoss - Total revenue loss
 * @param {number} downtimeLoss - Downtime loss
 * @returns {number} Deviation loss in EUR
 */
function calculateDeviationLoss(totalLoss, downtimeLoss) {
  return totalLoss - downtimeLoss;
}

/**
 * Calculate battery utilization percentage
 * @param {Array} comparisonData - Comparison data from revenue analysis
 * @param {Array} batteryMeta - Battery metadata
 * @param {number} totalTimeHours - Total analysis time in hours
 * @returns {Object} Utilization data by battery
 */
function calculateUtilization(comparisonData, batteryMeta, totalTimeHours) {
  const utilizationByBattery = {};

  // Create battery metadata lookup
  const batteryMap = new Map();
  batteryMeta.forEach(battery => {
    batteryMap.set(battery.battery_id, battery);
  });

  // Group comparison data by battery
  const dataByBattery = {};
  comparisonData.forEach(data => {
    if (!dataByBattery[data.battery_id]) {
      dataByBattery[data.battery_id] = [];
    }
    dataByBattery[data.battery_id].push(data);
  });

  // Calculate utilization for each battery
  Object.keys(dataByBattery).forEach(batteryId => {
    const battery = batteryMap.get(batteryId);
    const batteryData = dataByBattery[batteryId];

    if (!battery) {
      utilizationByBattery[batteryId] = { error: 'Battery metadata not found' };
      return;
    }

    // Calculate total actual energy dispatched (absolute value)
    const totalActualEnergyDispatched = batteryData
      .reduce((sum, data) => sum + Math.abs(data.act_energy_kwh || 0), 0);

    // Calculate potential energy throughput (rated power * time)
    const potentialEnergyThroughput = battery.power_kw * totalTimeHours;

    // Calculate utilization percentage
    const utilizationPercent = potentialEnergyThroughput > 0
      ? (totalActualEnergyDispatched / potentialEnergyThroughput) * 100
      : 0;

    utilizationByBattery[batteryId] = {
      battery_id: batteryId,
      rated_power_kw: battery.power_kw,
      capacity_kwh: battery.capacity_kwh,
      total_actual_energy_dispatched_kwh: totalActualEnergyDispatched,
      potential_energy_throughput_kwh: potentialEnergyThroughput,
      utilization_percent: utilizationPercent,
      analysis_time_hours: totalTimeHours
    };
  });

  return utilizationByBattery;
}

/**
 * Calculate time-based availability (A_time)
 * @param {Array} comparisonData - Comparison data from revenue analysis
 * @returns {Object} Time-based availability by battery
 */
function calculateTimeBasedAvailability(comparisonData) {
  const availabilityByBattery = {};

  // Group data by battery
  const dataByBattery = {};
  comparisonData.forEach(data => {
    if (!dataByBattery[data.battery_id]) {
      dataByBattery[data.battery_id] = [];
    }
    dataByBattery[data.battery_id].push(data);
  });

  // Calculate availability for each battery
  Object.keys(dataByBattery).forEach(batteryId => {
    const batteryData = dataByBattery[batteryId];
    const totalSlices = batteryData.length;
    const nonDowntimeSlices = batteryData.filter(data => data.act_mode !== 'DOWNTIME').length;

    availabilityByBattery[batteryId] = {
      battery_id: batteryId,
      total_slices: totalSlices,
      non_downtime_slices: nonDowntimeSlices,
      downtime_slices: totalSlices - nonDowntimeSlices,
      a_time_percent: totalSlices > 0 ? (nonDowntimeSlices / totalSlices) * 100 : 0
    };
  });

  return availabilityByBattery;
}

/**
 * Calculate value-based availability (A_dispatch)
 * @param {Array} comparisonData - Comparison data from revenue analysis
 * @param {Array} batteryMeta - Battery metadata
 * @param {number} pMinPercent - Minimum power threshold percentage (default 5%)
 * @returns {Object} Value-based availability by battery
 */
function calculateValueBasedAvailability(comparisonData, batteryMeta, pMinPercent = 5) {
  const availabilityByBattery = {};

  // Create battery metadata lookup
  const batteryMap = new Map();
  batteryMeta.forEach(battery => {
    batteryMap.set(battery.battery_id, battery);
  });

  // Group data by battery
  const dataByBattery = {};
  comparisonData.forEach(data => {
    if (!dataByBattery[data.battery_id]) {
      dataByBattery[data.battery_id] = [];
    }
    dataByBattery[data.battery_id].push(data);
  });

  // Calculate availability for each battery
  Object.keys(dataByBattery).forEach(batteryId => {
    const battery = batteryMap.get(batteryId);
    const batteryData = dataByBattery[batteryId];

    if (!battery) {
      availabilityByBattery[batteryId] = { error: 'Battery metadata not found' };
      return;
    }

    const pMin = battery.power_kw * (pMinPercent / 100);

    // Identify instructed slices
    const instructedSlices = batteryData.filter(data =>
      Math.abs(data.pred_power_kw || 0) >= pMin
    );

    // Calculate partial availability for each slice
    let totalAvailability = 0;
    instructedSlices.forEach(data => {
      const predPowerAbs = Math.abs(data.pred_power_kw || 0);
      const actPowerAbs = Math.abs(data.act_power_kw || 0);
      const partialAvailability = predPowerAbs > 0 ? Math.min(1, actPowerAbs / predPowerAbs) : 1;
      totalAvailability += partialAvailability;
    });

    availabilityByBattery[batteryId] = {
      battery_id: batteryId,
      rated_power_kw: battery.power_kw,
      p_min_kw: pMin,
      total_slices: batteryData.length,
      instructed_slices: instructedSlices.length,
      non_instructed_slices: batteryData.length - instructedSlices.length,
      a_dispatch_percent: instructedSlices.length > 0 ? (totalAvailability / instructedSlices.length) * 100 : 100
    };
  });

  return availabilityByBattery;
}

/**
 * Calculate price-weighted availability (A_econ)
 * @param {Array} comparisonData - Comparison data from revenue analysis
 * @param {Array} batteryMeta - Battery metadata
 * @param {number} pMinPercent - Minimum power threshold percentage (default 5%)
 * @returns {Object} Price-weighted availability by battery
 */
function calculatePriceWeightedAvailability(comparisonData, batteryMeta, pMinPercent = 5) {
  const availabilityByBattery = {};

  // Create battery metadata lookup
  const batteryMap = new Map();
  batteryMeta.forEach(battery => {
    batteryMap.set(battery.battery_id, battery);
  });

  // Group data by battery
  const dataByBattery = {};
  comparisonData.forEach(data => {
    if (!dataByBattery[data.battery_id]) {
      dataByBattery[data.battery_id] = [];
    }
    dataByBattery[data.battery_id].push(data);
  });

  // Calculate availability for each battery
  Object.keys(dataByBattery).forEach(batteryId => {
    const battery = batteryMap.get(batteryId);
    const batteryData = dataByBattery[batteryId];

    if (!battery) {
      availabilityByBattery[batteryId] = { error: 'Battery metadata not found' };
      return;
    }

    const pMin = battery.power_kw * (pMinPercent / 100);

    // Calculate weighted availability
    let totalWeightedAvailability = 0;
    let totalWeight = 0;

    batteryData.forEach(data => {
      const predPowerAbs = Math.abs(data.pred_power_kw || 0);
      const actPowerAbs = Math.abs(data.act_power_kw || 0);
      const price = data.price_eur_mwh || 0;

      // Weight per slice: price * abs(pred_power_kw)
      const weight = price * predPowerAbs;

      if (weight > 0) {
        // Partial availability
        const partialAvailability = predPowerAbs > 0 ? Math.min(1, actPowerAbs / predPowerAbs) : 1;

        totalWeightedAvailability += partialAvailability * weight;
        totalWeight += weight;
      }
    });

    availabilityByBattery[batteryId] = {
      battery_id: batteryId,
      rated_power_kw: battery.power_kw,
      p_min_kw: pMin,
      total_weight: totalWeight,
      a_econ_percent: totalWeight > 0 ? (totalWeightedAvailability / totalWeight) * 100 : 100
    };
  });

  return availabilityByBattery;
}

/**
 * Calculate headroom cost (revenue impact during non-downtime periods when SLA is met)
 * @param {Array} comparisonData - Comparison data from revenue analysis
 * @param {Object} timeBasedAvailability - Time-based availability data by battery
 * @param {number} slaTargetPercent - SLA target percentage (default 95%)
 * @returns {Object} Headroom cost analysis
 */
function calculateHeadroomCost(comparisonData, timeBasedAvailability, slaTargetPercent = 95) {
  // Group data by battery
  const dataByBattery = {};
  comparisonData.forEach(data => {
    if (!dataByBattery[data.battery_id]) {
      dataByBattery[data.battery_id] = [];
    }
    dataByBattery[data.battery_id].push(data);
  });

  const headroomCostByBattery = {};

  Object.keys(dataByBattery).forEach(batteryId => {
    const batteryData = dataByBattery[batteryId];
    const batteryAvailability = timeBasedAvailability[batteryId];

    let headroomCost = 0;
    let qualifyingSlices = 0;

    // Only calculate headroom cost if the battery's overall A_time meets SLA target
    if (batteryAvailability && batteryAvailability.a_time_percent >= slaTargetPercent) {
      batteryData.forEach(data => {
        // Skip downtime slices
        if (data.act_mode === 'DOWNTIME') return;

        // Include all non-downtime slices in headroom cost when SLA is met
        const revenueDiff = (data.rev_pred_eur || 0) - (data.rev_act_eur || 0);
        headroomCost += revenueDiff;
        qualifyingSlices++;
      });
    }

    headroomCostByBattery[batteryId] = {
      battery_id: batteryId,
      headroom_cost_eur: headroomCost,
      qualifying_slices: qualifyingSlices,
      total_non_downtime_slices: batteryData.filter(d => d.act_mode !== 'DOWNTIME').length,
      battery_a_time_percent: batteryAvailability?.a_time_percent || 0,
      sla_target_percent: slaTargetPercent,
      sla_met: batteryAvailability?.a_time_percent >= slaTargetPercent
    };
  });

  return headroomCostByBattery;
}

/**
 * Calculate comprehensive key metrics including availability metrics
 * @param {Object} revenueAnalysis - Revenue analysis data
 * @param {Array} batteryMeta - Battery metadata
 * @param {Date} startDate - Analysis start date
 * @param {Date} endDate - Analysis end date
 * @param {number} pMinPercent - Minimum power threshold percentage (default 5%)
 * @param {number} slaTargetPercent - SLA target percentage (default 95%)
 * @returns {Object} Object containing all key metrics
 */
function calculateKeyMetrics(revenueAnalysis, batteryMeta, startDate, endDate, pMinPercent = 5, slaTargetPercent = 95) {
  const { comparisonData, summary } = revenueAnalysis;

  // Calculate total analysis time in hours
  const totalTimeHours = (endDate - startDate) / (1000 * 60 * 60);

  // Calculate existing metrics
  const totalRevenueLoss = summary.totalRevenueLoss;
  const downtimeLoss = calculateDowntimeLoss(comparisonData);
  const deviationLoss = calculateDeviationLoss(totalRevenueLoss, downtimeLoss);
  const utilization = calculateUtilization(comparisonData, batteryMeta, totalTimeHours);

  // Calculate new availability metrics
  const timeBasedAvailability = calculateTimeBasedAvailability(comparisonData);
  const valueBasedAvailability = calculateValueBasedAvailability(comparisonData, batteryMeta, pMinPercent);
  const priceWeightedAvailability = calculatePriceWeightedAvailability(comparisonData, batteryMeta, pMinPercent);
  const headroomCost = calculateHeadroomCost(comparisonData, timeBasedAvailability, slaTargetPercent);

  // Calculate overall utilization across all batteries
  const overallUtilization = Object.values(utilization).reduce((acc, battery) => {
    if (battery.utilization_percent !== undefined) {
      acc.totalActualEnergy += battery.total_actual_energy_dispatched_kwh;
      acc.totalPotentialEnergy += battery.potential_energy_throughput_kwh;
    }
    return acc;
  }, { totalActualEnergy: 0, totalPotentialEnergy: 0 });

  const overallUtilizationPercent = overallUtilization.totalPotentialEnergy > 0
    ? (overallUtilization.totalActualEnergy / overallUtilization.totalPotentialEnergy) * 100
    : 0;

  // Calculate overall availability metrics
  const overallTimeAvailability = Object.values(timeBasedAvailability).reduce((acc, battery) => {
    acc.totalSlices += battery.total_slices;
    acc.nonDowntimeSlices += battery.non_downtime_slices;
    return acc;
  }, { totalSlices: 0, nonDowntimeSlices: 0 });

  const overallTimeAvailabilityPercent = overallTimeAvailability.totalSlices > 0
    ? (overallTimeAvailability.nonDowntimeSlices / overallTimeAvailability.totalSlices) * 100
    : 0;

  return {
    revenueLoss: {
      total_loss_eur: totalRevenueLoss,
      downtime_loss_eur: downtimeLoss,
      deviation_loss_eur: deviationLoss,
      downtime_loss_percent: totalRevenueLoss !== 0 ? (downtimeLoss / Math.abs(totalRevenueLoss)) * 100 : 0,
      deviation_loss_percent: totalRevenueLoss !== 0 ? (deviationLoss / Math.abs(totalRevenueLoss)) * 100 : 0
    },
    utilization: {
      by_battery: utilization,
      overall_utilization_percent: overallUtilizationPercent,
      total_actual_energy_dispatched_kwh: overallUtilization.totalActualEnergy,
      total_potential_energy_throughput_kwh: overallUtilization.totalPotentialEnergy
    },
    availability: {
      time_based: {
        by_battery: timeBasedAvailability,
        overall_a_time_percent: overallTimeAvailabilityPercent
      },
      value_based: {
        by_battery: valueBasedAvailability,
        p_min_percent: pMinPercent
      },
      price_weighted: {
        by_battery: priceWeightedAvailability
      },
      headroom_cost: {
        by_battery: headroomCost,
        total_headroom_cost_eur: Object.values(headroomCost).reduce((sum, battery) => sum + battery.headroom_cost_eur, 0),
        sla_target_percent: slaTargetPercent
      }
    },
    analysisMetadata: {
      analysis_start: startDate.toISOString(),
      analysis_end: endDate.toISOString(),
      analysis_duration_hours: totalTimeHours,
      total_intervals: comparisonData.length,
      batteries_analyzed: Object.keys(utilization).length,
      p_min_percent: pMinPercent,
      sla_target_percent: slaTargetPercent
    }
  };
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

    // Get configuration parameters from UI
    const pMinPct = parseFloat(document.getElementById('pMinPct')?.value || 5);
    const slaPct = parseFloat(document.getElementById('slaPct')?.value || 95);

    // Calculate key metrics
    const keyMetrics = calculateKeyMetrics(revenueAnalysis, standardizedData.batteryMeta, startDate, endDate, pMinPct, slaPct);

    // Display results
    const output = `=== Revenue Loss Analysis Complete ===
Analysis Period: ${startDate.toISOString()} to ${endDate.toISOString()}
(Time range automatically detected from input files)
Discretization Interval: ${DISCRETIZATION_INTERVAL_MIN} minutes
Analysis Duration: ${keyMetrics.analysisMetadata.analysis_duration_hours.toFixed(2)} hours

=== Data Summary ===
Battery Metadata: ${standardizedData.batteryMeta.length} batteries
Price Data: ${standardizedData.priceData.length} ${DISCRETIZATION_INTERVAL_MIN}-minute intervals
Predicted Schedule: ${standardizedData.predictedSchedule.length} ${DISCRETIZATION_INTERVAL_MIN}-minute intervals
Actual Events: ${standardizedData.actualEvents.length} ${DISCRETIZATION_INTERVAL_MIN}-minute intervals

=== Revenue Analysis Summary ===
Total Predicted Revenue: €${revenueAnalysis.summary.totalPredictedRevenue.toFixed(2)}
Total Actual Revenue: €${revenueAnalysis.summary.totalActualRevenue.toFixed(2)}
Total Revenue Loss: €${revenueAnalysis.summary.totalRevenueLoss.toFixed(2)}

=== Key Metrics ===
Revenue Loss Breakdown:
  • Total Loss: €${keyMetrics.revenueLoss.total_loss_eur.toFixed(2)}
  • Downtime Loss: €${keyMetrics.revenueLoss.downtime_loss_eur.toFixed(2)} (${keyMetrics.revenueLoss.downtime_loss_percent.toFixed(1)}%)
  • Deviation Loss: €${keyMetrics.revenueLoss.deviation_loss_eur.toFixed(2)} (${keyMetrics.revenueLoss.deviation_loss_percent.toFixed(1)}%)

Utilization:
  • Overall Utilization: ${keyMetrics.utilization.overall_utilization_percent.toFixed(1)}%
  • Total Actual Energy Dispatched: ${keyMetrics.utilization.total_actual_energy_dispatched_kwh.toFixed(2)} kWh
  • Total Potential Energy Throughput: ${keyMetrics.utilization.total_potential_energy_throughput_kwh.toFixed(2)} kWh

Availability Metrics:
  • Overall Time-Based Availability (A_time): ${keyMetrics.availability.time_based.overall_a_time_percent.toFixed(1)}%
  • P_min Threshold: ${keyMetrics.analysisMetadata.p_min_percent}% of rated power
  • SLA Target: ${keyMetrics.analysisMetadata.sla_target_percent}%
  • Total Headroom Cost: €${keyMetrics.availability.headroom_cost.total_headroom_cost_eur.toFixed(2)}

Battery-Specific Metrics:
${Object.keys(keyMetrics.availability.time_based.by_battery).map(batteryId => {
  const timeAvail = keyMetrics.availability.time_based.by_battery[batteryId];
  const valueAvail = keyMetrics.availability.value_based.by_battery[batteryId];
  const priceAvail = keyMetrics.availability.price_weighted.by_battery[batteryId];
  const headroom = keyMetrics.availability.headroom_cost.by_battery[batteryId];
  const util = keyMetrics.utilization.by_battery[batteryId];

  return `  • ${batteryId}:
    - Utilization: ${util?.utilization_percent?.toFixed(1) || 'N/A'}% (${util?.rated_power_kw || 'N/A'} kW rated)
    - A_time: ${timeAvail.a_time_percent.toFixed(1)}% (${timeAvail.downtime_slices}/${timeAvail.total_slices} downtime slices)
    - A_dispatch: ${valueAvail.a_dispatch_percent?.toFixed(1) || 'N/A'}% (${valueAvail.instructed_slices || 0} instructed slices)
    - A_econ: ${priceAvail.a_econ_percent?.toFixed(1) || 'N/A'}% (price-weighted)
    - Headroom Cost: €${headroom.headroom_cost_eur?.toFixed(2) || '0.00'}`;
}).join('\n')}

=== Sample Revenue Comparison Data (first 3 intervals) ===
${JSON.stringify(revenueAnalysis.comparisonData.slice(0, 3), null, 2)}
`;

    document.getElementById('output').textContent = output;

    // Create visualizations
    createVisualizations(revenueAnalysis, keyMetrics, standardizedData);

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

/**
 * Create all visualizations
 * @param {Object} revenueAnalysis - Revenue analysis data
 * @param {Object} keyMetrics - Key metrics data
 * @param {Object} standardizedData - Standardized input data
 */
function createVisualizations(revenueAnalysis, keyMetrics, standardizedData) {
  try {
    // Show charts container
    document.getElementById('chartsContainer').style.display = 'block';

    // Create high-level metric charts
    console.log('Creating high-level metric charts...');
    createRevenueChart(revenueAnalysis.summary);
    createLossBreakdownChart(keyMetrics.revenueLoss);
    createUtilizationChart(keyMetrics.utilization);
    createAvailabilityChart(keyMetrics.availability);

    // Create performance time series charts
    console.log('Creating performance time series charts...');
    console.log('Comparison data length:', revenueAnalysis.comparisonData.length);
    console.log('Price data length:', standardizedData.priceData.length);

    createPowerChart(revenueAnalysis.comparisonData);
    createRevenueTimeChart(revenueAnalysis.comparisonData);
    createPriceAvailabilityChart(revenueAnalysis.comparisonData, standardizedData.priceData);

    console.log('All charts created successfully');
  } catch (error) {
    console.error('Error creating visualizations:', error);
    // Show error message to user
    const errorDiv = document.createElement('div');
    errorDiv.style.color = 'red';
    errorDiv.style.padding = '10px';
    errorDiv.style.border = '1px solid red';
    errorDiv.style.borderRadius = '4px';
    errorDiv.style.margin = '10px 0';
    errorDiv.innerHTML = `<strong>Visualization Error:</strong> ${error.message}`;
    document.getElementById('chartsContainer').prepend(errorDiv);
  }
}

/**
 * Create revenue analysis bar chart
 */
function createRevenueChart(summary) {
  const ctx = document.getElementById('revenueChart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Predicted Revenue', 'Actual Revenue', 'Revenue Loss'],
      datasets: [{
        data: [
          summary.totalPredictedRevenue,
          summary.totalActualRevenue,
          summary.totalRevenueLoss
        ],
        backgroundColor: ['#28a745', '#17a2b8', '#dc3545'],
        borderColor: ['#1e7e34', '#117a8b', '#bd2130'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `€${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '€' + value.toFixed(0);
            }
          }
        }
      }
    }
  });
}

/**
 * Create revenue loss breakdown pie chart
 */
function createLossBreakdownChart(revenueLoss) {
  const ctx = document.getElementById('lossBreakdownChart').getContext('2d');
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Downtime Loss', 'Deviation Loss'],
      datasets: [{
        data: [revenueLoss.downtime_loss_eur, revenueLoss.deviation_loss_eur],
        backgroundColor: ['#ffc107', '#fd7e14'],
        borderColor: ['#e0a800', '#e8590c'],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: function(context) {
              const percentage = ((context.parsed / revenueLoss.total_loss_eur) * 100).toFixed(1);
              return `${context.label}: €${context.parsed.toFixed(2)} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

/**
 * Create battery utilization horizontal bar chart
 */
function createUtilizationChart(utilization) {
  const batteries = Object.values(utilization.by_battery);
  const ctx = document.getElementById('utilizationChart').getContext('2d');

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: batteries.map(b => `${b.battery_id}\n(${b.rated_power_kw} kW)`),
      datasets: [{
        label: 'Utilization %',
        data: batteries.map(b => b.utilization_percent),
        backgroundColor: '#6f42c1',
        borderColor: '#5a32a3',
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.parsed.x.toFixed(1)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          }
        }
      }
    }
  });
}

/**
 * Create availability metrics radar chart
 */
function createAvailabilityChart(availability) {
  const batteries = Object.keys(availability.time_based.by_battery);
  const ctx = document.getElementById('availabilityChart').getContext('2d');

  const datasets = batteries.map((batteryId, index) => {
    const colors = ['#007bff', '#28a745', '#dc3545', '#ffc107'];
    const color = colors[index % colors.length];

    return {
      label: batteryId,
      data: [
        availability.time_based.by_battery[batteryId].a_time_percent,
        availability.value_based.by_battery[batteryId].a_dispatch_percent || 0,
        availability.price_weighted.by_battery[batteryId].a_econ_percent || 0
      ],
      backgroundColor: color + '20',
      borderColor: color,
      borderWidth: 2,
      pointBackgroundColor: color
    };
  });

  new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['A_time (%)', 'A_dispatch (%)', 'A_econ (%)'],
      datasets: datasets
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' }
      },
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          }
        }
      }
    }
  });
}

// Global variable to store chart instance and data
let powerChartInstance = null;
let powerChartData = null;

/**
 * Create power performance time series chart with battery selector
 */
function createPowerChart(comparisonData) {
  try {
    const ctx = document.getElementById('powerChart').getContext('2d');

    if (!comparisonData || comparisonData.length === 0) {
      console.warn('No comparison data available for power chart');
      return;
    }

    // Store data globally for selector functionality
    powerChartData = comparisonData;

    // Populate battery selector
    populateBatterySelector(comparisonData);

    // Create initial chart (overall view)
    updatePowerChart('overall');

  } catch (error) {
    console.error('Error creating power chart:', error);
  }
}

/**
 * Populate the battery selector dropdown
 */
function populateBatterySelector(comparisonData) {
  const selector = document.getElementById('batterySelector');
  if (!selector) return;

  // Get unique battery IDs
  const batteryIds = [...new Set(comparisonData.map(d => d.battery_id))].sort();

  // Clear existing options except "Overall"
  selector.innerHTML = '<option value="overall">Overall (All Batteries)</option>';

  // Add individual battery options
  batteryIds.forEach(batteryId => {
    const option = document.createElement('option');
    option.value = batteryId;
    option.textContent = `${batteryId} (Individual)`;
    selector.appendChild(option);
  });

  // Add event listener for selector changes
  selector.removeEventListener('change', handleBatterySelection); // Remove existing listener
  selector.addEventListener('change', handleBatterySelection);
}

/**
 * Handle battery selector change
 */
function handleBatterySelection(event) {
  const selectedBattery = event.target.value;
  updatePowerChart(selectedBattery);
}

/**
 * Update power chart based on selected battery
 */
function updatePowerChart(selectedBattery) {
  try {
    const ctx = document.getElementById('powerChart').getContext('2d');

    // Destroy existing chart if it exists
    if (powerChartInstance) {
      powerChartInstance.destroy();
    }

    let datasets = [];

    if (selectedBattery === 'overall') {
      // Create overall aggregated view
      datasets = createOverallPowerDatasets(powerChartData);
    } else {
      // Create individual battery view
      datasets = createIndividualBatteryDatasets(powerChartData, selectedBattery);
    }

    powerChartInstance = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${context.parsed.y.toFixed(1)} kW`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: {
              displayFormats: {
                hour: 'MMM dd HH:mm'
              }
            },
            title: { display: true, text: 'Time' }
          },
          y: {
            title: { display: true, text: 'Power (kW)' },
            ticks: {
              callback: function(value) {
                return value.toFixed(0) + ' kW';
              }
            }
          }
        }
      }
    });

  } catch (error) {
    console.error('Error updating power chart:', error);
  }
}

/**
 * Create datasets for overall aggregated view
 */
function createOverallPowerDatasets(comparisonData) {
  // Sample data for performance
  const sampleRate = Math.max(1, Math.floor(comparisonData.length / 1000));

  // Aggregate by timestamp (sum across all batteries)
  const timeAggregated = {};
  comparisonData.forEach((data, index) => {
    if (index % sampleRate === 0 && data.ts) {
      if (!timeAggregated[data.ts]) {
        timeAggregated[data.ts] = {
          timestamp: data.ts,
          predicted: 0,
          actual: 0
        };
      }
      timeAggregated[data.ts].predicted += data.pred_power_kw || 0;
      timeAggregated[data.ts].actual += data.act_power_kw || 0;
    }
  });

  const sortedData = Object.values(timeAggregated).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return [
    {
      label: 'Total Predicted Power',
      data: sortedData.map(d => ({ x: d.timestamp, y: d.predicted })),
      borderColor: '#007bff',
      backgroundColor: '#007bff20',
      borderWidth: 3,
      fill: false,
      tension: 0.1
    },
    {
      label: 'Total Actual Power',
      data: sortedData.map(d => ({ x: d.timestamp, y: d.actual })),
      borderColor: '#28a745',
      backgroundColor: '#28a74520',
      borderWidth: 3,
      borderDash: [5, 5],
      fill: false,
      tension: 0.1
    }
  ];
}

/**
 * Create datasets for individual battery view
 */
function createIndividualBatteryDatasets(comparisonData, batteryId) {
  // Filter data for selected battery and sample for performance
  const batteryData = comparisonData.filter(d => d.battery_id === batteryId);
  const sampleRate = Math.max(1, Math.floor(batteryData.length / 500));
  const sampledData = batteryData.filter((_, index) => index % sampleRate === 0 && batteryData[index].ts);

  return [
    {
      label: `${batteryId} Predicted Power`,
      data: sampledData.map(d => ({ x: d.ts, y: d.pred_power_kw || 0 })),
      borderColor: '#007bff',
      backgroundColor: '#007bff20',
      borderWidth: 2,
      fill: false,
      tension: 0.1
    },
    {
      label: `${batteryId} Actual Power`,
      data: sampledData.map(d => ({ x: d.ts, y: d.act_power_kw || 0 })),
      borderColor: '#28a745',
      backgroundColor: '#28a74520',
      borderWidth: 2,
      borderDash: [5, 5],
      fill: false,
      tension: 0.1
    }
  ];
}

/**
 * Create revenue performance time series chart
 */
function createRevenueTimeChart(comparisonData) {
  try {
    const ctx = document.getElementById('revenueTimeChart').getContext('2d');

    if (!comparisonData || comparisonData.length === 0) {
      console.warn('No comparison data available for revenue time chart');
      return;
    }

    // Sample data for performance
    const sampleRate = Math.max(1, Math.floor(comparisonData.length / 500));
    const sampledData = comparisonData.filter((_, index) => index % sampleRate === 0);

    // Aggregate by time (sum across all batteries for each timestamp)
    const timeAggregated = {};
    sampledData.forEach(data => {
      const ts = data.ts;
      if (ts && !timeAggregated[ts]) {
        timeAggregated[ts] = {
          timestamp: ts,
          predicted: 0,
          actual: 0,
          loss: 0
        };
      }
      if (ts) {
        timeAggregated[ts].predicted += data.rev_pred_eur || 0;
        timeAggregated[ts].actual += data.rev_act_eur || 0;
        timeAggregated[ts].loss += data.revenue_loss_eur || 0;
      }
    });

  const sortedData = Object.values(timeAggregated).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Predicted Revenue',
          data: sortedData.map(d => ({ x: d.timestamp, y: d.predicted })),
          borderColor: '#28a745',
          backgroundColor: '#28a74520',
          borderWidth: 2,
          fill: false,
          tension: 0.1
        },
        {
          label: 'Actual Revenue',
          data: sortedData.map(d => ({ x: d.timestamp, y: d.actual })),
          borderColor: '#17a2b8',
          backgroundColor: '#17a2b820',
          borderWidth: 2,
          fill: false,
          tension: 0.1
        },
        {
          label: 'Revenue Loss',
          data: sortedData.map(d => ({ x: d.timestamp, y: d.loss })),
          borderColor: '#dc3545',
          backgroundColor: '#dc354520',
          borderWidth: 2,
          fill: false,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: €${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            displayFormats: {
              hour: 'MMM dd HH:mm'
            }
          },
          title: { display: true, text: 'Time' }
        },
        y: {
          title: { display: true, text: 'Revenue (EUR)' },
          ticks: {
            callback: function(value) {
              return '€' + value.toFixed(1);
            }
          }
        }
      }
    }
  });

  } catch (error) {
    console.error('Error creating revenue time chart:', error);
  }
}

/**
 * Create price and availability time series chart
 */
function createPriceAvailabilityChart(comparisonData, priceData) {
  try {
    const ctx = document.getElementById('priceAvailabilityChart').getContext('2d');

    if (!comparisonData || comparisonData.length === 0 || !priceData || priceData.length === 0) {
      console.warn('No data available for price availability chart');
      return;
    }

    // Sample data for performance
    const sampleRate = Math.max(1, Math.floor(priceData.length / 500));
    const sampledPrices = priceData.filter((_, index) => index % sampleRate === 0 && priceData[index].price_eur_mwh !== null);

    // Calculate rolling availability (time-based) for each timestamp
    const windowSize = Math.max(1, Math.floor(comparisonData.length / 50)); // Rolling window
    const availabilityData = [];

    for (let i = 0; i < comparisonData.length; i += sampleRate) {
      if (comparisonData[i] && comparisonData[i].ts) {
        const windowStart = Math.max(0, i - windowSize);
        const windowEnd = Math.min(comparisonData.length, i + windowSize);
        const windowData = comparisonData.slice(windowStart, windowEnd);

        const nonDowntime = windowData.filter(d => d.act_mode !== 'DOWNTIME').length;
        const availability = windowData.length > 0 ? (nonDowntime / windowData.length) * 100 : 0;

        availabilityData.push({
          x: comparisonData[i].ts,
          y: availability
        });
      }
    }

  new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Price (EUR/MWh)',
          data: sampledPrices.map(p => ({ x: p.ts, y: p.price_eur_mwh })),
          borderColor: '#ffc107',
          backgroundColor: '#ffc10720',
          borderWidth: 2,
          fill: false,
          tension: 0.1,
          yAxisID: 'y'
        },
        {
          label: 'Rolling Availability (%)',
          data: availabilityData,
          borderColor: '#6f42c1',
          backgroundColor: '#6f42c120',
          borderWidth: 2,
          fill: false,
          tension: 0.1,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.dataset.label.includes('Price')) {
                return `${context.dataset.label}: €${context.parsed.y.toFixed(1)}/MWh`;
              } else {
                return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
              }
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            displayFormats: {
              hour: 'MMM dd HH:mm'
            }
          },
          title: { display: true, text: 'Time' }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Price (EUR/MWh)' },
          ticks: {
            callback: function(value) {
              return '€' + value.toFixed(0);
            }
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Availability (%)' },
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            callback: function(value) {
              return value.toFixed(0) + '%';
            }
          }
        }
      }
    }
  });

  } catch (error) {
    console.error('Error creating price availability chart:', error);
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
    calculateRevenueAnalysis,
    calculateDowntimeLoss,
    calculateDeviationLoss,
    calculateUtilization,
    calculateTimeBasedAvailability,
    calculateValueBasedAvailability,
    calculatePriceWeightedAvailability,
    calculateHeadroomCost,
    calculateKeyMetrics
  };
}
