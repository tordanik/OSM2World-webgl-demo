"use strict";

/**
 * Namespace for the OSM2World web frontend.
 * @namespace
 */
const OSM2World = {};
(function() {

	const ssrEnabled = false;
	const sceneDiameter = 4000;
	const highLodDiameter = 500;

	/** render options for the viewer */
	OSM2World.RenderOptions = class {
		constructor(textureResolution, shadowMapResolution, samples) {
			this.textureResolution = textureResolution
			this.shadowMapResolution = shadowMapResolution
			this.samples = samples
		}
	}

	OSM2World.defaultRenderOptions = {
		low: new OSM2World.RenderOptions(256, null, 1),
		high: new OSM2World.RenderOptions(512, 2048, 4)
	}

	/** WebGL-based viewer */
	OSM2World.Viewer = class {

		#engine;
		scene;
		camera;
		originLatLon;

		#updateUrlParameters;

		#shadowGenerator;

		tileLayerRootUrl;

		/** currently loaded tiles in a map from TileNumberWithLod string representations to meshes */
		#loadedTiles = new Map();

		modelUrl;
		#model = null;

		#statusCallback = null;

		constructor(babylonEngine, babylonScene, tileRoot, originLatLon, camera,
					renderOptions = defaultRenderOptions.high, updateUrlParameters = false) {

			this.#engine = babylonEngine
			this.scene = babylonScene
			this.tileLayerRootUrl = tileRoot
			this.camera = camera
			this.#updateUrlParameters = updateUrlParameters

			this.scene.environmentTexture = new BABYLON.HDRCubeTexture("DaySkyHDRI041B.hdr", this.scene, 512, false, true, false, true)

			const sunLight = new BABYLON.DirectionalLight("sunlight", new BABYLON.Vector3(-1, -1, -1))
			sunLight.intensity = 1.0

			if (renderOptions.shadowMapResolution) {
				this.#shadowGenerator = new BABYLON.CascadedShadowGenerator(renderOptions.shadowMapResolution, sunLight)
				this.#shadowGenerator.autoCalcDepthBounds = true
				this.#shadowGenerator.forceBackFacesOnly = true
			}

			if (originLatLon) {
				this.originLatLon = new LatLon(originLatLon[0], originLatLon[1])
				this.setView(this.originLatLon, 500, Math.PI / 2, Math.PI / 4)
			} else {
				this.#setViewFromUrl()
			}

			// regularly update the loaded tiles
			setInterval(() => this.#updateTiles(), 1000);

		}

		/**
		 * Creates an OSM2World viewer based on a canvas.
		 * Will set up a Babylon scene, camera, sky dome and render loop.
		 *
		 * @param {string} canvasID  id of the canvas to use for the viewer
		 * @param {string} tileRoot  root URL for 3D tiles in glTF format
		 * @param {OSM2World.RenderOptions} renderOptions  settings to control quality vs. performance tradeoffs
		 */
		static fromCanvas(canvasID, tileRoot, renderOptions = defaultRenderOptions.high) {

			const canvas = document.getElementById(canvasID)
			canvas.setAttribute("touchAction", "none")

			const engine = new BABYLON.Engine(canvas, true)
			const scene = new BABYLON.Scene(engine)

			scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR
			scene.fogColor = new BABYLON.Color3(0.6, 0.6, 0.7);

			scene.skipPointerMovePicking = true

			const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 4, 500, new BABYLON.Vector3(0, 0, 0));
			camera.attachControl(canvas, true, false, 0);
			camera.minZ = 0.1;
			camera.maxZ = sceneDiameter * 1.1;
			camera.lowerBetaLimit = 0;
			camera.upperBetaLimit = Math.PI / 2.1; // almost horizontal
			camera.lowerRadiusLimit = 1;
			camera.upperRadiusLimit = sceneDiameter / 2.1;
			camera.mapPanning = true; // prevents vertical panning
			camera.panningSensibility = 5;
			camera.internalCamera = true;

			const result = new OSM2World.Viewer(engine, scene, tileRoot, null, camera, renderOptions, true);

			const skyDome = new BABYLON.PhotoDome("sky", "DaySkyHDRI041B.jpg", { size: sceneDiameter }, this.scene);
			skyDome.material.fogEnabled = false
			skyDome.rotate(new BABYLON.Vector3(0, 1, 0), -Math.PI / 4) // rotate to match reflection texture

			const ground = BABYLON.MeshBuilder.CreateGround("ground", {height: sceneDiameter, width: sceneDiameter})

			const defaultPipeline = new BABYLON.DefaultRenderingPipeline("defaultPipeline", true, scene, [camera])
			defaultPipeline.samples = renderOptions.samples
			if (ssrEnabled) {
				defaultPipeline.fxaaEnabled = true
				const ssr = new BABYLON.SSRRenderingPipeline("ssr", scene, [camera])
			}

			// Register a render loop to repeatedly render the scene
			engine.runRenderLoop(() => {

				skyDome.position = new BABYLON.Vector3(camera.target.x, 0, camera.target.z)
				ground.position = new BABYLON.Vector3(camera.target.x, -0.5, camera.target.z)

				camera.minZ = Math.min(Math.max(0.1, camera.position.y / 100), 10);

				const cameraDirectionXZ = camera.target.subtract(camera.globalPosition).multiplyByFloats(1, 0, 1).normalize()
				const cameraDistanceToSkyEdge = BABYLON.Vector3.Distance(
					camera.globalPosition, skyDome.position.add(cameraDirectionXZ.scale(sceneDiameter / 2)))
				scene.fogStart = cameraDistanceToSkyEdge - (sceneDiameter / 2) * 0.15
				scene.fogEnd = cameraDistanceToSkyEdge + (sceneDiameter / 2) * 0.1

				scene.render();

			});

			// Watch for browser/canvas resize events
			window.addEventListener("resize", () => {
				engine.resize();
			});

			return result;

		}

		/**
		 * Creates an OSM2World viewer based on an already-existing Babylon scene.
		 * The caller is responsible for setting up a camera and render loop.
		 */
		static fromBabylonScene(babylonEngine, babylonScene, tileRoot, originLatLon, camera) {
			return new OSM2World.Viewer(babylonEngine, babylonScene, tileRoot, originLatLon, camera, false);
		}

		clearContent() {

			if (this.#model) {
				this.#model.dispose()
				this.#model = null
			}

			this.#loadedTiles.forEach(t => {if (t) {t.dispose()}})
			this.#loadedTiles.clear()

		}

		addModel(modelUrl) {
			this.clearContent()
			return BABYLON.SceneLoader.ImportMeshAsync(null, modelUrl).then((result) => {
				const mesh = result.meshes[0]
				this.#addMeshToScene(mesh, 0, 0, 0)
				this.#model = mesh
			})
		}

		setStatusCallback(callback) {
			this.#statusCallback = callback
		}

		setView(originLatLon, radius, alpha, beta) {

			console.log("Set view", originLatLon)

			this.originLatLon = originLatLon

			if (this.camera.internalCamera) {
				this.camera.target = new BABYLON.Vector3(0, 0, 0)
				this.camera.radius = radius || 500
				this.camera.alpha = alpha || Math.PI / 2
				this.camera.beta = beta || Math.PI / 4
			}

			this.clearContent() // TODO remove once updateTiles works

		}

		/**
		 * calls setView based on URL parameters such as lat and lon.
		 * If the parameters aren't present, defaults are used.
		 */
		#setViewFromUrl() {

			const urlParams = new URLSearchParams(window.location.search);

			const lat = urlParams.get("lat") || 48.5683;
			const lon = urlParams.get("lon") || 13.4514;

			let radius = parseFloat(urlParams.get("radius"));
			let alpha = parseFloat(urlParams.get("alpha"));
			let beta = parseFloat(urlParams.get("beta"));

			// support old parameters from maps.osm2world.org
			if (urlParams.get("zoom") && !urlParams.get("radius")) {
				radius = 100 * Math.pow(2, 20 - parseInt(urlParams.get("zoom")));
			}
			if (!urlParams.get("alpha")) {
				switch (urlParams.get("view")) {
					case "N": alpha = Math.PI * 0.5; break;
					case "W": alpha = Math.PI; break;
					case "S": alpha = Math.PI * 1.5; break;
					case "E": alpha = Math.PI * 2; break;
				}
			}

			this.setView(new LatLon(lat, lon), radius, alpha, beta)

		}

		/**
		 * Updates the URL with the current view
		 */
		#updateUrl() {

			const cameraLatLon = this.#getCameraLatLon()

			let newUrl = ''
				+ '?lat=' + cameraLatLon.lat.toFixed(7)
				+ '&lon=' + cameraLatLon.lon.toFixed(7)
				+ '&radius=' + this.camera.radius.toFixed(2)
				+ '&alpha=' + this.camera.alpha.toFixed(3)
				+ '&beta=' + this.camera.beta.toFixed(3);

			window.history.replaceState(null, "", newUrl)

		}

		/**
		 * loads and discards tiles based on the current camera position.
 		 */
		#updateTiles() {

			console.log(this.#engine.getFps().toFixed() + " fps")

			const maxTileRings = 10;

			const proj = new OrthographicAzimuthalMapProjection(this.originLatLon)
			const cameraXZ = (this.camera.target)
				? {x: -this.camera.target.x, z: -this.camera.target.z}
				: {x: 0, z: 0}
			const cameraRadius = this.camera.radius ? this.camera.radius : 0
			const cameraLatLon = proj.toLatLon(cameraXZ) // TODO: consider using #getCameraLatLon

			const centerTile = TileNumber.atLatLon(15, cameraLatLon)

			// determine a set of tiles near the camera

			let tilesNearCameraTarget = new Set()
			for (let x = -maxTileRings; x <= maxTileRings; x++) {
				for (let y = -maxTileRings; y <= maxTileRings; y++) {
					const tile = centerTile.add(x, y)
					const distance = this.#distanceToTile(proj, cameraXZ, tile)
					if (distance <= sceneDiameter / 2) {
						const lod = (distance <= highLodDiameter && cameraRadius <= highLodDiameter) ? 3 : 1
						tilesNearCameraTarget.add(new TileNumberWithLod(tile, lod))
					}
				}
			}
			tilesNearCameraTarget = Array.from(tilesNearCameraTarget)

			// load the tiles near the camera. Do so one ring at a time.
			// This ensures that something is visible in the center and reduces duplicate texture downloads.

			for (let ring = 0; ring <= maxTileRings; ring++) {
				let ringCompletelyLoaded = true
				for (let tWithLod of tilesNearCameraTarget) {
					const t = tWithLod.tileNumber;
					const tileRing = Math.max(Math.abs(t.x - centerTile.x), Math.abs(t.y - centerTile.y))
					if (tileRing === ring) {
						if (!this.#loadedTiles.has(tWithLod.toString())) {
							this.#loadAndPlaceTile(tWithLod)
							ringCompletelyLoaded = false
						}
					}
				}
				if (!ringCompletelyLoaded) break;
			}

			// discard tiles which are no longer near the camera

			for (const [tileNumberWithLod, mesh] of this.#loadedTiles) {
				if (!tilesNearCameraTarget.some(t => t.toString() === tileNumberWithLod)) {

					let tileNumberString = tileNumberWithLod.replace(/lod\d+\//, "")

					if (tilesNearCameraTarget.some(u => u.tileNumber.toString() === tileNumberString
						&& !this.#loadedTiles.get(u.toString()))) {
						// keep the tile at the old lod around until the new lod has been loaded
						console.log("Keeping tile: " + tileNumberWithLod)
						continue;
					}

					// discard this tile
					console.log("Discarding tile: " + tileNumberWithLod)
					if (mesh != null) { mesh.dispose() }
					this.#loadedTiles.delete(tileNumberWithLod)

				}
			}

			// update the URL based on the current view

			if (this.#updateUrlParameters) {
				this.#updateUrl()
			}

			// provide status info, e.g. to display a message that tiles are still being loaded

			if (this.#statusCallback) {
				const centerTileContent =  [0, 1, 2, 3, 4]
					.map(lod => this.#loadedTiles.get(new TileNumberWithLod(centerTile, lod).toString()))
					.find(t => !!t)
				this.#statusCallback({
					"centerTileLoading" : !centerTileContent,
					"centerTileMissing" : centerTileContent && centerTileContent.name && centerTileContent.name.startsWith("missing")
				})
			}

		}

		#loadAndPlaceTile(tileNumberWithLod) {
			if (!this.#loadedTiles.has(tileNumberWithLod.toString())) {
				this.#loadedTiles.set(tileNumberWithLod.toString(), null) // block further attempts to load the tile while this one is in progress
				const proj = new OrthographicAzimuthalMapProjection(this.originLatLon)
				const centerPos = proj.toXZ(tileNumberWithLod.tileNumber.bounds().center)
				console.log("Loading tile: " + tileNumberWithLod)
				return BABYLON.SceneLoader.ImportMeshAsync(null, this.tileLayerRootUrl, tileNumberWithLod + ".glb").then((result) => {
					const tileMesh = result.meshes[0]
					tileMesh.name = tileNumberWithLod.toString()
					this.#addMeshToScene(tileMesh, -centerPos.x, 0, -centerPos.z)
					this.#loadedTiles.set(tileNumberWithLod.toString(), tileMesh)
				}).catch(() => {
					const emptyTileMesh = new BABYLON.Mesh("missing: " + tileNumberWithLod, this.scene);
					this.#loadedTiles.set(tileNumberWithLod.toString(), emptyTileMesh)
				})
			} else {
				return Promise.resolve()
			}
		}

		#addMeshToScene(mesh, x, y, z) {
			mesh.setAbsolutePosition(x, y, z)
			if (this.#shadowGenerator) { this.#shadowGenerator.addShadowCaster(mesh, true) }
			mesh.getChildMeshes(false).forEach((c) => {c.receiveShadows = true})
		}

		/** returns the distance between a point and the bounds of a tile */
		#distanceToTile(proj, point, tile) {

			const min = proj.toXZ(tile.bounds().min)
			const max = proj.toXZ(tile.bounds().max)

			if (point.x >= min.x && point.x <= max.x
				&& point.z >= min.z && point.z <= max.z) {
				// point is within the tile
				return 0
			} else if (point.x >= min.x && point.x <= max.x) {
				// closest point is on a horizontal edge
				return Math.min(Math.abs(point.z - min.z), Math.abs(point.z - max.z));
			} else if  (point.x >= min.x && point.x <= max.x) {
				// closest point is on a vertical edge
				return Math.min(Math.abs(point.x - min.x), Math.abs(point.x - max.x));
			} else {
				// closest point is one of the corners
				const corners = [
					min,
					new XZ(min.x, max.z),
					new XZ(max.x, min.z),
					max
				];
				return Math.min(...corners.map(p => p.distanceTo(point)))
			}

		}

		#getCameraLatLon() {

			const proj = new OrthographicAzimuthalMapProjection(this.originLatLon)
			const cameraXZ = {x: -this.camera.target.x, z: -this.camera.target.z}
			return proj.toLatLon(cameraXZ)

		}

	}

})();