/* global THREE, escapeHtml */
'use strict';

const ASSETS_PATH = '/assets/3d';
const CAMERA_STORAGE_KEY = 'kitchen3d_camera';
const loader = new THREE.GLTFLoader();

const INGREDIENT_SCALES = {
  tomato: 1.0,
  garlic: 0.25,
  cabbage: 0.8,
};
const DEFAULT_SCALE = 0.5;

let scene, camera, renderer, orbitControls, transformControls;
let ingredientMeshes = [];
let selectedObject = null;

function initScene(container) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd4d4d4);

  camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 100);

  // Fixed counter-level camera
  camera.position.set(0.1257, 4.2654, -3.5369);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  // Lighting
  const hemisphere = new THREE.HemisphereLight(0xfff5e6, 0x8090a0, 0.4);
  scene.add(hemisphere);

  const ambient = new THREE.AmbientLight(0xffeedd, 0.3);
  scene.add(ambient);

  // Key light (main directional)
  const directional = new THREE.DirectionalLight(0xfff8f0, 1.0);
  directional.position.set(3, 6, 2);
  directional.castShadow = true;
  directional.shadow.mapSize.width = 2048;
  directional.shadow.mapSize.height = 2048;
  directional.shadow.camera.near = 0.5;
  directional.shadow.camera.far = 20;
  directional.shadow.camera.left = -6;
  directional.shadow.camera.right = 6;
  directional.shadow.camera.top = 6;
  directional.shadow.camera.bottom = -6;
  directional.shadow.bias = -0.0005;
  directional.shadow.normalBias = 0.02;
  scene.add(directional);

  // Fill light (softer, opposite side)
  const fillLight = new THREE.DirectionalLight(0xc8d8ff, 0.4);
  fillLight.position.set(-3, 4, -2);
  scene.add(fillLight);

  // Rim/back light for depth
  const rimLight = new THREE.DirectionalLight(0xfff0dd, 0.3);
  rimLight.position.set(0, 3, -4);
  scene.add(rimLight);

  // Controls
  orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.target.set(0.1169, 3.2055, 0.7738);

  transformControls = new THREE.TransformControls(camera, renderer.domElement);
  transformControls.addEventListener('dragging-changed', (event) => {
    orbitControls.enabled = !event.value;
  });
  scene.add(transformControls);

  // Click to select
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  renderer.domElement.addEventListener('click', (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(ingredientMeshes, true);

    if (intersects.length > 0) {
      let target = intersects[0].object;
      // Walk up to find the ingredient group
      while (target.parent && !ingredientMeshes.includes(target)) {
        target = target.parent;
      }
      selectObject(target);
    } else {
      deselectObject();
    }
  });

  // Lock camera by default
  orbitControls.enabled = false;

  // Keyboard: toggle transform mode
  window.addEventListener('keydown', (e) => {
    if (!selectedObject) return;
    if (e.key === 'g') transformControls.setMode('translate');
    if (e.key === 'r') transformControls.setMode('rotate');
    if (e.key === 's') transformControls.setMode('scale');
    if (e.key === 'Escape') deselectObject();
  });

  // Resize
  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  // Render loop
  function animate() {
    requestAnimationFrame(animate);
    orbitControls.update();
    renderer.render(scene, camera);
  }
  animate();
}

function selectObject(obj) {
  if (selectedObject === obj) return;
  deselectObject();
  selectedObject = obj;
  transformControls.attach(obj);
}

function deselectObject() {
  selectedObject = null;
  transformControls.detach();
}

function loadKitchen() {
  return new Promise((resolve, reject) => {
    loader.load(
      `${ASSETS_PATH}/kitchen2.glb`,
      (gltf) => {
        const kitchen = gltf.scene;
        kitchen.traverse((child) => {
          if (child.isMesh) {
            child.receiveShadow = true;
            child.castShadow = true;
          }
        });
        scene.add(kitchen);

        // Debug: log kitchen bounding box to find counter surface
        const box = new THREE.Box3().setFromObject(kitchen);
        console.log('Kitchen bounding box:', {
          min: { x: box.min.x, y: box.min.y, z: box.min.z },
          max: { x: box.max.x, y: box.max.y, z: box.max.z },
        });
        console.log('Kitchen center:', box.getCenter(new THREE.Vector3()));
        console.log('Kitchen size:', box.getSize(new THREE.Vector3()));

        resolve(kitchen);
      },
      undefined,
      (err) => {
        console.error('Failed to load kitchen:', err);
        reject(err);
      }
    );
  });
}

function loadIngredient(name, position) {
  return new Promise((resolve) => {
    const normalizedName = name.toLowerCase().trim();
    loader.load(
      `${ASSETS_PATH}/${normalizedName}.glb`,
      (gltf) => {
        const model = gltf.scene;
        model.position.copy(position);
        model.scale.setScalar(INGREDIENT_SCALES[normalizedName] || DEFAULT_SCALE);
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
          }
        });
        model.userData.ingredientName = name;
        scene.add(model);
        ingredientMeshes.push(model);
        resolve(model);
      },
      undefined,
      () => {
        // Fallback: colored sphere placeholder
        const geometry = new THREE.SphereGeometry(0.15, 16, 16);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5),
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.copy(position);
        sphere.castShadow = true;
        sphere.userData.ingredientName = name;
        scene.add(sphere);
        ingredientMeshes.push(sphere);
        console.warn(`No GLB for "${name}", using placeholder sphere`);
        resolve(sphere);
      }
    );
  });
}

