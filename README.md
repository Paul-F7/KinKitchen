# Aki — Indigenous Food Reconnection

Aki reconnects people with Indigenous food traditions through AI-powered ingredient recognition, traditional recipes, and immersive 3D/AR experiences. Upload a photo or video of your kitchen or ingredients; the app identifies food, surfaces Indigenous context (e.g. Ojibwe names, cultural uses), suggests recipes from an Indigenous recipes dataset, and guides you through cooking in a step-by-step 3D kitchen with voice (say “next” or “continue”) and TTS.

---

## Our story

### What inspired us

We wanted to help people reconnect with Indigenous foodways—not as a history lesson, but as something you can do in your own kitchen. So many of us are disconnected from where our food comes from and from the knowledge that Indigenous cultures have carried for generations. We were inspired by the Three Sisters (squash, beans, corn) and by the idea that a photo of your counter could become a doorway: to Ojibwe names, to traditional recipes, and to a guided cooking experience that feels both modern (AI, 3D, voice) and rooted. We built Aki so that "what's in my kitchen?" leads to "how do I cook this with respect and care?"

### What we learned

We learned how to weave multiple AI and media services into one flow: Cloudinary for storage and object detection (LVIS), Gemini for Indigenous context and analysis, ElevenLabs for natural-sounding step-by-step voice. We learned how to structure a 3D cooking tutorial as a sequence of small, scripted "step modules" (chop, dice, mince, pour, boil, add veggies, add beans & corn, stir and reveal) so the experience stays smooth and predictable. We also learned how important it is to keep Indigenous context accurate and respectful—surfacing nation and territory, using recipe and story data carefully, and letting the food and the process lead.

### How we built it

We started with a Node + Express backend and a vanilla JS frontend (no framework) so we could move fast and keep the stack simple. The upload pipeline: Multer → Cloudinary (upload + LVIS bounding boxes) → Gemini (analysis + cultural context) → recipe-matcher (ingredient list vs. `indigenous-recipes.json`). The frontend is a single-page app: splash (with a 3D hero), nation picker, upload, detection, recipe list with a "View 3D Kitchen" button, and the 3D kitchen screen. The kitchen is a Three.js scene that loads GLB models for ingredients, a cutting board, pot, and finished stew; `CookingGuide` runs an 8-step overlay and coordinates step modules (Step1Chop through Step8Stir). Each step can speak via ElevenLabs TTS, and we added voice control so users can say "next" or "continue" to advance. Story narration and AR storyboard (CookingAR) round out the experience.

### Challenges we faced

- **Integrating many APIs** — Cloudinary, Gemini, ElevenLabs (and optionally Hugging Face) had different auth, rate limits, and response shapes. We had to normalize errors, handle missing keys gracefully, and keep the UI responsive while waiting on external calls.
- **3D pipeline and step choreography** — Making chop, dice, mince, pour, boil, and stir feel consistent meant building separate step modules with clear phases (e.g. board in, ingredient to board, knife animation, pile reveal, board out). Syncing visibility and positions (cutting board, pot, stew) across steps and keeping performance smooth was tricky.
- **Merging different versions** — We had one branch focused on recipe list, 3D button, and voice, and another with the "finish" (pot, stew, full 8-step flow). Combining them required carefully bringing over new assets and step modules without breaking the existing flow.
- **Voice and accessibility** — We wanted "Listen" and voice "next/continue" to work across browsers; we had to handle Web Speech API support and fallbacks and keep TTS and UI in sync.

---

## Table of contents

