#!/usr/bin/env python3
"""
Оптимальное планирование окон обслуживания энергетических систем
Optimal Energy System Maintenance Window Scheduling

Based on recommendations for MILP-based discrete optimal control approach.
Implements extensible cost function C_total = C_elec + C_risk
(Simplified version without labor costs for easier understanding)
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
    Класс для оптимизации планирования окон обслуживания энергосистем
    Maintenance window optimization for energy systems
    """
    
    def __init__(self, horizon_hours: int = 48, time_slot_hours: float = 1.0):
        """
        Инициализация оптимизатора
        
        Args:
            horizon_hours: Горизонт планирования в часах (planning horizon in hours)
            time_slot_hours: Дискретизация времени в часах (time discretization in hours)
        """
        self.H = horizon_hours  # горизонт планирования
        self.dt = time_slot_hours  # шаг дискретизации
        self.T = list(range(int(self.H / self.dt)))  # временные слоты
        
        # Параметры по умолчанию (default parameters)
        self.E_aux = 2.1  # потребление вспомогательного оборудования, кВт⋅ч
        self.L = 3  # длительность обслуживания, часов
        self.Cfail = 10000.0  # стоимость отказа
        
        # Данные временных рядов (time series data)
        self.P_elec = {}  # цены на электроэнергию
        self.lambda_failure = {}  # интенсивность отказов
        
        # PuLP модель
        self.model = None
        self.results = None
        
    def set_electricity_prices(self, prices: Dict[int, float]):
        """Установить цены на электроэнергию по временным слотам"""
        self.P_elec = prices
        
    def set_failure_rates(self, rates: Dict[int, float]):
        """Установить интенсивность отказов по временным слотам"""
        self.lambda_failure = rates
        
    def generate_sample_data(self):
        """
        Генерация примерных данных для демонстрации
        Generate sample data for demonstration
        """
        print("Генерирую примерные данные...")
        
        # Примерные цены на электроэнергию (волатильные цены в течение дня)
        base_price = 0.12  # $/кВт⋅ч
        peak_hours = [8, 9, 10, 17, 18, 19, 20]  # пиковые часы
        
        self.P_elec = {}
        self.lambda_failure = {}
        
        for t in self.T:
            hour_of_day = t % 24
            
            # Цена электроэнергии выше в пиковые часы
            if hour_of_day in peak_hours:
                self.P_elec[t] = base_price * (1.5 + 0.2 * np.sin(t * 0.1))
            elif 22 <= hour_of_day or hour_of_day <= 6:  # ночные часы
                self.P_elec[t] = base_price * (0.6 + 0.1 * np.sin(t * 0.1))
            else:
                self.P_elec[t] = base_price * (1.0 + 0.1 * np.sin(t * 0.1))
            
            # Интенсивность отказов растет с откладыванием обслуживания
            self.lambda_failure[t] = 0.001 * (1 + 0.01 * t)  # растущий риск
    
    def build_model(self):
        """
        Построение MILP модели оптимизации
        Build the MILP optimization model
        """
        print("Строю MILP модель...")
        
        # Создание модели PuLP
        self.model = pulp.LpProblem("MaintenanceOptimization", pulp.LpMinimize)
        
        # Переменные (Variables)
        # x[t] = 1 если обслуживание начинается в слоте t
        self.x = pulp.LpVariable.dicts("start", self.T, cat='Binary')
        
        # y[t] = 1 если идет обслуживание в слоте t  
        self.y = pulp.LpVariable.dicts("maintenance", self.T, cat='Binary')
        
        # Ограничения (Constraints)
        
        # 1. Связь между началом и процессом обслуживания
        for t in self.T:
            # y[t] = 1 если начали обслуживание в течение последних L часов
            start_times = [tau for tau in self.T if 0 <= t - tau < self.L]
            self.model += self.y[t] == pulp.lpSum([self.x[tau] for tau in start_times])
        
        # 2. Единственность окна обслуживания
        self.model += pulp.lpSum([self.x[t] for t in self.T]) == 1
        
        # Целевая функция (Objective Function)
        # Прямые затраты на электричество
        direct_costs = pulp.lpSum([
            self.y[t] * self.P_elec.get(t, 0) * self.E_aux
            for t in self.T
        ])
        
        # Риски отказов (растут с откладыванием обслуживания)
        risk_costs = pulp.lpSum([
            self.x[t] * self.lambda_failure.get(t, 0) * self.Cfail * t
            for t in self.T
        ])
        
        self.model += direct_costs + risk_costs
        
        print(f"Модель построена с {len(self.T)} временными слотами")
        
    def solve(self, verbose: bool = True):
        """
        Решение модели оптимизации
        Solve the optimization model
        """
        if self.model is None:
            raise ValueError("Модель не построена. Вызовите build_model() сначала.")
        
        print("Решаю модель с помощью cbc...")
        
        try:
            # Проверяем наличие CBC в стандартном месте
            cbc_path = "/usr/bin/coin.cbc"
            if os.path.exists(cbc_path):
                solver = pulp.COIN_CMD(path=cbc_path, msg=verbose)
            else:
                solver = pulp.COIN_CMD(msg=verbose)
            
            # Проверка доступности решателя
            if not solver.available():
                print("⚠ Решатель CBC недоступен, пробую другие...")
                # Попробуем другие доступные решатели
                for solver_class in [pulp.PULP_CBC_CMD, pulp.GLPK_CMD]:
                    solver = solver_class(msg=verbose)
                    if solver.available():
                        break
                else:
                    print("⚠ Нет доступных решателей")
                    return False
            
            # Решение модели
            self.model.solve(solver)
            
            # Проверка статуса решения
            if pulp.LpStatus[self.model.status] == 'Optimal':
                print("✓ Найдено оптимальное решение!")
                return True
            else:
                print(f"⚠ Решение не найдено: {pulp.LpStatus[self.model.status]}")
                return False
                
        except Exception as e:
            print(f"Ошибка при решении: {e}")
            return False
    
    def get_results(self) -> Dict:
        """
        Извлечение результатов оптимизации
        Extract optimization results
        """
        if self.model is None:
            return {}
        
        results = {}
        
        # Найти время начала обслуживания
        start_times = [t for t in self.T if self.x[t].varValue and self.x[t].varValue > 0.5]
        if start_times:
            results['start_time'] = start_times[0]
            results['start_hour'] = start_times[0] * self.dt
        
        # Расписание обслуживания
        service_schedule = {t: self.y[t].varValue and self.y[t].varValue > 0.5 for t in self.T}
        results['service_schedule'] = service_schedule
        
        # Значение целевой функции
        results['total_cost'] = pulp.value(self.model.objective)
        
        # Декомпозиция затрат
        if start_times:
            start_t = start_times[0]
            service_times = [t for t in self.T if service_schedule[t]]
            
            # Затраты на электричество
            elec_cost = sum(self.P_elec.get(t, 0) * self.E_aux for t in service_times)
            results['electricity_cost'] = elec_cost
            
            # Риски
            risk_cost = self.lambda_failure.get(start_t, 0) * self.Cfail * start_t
            results['risk_cost'] = risk_cost
        
        return results
    
    def print_results(self):
        """Вывод результатов оптимизации"""
        results = self.get_results()
        
        if not results:
            print("Нет результатов для вывода")
            return
        
        print("\n" + "="*50)
        print("РЕЗУЛЬТАТЫ ОПТИМИЗАЦИИ")
        print("="*50)
        
        if 'start_time' in results:
            print(f"Оптимальное время начала: слот {results['start_time']} "
                  f"({results['start_hour']:.1f} ч от текущего момента)")
        
        print(f"Общие затраты: ${results['total_cost']:.2f}")
        
        if 'electricity_cost' in results:
            print(f"  - Электричество: ${results['electricity_cost']:.2f}")
            print(f"  - Риски: ${results['risk_cost']:.2f}")
        
        # Показать расписание
        print(f"\nРасписание обслуживания (длительность {self.L} ч):")
        schedule = results.get('service_schedule', {})
        for t in self.T:
            if schedule.get(t, False):
                hour = t * self.dt
                print(f"  Слот {t:2d} ({hour:4.1f}ч): Обслуживание | "
                      f"Электр: ${self.P_elec.get(t, 0):.3f}/кВт⋅ч")
    
    def plot_results(self, figsize: Tuple[int, int] = (15, 5)):
        """
        Визуализация результатов оптимизации
        Plot optimization results
        """
        results = self.get_results()
        if not results:
            print("Нет результатов для визуализации")
            return
        
        fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=figsize)
        
        hours = [t * self.dt for t in self.T]
        
        # 1. Цены на электроэнергию
        elec_prices = [self.P_elec.get(t, 0) for t in self.T]
        ax1.plot(hours, elec_prices, 'b-', linewidth=2, label='Цена электричества')
        ax1.set_xlabel('Время (часы)')
        ax1.set_ylabel('Цена ($/кВт⋅ч)')
        ax1.set_title('Цены на электроэнергию')
        ax1.grid(True, alpha=0.3)
        ax1.legend()
        
        # 2. Интенсивность отказов
        failure_rates = [self.lambda_failure.get(t, 0) for t in self.T]
        ax2.plot(hours, failure_rates, 'r-', linewidth=2, label='Интенсивность отказов')
        ax2.set_xlabel('Время (часы)')
        ax2.set_ylabel('λ (1/час)')
        ax2.set_title('Риск отказов')
        ax2.grid(True, alpha=0.3)
        ax2.legend()
        
        # 3. Расписание обслуживания
        schedule = results.get('service_schedule', {})
        maintenance_mask = [1 if schedule.get(t, False) else 0 for t in self.T]
        
        ax3.fill_between(hours, 0, maintenance_mask, alpha=0.7, color='orange', 
                        label='Окно обслуживания')
        ax3.plot(hours, elec_prices, 'b--', alpha=0.5, label='Цена электричества')
        ax3.set_xlabel('Время (часы)')
        ax3.set_ylabel('Статус / Цена')
        ax3.set_title('Оптимальное окно обслуживания')
        ax3.grid(True, alpha=0.3)
        ax3.legend()
        
        plt.tight_layout()
        
        # Save the plot instead of showing it
        plot_filename = 'maintenance_optimization_results.png'
        plt.savefig(plot_filename, dpi=150, bbox_inches='tight')
        print(f"График сохранен как: {plot_filename}")
        plt.close()  # Close the figure to free memory


def main():
    """
    Главная функция для демонстрации работы оптимизатора
    Main function to demonstrate the optimizer
    """
    print("Система оптимизации планирования обслуживания энергосистем")
    print("Energy Systems Maintenance Optimization")
    print("="*60)
    
    # Создание оптимизатора
    optimizer = MaintenanceOptimizer(horizon_hours=48, time_slot_hours=1.0)
    
    # Генерация примерных данных
    optimizer.generate_sample_data()
    
    # Построение модели
    optimizer.build_model()
    
    # Решение модели
    success = optimizer.solve(verbose=False)
    
    if success:
        # Вывод результатов
        optimizer.print_results()
        
        # Визуализация
        optimizer.plot_results()
    else:
        print("Не удалось найти оптимальное решение")


if __name__ == "__main__":
    main()
