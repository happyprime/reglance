# Reglance

Visual regression at a glance.

# Reports

1. Create a view-compare directory when capture.js runs, if it does not yet exist.
2. Create a "latest" directory within view-compare, if it does not yet exist.
3. Create a timestamp directory within view-compare, if it does not yet exist.
4. Normalize the URL and viewport dimensions passed to capture.js to create a filename.
5. Store the captured PNG file in the timestamp directory, replace any existing file of the same name in the latest directory.
