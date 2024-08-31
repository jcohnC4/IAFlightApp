import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template, session, redirect, url_for
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import requests
import logging
import threading
from functools import wraps

load_dotenv()  # This loads the variables from .env

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
logging.basicConfig(level=logging.DEBUG)

# Load environment variables
RAPIDAPI_KEY = os.getenv('RAPIDAPI_KEY')
RAPIDAPI_HOST = os.getenv('RAPIDAPI_HOST')
APP_PASSWORD = os.getenv('APP_PASSWORD')
SECRET_KEY = os.getenv('SECRET_KEY')

# Check if all required environment variables are set
if not all([RAPIDAPI_KEY, RAPIDAPI_HOST, APP_PASSWORD, SECRET_KEY]):
    raise ValueError("Missing required environment variables. Please check your .env file.")

app.secret_key = SECRET_KEY

active_trackers = {}

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('authenticated'):
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/api/check_auth')
def check_auth():
    if 'authenticated' in session and session['authenticated']:
        return jsonify({"authenticated": True}), 200
    else:
        return jsonify({"authenticated": False}), 401

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form['password'] == APP_PASSWORD:
            session['authenticated'] = True
            next_page = request.args.get('next')
            return redirect(next_page or url_for('index'))
        else:
            return 'Invalid password', 401
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('authenticated', None)
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/api/aircraft', methods=['POST'])
@login_required
def get_aircraft_data():
    app.logger.info("Received request to /api/aircraft")
    try:
        data = request.json
        app.logger.info(f"Request data: {data}")
        search_type = data['searchType']
        search_value = data['searchValue']

        url = f"https://{RAPIDAPI_HOST}/v2/{search_type}/{search_value}/"
        
        headers = {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": RAPIDAPI_HOST
        }

        app.logger.info(f"Sending request to: {url}")
        response = requests.get(url, headers=headers)
        app.logger.info(f"Response status code: {response.status_code}")
        app.logger.info(f"Response content: {response.text}")

        response.raise_for_status()
        json_response = response.json()
        
        if 'ac' in json_response and json_response['ac']:
            aircraft = json_response['ac'][0]
            app.logger.info(f"Aircraft found: {aircraft}")
            return jsonify({"success": True, "data": aircraft})
        else:
            app.logger.warning("No aircraft found in the response")
            return jsonify({"success": False, "message": "No aircraft found. The aircraft may not be airborne or transmitting data at this time."})

    except Exception as e:
        app.logger.error(f"An error occurred: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500

@socketio.on('connect')
def handle_connect():
    app.logger.info("Client connected")

@socketio.on('disconnect')
def handle_disconnect():
    app.logger.info("Client disconnected")

@socketio.on('start_tracking')
def start_tracking(data):
    app.logger.info(f"Start tracking received for: {data}")
    registration = data['registration']
    
    if registration in active_trackers:
        active_trackers[registration].set()  # Stop the previous tracker
    
    stop_event = threading.Event()
    active_trackers[registration] = stop_event
    
    def background_task():
        while not stop_event.is_set():
            aircraft_data = fetch_aircraft_data(registration)
            if aircraft_data:
                app.logger.info(f"Emitting aircraft update for {registration}")
                socketio.emit('aircraft_update', aircraft_data)
            socketio.sleep(1)  # Update every 1 second

    socketio.start_background_task(background_task)

@socketio.on('stop_tracking')
def stop_tracking(data):
    registration = data['registration']
    if registration in active_trackers:
        active_trackers[registration].set()  # Signal the thread to stop
        del active_trackers[registration]
        app.logger.info(f"Stopped tracking {registration}")

def fetch_aircraft_data(registration):
    url = f"https://{RAPIDAPI_HOST}/v2/registration/{registration}/"
    headers = {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": RAPIDAPI_HOST
    }
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        if 'ac' in data and data['ac']:
            return data['ac'][0]
    except Exception as e:
        app.logger.error(f"Error fetching data for {registration}: {str(e)}")
    return None

if __name__ == '__main__':
    app.logger.info("Starting the application")
    app.logger.info(f"RAPIDAPI_HOST: {RAPIDAPI_HOST}")  # Log the host (don't log the key for security reasons)
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)