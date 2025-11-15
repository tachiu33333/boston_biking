import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'pk.eyJ1IjoidGFjaGl1IiwiYSI6ImNtaHdpbGxraDAwMWoybHBtbzlyM3Z5bWEifQ.KBIIWJTkra-eFISEizvq9A';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// Shared style for bike lanes
const bikeLaneStyle = {
  'line-color': '#32D400',  // A bright green using hex code
  'line-width': 5,          // Thicker lines
  'line-opacity': 0.6       // Slightly less transparent
};

// Helper function to convert coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Helper function to format time
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Helper function to get minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Function to compute station traffic
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Function to filter trips by time
function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

map.on('load', async () => {
    console.log('Map loaded successfully');
    
    // Boston bike lanes
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
      });
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: bikeLaneStyle
      });
    console.log('Boston bike lanes added');
    
    // Cambridge bike lanes
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
      });
    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': '#FF6B6B',
            'line-width': 5,
            'line-opacity': 0.6
        }
      });
    console.log('Cambridge bike lanes added');
    
    try {
        const jsonurl = 'https://gbfs.bluebikes.com/gbfs/en/station_information.json';
        const jsonData = await d3.json(jsonurl);
        console.log('Loaded JSON Data:', jsonData);
        console.log('Number of stations:', jsonData.data.stations.length);
        
        // Load traffic data
        let trips = await d3.csv(
          'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
          (trip) => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            return trip;
          },
        );
        console.log('Loaded trips:', trips.length);
        
        let stations = computeStationTraffic(jsonData.data.stations, trips);
        console.log('Stations Array:', stations);
        console.log('Sample station:', stations[0]);
        
        // Create radius scale
        const radiusScale = d3
          .scaleSqrt()
          .domain([0, d3.max(stations, (d) => d.totalTraffic)])
          .range([0, 25]);
        
        console.log('Radius scale domain:', radiusScale.domain());
        
        // Create station flow scale
        let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
        
        // Select SVG and add circles
        const svg = d3.select('#map').select('svg');
        console.log('SVG element:', svg.node());
        
        const circles = svg
          .selectAll('circle')
          .data(stations, (d) => d.short_name)
          .enter()
          .append('circle')
          .attr('class', 'station-circle')
          .attr('r', (d) => {
            const r = radiusScale(d.totalTraffic);
            console.log(`Station ${d.name}: radius=${r}, traffic=${d.totalTraffic}`);
            return r;
          })
          .attr('opacity', 0.8)
          .style('--departure-ratio', (d) =>
            stationFlow(d.departures / d.totalTraffic),
          )
          .on('mouseenter', function(event, d) {
            d3.select(this).attr('opacity', 1).attr('stroke-width', 3);
            
            // Create popup
            const popup = new mapboxgl.Popup({
              closeButton: false,
              closeOnClick: false,
              offset: 15
            })
              .setLngLat([+d.lon, +d.lat])
              .setHTML(`
                <strong>${d.name}</strong><br/>
                ${d.totalTraffic} trips<br/>
                ${d.departures} departures<br/>
                ${d.arrivals} arrivals
              `)
              .addTo(map);
            
            d3.select(this).datum().popup = popup;
          })
          .on('mouseleave', function(event, d) {
            d3.select(this).attr('opacity', 0.8).attr('stroke-width', 2);
            
            const stationData = d3.select(this).datum();
            if (stationData.popup) {
              stationData.popup.remove();
              delete stationData.popup;
            }
          });
        
        console.log('Number of circles created:', circles.size());
        
        // Function to update circle positions
        function updatePositions() {
          circles
            .attr('cx', (d) => getCoords(d).cx)
            .attr('cy', (d) => getCoords(d).cy);
        }
        
        updatePositions();
        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);
        
        // Time slider controls
        const timeSlider = document.querySelector('#time-slider');
        const selectedTime = document.querySelector('#selected-time');
        const anyTimeLabel = document.querySelector('#any-time');
        
        function updateScatterPlot(timeFilter) {
          const filteredTrips = filterTripsbyTime(trips, timeFilter);
          const filteredStations = computeStationTraffic(stations, filteredTrips);
          
          timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
          
          circles
            .data(filteredStations, (d) => d.short_name)
            .attr('r', (d) => radiusScale(d.totalTraffic))
            .style('--departure-ratio', (d) =>
              stationFlow(d.departures / d.totalTraffic),
            );
          
          // Remove old tooltips when data updates
          circles.each(function(d) {
            if (d.popup) {
              d.popup.remove();
              delete d.popup;
            }
          });
        }
        
        function updateTimeDisplay() {
          let timeFilter = Number(timeSlider.value);
          
          if (timeFilter === -1) {
            selectedTime.textContent = '';
            anyTimeLabel.style.display = 'block';
          } else {
            selectedTime.textContent = formatTime(timeFilter);
            anyTimeLabel.style.display = 'none';
          }
          
          updateScatterPlot(timeFilter);
        }
        
        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();
        
    } catch (error) {
        console.error('Error loading data:', error);
    }
  });