# Sword art (for the artist)

Drop transparent PNGs here and the game picks one at random for each falling sword:

    sword1.png   sword2.png   sword3.png

- **Draw the sword pointing DOWN** (tip at the bottom), it falls straight down without rotating.
- Tall and thin, about 64 x 160 px. It is drawn about 30 px wide and 84 px tall in the arena, so keep it bold and readable.
- Transparent background. One file is enough.
- If there are no files, the game draws a simple sword instead.
- To allow more than 3 designs, change `artSlots` in `src/hazard.js` and the file list in `src/ui/hazardRender.js`.
