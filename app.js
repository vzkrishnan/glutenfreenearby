(function () {
  'use strict';

  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
  ];

  // Cuisines that commonly include naturally gluten-free dishes.
  // Used to expand the search beyond places explicitly tagged diet:gluten_free.
  const GF_FRIENDLY_CUISINES = [
    'indian',
    'thai',
    'vietnamese',
    'mexican',
    'japanese',
    'sushi',
    'korean',
    'chinese',
    'ethiopian',
    'lebanese',
    'mediterranean',
    'middle_eastern',
    'turkish',
    'greek',
    'persian',
    'african',
    'brazilian',
    'peruvian',
    'caribbean'
  ];

  const CUISINE_LABELS = {
    indian: 'Indian',
    thai: 'Thai',
    vietnamese: 'Vietnamese',
    mexican: 'Mexican',
    japanese: 'Japanese',
    sushi: 'Sushi / Japanese',
    korean: 'Korean',
    chinese: 'Chinese',
    ethiopian: 'Ethiopian',
    lebanese: 'Lebanese',
    mediterranean: 'Mediterranean',
    middle_eastern: 'Middle Eastern',
    turkish: 'Turkish',
    greek: 'Greek',
    persian: 'Persian',
    african: 'African',
    brazilian: 'Brazilian',
    peruvian: 'Peruvian',
    caribbean: 'Caribbean',
    italian: 'Italian',
    american: 'American',
    pizza: 'Pizza',
    burger: 'Burger',
    cafe: 'Café',
    coffee_shop: 'Coffee shop',
    bakery: 'Bakery',
    dessert: 'Dessert',
    breakfast: 'Breakfast',
    asian: 'Asian',
    fusion: 'Fusion',
    international: 'International',
    regional: 'Regional',
    vegetarian: 'Vegetarian',
    vegan: 'Vegan'
  };

  const statusEl = document.getElementById('status');
  const refreshBtn = document.getElementById('refresh-btn');
  const radiusEl = document.getElementById('radius');
  const cuisineEl = document.getElementById('cuisine');
  const includeFriendlyEl = document.getElementById('include-friendly');
  const resultsList = document.getElementById('results-list');
  const emptyState = document.getElementById('empty-state');

  let map;
  let userMarker;
  let resultMarkersLayer;
  let lastCoords = null;
  let lastPlaces = [];

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

  function buildOverpassQuery(lat, lon, radius, includeFriendly) {
    const around = 'around:' + radius + ',' + lat + ',' + lon;
    const parts = [
      'node["diet:gluten_free"~"yes|only"](' + around + ');',
      'way["diet:gluten_free"~"yes|only"](' + around + ');',
      'node["cuisine"~"gluten_free",i](' + around + ');',
      'way["cuisine"~"gluten_free",i](' + around + ');'
    ];

    if (includeFriendly) {
      const cuisineRegex = GF_FRIENDLY_CUISINES.join('|');
      parts.push('node["amenity"~"restaurant|cafe|fast_food"]["cuisine"~"' + cuisineRegex + '",i](' + around + ');');
      parts.push('way["amenity"~"restaurant|cafe|fast_food"]["cuisine"~"' + cuisineRegex + '",i](' + around + ');');
    }

    return '[out:json][timeout:25];(' + parts.join('') + ');out center tags;';
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

  // OSM cuisine tags can be semicolon-separated lists. Pick the first known
  // friendly cuisine, otherwise fall back to the first value.
  function pickPrimaryCuisine(rawCuisine) {
    if (!rawCuisine) return '';
    const values = rawCuisine.split(';').map(function (v) { return v.trim().toLowerCase(); }).filter(Boolean);
    if (!values.length) return '';
    for (const v of values) {
      if (GF_FRIENDLY_CUISINES.indexOf(v) !== -1) return v;
    }
    return values[0];
  }

  function cuisineLabel(key) {
    if (!key) return 'Other';
    if (CUISINE_LABELS[key]) return CUISINE_LABELS[key];
    return key.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function normalizeElement(el, userLat, userLon) {
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
    const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (lat == null || lon == null) return null;
    const tags = el.tags || {};
    const rawCuisine = tags.cuisine || '';
    const cuisineKey = pickPrimaryCuisine(rawCuisine);
    const dietTag = tags['diet:gluten_free'] || '';
    const cuisineMentionsGf = rawCuisine && /gluten_free/i.test(rawCuisine);
    let glutenFree = '';
    if (dietTag === 'only') glutenFree = 'only';
    else if (dietTag === 'yes' || cuisineMentionsGf) glutenFree = 'yes';
    else glutenFree = 'maybe';

    return {
      id: el.type + '/' + el.id,
      lat: lat,
      lon: lon,
      name: tags.name || 'Unnamed place',
      cuisineKey: cuisineKey,
      cuisineLabel: cuisineLabel(cuisineKey),
      amenity: tags.amenity || '',
      address: buildAddress(tags),
      glutenFree: glutenFree,
      distanceKm: haversineKm(userLat, userLon, lat, lon),
      website: tags.website || tags['contact:website'] || '',
      phone: tags.phone || tags['contact:phone'] || ''
    };
  }

  function updateCuisineDropdown(places) {
    const previous = cuisineEl.value;
    const counts = {};
    places.forEach(function (p) {
      const key = p.cuisineKey || '__other__';
      counts[key] = (counts[key] || 0) + 1;
    });

    const keys = Object.keys(counts).sort(function (a, b) {
      if (a === '__other__') return 1;
      if (b === '__other__') return -1;
      return cuisineLabel(a).localeCompare(cuisineLabel(b));
    });

    cuisineEl.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All cuisines (' + places.length + ')';
    cuisineEl.appendChild(allOpt);

    keys.forEach(function (key) {
      const opt = document.createElement('option');
      opt.value = key;
      const label = key === '__other__' ? 'Other / unspecified' : cuisineLabel(key);
      opt.textContent = label + ' (' + counts[key] + ')';
      cuisineEl.appendChild(opt);
    });

    cuisineEl.value = Array.from(cuisineEl.options).some(function (o) { return o.value === previous; })
      ? previous
      : 'all';
  }

  function filterByCuisine(places) {
    const selected = cuisineEl.value;
    if (!selected || selected === 'all') return places.slice();
    if (selected === '__other__') {
      return places.filter(function (p) { return !p.cuisineKey; });
    }
    return places.filter(function (p) { return p.cuisineKey === selected; });
  }

  function groupByCuisine(places) {
    const groups = {};
    places.forEach(function (p) {
      const key = p.cuisineKey || '__other__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return Object.keys(groups)
      .map(function (key) {
        return {
          key: key,
          label: key === '__other__' ? 'Other / unspecified' : cuisineLabel(key),
          places: groups[key]
        };
      })
      .sort(function (a, b) {
        // Groups with closer minimum distance come first.
        const aMin = a.places[0] ? a.places[0].distanceKm : Infinity;
        const bMin = b.places[0] ? b.places[0].distanceKm : Infinity;
        return aMin - bMin;
      });
  }

  function tagInfo(glutenFree) {
    if (glutenFree === 'only') return { cls: 'tag-only', text: 'Gluten free only' };
    if (glutenFree === 'yes') return { cls: 'tag-yes', text: 'Gluten free options' };
    return { cls: 'tag-maybe', text: 'May have GF options' };
  }

  // OSM stores phone numbers in various forms. Normalize to a tel: href by
  // stripping spaces, dashes, parens, and trailing extensions.
  function telHref(phone) {
    if (!phone) return '';
    const cleaned = String(phone).split(/[;,]/)[0].trim().replace(/[\s().-]/g, '');
    return cleaned ? 'tel:' + cleaned : '';
  }

  function displayPhone(phone) {
    if (!phone) return '';
    return String(phone).split(/[;,]/)[0].trim();
  }

  function renderResultItem(place) {
    const li = document.createElement('li');
    li.className = 'result-item';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');

    const tag = tagInfo(place.glutenFree);

    li.innerHTML =
      '<div class="name"></div>' +
      '<div class="meta">' +
        '<span class="type"></span>' +
        '<span class="distance"></span>' +
      '</div>' +
      '<div class="address"></div>' +
      '<div class="actions"></div>' +
      '<span class="tag"></span>';

    li.querySelector('.name').textContent = place.name;
    const typeText = place.cuisineLabel && place.cuisineLabel !== 'Other'
      ? place.cuisineLabel
      : (place.amenity || 'place').replace(/_/g, ' ');
    li.querySelector('.type').textContent = typeText;
    li.querySelector('.distance').textContent = formatDistance(place.distanceKm);
    li.querySelector('.address').textContent = place.address || 'Address not listed';
    const tagEl = li.querySelector('.tag');
    tagEl.classList.add(tag.cls);
    tagEl.textContent = tag.text;

    const actions = li.querySelector('.actions');
    const tel = telHref(place.phone);
    if (tel) {
      const a = document.createElement('a');
      a.className = 'action-link action-call';
      a.href = tel;
      a.textContent = displayPhone(place.phone);
      a.setAttribute('aria-label', 'Call ' + place.name);
      a.addEventListener('click', function (e) { e.stopPropagation(); });
      actions.appendChild(a);
    }
    if (place.website) {
      const w = document.createElement('a');
      w.className = 'action-link action-book';
      w.href = place.website;
      w.target = '_blank';
      w.rel = 'noopener';
      w.textContent = 'Book / Visit website';
      w.setAttribute('aria-label', 'Open website for ' + place.name);
      w.addEventListener('click', function (e) { e.stopPropagation(); });
      actions.appendChild(w);
    }
    if (!tel && !place.website) {
      actions.remove();
    }

    li.addEventListener('click', function () { focusPlace(place); });
    li.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        focusPlace(place);
      }
    });
    return li;
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
    const groups = groupByCuisine(places);
    const showGroupHeaders = groups.length > 1;

    groups.forEach(function (group) {
      if (showGroupHeaders) {
        const header = document.createElement('li');
        header.className = 'group-header';
        header.setAttribute('role', 'separator');
        header.textContent = group.label + ' (' + group.places.length + ')';
        resultsList.appendChild(header);
      }
      group.places.forEach(function (place) {
        resultsList.appendChild(renderResultItem(place));
        const marker = L.marker([place.lat, place.lon]).bindPopup(buildPopupHtml(place));
        resultMarkersLayer.addLayer(marker);
        bounds.extend([place.lat, place.lon]);
      });
    });

    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  function buildPopupHtml(place) {
    const wrapper = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = place.name;
    wrapper.appendChild(name);

    if (place.cuisineLabel && place.cuisineLabel !== 'Other') {
      const cuisine = document.createElement('div');
      cuisine.textContent = place.cuisineLabel;
      cuisine.style.fontSize = '0.8rem';
      cuisine.style.marginTop = '2px';
      cuisine.style.color = '#5b6b5b';
      wrapper.appendChild(cuisine);
    }

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

    const tag = tagInfo(place.glutenFree);
    const tagEl = document.createElement('div');
    tagEl.textContent = tag.text;
    tagEl.style.fontSize = '0.75rem';
    tagEl.style.marginTop = '4px';
    tagEl.style.fontWeight = '600';
    tagEl.style.color = place.glutenFree === 'maybe' ? '#8a6d00' : '#1b5e20';
    wrapper.appendChild(tagEl);

    const tel = telHref(place.phone);
    if (tel) {
      const phoneLink = document.createElement('a');
      phoneLink.href = tel;
      phoneLink.textContent = 'Call ' + displayPhone(place.phone);
      phoneLink.style.display = 'block';
      phoneLink.style.marginTop = '6px';
      phoneLink.style.fontSize = '0.85rem';
      wrapper.appendChild(phoneLink);
    }

    if (place.website) {
      const bookLink = document.createElement('a');
      bookLink.href = place.website;
      bookLink.target = '_blank';
      bookLink.rel = 'noopener';
      bookLink.textContent = 'Book / Visit website';
      bookLink.style.display = 'block';
      bookLink.style.marginTop = '4px';
      bookLink.style.fontSize = '0.85rem';
      wrapper.appendChild(bookLink);
    }

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

  function applyFilterAndRender() {
    if (!lastCoords) return;
    const filtered = filterByCuisine(lastPlaces);
    renderResults(filtered, lastCoords);
    const total = lastPlaces.length;
    const shown = filtered.length;
    if (total === shown) {
      setStatus('Found ' + total + ' place' + (total === 1 ? '' : 's') + '.');
    } else {
      setStatus('Showing ' + shown + ' of ' + total + ' place' + (total === 1 ? '' : 's') + '.');
    }
  }

  async function refresh() {
    refreshBtn.disabled = true;
    setStatus('Getting your location...');
    try {
      const coords = await getLocation();
      lastCoords = coords;
      placeUserMarker(coords);

      const radius = parseInt(radiusEl.value, 10) || 5000;
      const includeFriendly = !!includeFriendlyEl.checked;
      setStatus('Searching within ' + (radius / 1000) + ' km...');

      const data = await queryOverpass(buildOverpassQuery(coords.lat, coords.lon, radius, includeFriendly));
      const elements = (data && data.elements) || [];

      const seen = new Set();
      const places = elements
        .map(function (el) { return normalizeElement(el, coords.lat, coords.lon); })
        .filter(function (p) {
          if (!p) return false;
          if (p.distanceKm * 1000 > radius) return false;
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        })
        .sort(function (a, b) { return a.distanceKm - b.distanceKm; });

      lastPlaces = places;
      updateCuisineDropdown(places);
      applyFilterAndRender();
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Something went wrong.', true);
      lastPlaces = [];
      updateCuisineDropdown([]);
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
    includeFriendlyEl.addEventListener('change', function () {
      if (lastCoords) refresh();
    });
    cuisineEl.addEventListener('change', applyFilterAndRender);
    refresh();
  });
})();
