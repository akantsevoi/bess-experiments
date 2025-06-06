#!/usr/bin/env python3
"""
Simplified Energy System Maintenance Optimization - LEARNING VERSION
Optimal Energy System Maintenance Window Scheduling

Simplified version using ONLY electricity prices for easier learning.
Finds the cheapest time window to perform maintenance.
"""

import pulp
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import os


class MaintenanceOptimizer:
    """
    Simplified maintenance window optimizer - LEARNING VERSION
    Only considers electricity costs (no failure risks)
    """
    
    def __init__(self, electricity_prices: Dict[int, float] = None, maintenance_durations: List[int] = None):
        self.H = len(electricity_prices) if electricity_prices else 24  # planning horizon
        self.dt = 1.0  # time step
        self.T = list(range(int(self.H / self.dt)))  # time slots
        
        # Maintenance durations for multiple events
        if maintenance_durations is not None:
            self.L_list = maintenance_durations  # List of maintenance durations
        else:
            self.L_list = [1]  # Default: single 1-hour maintenance
        
        self.num_maintenance_events = len(self.L_list)  # Number of maintenance events
        
        # Set electricity prices
        if electricity_prices is not None:
            self.P_elec = electricity_prices
        else:
            self.P_elec = {}  # empty dict, must be set later
        
        # PuLP model
        self.model = None
        self.results = None
        
    def set_electricity_prices(self, prices: Dict[int, float]):
        """Set electricity prices for each time slot"""
        self.P_elec = prices
        
    def build_model(self):
        """
        Build the SIMPLIFIED MILP optimization model for MULTIPLE maintenance events
        Only minimizes electricity costs!
        """
        # Validate that prices are set
        if not self.P_elec:
            raise ValueError("Electricity prices must be set before building model. "
                           "Pass prices to constructor or use set_electricity_prices().")
        
        print("Building simplified MILP model for MULTIPLE maintenance events...")
        print(f"Number of maintenance events: {self.num_maintenance_events}")
        print(f"Maintenance durations: {self.L_list} hours")
        
        # Create PuLP model
        self.model = pulp.LpProblem("MultipleMaintenanceOptimization", pulp.LpMinimize)
        
        # Variables for each maintenance event
        # x[i][t] = 1 if maintenance event i starts at time slot t
        self.x = {}
        for i in range(self.num_maintenance_events):
            self.x[i] = pulp.LpVariable.dicts(f"start_event_{i}", self.T, cat='Binary')
        
        # y[i][t] = 1 if maintenance event i is active at time slot t  
        self.y = {}
        for i in range(self.num_maintenance_events):
            self.y[i] = pulp.LpVariable.dicts(f"maintenance_event_{i}", self.T, cat='Binary')
        
        # Constraints
        
        # 1. Link between start and active maintenance for each event
        # forces to keep maintenance intervals(for the same event) far enough so they don't overlap 
        # if there are several possible windows of them
        # because otherwise y[i][t] would not be equal 1
        for i in range(self.num_maintenance_events):
            L = self.L_list[i]
            for t in self.T:
                # y[i][t] = 1 if we started maintenance event i within the last L hours
                start_times = [tau for tau in self.T if 0 <= t - tau < L]
                self.model += self.y[i][t] == pulp.lpSum([self.x[i][tau] for tau in start_times])
        
        # 2. Must start each maintenance event exactly once
        for i in range(self.num_maintenance_events):
            self.model += pulp.lpSum([self.x[i][t] for t in self.T]) == 1
        
        # 3. Ensure each maintenance event can complete within time horizon
        for i in range(self.num_maintenance_events):
            L = self.L_list[i]
            for t in self.T:
                if t + L > len(self.T):  # Not enough time slots remaining
                    self.model += self.x[i][t] == 0  # Cannot start maintenance at this time
        
        # 4. NEW: No overlap between maintenance events
        # At most one maintenance event can be active at any time slot
        for t in self.T:
            self.model += pulp.lpSum([self.y[i][t] for i in range(self.num_maintenance_events)]) <= 1
        
        # SIMPLIFIED Objective Function - ONLY electricity costs for ALL events!
        electricity_costs = pulp.lpSum([
            self.y[i][t] * self.P_elec.get(t, 0)
            for i in range(self.num_maintenance_events)
            for t in self.T
        ])
        
        self.model += electricity_costs
        
        print(f"Model built with {len(self.T)} time slots and {self.num_maintenance_events} maintenance events")
        print("Objective: Minimize TOTAL electricity costs across all maintenance events")
        print("Constraint: No maintenance events can overlap")
        
    def solve(self, verbose: bool = True):
        """
        Solve the optimization model
        """
        if self.model is None:
            raise ValueError("Model not built. Call build_model() first.")
        
        print("Solving model with CBC...")
        
        try:
            # Check for CBC in standard location
            cbc_path = "/usr/bin/coin.cbc"
            if os.path.exists(cbc_path):
                solver = pulp.COIN_CMD(path=cbc_path, msg=verbose)
            else:
                solver = pulp.COIN_CMD(msg=verbose)
            
            # Check solver availability
            if not solver.available():
                print("⚠ CBC solver not available, trying others...")
                # Try other available solvers
                for solver_class in [pulp.PULP_CBC_CMD, pulp.GLPK_CMD]:
                    solver = solver_class(msg=verbose)
                    if solver.available():
                        break
                else:
                    print("⚠ No available solvers")
                    return False
            
            # Solve model
            self.model.solve(solver)
            
            # Check solution status
            if pulp.LpStatus[self.model.status] == 'Optimal':
                print("✓ Found optimal solution!")
                return True
            else:
                print(f"⚠ No solution found: {pulp.LpStatus[self.model.status]}")
                return False
                
        except Exception as e:
            print(f"Error solving: {e}")
            return False
    
    def get_results(self) -> Dict:
        """
        Extract optimization results for multiple maintenance events
        """
        if self.model is None:
            return {}
        
        results = {}
        
        # Results for each maintenance event
        results['events'] = []
        
        for i in range(self.num_maintenance_events):
            event_result = {}
            
            # Find maintenance start time for this event
            start_times = [t for t in self.T if self.x[i][t].varValue and self.x[i][t].varValue > 0.5]
            if start_times:
                event_result['start_time'] = start_times[0]
                event_result['start_hour'] = start_times[0] * self.dt
                event_result['duration'] = self.L_list[i]
                event_result['end_time'] = start_times[0] + self.L_list[i] - 1
                event_result['end_hour'] = (start_times[0] + self.L_list[i] - 1) * self.dt
            
            # Maintenance schedule for this event
            service_schedule = {t: self.y[i][t].varValue and self.y[i][t].varValue > 0.5 for t in self.T}
            event_result['service_schedule'] = service_schedule
            
            # Calculate electricity cost for this event
            if start_times:
                service_times = [t for t in self.T if service_schedule[t]]
                elec_cost = sum(self.P_elec.get(t, 0) for t in service_times)
                event_result['electricity_cost'] = elec_cost
            
            results['events'].append(event_result)
        
        # Total cost across all events
        results['total_cost'] = pulp.value(self.model.objective)
        
        # Combined schedule showing all events
        combined_schedule = {}
        for t in self.T:
            active_events = [i for i in range(self.num_maintenance_events) 
                           if self.y[i][t].varValue and self.y[i][t].varValue > 0.5]
            combined_schedule[t] = active_events  # List of active event indices
        results['combined_schedule'] = combined_schedule
        
        return results
    
    def print_results(self):
        """Print optimization results for multiple maintenance events"""
        results = self.get_results()
        
        if not results:
            print("No results to display")
            return
        
        print("\n" + "="*60)
        print("MULTIPLE MAINTENANCE EVENTS OPTIMIZATION RESULTS")
        print("(Electricity costs only)")
        print("="*60)
        
        print(f"Total electricity cost across all events: ${results['total_cost']:.2f}")
        print(f"Number of maintenance events: {self.num_maintenance_events}")
        
        # Show results for each event
        for i, event in enumerate(results['events']):
            print(f"\n--- Maintenance Event {i+1} (Duration: {event.get('duration', 'N/A')}h) ---")
            
            if 'start_time' in event:
                print(f"Start time: slot {event['start_time']} ({event['start_hour']:.1f}h)")
                print(f"End time: slot {event['end_time']} ({event['end_hour']:.1f}h)")
                print(f"Cost: ${event.get('electricity_cost', 0):.2f}")
                
                # Show detailed schedule for this event
                schedule = event.get('service_schedule', {})
                active_slots = [t for t in self.T if schedule.get(t, False)]
                if active_slots:
                    print(f"Active slots: {active_slots}")
                    for t in active_slots:
                        hour = t * self.dt
                        print(f"  Slot {t:2d} ({hour:4.1f}h): Price ${self.P_elec.get(t, 0):.3f}/kWh")
            else:
                print("No solution found for this event")
        
        # Show combined timeline
        print(f"\n--- Combined Timeline ---")
        combined = results.get('combined_schedule', {})
        active_times = {t: events for t, events in combined.items() if events}
        
        if active_times:
            print("Time slots with maintenance:")
            for t in sorted(active_times.keys()):
                hour = t * self.dt
                events = active_times[t]
                event_labels = [f"Event{i+1}" for i in events]
                print(f"  Slot {t:2d} ({hour:4.1f}h): {', '.join(event_labels)} | "
                      f"Price: ${self.P_elec.get(t, 0):.3f}/kWh")
        else:
            print("No maintenance scheduled")
    
    def plot_results(self, figsize: Tuple[int, int] = (12, 6)):
        """
        Visualize multiple maintenance events optimization results
        """
        results = self.get_results()
        if not results:
            print("No results to visualize")
            return
        
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=figsize)
        
        hours = [t * self.dt for t in self.T]
        elec_prices = [self.P_elec.get(t, 0) for t in self.T]
        
        # 1. Electricity prices as bar chart
        ax1.bar(hours, elec_prices, width=1.0, color='skyblue', edgecolor='blue', alpha=0.7, label='Electricity Price')
        ax1.set_xlabel('Time (hours)')
        ax1.set_ylabel('Price ($/kWh)')
        ax1.set_title('Electricity Prices Over Time')
        ax1.grid(True, alpha=0.3, axis='y')
        ax1.legend()
        
        # 2. Multiple maintenance events schedule - MODIFIED TO DRAW AT BOTTOM
        colors = ['orange', 'green', 'red', 'purple', 'brown', 'pink']  # Different colors for events
        
        # Plot electricity prices as bar chart (same style as first chart)
        ax2.bar(hours, elec_prices, width=1.0, color='skyblue', edgecolor='blue', alpha=0.7, label='Electricity Price')
        
        # Plot each maintenance event as filled rectangles AT THE BOTTOM
        maintenance_height = 0.40  # Height of each maintenance bar
        y_offset = -0.05  # Start position below the x-axis
        
        for i, event in enumerate(results['events']):
            schedule = event.get('service_schedule', {})
            
            if any(schedule.get(t, False) for t in self.T):  # Only plot if there's maintenance scheduled
                color = colors[i % len(colors)]
                duration = event.get('duration', 'N/A')
                cost = event.get('electricity_cost', 0)
                
                # All events on the same horizontal line
                y_position = y_offset
                
                # Find continuous maintenance periods for this event
                maintenance_periods = []
                start_time = None
                
                for t in self.T:
                    if schedule.get(t, False):  # Maintenance is active
                        if start_time is None:
                            start_time = t
                    else:  # Maintenance is not active
                        if start_time is not None:
                            maintenance_periods.append((start_time, t - 1))
                            start_time = None
                
                # Handle case where maintenance continues to the end
                if start_time is not None:
                    maintenance_periods.append((start_time, self.T[-1]))
                
                # Draw rectangles for each maintenance period at the bottom
                for start_t, end_t in maintenance_periods:
                    start_hour = start_t * self.dt - 0.5  # Align with full-width bars
                    end_hour = (end_t + 1) * self.dt - 0.5  # +1 to include the end slot
                    width = end_hour - start_hour
                    
                    # Create rectangle at the bottom on the same line
                    rect = plt.Rectangle((start_hour, y_position), width, maintenance_height, 
                                       alpha=0.5, facecolor=color, 
                                       edgecolor='black', linewidth=1)
                    ax2.add_patch(rect)
                
                # Add label (only once per event)
                ax2.plot([], [], color=color, alpha=0.8, linewidth=10,
                        label=f'Event {i+1} ({duration}h, ${cost:.2f})')
        
        ax2.set_xlabel('Time (hours)')
        ax2.set_ylabel('Price ($/kWh)')
        ax2.set_title(f'Optimal Maintenance Windows for {self.num_maintenance_events} Events')
        ax2.grid(True, alpha=0.3, axis='y')
        ax2.legend()
        
        # Adjust y-limits to show maintenance windows at bottom
        min_y = y_offset - 0.05
        ax2.set_ylim(min_y, 1.1)
        
        plt.tight_layout()
        
        # Save the plot
        plot_filename = 'multiple_maintenance_results.png'
        plt.savefig(plot_filename, dpi=150, bbox_inches='tight')
        print(f"Plot saved as: {plot_filename}")
        plt.close()


