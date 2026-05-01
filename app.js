(function () {
  'use strict';

  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
  ];

  const statusEl = document.getElementById('status');
  const refreshBtn = document.getElementById('refresh-btn');
  const radiusEl = document.getElementById('radius');
  const resultsList = document.getElementById('results-list');
  const emptyState = document.getElementById('empty-state');

  let map;
  let userMarker;
  let resultMarkersLayer;
  let lastCoords = null;

  function setStatus(message, isError) {
    statusEl.textContent = message || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function initMap() {
    map = L.map('map', {
      zoomControl: true,
      attributionControl: true
    }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    resultMarkersLayer = L.layerGroup().addTo(map);
  }

  function getLocation() {
    return new Promise(function (resolve, reject) {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation is not supported by your browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        },
        function (err) {
          let msg = 'Could not get your location.';
          if (err.code === 1) msg = 'Location permission denied. Please allow location access.';
          else if (err.code === 2) msg = 'Location unavailable. Try again outside or with better signal.';
          else if (err.code === 3) msg = 'Location request timed out.';
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  function buildOverpassQuery(lat, lon, radius) {
    return (
      '[out:json][timeout:25];' +
      '(' +
        'node["diet:gluten_free"~"yes|only"](around:' + radius + ',' + lat + ',' + lon + ');' +
        'way["diet:gluten_free"~"yes|only"](around:' + radius + ',' + lat + ',' + lon + ');' +
        'node["cuisine"~"gluten_free",i](around:' + radius + ',' + lat + ',' + lon + ');' +
      ');' +
      'out center tags;'
    );
  }

  async function queryOverpass(query) {
    let lastError;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query)
        });
        if (!response.ok) {
          lastError = new Error('Overpass returned ' + response.status);
          continue;
        }
        return await response.json();
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Could not reach Overpass API.');
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = function (deg) { return deg * Math.PI / 180; };
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(km) {
    if (km < 1) return Math.round(km * 1000) + ' m';
    return km.toFixed(km < 10 ? 1 : 0) + ' km';
  }

  function buildAddress(tags) {
    if (!tags) return '';
    const parts = [];
    if (tags['addr:housenumber'] && tags['addr:street']) {
      parts.push(tags['addr:housenumber'] + ' ' + tags['addr:street']);
    } else if (tags['addr:street']) {
      parts.push(tags['addr:street']);
    }
    if (tags['addr:city']) parts.push(tags['addr:city']);
    if (tags['addr:state']) parts.push(tags['addr:state']);
    if (tags['addr:postcode']) parts.push(tags['addr:postcode']);
    return parts.join(', ');
  }

  function normalizeElement(el, userLat, userLon) {
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
    const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (lat == null || lon == null) return null;
    const tags = el.tags || {};
    return {
      id: el.type + '/' + el.id,
      lat: lat,
      lon: lon,
      name: tags.name || 'Unnamed place',
      cuisine: tags.cuisine || '',
      amenity: tags.amenity || '',
      address: buildAddress(tags),
      glutenFree: tags['diet:gluten_free'] || (tags.cuisine && /gluten_free/i.test(tags.cuisine) ? 'yes' : ''),
      distanceKm: haversineKm(userLat, userLon, lat, lon),
      website: tags.website || tags['contact:website'] || '',
      phone: tags.phone || tags['contact:phone'] || ''
    };
  }

  function renderResults(places, userCoords) {
    resultsList.innerHTML = '';
    resultMarkersLayer.clearLayers();

    if (!places.length) {
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;

    const bounds = L.latLngBounds([userCoords.lat, userCoords.lon], [userCoords.lat, userCoords.lon]);

    places.forEach(function (place) {
      const li = document.createElement('li');
      li.className = 'result-item';
      li.tabIndex = 0;
      li.setAttribute('role', 'button');

      const tagClass = place.glutenFree === 'only' ? 'tag-only' : 'tag-yes';
      const tagText = place.glutenFree === 'only' ? 'Gluten free only' : 'Gluten free options';

      li.innerHTML =
        '<div class="name"></div>' +
        '<div class="meta">' +
          '<span class="type"></span>' +
          '<span class="distance"></span>' +
        '</div>' +
        '<div class="address"></div>' +
        '<span class="tag ' + tagClass + '"></span>';

      li.querySelector('.name').textContent = place.name;
      li.querySelector('.type').textContent = (place.amenity || 'place').replace(/_/g, ' ');
      li.querySelector('.distance').textContent = formatDistance(place.distanceKm);
      li.querySelector('.address').textContent = place.address || 'Address not listed';
      li.querySelector('.tag').textContent = tagText;

      li.addEventListener('click', function () { focusPlace(place); });
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          focusPlace(place);
        }
      });
      resultsList.appendChild(li);

      const marker = L.marker([place.lat, place.lon]).bindPopup(buildPopupHtml(place));
      resultMarkersLayer.addLayer(marker);
      bounds.extend([place.lat, place.lon]);
    });

    if (places.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }

  function buildPopupHtml(place) {
    const wrapper = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = place.name;
    wrapper.appendChild(name);

    if (place.address) {
      const addr = document.createElement('div');
      addr.textContent = place.address;
      addr.style.fontSize = '0.85rem';
      addr.style.marginTop = '4px';
      wrapper.appendChild(addr);
    }

    const dist = document.createElement('div');
    dist.textContent = formatDistance(place.distanceKm) + ' away';
    dist.style.fontSize = '0.8rem';
    dist.style.marginTop = '4px';
    dist.style.color = '#1b5e20';
    wrapper.appendChild(dist);

    const directions = document.createElement('a');
    directions.href = 'https://www.openstreetmap.org/?mlat=' + place.lat + '&mlon=' + place.lon + '#map=18/' + place.lat + '/' + place.lon;
    directions.target = '_blank';
    directions.rel = 'noopener';
    directions.textContent = 'Open in map';
    directions.style.display = 'inline-block';
    directions.style.marginTop = '6px';
    wrapper.appendChild(directions);

    return wrapper;
  }

  function focusPlace(place) {
    map.setView([place.lat, place.lon], 17);
    resultMarkersLayer.eachLayer(function (layer) {
      const ll = layer.getLatLng();
      if (ll.lat === place.lat && ll.lng === place.lon) {
        layer.openPopup();
      }
    });
  }

  function placeUserMarker(coords) {
    const latlng = [coords.lat, coords.lon];
    if (userMarker) {
      userMarker.setLatLng(latlng);
    } else {
      const userIcon = L.divIcon({
        className: 'user-location-marker',
        html: '<div style="background:#1976d2;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px #1976d2;"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      userMarker = L.marker(latlng, { icon: userIcon, zIndexOffset: 1000 })
        .bindPopup('You are here')
        .addTo(map);
    }
    map.setView(latlng, 14);
  }

  async function refresh() {
    refreshBtn.disabled = true;
    setStatus('Getting your location...');
    try {
      const coords = await getLocation();
      lastCoords = coords;
      placeUserMarker(coords);

      const radius = parseInt(radiusEl.value, 10) || 5000;
      setStatus('Searching gluten-free places within ' + (radius / 1000) + ' km...');

      const data = await queryOverpass(buildOverpassQuery(coords.lat, coords.lon, radius));
      const elements = (data && data.elements) || [];

      const places = elements
        .map(function (el) { return normalizeElement(el, coords.lat, coords.lon); })
        .filter(function (p) { return p && p.distanceKm * 1000 <= radius; })
        .sort(function (a, b) { return a.distanceKm - b.distanceKm; });

      renderResults(places, coords);
      setStatus('Found ' + places.length + ' place' + (places.length === 1 ? '' : 's') + '.');
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Something went wrong.', true);
      renderResults([], lastCoords || { lat: 0, lon: 0 });
    } finally {
      refreshBtn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMap();
    refreshBtn.addEventListener('click', refresh);
    radiusEl.addEventListener('change', function () {
      if (lastCoords) refresh();
    });
    refresh();
  });
})();
