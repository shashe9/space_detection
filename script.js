import { startEarth3D } from './earth3d.js';

let satellites = [];
let currentDataArray = []; 

document.addEventListener("DOMContentLoaded", () => {
    function clearPlotContainer() {
        const container = document.getElementById("plotContainer");
        if (container) container.innerHTML = "";
    }

    fetch("data/tle.txt")
        .then(res => res.text())
        .then(text => {
            if (text.includes("<html")) {
                alert("TLE file not loaded");
                return;
            }
            parseTLE(text);
            populateSatelliteDropdown();
            updateSelection();
        });

    function parseTLE(tleText) {
        const lines = tleText.split("\n").map(l => l.trim()).filter(Boolean);
        satellites = [];
        for (let i = 0; i < lines.length - 2; i += 3) {
            satellites.push({
                name: lines[i],
                line1: lines[i + 1],
                line2: lines[i + 2],
                index: i / 3
            });
        }
    }

    function populateSatelliteDropdown() {
        const selectMenu = document.getElementById("satelliteSelectMenu");
        selectMenu.innerHTML = ""; 

        satellites.forEach((sat, i) => {
            const option = document.createElement("option");
            option.value = i;
            option.textContent = sat.name;
            selectMenu.appendChild(option);
        });

        selectMenu.onchange = () => updateSelection();
    }

    function propagateSatellite(sat, minutes = 120) {
        const satrec = satellite.twoline2satrec(sat.line1, sat.line2);
        const data = { name: sat.name, times: [], lats: [], lons: [], alts: [], speeds: [] };

        for (let m = 0; m <= minutes; m++) {
            const t = new Date();
            t.setMinutes(t.getMinutes() + m);
            const pv = satellite.propagate(satrec, t);
            if (!pv.position) continue;

            const gmst = satellite.gstime(t);
            const geo = satellite.eciToGeodetic(pv.position, gmst);

            data.times.push(t);
            data.lats.push(satellite.degreesLat(geo.latitude));
            data.lons.push(satellite.degreesLong(geo.longitude));
            data.alts.push(geo.height * 1000);
            data.speeds.push(
                Math.sqrt(pv.velocity.x * 2 + pv.velocity.y * 2 + pv.velocity.z ** 2) * 1000
            );
        }
        return data;
    }

    function updateSelection() {
        const selectMenu = document.getElementById("satelliteSelectMenu");
        const idx = selectMenu.value;
        
        if (idx !== "") {
            const sat = satellites[idx];
            currentDataArray = [propagateSatellite(sat)];
        }

        const activeBtn = document.querySelector(".plot-btn.active");
        const mode = activeBtn ? activeBtn.dataset.plot : "orbit";
        renderView(mode);
    }

    function renderView(mode) {
        if (currentDataArray.length === 0) {
            clearPlotContainer();
            document.getElementById('avgAlt').innerText = "–";
            document.getElementById('avgSpeed').innerText = "–";
            document.getElementById('orbitType').innerText = "–";
            return;
        }

        const primaryData = currentDataArray[0];

        const avgAltitude = primaryData.alts.reduce((a, b) => a + b, 0) / primaryData.alts.length;
        const avgVel = primaryData.speeds.reduce((a, b) => a + b, 0) / primaryData.speeds.length;
        
        let type = "LEO";
        if (avgAltitude > 2000000 && avgAltitude < 35000000) type = "MEO";
        if (avgAltitude >= 35000000) type = "GEO";

        document.getElementById('avgAlt').innerText = Math.round(avgAltitude).toLocaleString();
        document.getElementById('avgSpeed').innerText = Math.round(avgVel).toLocaleString();
        document.getElementById('orbitType').innerText = type;

        if (mode === "orbit3d") {
            switchView("3d");
            startEarth3D(document.getElementById("threeContainer"), currentDataArray);
        } else {
            switchView("plot");
            if (mode === "orbit") plotAnimatedGroundTrack(primaryData, primaryData.name);
            else if (mode === "altitude") plotAltitude(primaryData);
            else if (mode === "speed") plotSpeed(primaryData);
            else if (mode === "correlation") plotCorrelation(primaryData);
        }
        
        setupNavigation();
    }

    function plotAnimatedGroundTrack(data, name) {
        clearPlotContainer();
        Plotly.newPlot("plotContainer", [{
            type: "scattergeo",
            lat: data.lats,
            lon: data.lons,
            mode: "lines",
            line: { width: 3, color: '#10b981' }
        }], {
            title: { text: 3D Globe View – ${name}, font: { color: '#ffffff', size: 16 } },
            paper_bgcolor: 'rgba(0,0,0,0)',
            geo: { 
                projection: { type: "orthographic" }, 
                showland: true, 
                landcolor: '#111827',
                showocean: true,
                oceancolor: '#020617',
                bgcolor: 'rgba(0,0,0,0)',
                showcountries: true,
                countrycolor: '#374151'
            }
        }, { responsive: true });
    }

    function plotAltitude(data) {
        Plotly.newPlot("plotContainer", [{ x: data.times, y: data.alts, mode: "lines", line: { color: '#10b981' } }], 
        { title: { text: "Altitude Profile", font: { color: '#ffffff' } }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', xaxis: { gridcolor: '#333' }, yaxis: { gridcolor: '#333' } });
    }

    function plotSpeed(data) {
        Plotly.newPlot("plotContainer", [{ x: data.times, y: data.speeds, mode: "lines", line: { color: '#6366f1' } }], 
        { title: { text: "Velocity Profile", font: { color: '#ffffff' } }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', xaxis: { gridcolor: '#333' }, yaxis: { gridcolor: '#333' } });
    }

    function plotCorrelation(data) {
        const vars = { Altitude: data.alts, Speed: data.speeds, Latitude: data.lats };
        const labels = Object.keys(vars);
        const matrix = labels.map(a => labels.map(b => pearson(vars[a], vars[b]).toFixed(2)));
        Plotly.newPlot("plotContainer", [{ z: matrix, x: labels, y: labels, type: "heatmap", colorscale: "Viridis" }], 
        { title: { text: "Correlation Heatmap", font: { color: '#ffffff' } }, paper_bgcolor: 'rgba(0,0,0,0)' });
    }

    function pearson(x, y) {
        const n = x.length;
        const mx = x.reduce((a, b) => a + b) / n;
        const my = y.reduce((a, b) => a + b) / n;
        let num = 0, dx = 0, dy = 0;
        for (let i = 0; i < n; i++) {
            num += (x[i] - mx) * (y[i] - my);
            dx += (x[i] - mx) ** 2;
            dy += (y[i] - my) ** 2;
        }
        return num / Math.sqrt(dx * dy);
    }

    function switchView(mode) {
        const plotCont = document.getElementById("plotContainer");
        const threeCont = document.getElementById("threeContainer");
        if (mode === "3d") {
            plotCont.style.display = "none";
            threeCont.style.display = "block";
        } else {
            plotCont.style.display = "block";
            threeCont.style.display = "none";
        }
    }

    function setupNavigation() {
        document.querySelectorAll(".plot-nav .plot-btn").forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll(".plot-nav .plot-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                renderView(btn.dataset.plot);
            };
        });
    }
});
