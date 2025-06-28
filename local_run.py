#!/usr/bin/env python3
"""
Simplified Energy System Maintenance Optimization - LEARNING VERSION
Optimal Energy System Maintenance Window Scheduling

Simplified version using electricity prices and labor costs for easier learning.
Finds the cheapest time window to perform maintenance.
"""

from model import MaintenanceOptimizer
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
from typing import Tuple


def plot_results(optimizer: MaintenanceOptimizer, figsize: Tuple[int, int] = (12, 8)):
    """
    Visualize multiple maintenance events optimization results with electricity and labor costs
    """
    results = optimizer.get_results()
    if not results:
        print("No results to visualize")
        return
    
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=figsize)
    
    hours = [t * optimizer.dt for t in optimizer.T]
    elec_prices = [optimizer.P_elec.get(t, 0) for t in optimizer.T]
    labor_prices = [optimizer.P_labor.get(t, 0) for t in optimizer.T]
    total_prices = [elec_prices[i] + labor_prices[i] for i in range(len(hours))]
    
    # 1. Electricity prices as bar chart
    ax1.bar(hours, elec_prices, width=1.0, color='skyblue', edgecolor='blue', alpha=0.7, label='Electricity Price')
    ax1.set_xlabel('Time (hours)')
    ax1.set_ylabel('Price ($/kWh)')
    ax1.set_title('Electricity Prices Over Time')
    ax1.grid(True, alpha=0.3, axis='y')
    ax1.legend()
    
    # 2. Labor costs as bar chart
    ax2.bar(hours, labor_prices, width=1.0, color='lightcoral', edgecolor='red', alpha=0.7, label='Labor Cost')
    ax2.set_xlabel('Time (hours)')
    ax2.set_ylabel('Cost ($/hour)')
    ax2.set_title('Labor Costs Over Time')
    ax2.grid(True, alpha=0.3, axis='y')
    ax2.legend()
    
    # 3. Combined costs with maintenance events schedule
    colors = ['orange', 'green', 'red', 'purple', 'brown', 'pink']  # Different colors for events
    
    # Plot total costs as stacked bar chart
    ax3.bar(hours, elec_prices, width=1.0, color='skyblue', edgecolor='blue', alpha=0.7, label='Electricity Price')
    ax3.bar(hours, labor_prices, width=1.0, bottom=elec_prices, color='lightcoral', edgecolor='red', alpha=0.7, label='Labor Cost')
    
    # Plot each maintenance event as filled rectangles AT THE BOTTOM
    maintenance_height = max(total_prices) * 0.3  # Height of each maintenance bar
    y_offset = -max(total_prices) * 0.05  # Start position below the x-axis
    
    for i, event in enumerate(results['events']):
        schedule = event.get('service_schedule', {})
        
        if any(schedule.get(t, False) for t in optimizer.T):  # Only plot if there's maintenance scheduled
            color = colors[i % len(colors)]
            duration = event.get('duration', 'N/A')
            total_cost = event.get('total_cost', 0)
            elec_cost = event.get('electricity_cost', 0)
            labor_cost = event.get('labor_cost', 0)
            
            # All events on the same horizontal line
            y_position = y_offset
            
            # Find continuous maintenance periods for this event
            maintenance_periods = []
            start_time = None
            
            for t in optimizer.T:
                if schedule.get(t, False):  # Maintenance is active
                    if start_time is None:
                        start_time = t
                else:  # Maintenance is not active
                    if start_time is not None:
                        maintenance_periods.append((start_time, t - 1))
                        start_time = None
            
            # Handle case where maintenance continues to the end
            if start_time is not None:
                maintenance_periods.append((start_time, optimizer.T[-1]))
            
            # Draw rectangles for each maintenance period at the bottom
            for start_t, end_t in maintenance_periods:
                start_hour = start_t * optimizer.dt - 0.5  # Align with full-width bars
                end_hour = (end_t + 1) * optimizer.dt - 0.5  # +1 to include the end slot
                width = end_hour - start_hour
                
                # Create rectangle at the bottom on the same line
                rect = plt.Rectangle((start_hour, y_position), width, maintenance_height, 
                                   alpha=0.5, facecolor=color, 
                                   edgecolor='black', linewidth=1)
                ax3.add_patch(rect)
            
            # Add label (only once per event)
            ax3.plot([], [], color=color, alpha=0.8, linewidth=10,
                    label=f'Event {i+1} ({duration}h, ${total_cost:.2f}: ${elec_cost:.2f}+${labor_cost:.2f})')
    
    ax3.set_xlabel('Time (hours)')
    ax3.set_ylabel('Cost ($/hour)')
    ax3.set_title(f'Optimal Maintenance Windows for {optimizer.num_maintenance_events} Events (Total Costs)')
    ax3.grid(True, alpha=0.3, axis='y')
    ax3.legend()
    
    # Adjust y-limits to show maintenance windows at bottom
    min_y = y_offset - max(total_prices) * 0.05
    ax3.set_ylim(min_y, max(total_prices) * 1.1)
    
    plt.tight_layout()
    
    # Save the plot
    plot_filename = 'multiple_maintenance_results.png'
    plt.savefig(plot_filename, dpi=150, bbox_inches='tight')
    print(f"Plot saved as: {plot_filename}")
    plt.close()


