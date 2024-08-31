console.log("app.js starting to load");

let map;
let marker;
let pathLine;
let allPositions = [];
let socket;
let currentAircraft = null;
let showFullTrail = false;
let userInteracted = false;
let userSetZoom = false;
let initialZoom = 4; // Set to show entire US

function checkAuthentication() {
    return fetch('/api/check_auth')
        .then(response => {
            if (response.status === 401) {
                throw new Error('Not authenticated');
            }
            return response.json();
        });
}

function initMap() {
    console.log("initMap function called");
    if (map) {
        map.remove();
    }
    map = L.map('map').setView([39.8283, -98.5795], initialZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    map.on('zoomend dragend', function() {
        userInteracted = true;
        showFullTrail = false; // Disable full trail view on manual interaction
    });
    
    console.log("Map initialized");
}

function initMapControls() {
    console.log("Initializing map controls");
    document.getElementById('zoomToRadius').addEventListener('click', zoomToRadius);
    document.getElementById('centerAircraft').addEventListener('click', centerAircraft);
    document.getElementById('showFullTrail').addEventListener('click', toggleShowFullTrail);
    document.getElementById('resetZoom').addEventListener('click', resetZoom);
}

function zoomToRadius() {
    console.log("Zoom to radius clicked");
    if (marker) {
        const position = marker.getLatLng();
        const radiusInMeters = 250 * 1609.34; // 250 miles in meters
        map.fitBounds(L.latLng(position).toBounds(radiusInMeters));
        userInteracted = true;
        showFullTrail = false;
        updateShowFullTrailButton();
    }
}

function centerAircraft() {
    console.log("Center aircraft clicked");
    if (marker) {
        map.panTo(marker.getLatLng());
        userInteracted = true;
        showFullTrail = false;
        updateShowFullTrailButton();
    }
}

function toggleShowFullTrail() {
    console.log("Toggle show full trail clicked");
    showFullTrail = !showFullTrail;
    userInteracted = false;
    if (showFullTrail && pathLine) {
        map.fitBounds(pathLine.getBounds());
    }
}

function resetZoom() {
    console.log("Reset zoom clicked");
    if (marker) {
        map.setView(marker.getLatLng(), initialZoom);
        userInteracted = true;
        showFullTrail = false;
        updateShowFullTrailButton();
    }
}

function createAirplaneIcon(rotation) {
    return L.divIcon({
        html: `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" style="transform: rotate(${rotation}deg);">
                <path fill="#3388ff" d="M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z" />
            </svg>
        `,
        className: 'aircraft-icon',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
    });
}

function initSocket() {
    console.log('Initializing socket connection');
    socket = io({
        path: '/socket.io',
        transports: ['websocket', 'polling']
    });
    
    socket.on('connect', () => {
        console.log('Connected to server via WebSocket');
    });

    socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
    });

    socket.on('aircraft_update', (data) => {
        console.log('Received aircraft update:', data);
        updateAircraftData(data);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from WebSocket server');
    });
}

function updateAircraftData(aircraft) {
    console.log('Updating aircraft data:', aircraft);
    displayPrimaryResult(aircraft);
    updateMap(aircraft);
}

function searchAircraft(aircraftId) {
    console.log("Searching for aircraft:", aircraftId);
    showLoading('Searching for aircraft...');
    clearResults();
    if (currentAircraft !== aircraftId) {
        if (currentAircraft) {
            stopTracking(currentAircraft);
        }
        currentAircraft = aircraftId;
    }

    userInteracted = false;
    showFullTrail = false;
    updateShowFullTrailButton();

    checkAuthentication()
        .then(() => {
            return fetch('/api/aircraft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ searchType: 'registration', searchValue: aircraftId }),
            });
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateAircraftData(data.data);
                startTracking(aircraftId);
            } else {
                showError(data.message || 'No aircraft found');
            }
            hideLoading();
        })
        .catch(error => {
            console.error('Error:', error);
            hideLoading();
            showError(`An error occurred: ${error.message}. Please try again.`);
        });
}

function startTracking(aircraftId) {
    if (socket && socket.connected) {
        console.log('Starting tracking for:', aircraftId);
        socket.emit('start_tracking', { registration: aircraftId });
        allPositions = []; // Reset positions when starting new tracking
        if (pathLine) {
            map.removeLayer(pathLine);
            pathLine = null;
        }
        if (marker) {
            map.removeLayer(marker);
            marker = null;
        }
        userInteracted = false;
        showFullTrail = false;
        updateShowFullTrailButton();
    } else {
        console.log('Socket not connected. Reconnecting...');
        socket.connect();
    }
}


