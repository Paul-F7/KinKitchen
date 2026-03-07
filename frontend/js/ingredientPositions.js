/* eslint-disable no-unused-vars */
'use strict';

// Hardcoded ingredient positions on the counter.
// Slot names follow the pattern: ingredientName_N (1-indexed).
// Move ingredients in the 3D view and use the live position panel to read
// updated coordinates, then paste them back here.
var INGREDIENT_POSITIONS = {
  tomato_1:  { x: -2.3359, y: 2.9709, z: 0.5000 },
  tomato_2:  { x: -1.4891, y: 2.9539, z: 0.6085 },
  tomato_3:  { x: -2.0000, y: 2.9922, z: -0.0636 },
  tomato_4:  { x: -1.7961, y: 2.9727, z: 0.3426 },

  garlic_1:           { x: -1.2249, y: 3.1085, z: -0.2336 },
  garlic_2:           { x: -1.2885, y: 3.1127, z: -0.0101 },

  cabbage_1:          { x: 1.0,     y: 3.1,    z: 0.5    },

  canned_beans_1:     { x: -1.5064, y: 3.2117, z: 0.5000 },
  onion_1:            { x: -1.2763, y: 2.9741, z: -0.6204 },
  butternut_squash_1: { x: -1.7433, y: 2.9802, z: -0.2553 },
  canned_corn_1:      { x: -1.1341, y: 3.1862, z: 0.5001 },
  chicken_stock_1:    { x: -1.7173, y: 3.2265, z: 0.1202 },
};

// Per-ingredient scale overrides (uniform). Falls back to DEFAULT_SCALE.
var INGREDIENT_SCALES = {
  tomato: 1.0,
  garlic: 0.2500,
  cabbage: 0.8,
  canned_beans: 0.0181,
  onion: 0.0248,
  butternut_squash: 3.5300,
  canned_corn: 0.1694,
  chicken_stock: 0.2689,
};
var DEFAULT_SCALE = 0.5;

// Per-ingredient rotation overrides in radians { x, y, z }.
// Falls back to DEFAULT_ROTATION.
var INGREDIENT_ROTATIONS = {
  garlic:           { x: 0.0000, y:  0.0000, z: 0.0000 },
  canned_beans:     { x: 0.0000, y: -1.3236, z: 0.0000 },
  onion:            { x: 0.0000, y:  0.0000, z: 0.1616 },
  butternut_squash: { x: 0.0000, y:  0.0000, z: 0.0000 },
  canned_corn:      { x: 0.0000, y:  1.1315, z: 0.0000 },
  chicken_stock:    { x: -3.1416, y: 0.5964, z: -3.1416 },
};
var DEFAULT_ROTATION = { x: 0, y: 0, z: 0 };