def main():
    """
    Main function to demonstrate the multiple maintenance events optimizer with labor costs
    """
    print("MULTIPLE MAINTENANCE EVENTS Optimization")
    print("Learning Version - Electricity Costs + Labor Costs")
    print("="*60)
    
    # Example electricity prices for 48 hours
    # Simulating a typical daily pattern: cheap at night, expensive during peaks
    example_elec_prices = {
        0: 0.06,   1: 0.05,   2: 0.04,   3: 0.04,   # Night: cheap
        4: 0.05,   5: 0.06,   6: 0.08,   7: 0.12,   # Early morning: rising
        8: 0.18,   9: 0.22,   10: 0.16,             # Morning peak: expensive
        11: 0.12,  12: 0.00,  13: 0.13,             # Midday: moderate  
        14: 0.11,  15: 0.13,  16: 0.15,             # Afternoon: rising
        17: 0.19,  18: 0.21,  19: 0.20,             # Evening peak: expensive
        20: 0.17,  21: 0.14,  22: 0.11,  23: 0.09,  # Evening: falling

        24: 0.08,  25: 0.09,  26: 0.10,  27: 0.11, # in total - 48 hours
        28: 0.12,  29: 0.13,  30: 0.81,  31: 0.85,
        32: 0.84,  33: 0.83,  34: 0.10,  35: 0.05,
        36: 0.08,  37: 0.05,  38: 0.05,  39: 0.05,
        40: 0.46,  41: 0.78,  42: 0.89,  43: 0.78,
        44: 0.50,  45: 0.47,  46: 0.47,  47: 0.45,
    }
    
    # Example labor costs for 48 hours
    # Simulating labor cost pattern: expensive during weekdays/daytime, cheaper at night/weekends
    example_labor_costs = {
        0:  0.4,   1: 0.4,   2: 0.4,   3: 0.4,   # Night: standard night rate
        4:  0.4,   5: 0.3,   6: 0.3,   7: 0.3,   # Early morning: increasing
        8:  0.1,   9: 0.1,  10: 0.1,            # Morning: peak rate
        11: 0.1,  12: 0.1,  13: 0.1,            # Midday: peak rate  
        14: 0.1,  15: 0.1,  16: 0.1,            # Afternoon: peak rate
        17: 0.1,  18: 0.3,  19: 0.3,            # Evening: decreasing
        20: 0.3,  21: 0.3,  22: 0.3,  23: 0.4,  # Evening: standard

        24: 0.4,  25: 0.4,  26: 0.4,  27: 0.4,  # Weekend night: cheaper
        28: 0.4,  29: 0.4,  30: 0.4,  31: 0.4,  # Weekend morning: moderate
        32: 0.1,  33: 0.1,  34: 0.1,  35: 0.1,  # Weekend day: moderate
        36: 0.1,  37: 0.1,  38: 0.1,  39: 0.1,  # Weekend afternoon: moderate
        40: 0.1,  41: 0.1,  42: 0.4,  43: 0.4,  # Weekend evening: cheaper
        44: 0.4,  45: 0.4,  46: 0.4,  47: 0.4,  # Weekend night: cheaper
    }
    
    print("Using example electricity prices:")
    print("Night (0-3h): $0.04-0.06/kWh (cheapest)")
    print("Morning peak (8-10h): $0.16-0.22/kWh (expensive)")
    print("Evening peak (17-19h): $0.19-0.21/kWh (expensive)")
    
    print("\nUsing example labor costs:")
    print("Night (0-3h): $25/hour (standard night rate)")
    print("Weekday peak (8-16h): $50/hour (peak rate)")
    print("Weekend (24-47h): $20-40/hour (cheaper rates)")
    
    # Example: Schedule multiple maintenance events with different durations
    maintenance_durations = [2, 1, 3,1]  # 2-hour, 1-hour, and 3-hour maintenance
    
    print(f"\nScheduling {len(maintenance_durations)} maintenance events:")
    for i, duration in enumerate(maintenance_durations):
        print(f"  Event {i+1}: {duration} hour(s)")
    
    # Create optimizer with multiple maintenance durations and both cost types
    optimizer = MaintenanceOptimizer(
        electricity_prices=example_elec_prices,
        labor_costs=example_labor_costs,
        maintenance_durations=maintenance_durations
    )
    
    # Build and solve model
    optimizer.build_model()
    success = optimizer.solve(verbose=False)
    
    if success:
        # Show results
        optimizer.print_results()
        
        # Visualize
        plot_results(optimizer)
        
        print("\n" + "="*60)
        print("🎓 LEARNING NOTE:")
        print("The optimizer found the cheapest time windows considering BOTH electricity and labor costs!")
        print("Notice how it balances between cheap electricity times and cheap labor times.")
        print("Try changing the cost patterns to see how the solution changes.")
        print("="*60)
    else:
        print("Could not find optimal solution")


if __name__ == "__main__":
    main()
