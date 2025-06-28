#!/usr/bin/env python3
"""
BESS Maintenance Optimization Model
MaintenanceOptimizer class for optimal maintenance window scheduling
"""

import pulp
from typing import Dict, List
import os


class MaintenanceOptimizer:
    """
    Simplified maintenance window optimizer - LEARNING VERSION
    Considers electricity costs and labor costs
    """
    
    def __init__(self, electricity_prices: Dict[int, float] = None, 
                 labor_costs: Dict[int, float] = None, 
                 maintenance_durations: List[int] = None):
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
            
        # Set labor costs
        if labor_costs is not None:
            self.P_labor = labor_costs
        else:
            self.P_labor = {}  # empty dict, must be set later
        
        # PuLP model
        self.model = None
        self.results = None
        
    def set_electricity_prices(self, prices: Dict[int, float]):
        """Set electricity prices for each time slot"""
        self.P_elec = prices
        
    def set_labor_costs(self, costs: Dict[int, float]):
        """Set labor costs for each time slot"""
        self.P_labor = costs
        
    def build_model(self):
        """
        Build the SIMPLIFIED MILP optimization model for MULTIPLE maintenance events
        Minimizes electricity costs + labor costs!
        """
        # Validate that prices are set
        if not self.P_elec:
            raise ValueError("Electricity prices must be set before building model. "
                           "Pass prices to constructor or use set_electricity_prices().")
        
        if not self.P_labor:
            raise ValueError("Labor costs must be set before building model. "
                           "Pass costs to constructor or use set_labor_costs().")
        
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
        
        # UPDATED Objective Function - electricity costs + labor costs for ALL events!
        electricity_costs = pulp.lpSum([
            self.y[i][t] * self.P_elec.get(t, 0)
            for i in range(self.num_maintenance_events)
            for t in self.T
        ])
        
        labor_costs = pulp.lpSum([
            self.y[i][t] * self.P_labor.get(t, 0)
            for i in range(self.num_maintenance_events)
            for t in self.T
        ])
        
        total_costs = electricity_costs + labor_costs
        self.model += total_costs
        
        print(f"Model built with {len(self.T)} time slots and {self.num_maintenance_events} maintenance events")
        print("Objective: Minimize TOTAL electricity costs + labor costs across all maintenance events")
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
            
            # Calculate costs for this event
            if start_times:
                service_times = [t for t in self.T if service_schedule[t]]
                elec_cost = sum(self.P_elec.get(t, 0) for t in service_times)
                labor_cost = sum(self.P_labor.get(t, 0) for t in service_times)
                total_cost = elec_cost + labor_cost
                
                event_result['electricity_cost'] = elec_cost
                event_result['labor_cost'] = labor_cost
                event_result['total_cost'] = total_cost
            
            results['events'].append(event_result)
        
        # Total cost across all events
        results['total_cost'] = pulp.value(self.model.objective)
        
        # Breakdown of total costs
        total_elec = sum(event.get('electricity_cost', 0) for event in results['events'])
        total_labor = sum(event.get('labor_cost', 0) for event in results['events'])
        results['total_electricity_cost'] = total_elec
        results['total_labor_cost'] = total_labor
        
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
        print("(Electricity costs + Labor costs)")
        print("="*60)
        
        print(f"Total cost across all events: ${results['total_cost']:.2f}")
        print(f"  - Total electricity cost: ${results.get('total_electricity_cost', 0):.2f}")
        print(f"  - Total labor cost: ${results.get('total_labor_cost', 0):.2f}")
        print(f"Number of maintenance events: {self.num_maintenance_events}")
        
        # Show results for each event
        for i, event in enumerate(results['events']):
            print(f"\n--- Maintenance Event {i+1} (Duration: {event.get('duration', 'N/A')}h) ---")
            
            if 'start_time' in event:
                print(f"Start time: slot {event['start_time']} ({event['start_hour']:.1f}h)")
                print(f"End time: slot {event['end_time']} ({event['end_hour']:.1f}h)")
                print(f"Total cost: ${event.get('total_cost', 0):.2f}")
                print(f"  - Electricity: ${event.get('electricity_cost', 0):.2f}")
                print(f"  - Labor: ${event.get('labor_cost', 0):.2f}")
                
                # Show detailed schedule for this event
                schedule = event.get('service_schedule', {})
                active_slots = [t for t in self.T if schedule.get(t, False)]
                if active_slots:
                    print(f"Active slots: {active_slots}")
                    for t in active_slots:
                        hour = t * self.dt
                        elec_price = self.P_elec.get(t, 0)
                        labor_price = self.P_labor.get(t, 0)
                        total_price = elec_price + labor_price
                        print(f"  Slot {t:2d} ({hour:4.1f}h): Elec ${elec_price:.3f}/kWh + Labor ${labor_price:.3f}/h = ${total_price:.3f}/h")
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
                elec_price = self.P_elec.get(t, 0)
                labor_price = self.P_labor.get(t, 0)
                total_price = elec_price + labor_price
                print(f"  Slot {t:2d} ({hour:4.1f}h): {', '.join(event_labels)} | "
                      f"Elec: ${elec_price:.3f}/kWh, Labor: ${labor_price:.3f}/h, Total: ${total_price:.3f}/h")
        else:
            print("No maintenance scheduled")
    