- [Our story](#our-story)
- [Quick start](#quick-start)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Data flow](#data-flow)
- [API reference](#api-reference)
- [Frontend structure](#frontend-structure)
- [Environment & run](#environment--run)

---

## Quick start

```bash
cp .env.example .env   # add your API keys (see below)
npm run install:backend
npm run dev
```

Open `http://localhost:3000`. Upload an image (or use a demo filename like `threesisters`), then choose **View 3D Kitchen** to run the full 8-step cooking guide (chop squash → dice onion → mince garlic → pour stock → boil → add veggies → add beans & corn → stir & reveal stew).

---

## Tech stack

### Frontend

| Layer | Technology | Purpose |
|-------|------------|--------|
| **Markup / UI** | HTML5, CSS3 | Single-page app: splash, nation picker, upload, detection, recipe, AR, story, word, 3D kitchen. Styles: `styles.css`, `aki-ui.css`. |
| **Fonts** | Google Fonts (Playfair Display, DM Sans) | Typography. |
| **Runtime** | Vanilla JavaScript (ES5+ strict) | Navigation (`app.js`), upload (`upload.js`), renderers (`render.js`), story (`story.js`). |
| **3D** | Three.js (r150+) | 3D kitchen: GLB meshes, OrbitControls, TransformControls, `xrCompatible: true` for WebXR. |
| **3D loading** | GLTFLoader | Ingredients from `/assets/3d/*.glb`; positions/scales from `ingredientPositions.js`. |
| **Cooking guide** | Custom (CookingGuide) | 8-step overlay: chop/dice/mince (Step1–3), pour stock (Step4), boil (Step5), add veggies (Step6), add beans & corn (Step7), stir & reveal stew (Step8). Listen + voice “next/continue”. |
| **AR** | CookingAR | 4-scene storyboard; knife chop, cultural text. |
| **Audio** | Web Audio API, ElevenLabs | Chimes; step TTS and story narration via `/api/tts`, `/api/story-audio`. |
| **HTTP** | Fetch API | `POST /api/upload`, `GET /api/tts`, `GET /api/story-audio`, etc. |

### Backend

| Layer | Technology | Purpose |
|-------|------------|--------|
| **Runtime** | Node.js | Server. |
| **Framework** | Express 4.x | Static files, JSON/urlencoded, API routes, 404/500. |
| **Config** | dotenv | `.env` (PORT, API keys). |
| **Upload** | Multer | In-memory/disk uploads; validation; `backend/uploads/`. |
| **HTTPS** | Node `https` | Cloudinary, Hugging Face. |

### External services

| Service | Role | Env vars |
|---------|------|----------|
| **Cloudinary** | Storage, CDN; LVIS detection; Analyze API (images). | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| **Google Gemini** | Image/video analysis: Indigenous context, objects, recipe suggestions. | `GEMINI_API_KEY` |
| **ElevenLabs** | TTS: story narration, step instructions. | `ELEVENLABS_API_KEY` or `ELEVEN_LABS_API_KEY` |
| **Hugging Face** | Depth, BLIP captioning (optional). | `HF_TOKEN` or `REACT_APP_HF_TOKEN` |

### Data & assets

- `backend/data/indigenous-recipes.json` — recipes for matching.
- `backend/data/recipe-stories.json` — story scripts per recipe.
- `assets/3d/*.glb` — ingredient and kitchen models (cutting board, pot, stew, minced garlic, etc.).

---

## Architecture

### High-level

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Browser (SPA)                                                               │
│  app.js │ upload.js │ render.js │ generate3d.js (+ CookingGuide, step 1–8)  │
│                          ▼                ▼                                  │
│                   /api/upload   /api/tts   /api/story-audio   /api/health    │
└──────────────────────────┼─────────────────┼────────────────────────────────┘
                           ▼                 ▼
┌──────────────────────────▼─────────────────▼────────────────────────────────┐
│  Node + Express                                                            │
│  routes: upload, story, hf, generate3d                                     │
│  services: cloudinary, gemini, elevenlabs, recipe-matcher, food-filter     │
│  → Cloudinary │ Gemini │ ElevenLabs │ indigenous-recipes.json               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Directory structure

```
video-analyzer/
├── backend/
│   ├── server.js
│   ├── routes/          # upload, story, hf, generate3d
│   ├── services/        # cloudinary, gemini, elevenlabs, recipe-matcher, food-filter, crop, …
│   ├── data/            # indigenous-recipes.json, recipe-stories.json
│   └── uploads/
├── frontend/
│   ├── index.html
│   ├── styles.css, aki-ui.css
│   └── js/
│       ├── app.js           # AkiApp: goTo(), state, nation, nav
│       ├── upload.js        # POST /api/upload, progress, 3D vs detect
│       ├── render.js        # AkiRender: renderDetection, renderRecipe, renderStory, renderWord
│       ├── generate3d.js    # Three.js scene, GLBs, CookingGuide, WebXR
│       ├── cookingGuide.js  # 8-step overlay, TTS, voice “next/continue”
│       ├── ingredientPositions.js
│       ├── steps/           # Step1Chop, Step2Chop, Step3Garlic, Step4Stock, Step5Boil,
│       │                    # Step6Veggies, Step7BeansCorn, Step8Stir
│       ├── story.js, ar.js, hero3d.js, glow.js, tiltCard.js, …
│       └── …
├── assets/3d/           # *.glb (ingredients, pot, stew, minced-garlic, cutting-board, …)
├── .env.example, .env
├── package.json
└── README.md
```

### Screens

**splash** → nation → **upload** → **detect** → **recipe** | **ar** | **story** | **word** | **kitchen3d**

- `AkiApp.state.uploadData` holds the last `/api/upload` response.
- **kitchen3d**: `handleGenerate3d(imageUrl, boundingBoxes, container)` builds the scene and mounts CookingGuide (8 steps, voice, Listen).

---

## Data flow

### Upload

1. User picks file (or “View 3D Kitchen” with file).
2. Frontend: `POST /api/upload` (FormData).
3. Backend: Multer → optional demo preset (e.g. `threesisters`) or Cloudinary upload + Gemini analyze + recipe-matcher.
4. Response: `url`, `analysis`, `boundingBoxes`, `suggestedRecipes`, `thumbnailUrl`, `posterUrl`.
5. Frontend: store in `AkiApp.state.uploadData`, render screens, then `goTo('detect')` or `goTo('kitchen3d')` + `handleGenerate3d(...)`.

### 3D kitchen & cooking guide

1. **generate3d.js** builds scene, loads GLBs from `/assets/3d/`, places with `ingredientPositions.js`.
2. **CookingGuide.init(scene, camera, renderer, meshes)** builds overlay and 8-step flow (Step1Chop … Step8Stir).
3. Each step: TTS via `GET /api/tts?text=<step.title>`; “Listen” replays; voice “next”/“continue” advances.
4. WebXR when supported; otherwise fullscreen 3D.

### Story & TTS

- Story: `GET /api/story?recipeId=...`, `GET /api/story-audio?recipeId=...` (ElevenLabs).
- Step TTS: `GET /api/tts?text=...` for phrases like “Cube the squash”.

---

## API reference

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/health` | Service status (elevenlabs, gemini, cloudinary, huggingface). |
| POST | `/api/upload` | Multipart upload → URL, analysis, boundingBoxes, suggestedRecipes, thumbnailUrl, posterUrl. |
| GET | `/api/story?recipeId=...` | `{ title, script }`. |
| GET | `/api/story-audio?recipeId=...` | MP3 story (ElevenLabs). |
| GET | `/api/tts?text=...` | MP3 step phrase (max 300 chars). |
| POST | `/api/generate3d` | `{ boundingBoxes }` → `{ ingredients }`. |
| POST | `/api/hf/depth` | Image crop → depth map. |
| POST | `/api/hf/segment` | Image crop → caption/shape. |

---

## Frontend structure

- **app.js** — Screens, `goTo()`, state, nation, nav, 3D kitchen entry.
- **upload.js** — File input, progress, `POST /api/upload`, render + navigate.
- **render.js** — Detection, recipe, story, word from `uploadData`; recipe list + 3D button.
- **generate3d.js** — Scene, GLBs, CookingGuide, WebXR/fullscreen.
- **cookingGuide.js** — 8 steps, knife/spoon/steam/particles, overlay, TTS, voice.
- **steps/** — Step1Chop, Step2Chop, Step3Garlic, Step4Stock, Step5Boil, Step6Veggies, Step7BeansCorn, Step8Stir.
- **story.js** — Story modal, audio playback.
- **ar.js** — CookingAR storyboard.

---

## Environment & run

1. Copy `.env.example` to `.env` and set:
   - **Cloudinary**: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
   - **Gemini**: `GEMINI_API_KEY`
   - **ElevenLabs**: `ELEVENLABS_API_KEY` (or `ELEVEN_LABS_API_KEY`)
   - **Hugging Face** (optional): `HF_TOKEN` or `REACT_APP_HF_TOKEN`
   - **PORT** (default 3000)

2. Install and run:
   ```bash
   npm run install:backend
   npm run dev
   ```
   Server at `http://localhost:3000`; frontend and `/assets` served by the same process.

3. **Health**: `GET http://localhost:3000/api/health` shows which services have keys.

---

This README documents the tech stack and architecture of Aki. For product/design overview, add a short “About Aki” section at the top if needed.
