"use strict";

/**
 * Namespace for the OSM2World web frontend.
 * @namespace
 */
const OSM2World = {};
(function() {

	/** WebGL-based viewer */
	OSM2World.Viewer = class {

		canvas;
		scene;
		camera;
		originLatLon;

		#shadowGenerator;

		tileLayerRootUrl;
		#loadedTiles = new Set();

		modelUrl;
		#model = null;

		/**
		 * @param {string} canvasID  id of the canvas to use for the viewer
		 * @param {string} tileRoot  root URL for 3D tiles in glTF format
		 */
		constructor(canvasID, tileRoot) {

			this.canvas = document.getElementById(canvasID);
			this.canvas.setAttribute("touchAction", "none");

			this.tileLayerRootUrl = tileRoot;

			const engine = new BABYLON.Engine(this.canvas, true);

			this.scene = new BABYLON.Scene(engine);

			this.camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 4, 500, new BABYLON.Vector3(0, 0, 0));
			this.camera.attachControl(this.canvas, true);
			this.camera.minZ = 0.1;
			this.camera.maxZ = 10000;
			this.camera.lowerBetaLimit = 0;
			this.camera.upperBetaLimit = Math.PI / 2.1; // almost horizontal
			this.camera.lowerRadiusLimit = 1;
			this.camera.upperRadiusLimit = 4000;
			this.camera.mapPanning = true; // prevents vertical panning
			this.camera.panningSensibility = 5;


			const skyDome = new BABYLON.PhotoDome("sky", "sky_dome.jpg", { size: this.camera.upperRadiusLimit * 2.1 }, this.scene);

			const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 1));
			light.intensity = 0.5

			const sunLight = new BABYLON.DirectionalLight("sunlight", new BABYLON.Vector3(-1, -1, -1))
			sunLight.intensity = 1.0 - light.intensity
			this.#shadowGenerator = new BABYLON.CascadedShadowGenerator(2048, sunLight)
			this.#shadowGenerator.autoCalcDepthBounds = true
			this.#shadowGenerator.forceBackFacesOnly = true
			this.#shadowGenerator._darkness = 0

			new BABYLON.SSRRenderingPipeline("ssr", this.scene, [this.camera])

			const urlParams = new URLSearchParams(window.location.search);
			const lat = urlParams.get("lat") || 48.14738;
			const lon = urlParams.get("lon") || 11.57403;
			this.setView(new LatLon(lat, lon))

			// Register a render loop to repeatedly render the scene
			engine.runRenderLoop(() => {
				skyDome.position = new BABYLON.Vector3(this.camera.target.x, 0, this.camera.target.z)
				this.scene.render();
			});

			// Watch for browser/canvas resize events
			window.addEventListener("resize", () => {
				engine.resize();
			});

		}

		clearContent() {

			if (this.#model) {
				this.#model.dispose()
				this.#model = null
			}

			this.#loadedTiles.forEach(t => {t.dispose()})
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

			console.log(originLatLon)

			this.originLatLon = originLatLon

			this.camera.target = new BABYLON.Vector3(0, 0, 0)
			this.camera.alpha = Math.PI / 2
			this.camera.beta = Math.PI / 4
			this.camera.radius = 500

			const centerTile = TileNumber.atLatLon(15, originLatLon)

			this.clearContent()

			this.loadAndPlaceTile(centerTile, true).then(() => {
				setTimeout(() => {
					for (let x = -3; x <= 3; x++) {
						for (let y = -3; y <= 3; y++) {
							let dist = Math.abs(x) + Math.abs(y);
							if (dist > 0 && dist <= 4) {
								this.loadAndPlaceTile(centerTile.add(x, y))
							}
						}
					}
				}, 500);
			})

		}

		loadAndPlaceTile(tileNumber) {
			const proj = new OrthographicAzimuthalMapProjection(this.originLatLon)
			const centerPos = proj.toXZ(tileNumber.bounds().center)
			return BABYLON.SceneLoader.ImportMeshAsync(null, this.tileLayerRootUrl, "lod1/" + tileNumber + ".glb").then((result) => {
				const tileMesh = result.meshes[0]
				this.#addMeshToScene(tileMesh, -centerPos.x, 0, -centerPos.y)
				this.#loadedTiles.add(tileMesh)
			})
		}

		#addMeshToScene(mesh, x, y, z) {
			mesh.setAbsolutePosition(x, y, z)
			this.#shadowGenerator.addShadowCaster(mesh, true)
			mesh.getChildMeshes(false).forEach((c) => {c.receiveShadows = true})
		}

	}

})();