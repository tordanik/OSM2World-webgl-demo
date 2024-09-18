"use strict";

/**
 * Namespace for the OSM2World web frontend.
 * @namespace
 */
const OSM2World = {};
(function() {

	const ssrEnabled = false;
	const sceneDiameter = 10000;

	/** WebGL-based viewer */
	OSM2World.Viewer = class {

		#engine;
		canvas;
		scene;
		camera;
		originLatLon;

		#shadowGenerator;

		tileLayerRootUrl;

		/** currently loaded tiles in a map from TileNumberWithLod string representations to meshes */
		#loadedTiles = new Map();

		modelUrl;
		#model = null;

		#ground;

		/**
		 * @param {string} canvasID  id of the canvas to use for the viewer
		 * @param {string} tileRoot  root URL for 3D tiles in glTF format
		 */
		constructor(canvasID, tileRoot) {

			this.canvas = document.getElementById(canvasID);
			this.canvas.setAttribute("touchAction", "none");

			this.tileLayerRootUrl = tileRoot;

			this.#engine = new BABYLON.Engine(this.canvas, true);

			this.scene = new BABYLON.Scene(this.#engine);

			this.scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR
			this.scene.fogColor = new BABYLON.Color3(0.6, 0.6, 0.7);

			this.camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 4, 500, new BABYLON.Vector3(0, 0, 0));
			this.camera.attachControl(this.canvas, true);
			this.camera.minZ = 0.1;
			this.camera.maxZ = sceneDiameter * 1.1;
			this.camera.lowerBetaLimit = 0;
			this.camera.upperBetaLimit = Math.PI / 2.1; // almost horizontal
			this.camera.lowerRadiusLimit = 1;
			this.camera.upperRadiusLimit = sceneDiameter / 2.1;
			this.camera.mapPanning = true; // prevents vertical panning
			this.camera.panningSensibility = 5;

			this.scene.environmentTexture = new BABYLON.HDRCubeTexture("DaySkyHDRI041B.hdr", this.scene, 512, false, true, false, true)

			const skyDome = new BABYLON.PhotoDome("sky", "DaySkyHDRI041B.jpg", { size: sceneDiameter }, this.scene);
			skyDome.material.fogEnabled = false
			skyDome.rotate(new BABYLON.Vector3(0, 1, 0), -Math.PI / 4) // rotate to match reflection texture

			this.#ground = BABYLON.MeshBuilder.CreateGround("ground", {height: sceneDiameter, width: sceneDiameter})

			const sunLight = new BABYLON.DirectionalLight("sunlight", new BABYLON.Vector3(-1, -1, -1))
			sunLight.intensity = 1.0
			this.#shadowGenerator = new BABYLON.CascadedShadowGenerator(2048, sunLight)
			this.#shadowGenerator.autoCalcDepthBounds = true
			this.#shadowGenerator.forceBackFacesOnly = true

			const defaultPipeline = new BABYLON.DefaultRenderingPipeline("defaultPipeline", true, this.scene, [this.camera])
			defaultPipeline.samples = 4
			if (ssrEnabled) {
				defaultPipeline.fxaaEnabled = true
				const ssr = new BABYLON.SSRRenderingPipeline("ssr", this.scene, [this.camera])
			}

			const urlParams = new URLSearchParams(window.location.search);
			const lat = urlParams.get("lat") || 48.14738;
			const lon = urlParams.get("lon") || 11.57403;
			this.setView(new LatLon(lat, lon))

			// regularly update the loaded tiles
			setInterval(() => this.#updateTiles(), 1000);

			// Register a render loop to repeatedly render the scene
			this.#engine.runRenderLoop(() => {

				skyDome.position = new BABYLON.Vector3(this.camera.target.x, 0, this.camera.target.z)
				this.#ground.position = new BABYLON.Vector3(this.camera.target.x, -0.5, this.camera.target.z)

				this.camera.minZ = Math.min(Math.max(0.1, this.camera.position.y / 100), 10);

				const cameraDirectionXZ = this.camera.target.subtract(this.camera.globalPosition).multiplyByFloats(1, 0, 1).normalize()
				const cameraDistanceToSkyEdge = BABYLON.Vector3.Distance(
					this.camera.globalPosition, skyDome.position.add(cameraDirectionXZ.scale(sceneDiameter / 2)))
				this.scene.fogStart = cameraDistanceToSkyEdge - (sceneDiameter / 2) * 0.15
				this.scene.fogEnd = cameraDistanceToSkyEdge + (sceneDiameter / 2) * 0.1

				this.scene.render();

			});

			// Watch for browser/canvas resize events
			window.addEventListener("resize", () => {
				this.#engine.resize();
			});

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

		setView(originLatLon) {

			console.log("Set view", originLatLon)

			this.originLatLon = originLatLon

			this.camera.target = new BABYLON.Vector3(0, 0, 0)
			this.camera.alpha = Math.PI / 2
			this.camera.beta = Math.PI / 4
			this.camera.radius = 500

			this.clearContent() // TODO remove once updateTiles works

		}

		/**
		 * loads and discards tiles based on the current camera position.
 		 */
		#updateTiles() {

			console.log(this.#engine.getFps().toFixed() + " fps")

			const maxTileRings = 10;

			const proj = new OrthographicAzimuthalMapProjection(this.originLatLon)
			const cameraXZ = {x: -this.camera.target.x, z: -this.camera.target.z}
			const cameraLatLon = proj.toLatLon(cameraXZ)

			const centerTile = TileNumber.atLatLon(15, cameraLatLon)

			// determine a set of tiles near the camera

			let tilesNearCameraTarget = new Set()
			for (let x = -maxTileRings; x <= maxTileRings; x++) {
				for (let y = -maxTileRings; y <= maxTileRings; y++) {
					const tile = centerTile.add(x, y)
					const distance = this.#distanceToTile(proj, cameraXZ, tile)
					if (distance <= sceneDiameter / 1.9) { // could be sceneDiameter / 2 if it wasn't distance to the center
						const lod = tile.equals(centerTile) ? 3 : 1
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

		}

		#loadAndPlaceTile(tileNumberWithLod) {
			if (!this.#loadedTiles.has(tileNumberWithLod.toString())) {
				this.#loadedTiles.set(tileNumberWithLod.toString(), null) // block further attempts to load the tile while this one is in progress
				const proj = new OrthographicAzimuthalMapProjection(this.originLatLon)
				const centerPos = proj.toXZ(tileNumberWithLod.tileNumber.bounds().center)
				console.log("Loading tile: " + tileNumberWithLod)
				return BABYLON.SceneLoader.ImportMeshAsync(null, this.tileLayerRootUrl, tileNumberWithLod + ".glb").then((result) => {
					const tileMesh = result.meshes[0]
					this.#addMeshToScene(tileMesh, -centerPos.x, 0, -centerPos.z)
					this.#loadedTiles.set(tileNumberWithLod.toString(), tileMesh)
				})
			} else {
				return Promise.resolve()
			}
		}

		#addMeshToScene(mesh, x, y, z) {
			mesh.setAbsolutePosition(x, y, z)
			this.#shadowGenerator.addShadowCaster(mesh, true)
			mesh.getChildMeshes(false).forEach((c) => {c.receiveShadows = true})
		}

		/** returns the distance between a point and the bounds of a tile */
		#distanceToTile(proj, point, tile) {

			const min = proj.toXZ(tile.bounds().min)
			const max = proj.toXZ(tile.bounds().max)

			if (point.x >= min.x && point.x <= max.x
				&& point.z >= min.z && point.z <= max.z) {
				return 0
			} else {

				// TODO: this isn't accurate if the tile boundary's closest point is on one of its edges (not a corner)

				const points = [
					min,
					new XZ(min.x, max.z),
					new XZ(max.x, min.z),
					max
				];

				return Math.min(...points.map(p => p.distanceTo(point)))

			}

		}

	}

})();