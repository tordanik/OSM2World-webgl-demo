"use strict";

/**
 * Namespace for the OSM2World web frontend.
 * @namespace
 */
const OSM2World = {};
(function() {

	/** WebGL-based viewer */
	OSM2World.Viewer = class {

		/**
		 * @param {string} canvasID  id of the canvas to use for the viewer
		 * @param {string} tileRoot  root URL for 3D tiles in glTF format
		 */
		constructor(canvasID, tileRoot) {

			const canvas = document.getElementById(canvasID);
			canvas.setAttribute("touchAction", "none");

			const engine = new BABYLON.Engine(canvas, true);

			const scene = new BABYLON.Scene(engine);

			const skyDome = new BABYLON.PhotoDome("sky", "sky_dome.jpg", { size: 5000 }, scene);

			const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 4, 500, new BABYLON.Vector3(0, 0, 0));
			camera.attachControl(canvas, true);
			camera.minZ = 10;
			camera.maxZ = 10000;
			camera.panningSensibility = 3;

			const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 1));

			const urlParams = new URLSearchParams(window.location.search);
			console.log(urlParams);

			const lat = urlParams.get("lat") || 48.14738;
			const lon = urlParams.get("lon") || 11.57403;
			const originLatLon = new LatLon(lat, lon)
			const proj = new OrthographicAzimuthalMapProjection(originLatLon)
			const centerTile = TileNumber.atLatLon(15, originLatLon)

			function loadAndPlaceTile(tileNumber) {
				return BABYLON.SceneLoader.ImportMeshAsync(null, tileRoot, "lod1/" + tileNumber + ".glb").then((result) => {
					const centerPos = proj.toXZ(tileNumber.bounds().center)
					result.meshes[0].setAbsolutePosition(-centerPos.x, 0, -centerPos.y)
				})
			}

			loadAndPlaceTile(centerTile, true).then(() => {
				setTimeout(function () {
					for (let x = -3; x <= 3; x++) {
						for (let y = -3; y <= 3; y++) {
							let dist = Math.abs(x) + Math.abs(y);
							if (dist > 0 && dist <= 4) {
								loadAndPlaceTile(centerTile.add(x, y))
							}
						}
					}
				}, 500);
			})

			// Register a render loop to repeatedly render the scene
			engine.runRenderLoop(function () {
				skyDome.position = new BABYLON.Vector3(camera.target.x, 0, camera.target.z)
				scene.render();
			});

			// Watch for browser/canvas resize events
			window.addEventListener("resize", function () {
				engine.resize();
			});

		}

	}

})();