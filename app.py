#!/usr/bin/env python3
"""
BESS Maintenance Optimization Web Service
Flask API wrapper for the MaintenanceOptimizer model
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from model import MaintenanceOptimizer
import traceback
from typing import Dict, List, Optional

app = Flask(__name__)
CORS(app)

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "service": "BESS Optimization API"})

@app.route('/optimize', methods=['POST'])
def optimize_maintenance():
    """
    Main optimization endpoint
    
    Expected JSON payload:
    {
        "electricity_prices": {
            "0": 0.06,
            "1": 0.05,
            ...
        },
        "labor_costs": {
            "0": 0.4,
            "1": 0.4,
            ...
        },
        "maintenance_durations": [2, 1, 3]
    }
    """
    try:
        # Validate request
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        
        data = request.get_json()
        
        # Extract parameters
        electricity_prices = data.get('electricity_prices', {})
        labor_costs = data.get('labor_costs', {})
        maintenance_durations = data.get('maintenance_durations', [1])
        
        # Validate required parameters
        if not electricity_prices:
            return jsonify({"error": "electricity_prices is required"}), 400
        
        if not labor_costs:
            return jsonify({"error": "labor_costs is required"}), 400
        
        # Convert string keys to integers for prices (JSON keys are strings)
        electricity_prices = {int(k): float(v) for k, v in electricity_prices.items()}
        labor_costs = {int(k): float(v) for k, v in labor_costs.items()}
        
        # Validate that both price dictionaries have the same time slots
        elec_slots = set(electricity_prices.keys())
        labor_slots = set(labor_costs.keys())
        if elec_slots != labor_slots:
            return jsonify({
                "error": "electricity_prices and labor_costs must have the same time slots",
                "electricity_slots": sorted(elec_slots),
                "labor_slots": sorted(labor_slots)
            }), 400
        
        # Create and run optimizer
        optimizer = MaintenanceOptimizer(
            electricity_prices=electricity_prices,
            labor_costs=labor_costs,
            maintenance_durations=maintenance_durations
        )
        
        optimizer.build_model()
        success = optimizer.solve(verbose=False)
        
        if success:
            results = optimizer.get_results()
            
            # Convert results to JSON-serializable format
            json_results = format_results_for_json(results)
            
            return jsonify({
                "status": "success",
                "results": json_results
            })
        else:
            return jsonify({
                "status": "failed",
                "error": "Optimization failed to find a solution"
            }), 500
            
    except ValueError as e:
        return jsonify({"error": f"Validation error: {str(e)}"}), 400
    except Exception as e:
        return jsonify({
            "error": f"Internal server error: {str(e)}",
            "traceback": traceback.format_exc()
        }), 500

def format_results_for_json(results: Dict) -> Dict:
    """Convert optimization results to JSON-serializable format"""
    json_results = {
        "total_cost": results.get('total_cost', 0),
        "total_electricity_cost": results.get('total_electricity_cost', 0),
        "total_labor_cost": results.get('total_labor_cost', 0),
        "num_events": len(results.get('events', [])),
        "events": [],
        "combined_schedule": results.get('combined_schedule', {})
    }
    
    # Format each maintenance event
    for i, event in enumerate(results.get('events', [])):
        formatted_event = {
            "event_id": i + 1,
            "duration": event.get('duration', 0),
            "start_time": event.get('start_time'),
            "start_hour": event.get('start_hour'),
            "end_time": event.get('end_time'),
            "end_hour": event.get('end_hour'),
            "electricity_cost": event.get('electricity_cost', 0),
            "labor_cost": event.get('labor_cost', 0),
            "total_cost": event.get('total_cost', 0),
            "service_schedule": event.get('service_schedule', {})
        }
        json_results["events"].append(formatted_event)
    
    return json_results

@app.route('/optimize/example', methods=['GET'])
def get_example_request():
    """
    Returns an example request payload for the optimization endpoint
    """
    example = {
        "electricity_prices": {
        "0": 0.06,   "1": 0.05,   "2": 0.04,   "3": 0.04,  
        "4": 0.05,   "5": 0.06,   "6": 0.08,   "7": 0.12, 
        "8": 0.18,   "9": 0.22,   "10": 0.16,  "11": 0.12,          
        "12": 0.00,  "13": 0.13,  "14": 0.11,  "15": 0.13,  
        "16": 0.15,  "17": 0.19,  "18": 0.21,  "19": 0.20,            
        "20": 0.17,  "21": 0.14,  "22": 0.11,  "23": 0.09,  
        "24": 0.08,  "25": 0.09,  "26": 0.10,  "27": 0.11, 
        "28": 0.12,  "29": 0.13,  "30": 0.81,  "31": 0.85,
        "32": 0.84,  "33": 0.83,  "34": 0.10,  "35": 0.05,
        "36": 0.08,  "37": 0.05,  "38": 0.05,  "39": 0.05,
        "40": 0.46,  "41": 0.78,  "42": 0.89,  "43": 0.78,
        "44": 0.50,  "45": 0.47,  "46": 0.47,  "47": 0.45
    },
        "labor_costs": {
        "0":  0.4,   "1": 0.4,   "2": 0.4,   "3": 0.4,  
        "4":  0.4,   "5": 0.3,   "6": 0.3,   "7": 0.3,  
        "8":  0.1,   "9": 0.1,  "10": 0.1,  "11": 0.1,  
        "12": 0.1,  "13": 0.1,  "14": 0.1,  "15": 0.1,  
        "16": 0.1,  "17": 0.1,  "18": 0.3,  "19": 0.3,            
        "20": 0.3,  "21": 0.3,  "22": 0.3,  "23": 0.4,  
        "24": 0.4,  "25": 0.4,  "26": 0.4,  "27": 0.4,  
        "28": 0.4,  "29": 0.4,  "30": 0.4,  "31": 0.4, 
        "32": 0.1,  "33": 0.1,  "34": 0.1,  "35": 0.1, 
        "36": 0.1,  "37": 0.1,  "38": 0.1,  "39": 0.1, 
        "40": 0.1,  "41": 0.1,  "42": 0.4,  "43": 0.4,  
        "44": 0.4,  "45": 0.4,  "46": 0.4,  "47": 0.4
    },
        "maintenance_durations": [2, 1, 3]
    }
    
    return jsonify({
        "description": "Example request payload for POST /optimize",
        "example_request": example,
        "usage": "Send this JSON payload to POST /optimize to run optimization"
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)