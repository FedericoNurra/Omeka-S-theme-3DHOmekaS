# 3DHOmekaS
An Omeka S theme for 3DHOP visualisations

## How to use it
Create an item and associate 3D medias (ply, nxs , nxz format are allowed). A 3DHOP viewer will display your 3D models.
You can also add geojson and kml media (leaflet viewer), as well as pdf, mp3 and mp4 files.
If you connect two items through the "dcterms:hasPart" properties, the associated 3D medias of the connected item will be shown on the primary item.

## Note:
On the /admin/setting of your Omeka S installation, remember to check "Disable file validation" to allow ply, nxs , nxz, geojson files upload as item medias, or add "ply, nxs , nxz" to the validation format array.
