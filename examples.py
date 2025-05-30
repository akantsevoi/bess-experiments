#!/usr/bin/env python3
"""
Examples demonstrating different scenarios for maintenance optimization
"""

from model import MaintenanceOptimizer
import numpy as np

def example_1_basic():
    """
    Example 1: Basic optimization with default settings
    """
    print("\n" + "="*60)
    print("ПРИМЕР 1: Базовая оптимизация")
    print("EXAMPLE 1: Basic optimization")
    print("="*60)
    
    optimizer = MaintenanceOptimizer(horizon_hours=24, time_slot_hours=1.0)
    optimizer.generate_sample_data()
    optimizer.build_model()
    
    success = optimizer.solve(verbose=False)
    if success:
        optimizer.print_results()
    else:
        print("Оптимизация не удалась")

def example_2_high_risk():
    """
    Example 2: High failure risk scenario
    """
    print("\n" + "="*60)
    print("ПРИМЕР 2: Высокий риск отказов")
    print("EXAMPLE 2: High failure risk scenario")
    print("="*60)
    
    optimizer = MaintenanceOptimizer(horizon_hours=24, time_slot_hours=1.0)
    
    # Generate base data
    optimizer.generate_sample_data()
    
    # Increase failure rates significantly
    high_risk_rates = {}
    for t in optimizer.T:
        # Much higher risk growth rate
        high_risk_rates[t] = 0.01 * (1 + 0.1 * t)  # 10x higher base rate
    
    optimizer.set_failure_rates(high_risk_rates)
    optimizer.build_model()
    
    success = optimizer.solve(verbose=False)
    if success:
        print("С высоким риском отказов система предпочитает раннее обслуживание")
        optimizer.print_results()
    else:
        print("Оптимизация не удалась")

def example_3_volatile_prices():
    """
    Example 3: Very volatile electricity prices
    """
    print("\n" + "="*60)
    print("ПРИМЕР 3: Волатильные цены на электричество")
    print("EXAMPLE 3: Volatile electricity prices")
    print("="*60)
    
    optimizer = MaintenanceOptimizer(horizon_hours=24, time_slot_hours=1.0)
    
    # Create very volatile price pattern
    volatile_prices = {}
    base_price = 0.10
    for t in optimizer.T:
        # Random spikes in electricity prices
        price_multiplier = 1.0 + 2.0 * np.sin(t * 0.8) + 0.5 * np.sin(t * 2.1)
        if price_multiplier < 0.3:
            price_multiplier = 0.3  # Minimum price
        volatile_prices[t] = base_price * price_multiplier
    
    optimizer.set_electricity_prices(volatile_prices)
    
    # Set minimal failure rates
    low_risk_rates = {t: 0.0001 * (1 + 0.001 * t) for t in optimizer.T}
    optimizer.set_failure_rates(low_risk_rates)
    
    optimizer.build_model()
    
    success = optimizer.solve(verbose=False)
    if success:
        print("При волатильных ценах система ищет периоды низких цен")
        optimizer.print_results()
    else:
        print("Оптимизация не удалась")

def example_4_different_horizons():
    """
    Example 4: Compare different planning horizons
    """
    print("\n" + "="*60)
    print("ПРИМЕР 4: Сравнение разных горизонтов планирования")
    print("EXAMPLE 4: Comparing different planning horizons")
    print("="*60)
    
    horizons = [12, 24, 48]
    
    for horizon in horizons:
        print(f"\n--- Горизонт планирования: {horizon} часов ---")
        
        optimizer = MaintenanceOptimizer(horizon_hours=horizon, time_slot_hours=1.0)
        optimizer.generate_sample_data()
        optimizer.build_model()
        
        success = optimizer.solve(verbose=False)
        if success:
            results = optimizer.get_results()
            print(f"Оптимальный старт: слот {results.get('start_time', 'N/A')} "
                  f"({results.get('start_hour', 'N/A')} ч)")
            print(f"Общие затраты: ${results.get('total_cost', 0):.2f}")
        else:
            print("Оптимизация не удалась")

def example_5_equipment_comparison():
    """
    Example 5: Compare different equipment power consumption
    """
    print("\n" + "="*60)
    print("ПРИМЕР 5: Сравнение оборудования с разным энергопотреблением")
    print("EXAMPLE 5: Equipment with different power consumption")
    print("="*60)
    
    power_levels = [1.0, 2.1, 5.0, 10.0]  # kWh
    
    for power in power_levels:
        print(f"\n--- Энергопотребление: {power} кВт⋅ч ---")
        
        optimizer = MaintenanceOptimizer(horizon_hours=24, time_slot_hours=1.0)
        optimizer.E_aux = power  # Set different power consumption
        optimizer.generate_sample_data()
        optimizer.build_model()
        
        success = optimizer.solve(verbose=False)
        if success:
            results = optimizer.get_results()
            print(f"Оптимальный старт: слот {results.get('start_time', 'N/A')}")
            print(f"Затраты на электричество: ${results.get('electricity_cost', 0):.2f}")
            print(f"Общие затраты: ${results.get('total_cost', 0):.2f}")
        else:
            print("Оптимизация не удалась")

def main():
    """
    Run all examples
    """
    print("ДЕМОНСТРАЦИЯ СИСТЕМЫ ОПТИМИЗАЦИИ ОБСЛУЖИВАНИЯ")
    print("MAINTENANCE OPTIMIZATION SYSTEM EXAMPLES")
    print("="*60)
    
    try:
        example_1_basic()
        example_2_high_risk()
        example_3_volatile_prices()
        example_4_different_horizons()
        example_5_equipment_comparison()
        
        print("\n" + "="*60)
        print("Все примеры выполнены успешно!")
        print("All examples completed successfully!")
        print("="*60)
        
    except Exception as e:
        print(f"Ошибка в примерах: {e}")

if __name__ == "__main__":
    main() 