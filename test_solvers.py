#!/usr/bin/env python3
"""
Test script to check available solvers and configure CBC
"""

import pyomo.environ as pyo
import os

def test_solvers():
    """Test common MILP solvers"""
    solvers_to_test = ['cbc', 'glpk', 'gurobi', 'cplex', 'scip']
    
    print("Testing solvers...")
    available_solvers = []
    
    for solver_name in solvers_to_test:
        try:
            solver = pyo.SolverFactory(solver_name)
            if solver.available():
                print(f"✓ {solver_name}: Available")
                available_solvers.append(solver_name)
            else:
                print(f"✗ {solver_name}: Not available")
        except Exception as e:
            print(f"✗ {solver_name}: Error - {e}")
    
    # Test with explicit CBC path
    print("\nTesting with explicit CBC path...")
    try:
        cbc_path = "/usr/bin/coin.cbc"
        if os.path.exists(cbc_path):
            print(f"Found CBC at: {cbc_path}")
            solver = pyo.SolverFactory('cbc', executable=cbc_path)
            print(f"CBC with explicit path available: {solver.available()}")
            if solver.available():
                available_solvers.append('cbc_explicit')
        else:
            print("CBC executable not found at /usr/bin/coin.cbc")
    except Exception as e:
        print(f"Error with explicit CBC path: {e}")
    
    return available_solvers

if __name__ == "__main__":
    available = test_solvers()
    print(f"\nAvailable solvers: {available}") 