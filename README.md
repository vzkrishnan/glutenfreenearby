# Gluten Free Nearby

A Progressive Web App that finds gluten-free restaurants and cafés near your current location, using free OpenStreetMap data — no API keys, no signup, no paid services.

## Features

- Uses your device location (Geolocation API)
- Queries the free [Overpass API](https://overpass-api.de/) for places tagged `diet:gluten_free=yes` or `only`
- Shows results on a Leaflet map and as a sortable list (closest first)
- Distance and address for each result
- Adjustable search radius (2 / 5 / 10 / 25 km)
- Installable as a PWA on mobile and desktop (offline shell, cached map tiles)
- Ready to wrap into a native iOS/Android app via Capacitor

## Live demo

Once deployed to GitHub Pages, this app will be available at:

`https://<your-github-username>.github.io/glutenfreenearby/`

## Local development

This is plain HTML/CSS/JS — no build step. Just serve the folder:

```bash
# from inside the glutenfreenearby/ folder
python3 -m http.server 8080
# then open http://localhost:8080
```

> Geolocation requires either `localhost` or HTTPS. GitHub Pages serves HTTPS automatically.

## Deploy to GitHub Pages

1. Push the contents of this folder to the `main` branch of your GitHub repo.
2. On GitHub: **Settings → Pages → Build and deployment → Source → Deploy from a branch**.
3. Choose `main` branch and `/ (root)` folder. Save.
4. Wait ~30 seconds. Your URL will appear at the top of the Pages settings.

## Wrapping for iOS / Android (later)

When you're ready to ship to the App Store / Play Store, the easiest path is [Capacitor](https://capacitorjs.com/):

```bash
npm init @capacitor/app
npx cap add ios
npx cap add android
# point Capacitor's webDir at this folder, then:
npx cap sync
npx cap open ios       # or android
```

## Data source

All restaurant data comes from [OpenStreetMap](https://www.openstreetmap.org/). The app reads the `diet:gluten_free` tag and `cuisine=gluten_free` from public OSM nodes/ways. Coverage depends on what local mappers have contributed — if a place is missing, anyone can add it.

## License

MIT
