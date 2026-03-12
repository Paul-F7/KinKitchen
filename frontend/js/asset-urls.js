/* AUTO-GENERATED — small files on Cloudinary, large files on jsDelivr (GitHub CDN) */
const _CL = 'https://res.cloudinary.com/dpnvlbwei';
const _GH = 'https://cdn.jsdelivr.net/gh/EVAnunit1307/Hack_Can_3_man@main';

window.ASSET_URLS = {
  /* ── Cloudinary (≤10 MB) ── */
  '/assets/3d/cabbage.glb':        `${_CL}/raw/upload/kin-kitchen/3d/cabbage.glb`,
  '/assets/3d/canned-beans.glb':   `${_CL}/raw/upload/kin-kitchen/3d/canned-beans.glb`,
  '/assets/3d/chicken-stock.glb':  `${_CL}/raw/upload/kin-kitchen/3d/chicken-stock.glb`,
  '/assets/3d/garlic.glb':         `${_CL}/raw/upload/kin-kitchen/3d/garlic.glb`,
  '/assets/3d/kitchen.glb':        `${_CL}/raw/upload/kin-kitchen/3d/kitchen.glb`,
  '/assets/3d/onion.glb':          `${_CL}/raw/upload/kin-kitchen/3d/onion.glb`,
  '/assets/3d/orange-cube.glb':    `${_CL}/raw/upload/kin-kitchen/3d/orange-cube.glb`,
  '/assets/3d/pot.glb':            `${_CL}/raw/upload/kin-kitchen/3d/pot.glb`,
  '/assets/3d/stew.glb':           `${_CL}/raw/upload/kin-kitchen/3d/stew.glb`,
  '/assets/3d/patato-onion-fry.glb': `${_GH}/assets/3d/patato-onion-fry.glb`,
  '/assets/3d/rice-and-beans.glb':   `${_GH}/assets/3d/rice-and-beans.glb`,
  '/assets/3d/bean-chilli.glb':      `${_GH}/assets/3d/bean-chilli.glb`,
  '/assets/3d/tomato.glb':         `${_CL}/raw/upload/kin-kitchen/3d/tomato.glb`,
  '/assets/3d/vegetable_soup.glb': `${_CL}/raw/upload/kin-kitchen/3d/vegetable_soup.glb`,
  '/assets/lesson-in-balance.mp4':   `${_CL}/video/upload/kin-kitchen/lesson-in-balance.mp4`,
  '/assets/story-video.mp4':         `${_CL}/video/upload/kin-kitchen/story-video.mp4`,
  '/assets/potato-onion-fry.mp4':    `${_CL}/video/upload/kin-kitchen/potato-onion-fry.mp4`,
  '/assets/rice-and-beans.mp4':      `${_CL}/video/upload/kin-kitchen/rice-and-beans.mp4`,
  '/assets/bean-chilli.mp4':         `${_CL}/video/upload/kin-kitchen/bean-chilli.mp4`,

  /* ── jsDelivr / GitHub CDN (>10 MB) ── */
  '/assets/3d/diced-potato.glb':                           `${_GH}/assets/3d/diced-potato.glb`,
  '/assets/3d/potato.glb':                                 `${_GH}/assets/3d/potato.glb`,
  '/assets/3d/rice.glb':                                   `${_GH}/assets/3d/rice.glb`,
  '/assets/3d/butternut-squash.glb':                       `${_GH}/assets/3d/butternut-squash.glb`,
  '/assets/3d/canned-corn.glb':                            `${_GH}/assets/3d/canned-corn.glb`,
  '/assets/3d/cutting-board.glb':                          `${_GH}/assets/3d/cutting-board.glb`,
  '/assets/3d/diced_onions.glb':                           `${_GH}/assets/3d/diced_onions.glb`,
  '/assets/3d/kitchen2.glb':                               `${_GH}/assets/3d/kitchen2.glb`,
  '/assets/3d/minced-garlic.glb':                          `${_GH}/assets/3d/minced-garlic.glb`,
  '/assets/3d/orange-pile-cubes.glb':                      `${_GH}/assets/3d/orange-pile-cubes.glb`,
  '/assets/3d/pile-cubes.glb':                             `${_GH}/assets/3d/pile-cubes.glb`,
  '/assets/3d/residential_buildings_ancient_villages.glb': `${_GH}/assets/3d/residential_buildings_ancient_villages.glb`,
  '/assets/3d/vietnamese_village__drone_3d_scan.glb':      `${_GH}/assets/3d/vietnamese_village__drone_3d_scan.glb`,
};

/* Dev → local paths. Prod → CDN */
window.assetUrl = function(p) {
  const isProd = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
  return isProd ? (window.ASSET_URLS[p] || p) : p;
};
