"use strict";

/**
 * Namespace for the OSM2World web frontend.
 * @namespace
 */
var OSM2World = {};
(function() {

	/** WebGL-based viewer */
	OSM2World.Viewer = class {

		/**
		 * @param {string} canvasID  id of the canvas to use for the viewer
		 */
		constructor(canvasID) {

			var canvas = document.getElementById(canvasID);
			//renderer = new THREE.WebGLRenderer({ canvas: canvas });

		}

	}

})();
