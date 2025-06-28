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
  let darkMode = false;

  // Theme management
  function toggleTheme() {
    darkMode = !darkMode;
    if (typeof window !== 'undefined') {
      localStorage.setItem('darkMode', darkMode.toString());
      document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    }
  }

  function initializeTheme() {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('darkMode');
      if (savedTheme) {
        darkMode = savedTheme === 'true';
      } else {
        // Check for system preference
        darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    }
  }

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

    // Get theme-aware colors
    const isDark = darkMode;
    const textColor = isDark ? '#e5e7eb' : '#374151';
    const gridColor = isDark ? '#374151' : '#e5e7eb';

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
            },
            legend: {
                labels: {
                    color: textColor
                }
            }
        },
        scales: {
            x: {
                stacked: true,
                ticks: {
                    color: textColor
                },
                grid: {
                    color: gridColor
                }
            },
            y: {
                stacked: true,
                ticks: {
                    color: textColor
                },
                grid: {
                    color: gridColor
                }
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
    initializeTheme();
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

  // Reactively update chart when theme changes
  $: if (darkMode !== undefined && electricityPrices && laborCosts) {
    try {
      const parsedElectricity = JSON.parse(electricityPrices);
      const parsedLabor = JSON.parse(laborCosts);
      const maintenanceEvents = results ? results.events : [];
      costsChartData = prepareCostsChartData(parsedElectricity, parsedLabor, maintenanceEvents);
    } catch (e) {
      // Ignore parsing errors
    }
  }
</script>

<svelte:head>
  <title>BESS Maintenance Optimizer</title>
</svelte:head>

<div class="header">
  <div class="header-content">
    <div class="title-section">
      <h1>Battery Energy Storage System</h1>
      <h2>Maintenance Optimization Dashboard</h2>
    </div>
    <button class="theme-toggle" on:click={toggleTheme} aria-label="Toggle theme">
      {#if darkMode}
        🌞
      {:else}
        🌙
      {/if}
    </button>
  </div>
</div>

<div class="main-container">
  <div class="left-panel">
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

      {#if error}
        <div class="error">
          <p>Error: {error}</p>
        </div>
      {/if}
    </div>
  </div>

  <div class="right-panel">
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
  </div>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
  }

  /* CSS Variables for theming */
  :global([data-theme="light"]) {
    --bg-primary: #ffffff;
    --bg-secondary: #f9fafb;
    --bg-tertiary: #f3f4f6;
    --text-primary: #111827;
    --text-secondary: #6b7280;
    --text-accent: #2563eb;
    --border-primary: #e5e7eb;
    --border-secondary: #d1d5db;
    --button-bg: #2563eb;
    --button-hover: #1d4ed8;
    --button-text: #ffffff;
    --input-bg: #ffffff;
    --input-border: #d1d5db;
    --error-bg: #fef2f2;
    --error-text: #991b1b;
    --error-border: #fecaca;
  }

  :global([data-theme="dark"]) {
    --bg-primary: #111827;
    --bg-secondary: #1f2937;
    --bg-tertiary: #374151;
    --text-primary: #f9fafb;
    --text-secondary: #d1d5db;
    --text-accent: #60a5fa;
    --border-primary: #374151;
    --border-secondary: #4b5563;
    --button-bg: #3b82f6;
    --button-hover: #2563eb;
    --button-text: #ffffff;
    --input-bg: #1f2937;
    --input-border: #4b5563;
    --error-bg: #7f1d1d;
    --error-text: #fecaca;
    --error-border: #991b1b;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    transition: background-color 0.3s ease, color 0.3s ease;
  }

  :global(#svelte) {
    width: 100%;
    height: 100%;
  }

  .header {
    padding: 1rem 1.5rem;
    background-color: var(--bg-primary);
    border-bottom: 1px solid var(--border-primary);
    width: 100%;
    margin: 0;
    transition: background-color 0.3s ease, border-color 0.3s ease;
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title-section {
    flex: 1;
  }

  .theme-toggle {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    padding: 0.5rem;
    font-size: 1.25rem;
    cursor: pointer;
    transition: all 0.3s ease;
    color: var(--text-primary);
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .theme-toggle:hover {
    background: var(--bg-tertiary);
    transform: scale(1.05);
  }

  h1 {
    color: var(--text-accent);
    margin: 0 0 0.5rem 0;
    transition: color 0.3s ease;
  }

  h2 {
    color: var(--text-secondary);
    font-weight: 400;
    margin: 0;
    transition: color 0.3s ease;
  }

  .main-container {
    display: flex;
    gap: 0;
    height: calc(100vh - 120px);
    width: 100vw;
    margin: 0;
    padding: 0;
  }

  .left-panel {
    width: 400px;
    flex-shrink: 0;
    background-color: var(--bg-secondary);
    border-right: 1px solid var(--border-primary);
    padding: 1.5rem;
    overflow-y: auto;
    height: 100%;
    transition: background-color 0.3s ease, border-color 0.3s ease;
  }

  .right-panel {
    flex: 1;
    min-width: 0;
    padding: 1.5rem;
    overflow-y: auto;
    height: 100%;
    background-color: var(--bg-primary);
    transition: background-color 0.3s ease;
  }

  .form-container {
    display: grid;
    gap: 1.5rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
  }

  label {
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: var(--text-primary);
    transition: color 0.3s ease;
  }

  textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    font-family: monospace;
    resize: vertical;
    min-height: 60px;
    background-color: var(--input-bg);
    color: var(--text-primary);
    transition: all 0.3s ease;
  }

  textarea:focus {
    outline: none;
    border-color: var(--text-accent);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }

  button {
    padding: 0.75rem 1.5rem;
    background-color: var(--button-bg);
    color: var(--button-text);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.3s ease;
  }

  button:hover:not(:disabled) {
    background-color: var(--button-hover);
    transform: translateY(-1px);
  }

  button:disabled {
    background-color: var(--text-secondary);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .error {
    margin-top: 1rem;
    padding: 0.75rem;
    background-color: var(--error-bg);
    color: var(--error-text);
    border: 1px solid var(--error-border);
    border-radius: 4px;
    font-size: 0.875rem;
    transition: all 0.3s ease;
  }

  .charts-container {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
  }

  .chart-container {
    padding: 1rem;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    transition: all 0.3s ease;
  }

  .chart-container h3 {
    color: var(--text-primary);
    margin-top: 0;
    transition: color 0.3s ease;
  }

  .results-raw {
    margin-top: 2rem;
    padding: 1rem;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    transition: all 0.3s ease;
  }

  .results-raw h3 {
    color: var(--text-primary);
    margin-top: 0;
    transition: color 0.3s ease;
  }

  .results-raw pre {
    color: var(--text-primary);
    transition: color 0.3s ease;
  }

  @media (max-width: 1024px) {
    .main-container {
      flex-direction: column;
    }
    
    .left-panel {
      width: 100%;
    }
  }

  pre {
    white-space: pre-wrap;
    word-wrap: break-word;
  }
</style>