function saveCameraState() {
  const state = {
    pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: orbitControls.target.x, y: orbitControls.target.y, z: orbitControls.target.z },
  };
  localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(state));
  console.log('Camera position saved');
}

function resetCameraState() {
  localStorage.removeItem(CAMERA_STORAGE_KEY);
  camera.position.set(0, 1.6, 1.8);
  orbitControls.target.set(0, 1.0, 0);
  orbitControls.update();
  console.log('Camera reset to default');
}

async function handleGenerate3d(imageUrl, boundingBoxes, container) {
  // Use overlay for status messages, container for the 3D canvas
  var overlay = document.getElementById('kitchen3d-overlay');
  if (overlay) overlay.innerHTML = '<p style="color:var(--cream);font-size:14px;">Loading 3D scene...</p>';

  try {
    const res = await fetch('/api/generate3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boundingBoxes }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to process ingredients');

    const ingredients = data.ingredients || [];
    if (!ingredients.length) {
      if (overlay) overlay.innerHTML = '<p style="color:#e55;">No ingredients detected.</p>';
      return;
    }

    // Clear previous scene
    container.innerHTML = '';
    ingredientMeshes = [];
    selectedObject = null;

    // Init Three.js scene
    initScene(container);

    // Load kitchen
    await loadKitchen();

    // Place ingredients on counter
    const spacing = 0.8;
    const baseX = -2.0;
    const counterY = 3.1;
    const counterZ = 0.5;

    await Promise.all(
      ingredients.map((ing, i) => {
        const pos = new THREE.Vector3(baseX + i * spacing, counterY, counterZ);
        return loadIngredient(ing.name, pos);
      })
    );

    // Update overlay with controls
    if (overlay) {
      overlay.innerHTML = '';
      overlay.style.pointerEvents = 'auto';

      // Status text
      const status = document.createElement('p');
      status.style.cssText = 'color:var(--cream);font-size:13px;margin-bottom:8px;';
      status.innerHTML = '<strong>3D Kitchen</strong> — ' + ingredients.length + ' ingredients';
      overlay.appendChild(status);

      const hint = document.createElement('p');
      hint.style.cssText = 'color:var(--cream);opacity:0.5;font-size:11px;margin-bottom:12px;';
      hint.textContent = 'Click an ingredient to select it, then drag to move.';
      overlay.appendChild(hint);

      // Button row
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

      // Unlock Camera
      const camBtn = document.createElement('button');
      camBtn.textContent = 'Unlock Camera';
      camBtn.className = 'kitchen3d-btn';
      camBtn.addEventListener('click', () => {
        orbitControls.enabled = !orbitControls.enabled;
        camBtn.textContent = orbitControls.enabled ? 'Lock Camera' : 'Unlock Camera';
      });
      btnRow.appendChild(camBtn);

      // Move mode
      const moveBtn = document.createElement('button');
      moveBtn.textContent = 'Move';
      moveBtn.className = 'kitchen3d-btn kitchen3d-btn--active';
      moveBtn.addEventListener('click', () => {
        transformControls.setMode('translate');
        moveBtn.classList.add('kitchen3d-btn--active');
        rotBtn.classList.remove('kitchen3d-btn--active');
        scaleBtn.classList.remove('kitchen3d-btn--active');
      });
      btnRow.appendChild(moveBtn);

      // Rotate mode
      const rotBtn = document.createElement('button');
      rotBtn.textContent = 'Rotate';
      rotBtn.className = 'kitchen3d-btn';
      rotBtn.addEventListener('click', () => {
        transformControls.setMode('rotate');
        rotBtn.classList.add('kitchen3d-btn--active');
        moveBtn.classList.remove('kitchen3d-btn--active');
        scaleBtn.classList.remove('kitchen3d-btn--active');
      });
      btnRow.appendChild(rotBtn);

      // Scale mode
      const scaleBtn = document.createElement('button');
      scaleBtn.textContent = 'Scale';
      scaleBtn.className = 'kitchen3d-btn';
      scaleBtn.addEventListener('click', () => {
        transformControls.setMode('scale');
        scaleBtn.classList.add('kitchen3d-btn--active');
        moveBtn.classList.remove('kitchen3d-btn--active');
        rotBtn.classList.remove('kitchen3d-btn--active');
      });
      btnRow.appendChild(scaleBtn);

      overlay.appendChild(btnRow);
    }

    // Enable orbit + set default transform mode
    orbitControls.enabled = false;
    transformControls.setMode('translate');
  } catch (err) {
    if (overlay) overlay.innerHTML = '<p style="color:#e55;">' + escapeHtml(err.message) + '</p>';
  }
}

function addGenerate3dButton(imageUrl, boundingBoxes) {
  if (!boundingBoxes?.length) return;

  const container = document.getElementById('result');

  const section = document.createElement('div');
  section.className = 'analysis analysis--stacked';
  section.id = 'generate3d-section';

  const btn = document.createElement('button');
  btn.textContent = 'View in 3D Kitchen (' + boundingBoxes.length + ' ingredients)';
  btn.className = 'btn-3d';
  btn.addEventListener('click', () => handleGenerate3d(imageUrl, boundingBoxes, section));

  section.appendChild(btn);
  container.appendChild(section);
}

// Expose to global scope for upload.js
window.addGenerate3dButton = addGenerate3dButton;
window.handleGenerate3d = handleGenerate3d;
