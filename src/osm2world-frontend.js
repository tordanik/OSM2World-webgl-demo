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
		tileRoot;
		camera;
		originLatLon;

		#shadowGenerator;
		#loadedTiles = new Set();

		/**
		 * @param {string} canvasID  id of the canvas to use for the viewer
		 * @param {string} tileRoot  root URL for 3D tiles in glTF format
		 */
		constructor(canvasID, tileRoot) {

			this.canvas = document.getElementById(canvasID);
			this.canvas.setAttribute("touchAction", "none");

			this.tileRoot = tileRoot;

			const engine = new BABYLON.Engine(this.canvas, true);

			const scene = new BABYLON.Scene(engine);

			const skyDome = new BABYLON.PhotoDome("sky", "sky_dome.jpg", { size: 5000 }, scene);

			const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 1));
			light.intensity = 0.5

			const sunLight = new BABYLON.DirectionalLight("sunlight", new BABYLON.Vector3(-1, -1, -1))
			sunLight.intensity = 1.0 - light.intensity
			this.#shadowGenerator = new BABYLON.CascadedShadowGenerator(2048, sunLight)
			this.#shadowGenerator.autoCalcDepthBounds = true
			this.#shadowGenerator.forceBackFacesOnly = true
			this.#shadowGenerator._darkness = -2

			const urlParams = new URLSearchParams(window.location.search);
			const lat = urlParams.get("lat") || 48.14738;
			const lon = urlParams.get("lon") || 11.57403;
			this.setView(new LatLon(lat, lon))

			// Register a render loop to repeatedly render the scene
			engine.runRenderLoop(() => {
				skyDome.position = new BABYLON.Vector3(this.camera.target.x, 0, this.camera.target.z)
				scene.render();
			});

			// Watch for browser/canvas resize events
			window.addEventListener("resize", () => {
				engine.resize();
			});

		}

		setView(originLatLon) {

			console.log(originLatLon)

			this.originLatLon = originLatLon

			if (this.camera) { this.camera.dispose() }
			this.camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 4, 500, new BABYLON.Vector3(0, 0, 0));
			this.camera.attachControl(this.canvas, true);
			this.camera.minZ = 10;
			this.camera.maxZ = 10000;
			this.camera.panningSensibility = 3;

			const centerTile = TileNumber.atLatLon(15, originLatLon)

			this.#loadedTiles.forEach(t => {t.dispose()})

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
			return BABYLON.SceneLoader.ImportMeshAsync(null, this.tileRoot, "lod1/" + tileNumber + ".glb").then((result) => {
				const centerPos = proj.toXZ(tileNumber.bounds().center)
				const tileMesh = result.meshes[0]
				tileMesh.setAbsolutePosition(-centerPos.x, 0, -centerPos.y)
				this.#shadowGenerator.addShadowCaster(tileMesh, true)
				tileMesh.getChildMeshes(false).forEach((c) => {c.receiveShadows = true})
				this.#loadedTiles.add(tileMesh)
			})
		}

	}

})();