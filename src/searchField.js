"use strict"

function setupSearchField(viewer, canvas) {

    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const resultsList = document.getElementById('resultsList')

    canvas.addEventListener('click', () => clearResults())

    searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            handleSearch();
        }
    });

    searchButton.addEventListener('click', function () {
        handleSearch();
    });

    resultsList.addEventListener('click', function (event) {
        if (event.target.tagName === 'LI') {
            const selectedResult = event.target
            viewer.setView(new LatLon(
                parseFloat(selectedResult.dataset.lat),
                parseFloat(selectedResult.dataset.lon)))
            clearResults()
        }
    });

    function handleSearch() {
        const searchTerm = searchInput.value.trim();

        if (searchTerm.length >= 1) {
            const apiUrl = `https://nominatim.openstreetmap.org/search?format=geojson&q=${encodeURIComponent(searchTerm)}`;

            fetch(apiUrl)
                .then(response => response.json())
                .then(data => displayResults(data.features))
                .catch(error => console.error('Error fetching data:', error));
        } else {
            clearResults() // Clear the results list if the search term is too short
        }
    }

    function clearResults() {
        resultsList.innerHTML = '';
    }

    function displayResults(results) {
        clearResults(); // Clear previous results

        results.forEach(result => {
            const li = document.createElement('li');
            li.textContent = result.properties.display_name;
            li.dataset.lat = result.geometry.coordinates[1];
            li.dataset.lon = result.geometry.coordinates[0];
            resultsList.appendChild(li);
        });
    }

}