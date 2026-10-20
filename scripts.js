document.addEventListener('DOMContentLoaded', () => {

    // ===== 1. MAPAS BASE =====
    const baseLayers = {
        dark: L.tileLayer('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_4iak_1_24289eb4ef8a24a5a8752e0e', {
            subdomains: 'abcd',
            maxZoom: 20,
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
        }),
        streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        }),
        satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri'
        })
    };

    // Inicializamos SIN capa base para que un fallo de tiles no bloquee el mapa
    const map = L.map('map', {
        zoomControl: false
    }).setView([39.694, -8.130], 7);

    // Añadimos la capa base por defecto de forma segura
    if (baseLayers.streets) baseLayers.streets.addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // ===== 2. DOM =====
    const labelSelect        = document.getElementById('labelSelect');
    const classificationSel  = document.getElementById('classificationSelect');
    const paletteSel         = document.getElementById('paletteSelect');
    const baseMapSel         = document.getElementById('baseMapSelect');
    const btnLoad            = document.getElementById('btnCargarGeoJSON');
    const btnReset           = document.getElementById('btnReset');
    const detailNome         = document.getElementById('detailNome');
    const detailTaxa         = document.getElementById('detailTaxa');
    const detailRank         = document.getElementById('detailRank');
    const statMin            = document.getElementById('statMin');
    const statMax            = document.getElementById('statMax');
    const statMean           = document.getElementById('statMean');
    const statMedian         = document.getElementById('statMedian');

    // ===== 3. ESTADO =====
    let geojsonLayer, legend, currentBreaks = [];
    let currentPalette = [];
    let allFeatures = [];

    const colorSchemes = {
        reds:    ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15'],
        purples: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'],
        greens:  ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c'],
        yellows: ['#ffffd4', '#fed98e', '#fe9929', '#d95f0e', '#993404'],
        blues:   ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
        oranges: ['#feedde', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603']
    };

    // ===== 4. HELPERS =====
    const getProp = (props, keys) => {
        if (!props) return null;
        const found = Object.keys(props).find(k =>
            keys.includes(k.toLowerCase().trim())
        );
        return found ? props[found] : null;
    };

    const getName = f => getProp(f.properties, ['nome', 'name']) || 'Sem nome';

    const getTaxa = f => {
        const v = parseFloat(getProp(f.properties, ['taxa', 'tasa', 'valor', 'rate']));
        return isNaN(v) ? 0 : v;
    };

    // ===== 5. JENKS REAL =====
    function jenksBreaks(data, nClasses) {
        const sorted = [...data].sort((a, b) => a - b);
        const n = sorted.length;
        if (n === 0) return [0, 1];
        if (n <= nClasses) return [...new Set([...sorted, sorted[n - 1] + 1])];

        const mat1 = Array.from({ length: n + 1 }, () => new Array(nClasses + 1).fill(0));
        const mat2 = Array.from({ length: n + 1 }, () => new Array(nClasses + 1).fill(0));

        for (let i = 1; i <= nClasses; i++) {
            mat1[1][i] = 1;
            mat2[1][i] = 0;
            for (let j = 2; j <= n; j++) mat2[j][i] = Infinity;
        }

        for (let l = 2; l <= n; l++) {
            let s1 = 0, s2 = 0, w = 0;
            for (let m = 1; m <= l; m++) {
                const i3 = l - m + 1;
                const d = sorted[i3 - 1];
                s2 += d * d;
                s1 += d;
                w += 1;
                const variance = s2 - (s1 * s1) / w;
                const i4 = i3 - 1;
                if (i4 !== 0) {
                    for (let j = 2; j <= nClasses; j++) {
                        if (mat2[l][j] >= variance + mat2[i4][j - 1]) {
                            mat1[l][j] = i3;
                            mat2[l][j] = variance + mat2[i4][j - 1];
                        }
                    }
                }
            }
            mat1[l][1] = 1;
            mat2[l][1] = s2 - (s1 * s1) / w;
        }

        const kclass = new Array(nClasses + 1);
        kclass[nClasses] = sorted[n - 1];
        kclass[0] = sorted[0];

        let countNum = nClasses;
        let k = n;
        while (countNum >= 2) {
            const idx = mat1[k][countNum] - 2;
            kclass[countNum - 1] = sorted[idx];
            k = mat1[k][countNum] - 1;
            countNum -= 1;
        }

        return kclass;
    }

    // ===== 6. QUEBRAS =====
    function computeBreaks(values, method) {
        const sorted = [...values].sort((a, b) => a - b);
        if (sorted.length === 0) return [0, 1, 2, 3, 4, 5];
        if (sorted.length === 1) return [sorted[0], sorted[0] + 0.1, sorted[0] + 0.2, sorted[0] + 0.3, sorted[0] + 0.4, sorted[0] + 0.5];

        const min = sorted[0], max = sorted[sorted.length - 1];
        const nClasses = 5;

        if (method === 'equal') {
            return Array.from({ length: nClasses + 1 }, (_, i) =>
                min + (i * (max - min) / nClasses)
            );
        }

        if (method === 'quartiles') {
            const q = i => sorted[Math.min(Math.floor(sorted.length * i), sorted.length - 1)];
            return [min, q(0.2), q(0.4), q(0.6), q(0.8), max];
        }

        return jenksBreaks(sorted, nClasses);
    }

    // ===== 7. COLOR BLINDADO =====
    function getColor(v, brk) {
        if (!brk || brk.length < 2 || !currentPalette || currentPalette.length === 0) {
            return '#cccccc'; // gris neutro si aún no hay datos
        }
        for (let i = 0; i < brk.length - 1; i++) {
            if (v >= brk[i] && v <= brk[i + 1]) {
                return currentPalette[Math.min(i, currentPalette.length - 1)];
            }
        }
        return currentPalette[currentPalette.length - 1];
    }

    // ===== 8. LEYENDA =====
    function addLegend() {
        if (legend) map.removeControl(legend);
        if (!currentBreaks || currentBreaks.length < 2) return;

        legend = L.control({ position: 'bottomright' });
        legend.onAdd = () => {
            const div = L.DomUtil.create('div', 'legend-horizontal');
            let html = '<div class="legend-container">';
            for (let i = 0; i < currentBreaks.length - 1; i++) {
                const color = currentPalette[i] || '#cccccc';
                html += `
                    <div class="legend-item" data-i="${i}"
                         onmouseover="highlightRange(${currentBreaks[i]}, ${currentBreaks[i + 1]})"
                         onmouseout="resetHighlight()">
                        <div class="legend-color" style="background:${color}"></div>
                        <div class="legend-text">${currentBreaks[i].toFixed(1)}–${currentBreaks[i + 1].toFixed(1)}%</div>
                    </div>`;
            }
            div.innerHTML = html + '</div>';
            return div;
        };
        legend.addTo(map);
    }

    // ===== 9. ESTADÍSTICAS =====
    function updateStats(features) {
        if (!features || !features.length) return;
        const vals = features.map(getTaxa).sort((a, b) => a - b);
        if (!vals.length) return;

        const sum = vals.reduce((a, b) => a + b, 0);
        const mean = sum / vals.length;
        const median = vals.length % 2
            ? vals[(vals.length - 1) / 2]
            : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;

        if (statMin)    statMin.textContent    = vals[0].toFixed(1) + '%';
        if (statMax)    statMax.textContent    = vals[vals.length - 1].toFixed(1) + '%';
        if (statMean)   statMean.textContent   = mean.toFixed(1) + '%';
        if (statMedian) statMedian.textContent = median.toFixed(1) + '%';
    }

    // ===== 10. CARGA =====
    if (btnLoad) {
        btnLoad.onclick = () => {
            fetch('portugal.geojson')
                .then(r => {
                    if (!r.ok) throw new Error('No se pudo cargar portugal.geojson');
                    return r.json();
                })
                .then(data => {
                    if (!data || !data.features || !data.features.length) {
                        throw new Error('GeoJSON vacío o sin features');
                    }
                    allFeatures = data.features;

                    currentPalette = colorSchemes[paletteSel.value] || colorSchemes.blues;

                    const vals = allFeatures.map(getTaxa);
                    currentBreaks = computeBreaks(vals, classificationSel.value);

                    if (geojsonLayer) map.removeLayer(geojsonLayer);

                    if (labelSelect) labelSelect.innerHTML = '<option value="">Seleccione...</option>';

                    geojsonLayer = L.geoJSON(data, {
                        style: f => ({
                            fillColor: getColor(getTaxa(f), currentBreaks),
                            weight: 1.2,
                            color: 'rgba(255,255,255,0.5)',
                            fillOpacity: 0.78
                        }),
                        onEachFeature: (f, layer) => {
                            const nome = getName(f);
                            const taxa = getTaxa(f);

                            layer.bindTooltip(
                                `<b>${nome}</b><br>${taxa.toFixed(1)}%`,
                                { sticky: true, direction: 'auto', className: 'tooltip-hover' }
                            );

                            layer.on({
                                mouseover: e => e.target.setStyle({ weight: 2.5, color: '#ff8c1a' }),
                                mouseout:  e => geojsonLayer.resetStyle(e.target),
                                click: () => seleccionarFreguesia(nome, taxa, layer)
                            });

                            if (labelSelect) labelSelect.add(new Option(nome, nome));
                        }
                    }).addTo(map);

                    addLegend();
                    updateStats(allFeatures);
                    if (geojsonLayer.getBounds().isValid()) {
                        map.fitBounds(geojsonLayer.getBounds());
                    }
                })
                .catch(err => {
                    console.error(err);
                    alert('Error cargando portugal.geojson — revisa la consola.');
                });
        };
    }

    // ===== 11. SELECCIÓN =====
    function seleccionarFreguesia(nome, taxa, layer) {
        if (detailNome) detailNome.innerHTML = `<b>Nome:</b> ${nome}`;
        if (detailTaxa) detailTaxa.innerHTML = `<b>Taxa:</b> ${taxa.toFixed(1)}%`;

        const vals = allFeatures.map(getTaxa).sort((a, b) => b - a);
        const rank = vals.indexOf(taxa) + 1;
        if (detailRank) detailRank.textContent = `#${rank} de ${vals.length} distritos`;

        if (labelSelect) labelSelect.value = nome;

        if (geojsonLayer) {
            geojsonLayer.eachLayer(l => {
                geojsonLayer.resetStyle(l);
                if (l.getTooltip() && l.getTooltip().options.className === 'tooltip-selected') {
                    l.unbindTooltip();
                    l.bindTooltip(
                        `<b>${getName(l.feature)}</b><br>${getTaxa(l.feature).toFixed(1)}%`,
                        { sticky: true, direction: 'auto', className: 'tooltip-hover' }
                    );
                }
            });
        }

        layer.setStyle({ color: '#ff8c1a', weight: 4, fillOpacity: 0.92 });
        layer.unbindTooltip();
        layer.bindTooltip(`<b>${nome}</b><br>${taxa.toFixed(1)}%`, {
            direction: 'center', className: 'tooltip-selected', permanent: false
        }).openTooltip();
        layer.bringToFront();
        if (layer.getBounds().isValid()) {
            map.fitBounds(layer.getBounds(), { padding: [40, 40] });
        }

        document.querySelectorAll('.legend-item').forEach(el => el.classList.remove('active-legend'));
        document.querySelectorAll('.legend-item').forEach((item, index) => {
            if (taxa >= currentBreaks[index] && taxa <= currentBreaks[index + 1]) {
                item.classList.add('active-legend');
            }
        });
    }

    // ===== 12. RESET =====
    if (btnReset) {
        btnReset.onclick = () => {
            if (!geojsonLayer) return;
            geojsonLayer.eachLayer(l => geojsonLayer.resetStyle(l));
            if (labelSelect) labelSelect.value = '';
            if (detailNome) detailNome.innerHTML = '<b>Nome:</b> --';
            if (detailTaxa) detailTaxa.innerHTML = '<b>Taxa:</b> --';
            if (detailRank) detailRank.textContent = '';
            document.querySelectorAll('.legend-item').forEach(el => el.classList.remove('active-legend'));
            if (geojsonLayer.getBounds().isValid()) map.fitBounds(geojsonLayer.getBounds());
        };
    }

    // ===== 13. CONTROLES =====
    if (baseMapSel) {
        baseMapSel.onchange = e => {
            Object.values(baseLayers).forEach(l => {
                if (map.hasLayer(l)) map.removeLayer(l);
            });
            const nueva = baseLayers[e.target.value];
            if (nueva) nueva.addTo(map);
        };
    }

    if (paletteSel) {
        paletteSel.onchange = () => {
            currentPalette = colorSchemes[paletteSel.value] || colorSchemes.blues;
            if (allFeatures.length) btnLoad.click();
        };
    }

    if (classificationSel) {
        classificationSel.onchange = () => {
            if (allFeatures.length) btnLoad.click();
        };
    }

    if (labelSelect) {
        labelSelect.onchange = e => {
            if (!e.target.value || !geojsonLayer) return;
            geojsonLayer.eachLayer(layer => {
                if (getName(layer.feature) === e.target.value) {
                    seleccionarFreguesia(e.target.value, getTaxa(layer.feature), layer);
                }
            });
        };
    }

    // ===== 14. HIGHLIGHT RANGE =====
    window.highlightRange = (min, max) => {
        if (!geojsonLayer) return;
        geojsonLayer.eachLayer(layer => {
            const v = getTaxa(layer.feature);
            layer.setStyle(v >= min && v <= max
                ? { fillOpacity: 1, weight: 2.5 }
                : { fillOpacity: 0.08, weight: 0.5 }
            );
        });
    };
    window.resetHighlight = () => {
        if (geojsonLayer) geojsonLayer.eachLayer(l => geojsonLayer.resetStyle(l));
    };
});
