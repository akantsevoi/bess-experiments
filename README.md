# Energy Systems Maintenance Optimization

**Optimal Maintenance Window Scheduling with Mixed Integer Linear Programming (MILP)**

This project implements an optimization system for scheduling maintenance windows of energy systems (such as Battery Energy Storage Systems - BESS) to minimize total costs. The system uses Mixed Integer Linear Programming to find the optimal timing that balances electricity costs and equipment failure risks.

## Features

- **Simplified Cost Function**: Optimizes electricity costs and failure risk costs
- **Time Discretization**: Flexible time slot configuration (e.g., 1-hour intervals)
- **MILP Optimization**: Uses CBC solver for guaranteed optimal solutions
- **Visualization**: Plots electricity prices, failure rates, and maintenance schedules
- **Sample Data Generation**: Creates realistic electricity price and failure rate patterns
- **Extensible Architecture**: Easy to add new cost components and constraints
- **Multiple Examples**: Demonstrates different scenarios and use cases

## Installation

### Prerequisites
- Python 3.7+
- CBC solver (COIN-OR Branch and Cut)

### Installing Dependencies

**Fedora/RHEL:**
```bash
sudo dnf install python3-pip coin-cbc
pip3 install pulp matplotlib numpy
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install python3-pip coinor-cbc
pip3 install pulp matplotlib numpy
```

**macOS:**
```bash
brew install coin-cbc
pip3 install pulp matplotlib numpy
```

### Verify Installation
Check if CBC solver is available:
```bash
python3 test_solvers.py
```

## Usage

### Basic Usage

```python
from local_run import MaintenanceOptimizer

# Create optimizer for 24-hour horizon with 1-hour time slots
optimizer = MaintenanceOptimizer(horizon_hours=24, time_slot_hours=1.0)

# Generate sample data or set your own
optimizer.generate_sample_data()

# Build and solve the optimization model
optimizer.build_model()
success = optimizer.solve()

if success:
    optimizer.print_results()
    optimizer.plot_results()  # Visualize the solution
```

### Running Examples

The project includes multiple examples demonstrating different scenarios:

```bash
python examples.py
```

This will run 5 different examples:
1. **Basic optimization** - Default settings
2. **High failure risk** - Equipment with increased failure rates
3. **Volatile electricity prices** - Scenarios with price fluctuations
4. **Different planning horizons** - Compare 12h, 24h, and 48h planning
5. **Equipment comparison** - Different power consumption levels

### Setting Custom Data

```python
# Set custom electricity prices ($/kWh for each time slot)
prices = {0: 0.08, 1: 0.09, 2: 0.07, ...}  # time_slot: price
optimizer.set_electricity_prices(prices)

# Set custom failure rates (probability per time slot)
rates = {0: 0.001, 1: 0.0012, 2: 0.0015, ...}  # time_slot: rate
optimizer.set_failure_rates(rates)
```

### Quick Demo
```bash
python local_run.py
```

## Model Details

### Mathematical Formulation

**Variables:**
- `x[t]` ∈ {0,1}: Binary variable indicating if maintenance starts at time slot t
- `m[t]` ∈ {0,1}: Binary variable indicating if maintenance is active at time slot t

**Objective Function:**
```
minimize: C_total = C_elec + C_risk
```
Where:
- `C_elec = Σ(m[t] × E_aux × p_elec[t])` (electricity costs during maintenance)
- `C_risk = Σ((1 - Σ(m[τ] for τ≤t)) × f_rate[t] × C_failure)` (risk costs for delayed maintenance)

**Constraints:**
1. **Single start**: `Σ x[t] = 1` (maintenance must start exactly once)
2. **Maintenance duration**: `m[t] = Σ x[τ]` for `τ ∈ [max(0, t-D+1), t]` (maintenance active for D consecutive slots after start)
3. **Timeline constraint**: `t + D - 1 ≤ T_max` (maintenance must complete within horizon)

**Parameters:**
- `E_aux`: Auxiliary power consumption during maintenance (kWh)
- `D`: Maintenance duration (time slots)
- `p_elec[t]`: Electricity price at time slot t ($/kWh)
- `f_rate[t]`: Cumulative failure rate at time slot t
- `C_failure`: Cost of equipment failure ($)

## Extending the Model

To add new cost components:

```python
# Add new parameters to __init__
self.new_parameter = value

# Add cost calculation in build_model()
C_new = lpSum([decision_vars[t] * cost_function(t) for t in self.T])

# Update objective function
C_total = C_elec + C_risk + C_new
```

## Files

- `local_run.py` - Main optimization model implementation
- `examples.py` - Demonstration scenarios and use cases
- `test_solvers.py` - CBC solver availability checker
- `project_requirements.txt` - Python dependencies
- `README.md` - This documentation

## Example Output

```
==================================================
РЕЗУЛЬТАТЫ ОПТИМИЗАЦИИ
==================================================
Оптимальное время начала: слот 0 (0.0 ч от текущего момента)
Общие затраты: $0.46
  - Электричество: $0.46
  - Риски: $0.00

Расписание обслуживания (длительность 3 ч):
  Слот  0 ( 0.0ч): Обслуживание | Электр: $0.072/кВт⋅ч
  Слот  1 ( 1.0ч): Обслуживание | Электр: $0.073/кВт⋅ч
  Слот  2 ( 2.0ч): Обслуживание | Электр: $0.074/кВт⋅ч
```

## Theoretical Background

The implementation demonstrates several key concepts:

1. **Discrete Time Formulation**: Time is discretized into slots for computational tractability
2. **Mixed Integer Linear Programming**: Binary variables for scheduling decisions with linear objective
3. **Risk-Cost Trade-off**: Balances immediate costs against future failure risks
4. **Rolling Horizon**: Can be extended to receding horizon optimization

The model can serve as a foundation for more complex energy systems optimization problems.

## License

This project is for educational and research purposes.

## Contributing

Contributions are welcome! Areas for extension:
- Additional cost factors (demand charges, battery degradation)
- Multi-equipment scheduling
- Stochastic optimization for uncertain prices
- Integration with real-time energy market data