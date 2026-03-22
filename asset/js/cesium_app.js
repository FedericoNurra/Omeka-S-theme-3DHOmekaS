document.addEventListener("DOMContentLoaded", async function () {
  if (!window.APP_CONFIG || !window.APP_CONFIG.CESIUM_TOKEN) {
    console.error("Token Cesium mancante");
    return;
  }

  Cesium.Ion.defaultAccessToken = window.APP_CONFIG.CESIUM_TOKEN;

  const viewer = new Cesium.Viewer("cesiumContainer", {
    timeline: false,
    animation: false,
    baseLayerPicker: true,
    geocoder: false,
    homeButton: true,
    sceneModePicker: false,
    navigationHelpButton: true,
    infoBox: true,
    selectionIndicator: true,
    fullscreenButton: false
  });

  viewer.canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  let initialBoundingSphere = null;

  const layerRegistry = {
    geojson: [],
    glb: []
  };

  viewer.homeButton.viewModel.command.beforeExecute.addEventListener(function (e) {
    if (initialBoundingSphere) {
      e.cancel = true;
      viewer.camera.flyToBoundingSphere(initialBoundingSphere, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(
          0.0,
          Cesium.Math.toRadians(-45),
          0.0
        )
      });
    }
  });

  function hasHeightInPositions(positions) {
    if (!positions || !positions.length) {
      return false;
    }

    return positions.some((pos) => {
      const cartographic = Cesium.Cartographic.fromCartesian(pos);
      return Math.abs(cartographic.height) > 0.01;
    });
  }

  function styleMixedHeightEntities(dataSource) {
    const now = Cesium.JulianDate.now();

    for (const entity of dataSource.entities.values) {
      if (entity.polygon && entity.polygon.hierarchy) {
        const hierarchy = entity.polygon.hierarchy.getValue(now);

        if (hierarchy && hierarchy.positions && hierarchy.positions.length) {
          const hasZ = hasHeightInPositions(hierarchy.positions);

          if (hasZ) {
            entity.polygon.perPositionHeight = new Cesium.ConstantProperty(true);
          } else {
            entity.polygon.height = new Cesium.ConstantProperty(0);
          }
        }
      }

      if (entity.polyline && entity.polyline.positions) {
        const positions = entity.polyline.positions.getValue(now);

        if (positions && positions.length) {
          const hasZ = hasHeightInPositions(positions);
          entity.polyline.clampToGround = new Cesium.ConstantProperty(!hasZ);
        }
      }

      if (entity.point && entity.position) {
        const position = entity.position.getValue(now);

        if (position) {
          const cartographic = Cesium.Cartographic.fromCartesian(position);
          const hasZ = Math.abs(cartographic.height) > 0.01;

          if (!hasZ) {
            entity.point.heightReference = new Cesium.ConstantProperty(
              Cesium.HeightReference.CLAMP_TO_GROUND
            );
          }
        }
      }

      if (entity.billboard && entity.position) {
        const position = entity.position.getValue(now);

        if (position) {
          const cartographic = Cesium.Cartographic.fromCartesian(position);
          const hasZ = Math.abs(cartographic.height) > 0.01;

          if (!hasZ) {
            entity.billboard.heightReference = new Cesium.ConstantProperty(
              Cesium.HeightReference.CLAMP_TO_GROUND
            );
          }
        }
      }

      if (entity.label && entity.position) {
        const position = entity.position.getValue(now);

        if (position) {
          const cartographic = Cesium.Cartographic.fromCartesian(position);
          const hasZ = Math.abs(cartographic.height) > 0.01;

          if (!hasZ) {
            entity.label.heightReference = new Cesium.ConstantProperty(
              Cesium.HeightReference.CLAMP_TO_GROUND
            );
          }
        }
      }
    }
  }

  function collectEntityPositions(entity) {
    const now = Cesium.JulianDate.now();
    const positions = [];

    if (entity.position) {
      const p = entity.position.getValue(now);
      if (p) {
        positions.push(p);
      }
    }

    if (entity.polyline && entity.polyline.positions) {
      const polylinePositions = entity.polyline.positions.getValue(now);
      if (polylinePositions && polylinePositions.length) {
        positions.push(...polylinePositions);
      }
    }

    if (entity.polygon && entity.polygon.hierarchy) {
      const hierarchy = entity.polygon.hierarchy.getValue(now);
      if (hierarchy && hierarchy.positions && hierarchy.positions.length) {
        positions.push(...hierarchy.positions);
      }
    }

    return positions;
  }

  function computeBoundingSphereFromEntities(entities) {
    const allPositions = [];

    for (const entity of entities) {
      allPositions.push(...collectEntityPositions(entity));
    }

    if (!allPositions.length) {
      return null;
    }

    return Cesium.BoundingSphere.fromPoints(allPositions);
  }

  function combineBoundingSpheres(spheres) {
    const validSpheres = spheres.filter(Boolean);

    if (!validSpheres.length) {
      return null;
    }

    let combined = Cesium.BoundingSphere.clone(validSpheres[0]);

    for (let i = 1; i < validSpheres.length; i++) {
      combined = Cesium.BoundingSphere.union(combined, validSpheres[i]);
    }

    return combined;
  }

  function setImmediateViewFromBoundingSphere(boundingSphere) {
    if (!boundingSphere) {
      return;
    }

    viewer.camera.viewBoundingSphere(
      boundingSphere,
      new Cesium.HeadingPitchRange(
        0.0,
        Cesium.Math.toRadians(-45),
        0.0
      )
    );
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }

  async function waitForModelReady(model, timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (model.ready) {
        resolve(true);
        return;
      }

      let done = false;

      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          resolve(false);
        }
      }, timeoutMs);

      const removeListener = model.readyEvent.addEventListener(() => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          removeListener();
          resolve(true);
        }
      });
    });
  }

  function setAllLayers(type, visible) {
    const collection = layerRegistry[type] || [];

    for (const layer of collection) {
      if (layer.object) {
        layer.object.show = visible;
      }

      const checkbox = document.getElementById(`layer-${layer.type}-${layer.id}`);
      if (checkbox) {
        checkbox.checked = visible;
      }
    }
  }

  function initLegendToggle() {
    const legend = document.getElementById("cesiumLegend");
    const toggle = document.getElementById("cesiumLegendToggle");

    if (!legend || !toggle) {
      return;
    }

    const icon = toggle.querySelector("i");

    toggle.addEventListener("click", function () {
      const isCollapsed = legend.classList.contains("is-collapsed");

      if (isCollapsed) {
        legend.classList.remove("is-collapsed");
        toggle.setAttribute("aria-expanded", "true");

        if (icon) {
          icon.classList.remove("fa-bars");
          icon.classList.add("fa-xmark");
        }
      } else {
        legend.classList.add("is-collapsed");
        toggle.setAttribute("aria-expanded", "false");

        if (icon) {
          icon.classList.remove("fa-xmark");
          icon.classList.add("fa-bars");
        }
      }
    });
  }

  function initRightClickOpenItem() {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction(function (movement) {
      const pickedObject = viewer.scene.pick(movement.position);

      if (!Cesium.defined(pickedObject) || !pickedObject.id) {
        return;
      }

      const entity = pickedObject.id;

      if (!entity.polygon) {
        return;
      }

      if (!entity.properties || !entity.properties.itemUrl) {
        return;
      }

      const itemUrl = entity.properties.itemUrl.getValue(Cesium.JulianDate.now());

      if (itemUrl) {
        window.open(itemUrl, "_blank", "noopener");
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }

  function buildLegend() {
    const legendPanel = document.getElementById("cesiumLegendPanel");
    if (!legendPanel) {
      return;
    }

    const hasGeojson = layerRegistry.geojson.length > 0;
    const hasGlb = layerRegistry.glb.length > 0;

    if (!hasGeojson && !hasGlb) {
      legendPanel.innerHTML = `
        <h3>Layer</h3>
        <div class="legend-empty">Nessun layer disponibile</div>
      `;
      return;
    }

    let html = `<h3>Layer</h3>`;

    if (hasGeojson) {
      html += `
        <div class="legend-group">
          <span class="legend-group-title">GeoJSON</span>
          <div class="legend-actions">
            <button type="button" data-action="all-on" data-type="geojson">Mostra tutti</button>
            <button type="button" data-action="all-off" data-type="geojson">Nascondi tutti</button>
          </div>
      `;

      for (const layer of layerRegistry.geojson) {
        html += `
          <div class="legend-item">
            <input
              type="checkbox"
              id="layer-${layer.type}-${layer.id}"
              data-type="${layer.type}"
              data-id="${layer.id}"
              checked
            >
            <label for="layer-${layer.type}-${layer.id}">${layer.title}</label>
          </div>
        `;
      }

      html += `</div>`;
    }

    if (hasGlb) {
      html += `
        <div class="legend-group">
          <span class="legend-group-title">Modelli 3D</span>
          <div class="legend-actions">
            <button type="button" data-action="all-on" data-type="glb">Mostra tutti</button>
            <button type="button" data-action="all-off" data-type="glb">Nascondi tutti</button>
          </div>
      `;

      for (const layer of layerRegistry.glb) {
        html += `
          <div class="legend-item">
            <input
              type="checkbox"
              id="layer-${layer.type}-${layer.id}"
              data-type="${layer.type}"
              data-id="${layer.id}"
              checked
            >
            <label for="layer-${layer.type}-${layer.id}">${layer.title}</label>
          </div>
        `;
      }

      html += `</div>`;
    }

    legendPanel.innerHTML = html;

    legendPanel.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener("change", function () {
        const type = this.dataset.type;
        const id = this.dataset.id;
        const checked = this.checked;

        const collection = layerRegistry[type] || [];
        const layer = collection.find((l) => l.id === id);

        if (layer && layer.object) {
          layer.object.show = checked;
        }
      });
    });

    legendPanel.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", function () {
        const action = this.dataset.action;
        const type = this.dataset.type;

        if (action === "all-on") {
          setAllLayers(type, true);
        }

        if (action === "all-off") {
          setAllLayers(type, false);
        }
      });
    });
  }

  async function loadGeoJsonLayers() {
    const layers = Array.isArray(window.CESIUM_GEOJSON_LAYERS)
      ? window.CESIUM_GEOJSON_LAYERS
      : [];

    if (!layers.length) {
      return {
        entities: [],
        boundingSphere: null
      };
    }

    const colors = [
      Cesium.Color.CYAN,
      Cesium.Color.YELLOW,
      Cesium.Color.ORANGE,
      Cesium.Color.LIME,
      Cesium.Color.MAGENTA
    ];

    const allEntities = [];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const color = colors[i % colors.length];

      try {
        const dataSource = await Cesium.GeoJsonDataSource.load(layer.url, {
          stroke: color,
          fill: color.withAlpha(0.3),
          strokeWidth: 2
        });

        dataSource.name = layer.title || `GeoJSON ${layer.id}`;
        viewer.dataSources.add(dataSource);

        layerRegistry.geojson.push({
          id: String(layer.id),
          title: layer.title || `GeoJSON ${layer.id}`,
          object: dataSource,
          type: "geojson"
        });

        styleMixedHeightEntities(dataSource);

        for (const entity of dataSource.entities.values) {
          entity.properties = entity.properties || new Cesium.PropertyBag();
          entity.properties.itemUrl = new Cesium.ConstantProperty(layer.itemUrl || null);

          if (entity.polygon) {
            entity.polygon.material = color.withAlpha(0.3);
            entity.polygon.outline = new Cesium.ConstantProperty(true);
            entity.polygon.outlineColor = new Cesium.ConstantProperty(color);
          }

          if (entity.polyline) {
            entity.polyline.material = new Cesium.ColorMaterialProperty(color);
            entity.polyline.width = new Cesium.ConstantProperty(2);
          }

          if (entity.point) {
            entity.point.color = new Cesium.ConstantProperty(color);
          }

          allEntities.push(entity);
        }
      } catch (error) {
        console.error(`Errore nel caricamento GeoJSON ${layer.url}`, error);
      }
    }

    return {
      entities: allEntities,
      boundingSphere: computeBoundingSphereFromEntities(allEntities)
    };
  }

  async function loadGlbLayers() {
    const models = Array.isArray(window.CESIUM_GLB_LAYERS)
      ? window.CESIUM_GLB_LAYERS
      : [];

    const loadedModels = [];
    const modelSpheres = [];

    for (const modelDef of models) {
      try {
        if (modelDef.lon === null || modelDef.lat === null) {
          console.warn("GLB saltato: coordinate mancanti", modelDef);
          continue;
        }

        const lon = Number(modelDef.lon);
        const lat = Number(modelDef.lat);

        if (Number.isNaN(lon) || Number.isNaN(lat)) {
          console.warn("GLB saltato: lon/lat mancanti o non validi", modelDef);
          continue;
        }

        const position = Cesium.Cartesian3.fromDegrees(
          lon,
          lat,
          Number(modelDef.height || 0)
        );

        const hpr = new Cesium.HeadingPitchRoll(
          Cesium.Math.toRadians(Number(modelDef.heading || 0)),
          Cesium.Math.toRadians(Number(modelDef.pitch || 0)),
          Cesium.Math.toRadians(Number(modelDef.roll || 0))
        );

        const modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(
          position,
          hpr
        );

        const model = await Cesium.Model.fromGltfAsync({
          url: modelDef.url,
          modelMatrix: modelMatrix,
          scale: Number(modelDef.scale || 1)
        });

        viewer.scene.primitives.add(model);
        loadedModels.push(model);

        layerRegistry.glb.push({
          id: String(modelDef.id),
          title: modelDef.title || `GLB ${modelDef.id}`,
          object: model,
          type: "glb"
        });

        const ready = await waitForModelReady(model, 8000);

        if (ready) {
          try {
            if (model.boundingSphere) {
              modelSpheres.push(Cesium.BoundingSphere.clone(model.boundingSphere));
            }
          } catch (e) {
            console.warn("Bounding sphere GLB non disponibile:", modelDef.url, e);
          }
        } else {
          console.warn("Timeout attesa readyEvent per GLB:", modelDef.url);
        }
      } catch (error) {
        console.error(`Errore nel caricamento GLB ${modelDef.url}`, error);
      }
    }

    return {
      models: loadedModels,
      boundingSphere: combineBoundingSpheres(modelSpheres)
    };
  }

  try {
    const geojsonResult = await loadGeoJsonLayers();

    if (geojsonResult.boundingSphere) {
      initialBoundingSphere = geojsonResult.boundingSphere;
      setImmediateViewFromBoundingSphere(initialBoundingSphere);
    }

    const glbResult = await loadGlbLayers();

    initialBoundingSphere = combineBoundingSpheres([
      geojsonResult.boundingSphere,
      glbResult.boundingSphere
    ]) || geojsonResult.boundingSphere;

    buildLegend();
    initLegendToggle();
    initRightClickOpenItem();
  } catch (error) {
    console.error("Errore generale nel caricamento layer:", error);
  }
});