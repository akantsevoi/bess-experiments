<script>
  import { onMount } from 'svelte';
  import { Chart, registerables } from 'chart.js';
  import { Bar } from 'svelte-chartjs';
  import annotationPlugin from 'chartjs-plugin-annotation';

  Chart.register(...registerables, annotationPlugin);

  let electricityPrices = '';
  let laborCosts = '';
  let maintenanceDurations = '';
  let results = null;
  let error = null;
  let loading = false;
  let costsChartData = null;
  let costsChartOptions = {};

  function prepareCostsChartData(electricity, labor, maintenanceEvents = []) {
    const electricityLabels = Object.keys(electricity);
    const electricityData = Object.values(electricity);
    const laborData = Object.values(labor);

    const colors = [
      'rgba(153, 102, 255, 0.2)',
      'rgba(255, 99, 132, 0.2)',
      'rgba(54, 162, 235, 0.2)',
      'rgba(255, 206, 86, 0.2)',
      'rgba(75, 192, 192, 0.2)',
      'rgba(255, 159, 64, 0.2)',
      'rgba(200, 200, 200, 0.2)'
    ];
    const borderColors = [
      'rgba(153, 102, 255, 1)',
      'rgba(255, 99, 132, 1)',
      'rgba(54, 162, 235, 1)',
      'rgba(255, 206, 86, 1)',
      'rgba(75, 192, 192, 1)',
      'rgba(255, 159, 64, 1)',
      'rgba(200, 200, 200, 1)'
    ];

    const annotations = maintenanceEvents.map((event, index) => {
        const colorIndex = index % colors.length;
        return {
            type: 'box',
            xMin: event.start_hour - 0.5,
            xMax: event.start_hour + event.duration - 0.5,
            yMin: 0,
            yMax: Math.max(...electricityData) + Math.max(...laborData),
            backgroundColor: colors[colorIndex],
            borderColor: borderColors[colorIndex],
            borderWidth: 1,
            label: {
                content: `Event ${index + 1}`,
                enabled: true,
                position: 'start'
            }
        }
    });

    costsChartOptions = {
        plugins: {
            annotation: {
                annotations: annotations
            }
        },
        scales: {
            x: {
                stacked: true
            },
            y: {
                stacked: true
            }
        }
    };

    return {
      labels: electricityLabels,
      datasets: [
        {
          label: 'Electricity Price',
          data: electricityData,
          backgroundColor: 'rgba(255, 159, 64, 0.5)',
          borderColor: 'rgba(255, 159, 64, 1)',
          borderWidth: 1,
          type: 'bar',
          yAxisID: 'y',
        },
        {
          label: 'Labor Cost',
          data: laborData,
          backgroundColor: 'rgba(75, 192, 192, 0.5)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
          type: 'bar',
          yAxisID: 'y',
        },
      ],
    };
  }

  async function fetchExampleData() {
    try {
      const response = await fetch('http://localhost:5000/optimize/example');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      electricityPrices = JSON.stringify(data.example_request.electricity_prices, null, 2);
      laborCosts = JSON.stringify(data.example_request.labor_costs, null, 2);
      maintenanceDurations = JSON.stringify(data.example_request.maintenance_durations, null, 2);
      costsChartData = prepareCostsChartData(data.example_request.electricity_prices, data.example_request.labor_costs);
    } catch (e) {
      error = `Failed to fetch example data: ${e.message}`;
    }
  }

  onMount(() => {
    fetchExampleData();
  });

  async function sendRequest() {
    loading = true;
    error = null;
    results = null;

    try {
      const payload = {
        electricity_prices: JSON.parse(electricityPrices),
        labor_costs: JSON.parse(laborCosts),
        maintenance_durations: JSON.parse(maintenanceDurations)
      };

      const response = await fetch('http://localhost:5000/optimize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      results = data.results;
      const parsedElectricity = JSON.parse(electricityPrices);
      const parsedLabor = JSON.parse(laborCosts);
      costsChartData = prepareCostsChartData(parsedElectricity, parsedLabor, results.events);
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
  
  $: {
    try {
      const parsedElectricity = JSON.parse(electricityPrices);
      const parsedLabor = JSON.parse(laborCosts);
      const maintenanceEvents = results ? results.events : [];
      costsChartData = prepareCostsChartData(parsedElectricity, parsedLabor, maintenanceEvents);
    } catch (e) {
      // Ignore parsing errors while user is typing
    }
  }
</script>

<svelte:head>
  <title>BESS Maintenance Optimizer</title>
</svelte:head>

<h1>Battery Energy Storage System</h1>
<h2>Maintenance Optimization Dashboard</h2>

<div class="form-container">
  <div class="form-group">
    <label for="electricity-prices">Electricity Prices (JSON)</label>
    <textarea id="electricity-prices" bind:value={electricityPrices} rows="10"></textarea>
  </div>

  <div class="form-group">
    <label for="labor-costs">Labor Costs (JSON)</label>
    <textarea id="labor-costs" bind:value={laborCosts} rows="10"></textarea>
  </div>

  <div class="form-group">
    <label for="maintenance-durations">Maintenance Durations (JSON Array)</label>
    <textarea id="maintenance-durations" bind:value={maintenanceDurations} rows="3"></textarea>
  </div>

  <button on:click={sendRequest} disabled={loading}>
    {loading ? 'Optimizing...' : 'Run Optimization'}
  </button>
</div>

{#if error}
  <div class="error">
    <p>Error: {error}</p>
  </div>
{/if}

<div class="charts-container">
  <div class="chart-container">
    <h3>Costs & Maintenance Schedule</h3>
    {#if costsChartData}
      <Bar data={costsChartData} options={costsChartOptions} />
    {/if}
  </div>
</div>

{#if results}
  <div class="results-raw">
    <h3>Optimization Results</h3>
    <pre>{JSON.stringify(results, null, 2)}</pre>
  </div>
{/if}

<style>
  h1 {
    color: #2563eb;
    margin-bottom: 0.5rem;
  }

  h2 {
    color: #6b7280;
    font-weight: 400;
    margin-bottom: 2rem;
  }

  .form-container {
    display: grid;
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
  }

  label {
    margin-bottom: 0.5rem;
    font-weight: 500;
  }

  textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-family: monospace;
  }

  button {
    padding: 0.75rem 1.5rem;
    background-color: #2563eb;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    transition: background-color 0.3s;
  }

  button:hover {
    background-color: #1d4ed8;
  }

  button:disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
  }

  .error {
    margin-top: 1rem;
    padding: 1rem;
    background-color: #fef2f2;
    color: #991b1b;
    border: 1px solid #fecaca;
    border-radius: 4px;
  }

  .charts-container {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
    margin-top: 2rem;
  }

  .chart-container {
    padding: 1rem;
    background-color: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
  }

  .results-raw {
    margin-top: 2rem;
    padding: 1rem;
    background-color: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
  }

  pre {
    white-space: pre-wrap;
    word-wrap: break-word;
  }
</style>