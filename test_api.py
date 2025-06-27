#!/usr/bin/env python3
"""
Test script for the BESS Optimization Web Service
"""

import requests
import json
import time
import subprocess
import threading
import sys
import os

def start_server():
    """Start the Flask server in the background"""
    try:
        return subprocess.Popen([sys.executable, 'app.py'], 
                               stdout=subprocess.PIPE, 
                               stderr=subprocess.PIPE)
    except Exception as e:
        print(f"Failed to start server: {e}")
        return None

def test_health_endpoint():
    """Test the health check endpoint"""
    try:
        response = requests.get('http://localhost:5000/health', timeout=5)
        if response.status_code == 200:
            print("✓ Health check passed")
            print(f"  Response: {response.json()}")
            return True
        else:
            print(f"✗ Health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ Health check failed: {e}")
        return False

def test_example_endpoint():
    """Test the example endpoint"""
    try:
        response = requests.get('http://localhost:5000/optimize/example', timeout=5)
        if response.status_code == 200:
            print("✓ Example endpoint passed")
            return response.json()
        else:
            print(f"✗ Example endpoint failed: {response.status_code}")
            return None
    except Exception as e:
        print(f"✗ Example endpoint failed: {e}")
        return None

def test_optimization_endpoint():
    """Test the main optimization endpoint"""
    # Use a smaller example for faster testing
    test_data = {
        "electricity_prices": {
            "0": 0.06, "1": 0.05, "2": 0.04, "3": 0.04,
            "4": 0.05, "5": 0.06, "6": 0.08, "7": 0.12,
            "8": 0.18, "9": 0.22, "10": 0.16, "11": 0.12
        },
        "labor_costs": {
            "0": 0.4, "1": 0.4, "2": 0.4, "3": 0.4,
            "4": 0.4, "5": 0.3, "6": 0.3, "7": 0.3,
            "8": 0.1, "9": 0.1, "10": 0.1, "11": 0.1
        },
        "maintenance_durations": [2, 1]
    }
    
    try:
        print("Testing optimization endpoint...")
        response = requests.post('http://localhost:5000/optimize',
                               json=test_data,
                               headers={'Content-Type': 'application/json'},
                               timeout=30)
        
        if response.status_code == 200:
            result = response.json()
            print("✓ Optimization endpoint passed")
            print(f"  Status: {result.get('status')}")
            
            if result.get('status') == 'success':
                results = result.get('results', {})
                print(f"  Total cost: ${results.get('total_cost', 0):.2f}")
                print(f"  Number of events: {results.get('num_events', 0)}")
                
                for event in results.get('events', []):
                    print(f"    Event {event.get('event_id')}: "
                          f"Start at slot {event.get('start_time')} "
                          f"(${event.get('total_cost', 0):.2f})")
            
            return True
        else:
            print(f"✗ Optimization endpoint failed: {response.status_code}")
            print(f"  Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"✗ Optimization endpoint failed: {e}")
        return False

def main():
    """Main test function"""
    print("BESS Optimization API Test")
    print("=" * 40)
    
    # Start server
    print("Starting Flask server...")
    server_process = start_server()
    
    if not server_process:
        print("Failed to start server")
        return
    
    # Wait for server to start
    time.sleep(3)
    
    try:
        # Test endpoints
        health_ok = test_health_endpoint()
        
        if health_ok:
            example_data = test_example_endpoint()
            optimization_ok = test_optimization_endpoint()
            
            if optimization_ok:
                print("\n✓ All tests passed!")
            else:
                print("\n✗ Some tests failed")
        else:
            print("\n✗ Server not responding")
    
    finally:
        # Clean up
        print("\nShutting down server...")
        server_process.terminate()
        server_process.wait()

if __name__ == "__main__":
    main()