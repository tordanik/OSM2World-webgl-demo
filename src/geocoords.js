"use strict"

/**
 * coordinate pair with latitude and longitude in degrees
 */
class LatLon {
    constructor(lat, lon) {
        this.lat = lat
        this.lon = lon
    }
    toString() {
        return this.lat + ", " + this.lon;
    }
}

/**
 * coordinate pair with x and z in meters
 */
class XZ {
    constructor(x, z) {
        this.x = x
        this.z = z
    }
    toString() {
        return this.x + ", " + this.z;
    }
    distanceTo(other) {
        return Math.sqrt((other.x - this.x) ** 2 + (other.z - this.z) ** 2)
    }
}

/**
 * tile number with zoom level.
 * Tile coords follow the common XYZ convention, with an Y axis that points southward.
 */
class TileNumber {

    constructor(zoom, x, y) {

        this.zoom = zoom
        this.x = x
        this.y = y

        if (zoom < 0) {
            throw new Error("illegal tile number, zoom must not be negative: " + toString());
        } else if (x < 0 || y < 0) {
            throw new Error("illegal tile number, x and y must not be negative: " + toString());
        } else if (x >= (1 << zoom)) {
            throw new Error("illegal tile number, x too large: " + toString());
        } else if (y >= (1 << zoom)) {
            throw new Error("illegal tile number, y too large: " + toString());
        }

    }

    toString() {
        return `${this.zoom}/${this.x}/${this.y}`
    }

    add(x, y) {
        return new TileNumber(this.zoom, this.x + x, this.y + y)
    }

    /** returns the TileNumber at the given zoom and location */
    static atLatLon(zoom, latLon) {
        const x = Math.floor((latLon.lon + 180) / 360 * (1<<zoom));
        const y = Math.floor((1 - Math.log(Math.tan(toRadians(latLon.lat)) + 1 / Math.cos(toRadians(latLon.lat))) / Math.PI) / 2 * (1<<zoom));
        return new TileNumber(zoom, x, y);
    }

    bounds() {
        const min = new LatLon(
            TileNumber.tile2lat(this.y + 1, this.zoom),
            TileNumber.tile2lon(this.x, this.zoom));
        const max = new LatLon(
            TileNumber.tile2lat(this.y, this.zoom),
            TileNumber.tile2lon(this.x + 1, this.zoom));
        const center = new LatLon((min.lat + max.lat) / 2, (min.lon + max.lon) / 2);
        return {min: min, max: max, center: center};
    }

    static tile2lon(x, z) {
        return x / Math.pow(2.0, z) * 360.0 - 180;
    }

    static tile2lat(y, z) {
        const n = Math.PI - (2.0 * Math.PI * y) / Math.pow(2.0, z)
        return toDegrees(Math.atan(Math.sinh(n)))
    }

}

/**
 * application of an orthographic projection that is intended to use values in meters centered around the coordinate
 * center (0,0). It projects coordinates onto a plane touching the globe at the origin.
 * This results in sufficient accuracy if the data covers only a small part of the globe.
 */
class OrthographicAzimuthalMapProjection {

    constructor(origin) {
        this.origin = origin;
        this._lat0 = toRadians(origin.lat);
        this._lon0 = toRadians(origin.lon);
    }

    toXZ(latLon) {

        const lat = toRadians(latLon.lat);
        const lon = toRadians(latLon.lon);

        const x = GLOBE_RADIUS * Math.cos(lat) * Math.sin(lon - this._lon0);
        const z = GLOBE_RADIUS * (Math.cos(this._lat0) * Math.sin(lat) - Math.sin(this._lat0) * Math.cos(lat) * Math.cos(lon - this._lon0));

        return new XZ(x, z);

    }

    toLat(pos) {

        const rho = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
        const c = Math.asin(rho / GLOBE_RADIUS);

        if (rho > 0) {
            return toDegrees(Math.asin( Math.cos(c) * Math.sin(this._lat0) + ( pos.z * Math.sin(c) * Math.cos(this._lat0) ) / rho ));
        } else {
            return toDegrees(this._lat0);
        }

    }

    toLon(pos) {

        const rho = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
        const c = Math.asin(rho / GLOBE_RADIUS);

        const div = rho * Math.cos(this._lat0) * Math.cos(c) - pos.z * Math.sin(this._lat0) * Math.sin(c);

        if (Math.abs(div) > 1e-5) {
            return toDegrees(this._lon0 + Math.atan2( pos.x * Math.sin(c), div ));
        } else {
            return toDegrees(this._lon0);
        }

    }

    toLatLon(pos) {
        return new LatLon(this.toLat(pos), this.toLon(pos))
    }

}

const GLOBE_RADIUS = 6371000;

function toDegrees(angleInRadians) {
    return angleInRadians * (180 / Math.PI)
}

function toRadians(angleInDegrees) {
    return angleInDegrees * (Math.PI / 180);
}
