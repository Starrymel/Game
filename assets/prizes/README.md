# Prize art (for the artist)

Drop transparent PNGs here and the game picks one at random for each falling prize:

    prize1.png   prize2.png   prize3.png

- Square-ish, about 128x128 px (it is drawn at about 38 px, so keep the shape simple and readable).
- Transparent background. Draw it facing the viewer (it falls straight down, no flipping).
- You can add just one file. If none exist, the game draws a golden star instead.
- To allow more than 3 designs, change `artSlots` in `src/prize.js` and the file list in `src/ui/prizeRender.js`.