function stopTracking(aircraftId) {
    if (socket) {
        console.log('Stopping tracking for:', aircraftId);
        socket.emit('stop_tracking', { registration: aircraftId });
    }
}

function updateMap(aircraft) {
    if (aircraft.lat && aircraft.lon) {
        const position = [aircraft.lat, aircraft.lon];
        allPositions.push(position);

        if (!marker) {
            marker = L.marker(position, {
                icon: createAirplaneIcon(aircraft.track || 0)
            }).addTo(map);
            map.setView(position, initialZoom);
        } else {
            marker.setLatLng(position);
            marker.setIcon(createAirplaneIcon(aircraft.track || 0));
        }

        if (!pathLine) {
            pathLine = L.polyline(allPositions, {color: 'red'}).addTo(map);
        } else {
            pathLine.setLatLngs(allPositions);
        }

        if (showFullTrail) {
            map.fitBounds(pathLine.getBounds());
        } else if (!userInteracted) {
            map.panTo(position);
        }
    }
}

function toggleShowFullTrail() {
    console.log("Toggle show full trail clicked");
    showFullTrail = !showFullTrail;
    userInteracted = false;
    if (showFullTrail && pathLine) {
        map.fitBounds(pathLine.getBounds());
    }
    updateShowFullTrailButton();
}

function updateShowFullTrailButton() {
    const button = document.getElementById('showFullTrail');
    if (button) {
        button.textContent = showFullTrail ? 'Disable Full Trail' : 'Show Full Trail';
        button.classList.toggle('active', showFullTrail);
    }
}

function displayPrimaryResult(aircraft) {
    console.log("Displaying primary result:", aircraft);
    const resultDiv = document.getElementById('primaryResult');
    resultDiv.innerHTML = `
        <div class="result-container">
            <div class="primary-info">
                <span><strong>Registration:</strong> ${aircraft.r || 'N/A'}</span>
                <span><strong>Type:</strong> ${aircraft.t || 'N/A'}</span>
                <span><strong>Flight:</strong> ${aircraft.flight ? aircraft.flight.trim() : 'N/A'}</span>
            </div>
            <div class="secondary-info">
                <span><strong>Alt:</strong> ${aircraft.alt_baro || 'N/A'} ft</span>
                <span><strong>Speed:</strong> ${aircraft.gs || 'N/A'} kts</span>
                <span><strong>Heading:</strong> ${aircraft.track || 'N/A'}°</span>
                <span><strong>Lat:</strong> ${aircraft.lat || 'N/A'}</span>
                <span><strong>Lon:</strong> ${aircraft.lon || 'N/A'}</span>
            </div>
        </div>
    `;
}

function showLoading(message) {
    const loadingDiv = document.getElementById('loading');
    loadingDiv.textContent = message;
    loadingDiv.style.display = 'block';
}

function hideLoading() {
    const loadingDiv = document.getElementById('loading');
    loadingDiv.style.display = 'none';
}

function showError(message) {
    const resultDiv = document.getElementById('primaryResult');
    resultDiv.innerHTML = `<p class="error-message">${message}</p>`;
}

function clearResults() {
    const resultDiv = document.getElementById('primaryResult');
    resultDiv.innerHTML = '';
}

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed");
    initMap();
    initSocket();
    initMapControls();
    updateShowFullTrailButton();

    checkAuthentication()
        .then(() => {
            console.log("User authenticated");
        })
        .catch(() => {
            console.log("User not authenticated");
            window.location.href = '/login';
        });

    const tabButtons = document.querySelectorAll('.tab-button');
    const manualEntryContainer = document.getElementById('manualEntryContainer');
    const manualAircraftInput = document.getElementById('manualAircraftInput');
    const manualSearchButton = document.getElementById('manualSearchButton');

    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            const aircraftId = this.dataset.aircraft;
            if (aircraftId === 'manual') {
                manualEntryContainer.style.display = 'flex';
                resetTracking();
            } else {
                manualEntryContainer.style.display = 'none';
                searchAircraft(aircraftId);
            }
        });
    });

    if (manualSearchButton) {
        manualSearchButton.addEventListener('click', function() {
            const manualAircraftId = manualAircraftInput.value.trim();
            if (manualAircraftId) {
                searchAircraft(manualAircraftId);
            } else {
                showError('Please enter an aircraft ID');
            }
        });
    }
});

console.log("app.js finished loading");