def main():
    """
    Main function to demonstrate the multiple maintenance events optimizer
    """
    print("MULTIPLE MAINTENANCE EVENTS Optimization")
    print("Learning Version - Electricity Costs Only")
    print("="*60)
    
    # Example electricity prices for 24 hours
    # Simulating a typical daily pattern: cheap at night, expensive during peaks
    example_prices = {
        0: 0.06,   1: 0.05,   2: 0.04,   3: 0.04,   # Night: cheap
        4: 0.05,   5: 0.06,   6: 0.08,   7: 0.12,   # Early morning: rising
        8: 0.18,   9: 0.22,   10: 0.16,             # Morning peak: expensive
        11: 0.12,  12: 0.00,  13: 0.13,             # Midday: moderate  
        14: 0.11,  15: 0.13,  16: 0.15,             # Afternoon: rising
        17: 0.19,  18: 0.21,  19: 0.20,             # Evening peak: expensive
        20: 0.17,  21: 0.14,  22: 0.11,  23: 0.09,  # Evening: falling

        24: 0.08,  25: 0.09,  26: 0.10,  27: 0.11, # in total - 48 hours
        28: 0.12,  29: 0.13,  30: 1.19,  31: 1.47,
        32: 1.39,  33: 1.38,  34: 0.10,  35: 0.05,
        36: 0.08,  37: 0.05,  38: 0.05,  39: 0.05,
        40: 0.46,  41: 0.78,  42: 0.89,  43: 0.78,
        44: 0.50,  45: 0.47,  46: 0.47,  47: 0.45,
    }
    
    print("Using example electricity prices:")
    print("Night (0-3h): $0.04-0.06/kWh (cheapest)")
    print("Morning peak (8-10h): $0.16-0.22/kWh (expensive)")
    print("Evening peak (17-19h): $0.19-0.21/kWh (expensive)")
    
    # Example: Schedule multiple maintenance events with different durations
    maintenance_durations = [2, 1, 3]  # 2-hour, 1-hour, and 3-hour maintenance
    
    print(f"\nScheduling {len(maintenance_durations)} maintenance events:")
    for i, duration in enumerate(maintenance_durations):
        print(f"  Event {i+1}: {duration} hour(s)")
    
    # Create optimizer with multiple maintenance durations
    optimizer = MaintenanceOptimizer(
        electricity_prices=example_prices,
        maintenance_durations=maintenance_durations
    )
    
    # Build and solve model
    optimizer.build_model()
    success = optimizer.solve(verbose=False)
    
    if success:
        # Show results
        optimizer.print_results()
        
        # Visualize
        optimizer.plot_results()
        
        print("\n" + "="*60)
        print("🎓 LEARNING NOTE:")
        print("The optimizer found the cheapest time windows for ALL maintenance events!")
        print("Notice how it avoids overlaps and picks the cheapest available slots.")
        print("Try changing durations or prices to see how the solution changes.")
        print("="*60)
    else:
        print("Could not find optimal solution")


if __name__ == "__main__":
    main()
